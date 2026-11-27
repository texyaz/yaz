//! The yaz web server: the application's commands over HTTP.
//!
//! For a yaz that runs on one machine and is used from a browser on another —
//! a workstation or a VM that holds the project and the TeX installation, and
//! a laptop that holds neither ([ADR-0030]).
//!
//! # How a command gets here
//!
//! The frontend built in web mode replaces Tauri's `invoke` with a `fetch` to
//! `POST /api/invoke/<command>`, carrying the same JSON arguments. This program
//! hands that to **the same handler the desktop application registers**, built
//! on Tauri's mock runtime, so there is no second list of commands and no
//! second copy of how an argument is decoded. A command added to
//! [`yaz_app::install`] is served here without touching this file.
//!
//! # What it trusts
//!
//! Nothing it can check, and the rest is stated rather than assumed. These
//! commands read and write files and run a TeX engine, so reaching this port
//! is equivalent to a shell as the user who started it. The server therefore:
//!
//! - has **no default address** that is reachable from elsewhere: it listens
//!   on loopback unless told otherwise;
//! - refuses a request whose `Host` is not one it was started for, which is
//!   what stops a DNS-rebinding page from talking to it;
//! - refuses an `/api` request without the `x-yaz-web` header, which a page on
//!   another origin cannot send without a preflight this server never answers.
//!
//! By itself it does **not** authenticate anybody. Put it on an interface only
//! you can reach — a VPN address, or loopback behind an SSH forward.
//!
//! Started with `--oidc-issuer` it asks an identity provider who is there and
//! serves only the people named with `--allow` ([ADR-0033], [`sign_in`]). That
//! decides who reaches the server; it does not divide it between them. The page
//! asks `GET /auth/me` who is signed in, to say so and to offer to sign out;
//! without sign-in that answers 204.
//!
//! [ADR-0033]: https://github.com/texyaz/yaz/blob/main/docs/adr/0033-the-web-server-can-ask-who-is-there.md
//! [ADR-0030]: https://github.com/texyaz/yaz/blob/main/docs/adr/0030-a-web-server-hosts-the-same-commands.md

#![deny(unsafe_code)]
#![warn(clippy::all)]

#[path = "web_collab.rs"]
mod collab;
#[path = "web_sign_in.rs"]
mod sign_in;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, bail};
use axum::Router;
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, Request, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde_json::{Value, json};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{INVOKE_KEY, MockRuntime};
use tauri::webview::InvokeRequest;
use tower_http::compression::CompressionLayer;
use tower_http::services::{ServeDir, ServeFile};

/// The header a page must send with every `/api` request.
const MARKER: &str = "x-yaz-web";

/// The largest request body accepted.
///
/// A pasted picture crosses as a JSON array of numbers, which is four times
/// the size of the picture, so this is generous on purpose.
const BODY_LIMIT: usize = 256 * 1024 * 1024;

/// What the command line asked for.
struct Options {
    listen: SocketAddr,
    dist: PathBuf,
    hosts: Vec<String>,
    zotero: Option<yaz_zotero::local_api::Endpoint>,
    sign_in: Option<sign_in::Settings>,
    /// Whether the projects this server opens are shared sessions (ADR-0035).
    share: bool,
}

const USAGE: &str = "\
yaz-web — serve yaz to a browser

USAGE:
    yaz-web --dist <DIR> [--listen <ADDR:PORT>] [--allow-host <NAME>]...
            [--zotero <HOST[:PORT]>] [--share]
            [--oidc-issuer <URL> --oidc-client-id <ID> --public-url <URL>
             --allow <WHO>...]

