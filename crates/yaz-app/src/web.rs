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
}

const USAGE: &str = "\
yaz-web — serve yaz to a browser

USAGE:
    yaz-web --dist <DIR> [--listen <ADDR:PORT>] [--allow-host <NAME>]...
            [--zotero <HOST[:PORT]>]
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
With sign-in, everybody named with --allow has that shell and shares the one
open project.";

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
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
        .build()
        .context("could not create the handler's webview")?;

    let sign_in = options.sign_in.map(sign_in::SignIn::new).transpose()?;
    let asks = sign_in.as_ref().map(|sign_in| sign_in.issuer().to_owned());
    let shared = Arc::new(Shared {
        webview,
        hosts: options.hosts,
        sign_in,
    });

    let index = options.dist.join("index.html");
    let api = Router::new()
        .route("/invoke/{command}", post(invoke))
        .route("/web/info", get(info))
        .layer(middleware::from_fn(require_marker))
        .layer(DefaultBodyLimit::max(BODY_LIMIT));

    let router = Router::new()
        .nest("/api", api)
        .route("/auth/{step}", get(sign_in_step))
        .fallback_service(ServeDir::new(&options.dist).fallback(ServeFile::new(index)))
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
        .with_state(shared);

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