OPTIONS:
    --dist <DIR>          The frontend built with `pnpm web:build:server`
                          (apps/desktop/dist-web).
    --listen <ADDR:PORT>  Where to listen. Default 127.0.0.1:4173.
    --allow-host <NAME>   A further name the server may be addressed by, such
                          as a VPN DNS name. The listen address and localhost
                          are always allowed. Repeatable.
    --zotero <HOST[:PORT]>
                          Read Zotero from another machine: the address its
                          port 23119 is forwarded to, e.g. over a VPN with
                          `tailscale serve --tcp 23119 tcp://127.0.0.1:23119`
                          on the machine Zotero runs on. Without this, Zotero
                          is looked for on the machine the server runs on.
    --share               Let several people edit one project at once. Every
                          project this server opens becomes a session that
                          keeps one copy of its text files, writes them into
                          the folder a moment after they change, and shows
                          each person where the others are typing. Without
                          it, a page saves a whole file and the last save
                          wins. A file that somebody else changes in the
                          folder meanwhile wins over a session's text, which
                          is then kept beside it as <name>.kept-<time>.<ext>.

SIGN-IN (all four together; the client secret is read from the environment
variable YAZ_WEB_OIDC_SECRET):
    --oidc-issuer <URL>   An OpenID Connect provider, e.g. a Keycloak realm:
                          https://sso.example.org/realms/company
    --oidc-client-id <ID> The client this server is registered as there, with
                          <public-url>/auth/callback as its redirect address.
    --public-url <URL>    The https address people open this server at.
    --allow <WHO>         Who may sign in: an e-mail address, a user name or a
                          group the provider reports. Repeatable.

The page shows who is signed in (name, e-mail address and, if the provider
has an https `picture` for them, the picture, which the browser loads itself)
with a menu to sign out.

Reaching this port is equivalent to a shell as the user running it. Without
sign-in there is no authentication: listen only where you alone can reach.
With sign-in, everybody named with --allow has that shell and can open any
folder the user running this can read.";

impl Options {
    fn parse(mut arguments: impl Iterator<Item = String>) -> anyhow::Result<Self> {
        let mut listen: SocketAddr = ([127, 0, 0, 1], 4173).into();
        let mut dist = None;
        let mut hosts = Vec::new();
        let mut zotero = None;
        let mut issuer = None;
        let mut client_id = None;
        let mut public_url = None;
        let mut allow = Vec::new();
        let mut share = false;

        while let Some(argument) = arguments.next() {
            let mut value = || {
                arguments
                    .next()
                    .with_context(|| format!("{argument} needs a value"))
            };
            match argument.as_str() {
                "--listen" => {
                    listen = value()?
                        .parse()
                        .context("--listen takes an address and a port, e.g. 127.0.0.1:4173")?;
                }
                "--dist" => dist = Some(PathBuf::from(value()?)),
                "--allow-host" => hosts.push(value()?.to_ascii_lowercase()),
                "--zotero" => {
                    zotero = Some(
                        yaz_zotero::local_api::Endpoint::parse(&value()?)
                            .context("--zotero takes a host and a port, e.g. laptop:23119")?,
                    );
                }
                "--share" => share = true,
                "--oidc-issuer" => issuer = Some(value()?),
                "--oidc-client-id" => client_id = Some(value()?),
                "--public-url" => public_url = Some(value()?),
                "--allow" => allow.push(value()?),
                "-h" | "--help" => {
                    println!("{USAGE}");
                    std::process::exit(0);
                }
                other => bail!("unknown argument {other}\n\n{USAGE}"),
            }
        }

        let dist = dist.with_context(|| format!("--dist is required\n\n{USAGE}"))?;
        if !dist.join("index.html").is_file() {
            bail!(
                "{} has no index.html — build the frontend with `pnpm web:build:server`",
                dist.display()
            );
        }

        hosts.push(listen.ip().to_string());
        hosts.push("localhost".to_owned());
        hosts.push("127.0.0.1".to_owned());

        let sign_in = match (issuer, client_id, public_url) {
            (Some(issuer), Some(client_id), Some(public_url)) => {
                // The address people sign in at is one the server answers to.
                let name = url::Url::parse(&public_url)
                    .ok()
                    .and_then(|address| address.host_str().map(str::to_ascii_lowercase))
                    .context("--public-url takes an address, e.g. https://yaz.example.org")?;
                hosts.push(name);
                Some(sign_in::Settings {
                    issuer,
                    client_id,
                    public_url,
                    allow,
                })
            }
            (None, None, None) if allow.is_empty() => None,
            _ => bail!(
                "sign-in needs --oidc-issuer, --oidc-client-id and --public-url together\n\n{USAGE}"
            ),
        };

        Ok(Self {
            listen,
            dist,
            hosts,
            zotero,
            sign_in,
            share,
        })
    }
}

/// What every request handler shares.
struct Shared {
    /// The mock runtime's one webview: the thing a command is invoked *on*.
    webview: tauri::WebviewWindow<MockRuntime>,
    hosts: Vec<String>,
    /// Set when the server was started with an identity provider to ask.
    sign_in: Option<sign_in::SignIn>,
    /// The session host: shares nothing unless the server was started with
    /// `--share`.
    collab: yaz_collab::Host,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let clock = yaz_app::StartupClock::now();
    yaz_app::start_logging("web");

    let options = Options::parse(std::env::args().skip(1))?;

    // One runtime, not two: without this Tauri starts its own, and an async
    // command would run on a different executor from the server that awaits it.
    tauri::async_runtime::set(tokio::runtime::Handle::current());

    let app = yaz_app::install(tauri::test::mock_builder(), clock)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .context("could not build the command handler")?;
    if let Some(endpoint) = options.zotero {
        tracing::info!(%endpoint, "reading Zotero from another machine");
        yaz_app::use_remote_zotero(&app, endpoint);
    }
    let collab = if options.share {
        let state_dir = yaz_core::settings::config_dir()
            .context("--share needs a place for its state, and this machine has no configuration directory")?
            .join("collab");
        tracing::info!("every project this server opens is a shared session");
        yaz_app::use_sharing(&app, yaz_collab::HostConfig::sharing(state_dir))
    } else {
        yaz_collab::Host::disabled()
    };
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
        .build()
        .context("could not create the handler's webview")?;

    let sign_in = options.sign_in.map(sign_in::SignIn::new).transpose()?;
    let asks = sign_in.as_ref().map(|sign_in| sign_in.issuer().to_owned());
    let shared = Arc::new(Shared {
        webview,
        hosts: options.hosts,
        sign_in,
        collab,
    });

    let router = router(shared, &options.dist);

    let listener = tokio::net::TcpListener::bind(options.listen)
        .await
        .with_context(|| format!("could not listen on {}", options.listen))?;

    if let Some(issuer) = &asks {
        tracing::info!(%issuer, "asking an identity provider who is there");
    } else if !options.listen.ip().is_loopback() {
        tracing::warn!(
            address = %options.listen,
            "listening beyond loopback with no authentication: anyone who can reach this \
             address can read and write files as this user"
        );
    }
    tracing::info!(url = %format!("http://{}", options.listen), "yaz web server ready");

    axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .context("the server stopped")?;

    // Held until here: dropping the application drops the state the commands
    // were reading.
    drop(app);
    Ok(())
}

/// Every route of the server, with the checks every request goes through.
fn router(shared: Arc<Shared>, dist: &std::path::Path) -> Router {
    let index = dist.join("index.html");
    let api = Router::new()
        .route("/invoke/{command}", post(invoke))
        .route("/web/info", get(info))
        .layer(middleware::from_fn(require_marker))
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        // After the layers above, so that it is not behind the marker header:
        // a browser cannot set a header on a WebSocket. It is let in by the
        // session, and by an Origin that matches the Host, instead.
        .route("/collab/link", get(collab::link));

    Router::new()
        .nest("/api", api)
        .route("/auth/{step}", get(sign_in_step))
        .fallback_service(ServeDir::new(dist).fallback(ServeFile::new(index)))
        .layer(middleware::from_fn(revalidate_pages))
        .layer(CompressionLayer::new())
        .layer(middleware::from_fn_with_state(
            Arc::clone(&shared),
            require_session,
        ))
        .layer(middleware::from_fn_with_state(
            Arc::clone(&shared),
            require_known_host,
        ))
        .with_state(shared)
}

/// Make a browser ask again for the page, while keeping what the page loads.
///
/// The files a build produces carry a hash of their contents in their names,
/// so they may be kept forever; the page that names them has the same name
/// after every build. Sent without this, a browser guessed how long to keep it
/// and went on showing the previous build after a new one was in place.
async fn revalidate_pages(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let is_page = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|kind| kind.starts_with("text/html"));
    if is_page {
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            header::HeaderValue::from_static("no-cache"),
        );
    }
    response
}

/// Refuse a request addressed to a name this server was not started for.
async fn require_known_host(
    State(shared): State<Arc<Shared>>,
    request: Request,
    next: Next,
) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .map(host_without_port)
        .unwrap_or_default();

    if !shared.hosts.contains(&host) {
        tracing::warn!(%host, "refused a request for a host this server was not started for");
        return (
            StatusCode::MISDIRECTED_REQUEST,
            "yaz-web was not started for this host name; see --allow-host",
        )
            .into_response();
    }
    next.run(request).await
}

/// With sign-in on, serve only somebody who signed in.
///
/// A page that is asked for without a session leads to the provider and back;
/// an API request is refused, and the page that sent it starts the sign-in.
async fn require_session(
    State(shared): State<Arc<Shared>>,
    request: Request,
    next: Next,
) -> Response {
    let Some(sign_in) = &shared.sign_in else {
        return next.run(request).await;
    };
    let path = request.uri().path();
    if path.starts_with("/auth/") || sign_in.signed_in(&request) {
        return next.run(request).await;
    }
    if path.starts_with("/api/") {
        return (StatusCode::UNAUTHORIZED, "not signed in").into_response();
    }
    let wanted = request
        .uri()
        .path_and_query()
        .map_or("/", |wanted| wanted.as_str());
    (
        StatusCode::FOUND,
        [(header::LOCATION, login_address(wanted))],
    )
        .into_response()
}

/// `/auth/login` for a person who wanted `wanted`, path and query both: a
/// link such as `/?project=%2Fwork%2Fpaper` must come back to itself after the
/// provider.
fn login_address(wanted: &str) -> String {
    format!(
        "/auth/login?{}",
        url::form_urlencoded::Serializer::new(String::new())
            .append_pair("next", wanted)
            .finish()
    )
}

/// What `/auth/...` answers when the server was started without sign-in.
///
/// `/auth/me` is the one step the page asks without knowing whether there is
/// anybody to ask, so it gets 204 — success, nobody — and not an error the
/// browser would print to the console. Every other step is 404: there is no
/// such page.
fn without_sign_in(step: &str) -> Response {
    match step {
        "me" => StatusCode::NO_CONTENT.into_response(),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

/// `/auth/login`, `/auth/callback`, `/auth/logout` and `/auth/me`.
async fn sign_in_step(
    State(shared): State<Arc<Shared>>,
    Path(step): Path<String>,
    request: Request,
) -> Response {
    let Some(sign_in) = &shared.sign_in else {
        return without_sign_in(&step);
    };
    match step.as_str() {
        "me" => sign_in.me(sign_in::session_of(&request)),
        "login" => {
            let wanted = sign_in::wanted(&request);
            drop(request);
            sign_in.login(wanted).await
        }
        "callback" => {
            let back = sign_in::Back::of(&request);
            drop(request);
            sign_in.finish(back).await
        }
        "logout" => {
            let session = sign_in::session_of(&request);
            drop(request);
            sign_in.logout(session).await
        }
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

/// `example.org:4173` → `example.org`, and `[::1]:4173` → `::1`.
fn host_without_port(host: &str) -> String {
    let host = host.trim().to_ascii_lowercase();
    if let Some(rest) = host.strip_prefix('[') {
        return rest.split(']').next().unwrap_or_default().to_owned();
    }
    match host.rsplit_once(':') {
        Some((name, port)) if port.chars().all(|c| c.is_ascii_digit()) => name.to_owned(),
        _ => host,
    }
}

/// Refuse an API request that did not come from the yaz frontend.
async fn require_marker(request: Request, next: Next) -> Response {
    if !request.headers().contains_key(MARKER) {
        return (StatusCode::FORBIDDEN, "missing x-yaz-web header").into_response();
    }
    next.run(request).await
}

/// What the frontend needs to know about the machine it is talking to.
async fn info() -> axum::Json<Value> {
    // Where a "choose a folder" prompt starts. The browser has no view of this
    // machine's disk, so the path is typed, and typing from `/` is unkind.
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    axum::Json(json!({ "home": home }))
}

/// Run one command and answer with what it returned.
async fn invoke(
    State(shared): State<Arc<Shared>>,
    Path(command): Path<String>,
    body: Bytes,
) -> Response {
    let arguments: Value = if body.is_empty() {
        json!({})
    } else {
        match serde_json::from_slice(&body) {
            Ok(arguments) => arguments,
            Err(error) => {
                return (
                    StatusCode::BAD_REQUEST,
                    format!("arguments are not JSON: {error}"),
                )
                    .into_response();
            }
        }
    };

    let request = InvokeRequest {
        cmd: command,
        callback: CallbackFn(0),
        error: CallbackFn(1),
        // The application's own origin, so the command is treated as coming
        // from the application's own window and not from a remote page.
        url: "tauri://localhost".parse().expect("a constant URL"),
        body: InvokeBody::Json(arguments),
        headers: HeaderMap::default(),
        invoke_key: INVOKE_KEY.to_owned(),
    };

    // Blocking: the helper waits on a channel for the command's answer, and a
    // synchronous command (a compile, say) runs for as long as it runs.
    let webview = shared.webview.clone();
    let outcome =
        tokio::task::spawn_blocking(move || tauri::test::get_ipc_response(&webview, request)).await;

    match outcome {
        Ok(Ok(InvokeResponseBody::Json(json))) => {
            ([(header::CONTENT_TYPE, "application/json")], json).into_response()
        }
        Ok(Ok(InvokeResponseBody::Raw(bytes))) => {
            ([(header::CONTENT_TYPE, "application/octet-stream")], bytes).into_response()
        }
        // The command's own error, as the value Tauri would have rejected the
        // promise with. 422 rather than 500: the server is fine.
        Ok(Err(error)) => (StatusCode::UNPROCESSABLE_ENTITY, axum::Json(error)).into_response(),
        Err(error) => {
            tracing::error!(%error, "a command panicked");
            (StatusCode::INTERNAL_SERVER_ERROR, "the command failed").into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;

    use super::{host_without_port, login_address, sign_in, without_sign_in};

    #[test]
    fn a_port_is_not_part_of_the_name() {
        assert_eq!(host_without_port("Example.org:4173"), "example.org");
        assert_eq!(host_without_port("100.64.0.1:4173"), "100.64.0.1");
        assert_eq!(host_without_port("localhost"), "localhost");
        assert_eq!(host_without_port("[::1]:4173"), "::1");
    }

    #[test]
    fn without_sign_in_only_me_is_answered() {
        // The page asks who is there before it knows whether anybody could be.
        assert_eq!(without_sign_in("me").status(), StatusCode::NO_CONTENT);
        for step in ["login", "callback", "logout", "other"] {
            assert_eq!(without_sign_in(step).status(), StatusCode::NOT_FOUND);
        }
    }

    #[test]
    fn the_query_of_a_link_survives_the_trip_to_the_provider() {
        for wanted in [
            "/?project=%2Fwork%2Fpaper",
            "/?a=1&project=%2Fwork%2Fmy%20paper%26more&b=%25",
            "/",
        ] {
            let login = login_address(wanted);
            let request = axum::http::Request::builder()
                .uri(&login)
                .body(axum::body::Body::empty())
                .expect("a request");
            // What `/auth/login` is handed, and what it sends the person on to
            // once they are back.
            assert_eq!(sign_in::wanted(&request).as_deref(), Some(wanted));
        }
    }
}

/// The link route, on a server that really listens: what a browser's
/// WebSocket would meet.
#[cfg(test)]
mod collab_tests {
    use std::net::SocketAddr;
    use std::time::Duration;

    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::{Error as SocketError, Message as Frame};
    use yrs::sync::{Awareness, DefaultProtocol, Message, Protocol, SyncMessage};
    use yrs::updates::encoder::Encode;
    use yrs::{Doc, GetString, Map, MapRef, OffsetKind, Options, Out, ReadTxn, Text, Transact};

    use super::*;

    /// A server on a free loopback port, with a project folder to share.
    struct Server {
        address: SocketAddr,
        project: tempfile::TempDir,
        // Held for as long as the server runs: dropping the application drops
        // the state the commands read.
        _app: tauri::App<MockRuntime>,
    }

    fn quick() -> yaz_collab::Timing {
        yaz_collab::Timing {
            idle: Duration::from_millis(30),
            busiest: Duration::from_millis(200),
            linger: Duration::from_millis(500),
            flush: Duration::from_millis(600),
            rescan: Duration::from_millis(100),
            retry: Duration::from_millis(20),
        }
    }

    async fn serve(share: bool, sign_in: Option<sign_in::SignIn>) -> Server {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("main.tex"), "middle\n").unwrap();
        let dist = tempfile::tempdir().unwrap();
        std::fs::write(dist.path().join("index.html"), "<html></html>").unwrap();

        let app = yaz_app::install(tauri::test::mock_builder(), yaz_app::StartupClock::now())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let collab = if share {
            let mut config = yaz_collab::HostConfig::sharing("unused".into());
            config.timing = quick();
            yaz_app::use_sharing(&app, config)
        } else {
            yaz_collab::Host::disabled()
        };
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
            .build()
            .unwrap();
        let shared = Arc::new(Shared {
            webview,
            hosts: vec!["127.0.0.1".to_owned(), "localhost".to_owned()],
            sign_in,
            collab,
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let router = router(shared, dist.path());
        tokio::spawn(async move {
            let _dist = dist;
            axum::serve(listener, router).await.unwrap();
        });
        Server {
            address,
            project,
            _app: app,
        }
    }

    impl Server {
        fn root(&self) -> String {
            self.project.path().to_str().unwrap().replace('/', "%2F")
        }

        fn request(
            &self,
            origin: Option<&str>,
        ) -> tokio_tungstenite::tungstenite::handshake::client::Request {
            let mut request = format!("ws://{}/api/collab/link?root={}", self.address, self.root())
                .into_client_request()
                .unwrap();
            if let Some(origin) = origin {
                request
                    .headers_mut()
                    .insert("origin", origin.parse().unwrap());
            }
            request
        }

        fn origin(&self) -> String {
            format!("http://{}", self.address)
        }
    }

    async fn refused_with(server: &Server, origin: Option<&str>) -> StatusCode {
        match tokio_tungstenite::connect_async(server.request(origin)).await {
            Err(SocketError::Http(response)) => response.status(),
            other => panic!("the link was let in: {:?}", other.map(|_| ())),
        }
    }

    #[tokio::test]
    async fn a_link_without_an_origin_or_with_a_foreign_one_gets_403() {
        let server = serve(true, None).await;
        assert_eq!(refused_with(&server, None).await, StatusCode::FORBIDDEN);
        assert_eq!(
            refused_with(&server, Some("https://evil.example")).await,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            refused_with(&server, Some("null")).await,
            StatusCode::FORBIDDEN
        );
    }

    #[tokio::test]
    async fn a_link_without_a_session_gets_401_when_sign_in_is_on() {
        let sign_in = sign_in::SignIn::with_secret(
            sign_in::Settings {
                issuer: "https://idp.example".to_owned(),
                client_id: "yaz".to_owned(),
                public_url: "https://yaz.example".to_owned(),
                allow: vec!["somebody".to_owned()],
            },
            "secret".to_owned(),
        )
        .unwrap();
        let server = serve(true, Some(sign_in)).await;
        let origin = server.origin();
        assert_eq!(
            refused_with(&server, Some(&origin)).await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn without_share_the_link_says_so_and_closes() {
        let server = serve(false, None).await;
        let (mut socket, _) =
            tokio_tungstenite::connect_async(server.request(Some(&server.origin())))
                .await
                .unwrap();
        let Some(Ok(Frame::Binary(hello))) = socket.next().await else {
            panic!("no hello");
        };
        // Tag 100, a one-byte length (it is under 128), then the JSON.
        assert_eq!(hello[0], 100);
        let message: Value = serde_json::from_slice(&hello[2..]).unwrap();
        assert_eq!(message["state"], "unavailable");
        assert_eq!(message["reason"], "error-collab-not-shared");
        assert!(matches!(
            socket.next().await,
            Some(Ok(Frame::Close(_)) | Err(_)) | None
        ));
    }

    /// A page: a document and an awareness, and the frames by hand.
    struct Page {
        socket: tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        awareness: Awareness,
        files: MapRef,
    }

    impl Page {
        async fn open(server: &Server) -> Page {
            let (socket, _) =
                tokio_tungstenite::connect_async(server.request(Some(&server.origin())))
                    .await
                    .unwrap();
            let doc = Doc::with_options(Options {
                offset_kind: OffsetKind::Utf16,
                ..Options::default()
            });
            let files = doc.get_or_insert_map("files");
            let mut page = Page {
                socket,
                awareness: Awareness::new(doc),
                files,
            };
            // The host speaks first, and the page only after `hello`.
            let hello = page.next_frame().await;
            assert_eq!(hello[0], 100);
            let state = page.awareness.doc().transact().state_vector();
            page.send(&Message::Sync(SyncMessage::SyncStep1(state)))
                .await;
            page
        }

        async fn next_frame(&mut self) -> Vec<u8> {
            match tokio::time::timeout(Duration::from_secs(5), self.socket.next()).await {
                Ok(Some(Ok(Frame::Binary(bytes)))) => bytes.to_vec(),
                other => panic!("no frame: {:?}", other.map(|_| ())),
            }
        }

        async fn send(&mut self, message: &Message) {
            self.socket
                .send(Frame::Binary(message.encode_v1().into()))
                .await
                .unwrap();
        }

        /// Handle frames until the text of `main.tex` is `wanted`.
        async fn until(&mut self, wanted: impl Fn(&str) -> bool) -> String {
            loop {
                if let Some(text) = self.text() {
                    if wanted(&text) {
                        return text;
                    }
                }
                let frame = self.next_frame().await;
                if frame[0] == 100 {
                    continue;
                }
                for response in DefaultProtocol.handle(&mut self.awareness, &frame).unwrap() {
                    self.send(&response).await;
                }
            }
        }

        fn text(&self) -> Option<String> {
            let txn = self.awareness.doc().transact();
            match self.files.get(&txn, "main.tex") {
                Some(Out::YText(text)) => Some(text.get_string(&txn)),
                _ => None,
            }
        }

        async fn type_at(&mut self, index: u32, chunk: &str) {
            let doc = self.awareness.doc().clone();
            let before = doc.transact().state_vector();
            let text = match self.files.get(&doc.transact(), "main.tex") {
                Some(Out::YText(text)) => text,
                _ => panic!("the file is not in the page"),
            };
            text.insert(&mut doc.transact_mut(), index, chunk);
            let update = doc.transact().encode_diff_v1(&before);
            self.send(&Message::Sync(SyncMessage::Update(update))).await;
        }
    }

    #[tokio::test]
    async fn two_pages_converge_through_the_route_and_the_file_follows() {
        let server = serve(true, None).await;
        let mut one = Page::open(&server).await;
        let mut two = Page::open(&server).await;
        one.until(|text| text == "middle\n").await;
        two.until(|text| text == "middle\n").await;

        // Both type before either has heard of the other.
        one.type_at(0, "one: ").await;
        two.type_at(7, "two: ").await;
        let both = |text: &str| text.contains("one: ") && text.contains("two: ");
        let seen_by_one = one.until(both).await;
        let seen_by_two = two.until(both).await;
        assert_eq!(seen_by_one, seen_by_two);

        let on_disk = server.project.path().join("main.tex");
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::fs::read_to_string(&on_disk).unwrap() != seen_by_one {
            assert!(
                std::time::Instant::now() < deadline,
                "the file never followed"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    /// Call a command as the page's `fetch` does.
    async fn invoke(server: &Server, command: &str, body: Value) -> (StatusCode, Value) {
        let response = reqwest::Client::new()
            .post(format!("http://{}/api/invoke/{command}", server.address))
            .header(MARKER, "1")
            .json(&body)
            .send()
            .await
            .unwrap();
        let status = StatusCode::from_u16(response.status().as_u16()).unwrap();
        (status, response.json().await.unwrap_or(Value::Null))
    }

    #[tokio::test]
    async fn the_commands_say_whether_a_project_is_shared() {
        let root = |server: &Server| json!({"root": server.project.path().to_str().unwrap()});

        let shared = serve(true, None).await;
        let (status, answer) = invoke(&shared, "collab_status", root(&shared)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            answer,
            json!({"shared": true, "reason": null, "upstream": "none"})
        );

        let alone = serve(false, None).await;
        let (_, answer) = invoke(&alone, "collab_status", root(&alone)).await;
        assert_eq!(answer["shared"], false);
        assert_eq!(answer["reason"], "error-collab-not-shared");
        // Asking a server that shares nothing to flush is refused, not ignored.
        let (status, answer) = invoke(
            &alone,
            "collab_flush",
            json!({"root": alone.project.path().to_str().unwrap(), "stateVector": [0]}),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(answer["messageKey"], "error-collab-not-shared");
    }

    #[tokio::test]
    async fn a_flush_waits_for_the_state_vector_a_page_names() {
        let server = serve(true, None).await;
        let mut page = Page::open(&server).await;
        page.until(|text| text == "middle\n").await;
        page.type_at(0, "typed ").await;
        let seen = {
            let doc = page.awareness.doc();
            doc.transact().state_vector().encode_v1()
        };
        let (status, answer) = invoke(
            &server,
            "collab_flush",
            json!({"root": server.project.path().to_str().unwrap(), "stateVector": seen}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{answer}");
        assert_eq!(
            std::fs::read_to_string(server.project.path().join("main.tex")).unwrap(),
            "typed middle\n"
        );
    }

    #[tokio::test]
    async fn a_text_frame_closes_the_link() {
        let server = serve(true, None).await;
        let mut page = Page::open(&server).await;
        page.socket.send(Frame::Text("hello".into())).await.unwrap();
        loop {
            match tokio::time::timeout(Duration::from_secs(5), page.socket.next()).await {
                Ok(Some(Ok(Frame::Close(frame)))) => {
                    assert_eq!(u16::from(frame.unwrap().code), 1003);
                    return;
                }
                Ok(Some(Ok(_))) => {}
                other => panic!("the link was not closed: {:?}", other.map(|_| ())),
            }
        }
    }
}
