//! Asking an identity provider who is there, before serving anything
//! ([ADR-0033]).
//!
//! The web server authenticates nobody by itself ([ADR-0030]), which is right
//! for the address only one person can reach. Started with `--oidc-issuer` it
//! serves **the people it was started for** instead: a request without a
//! session is sent to the provider (OpenID Connect, authorisation code with
//! PKCE), and what comes back is checked against the names given with
//! `--allow`.
//!
//! This decides who may reach the server. It does not divide the server
//! between them: everybody who is let in shares the one open project and has
//! what amounts to a shell as the user the server runs as. Whoever starts it
//! must still run it where that is acceptable.
//!
//! [ADR-0030]: https://github.com/texyaz/yaz/blob/main/docs/adr/0030-a-web-server-hosts-the-same-commands.md
//! [ADR-0033]: https://github.com/texyaz/yaz/blob/main/docs/adr/0033-the-web-server-can-ask-who-is-there.md

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use anyhow::{Context, bail};
use axum::extract::Request;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use sha2::{Digest, Sha256};

/// The cookie that names a session.
const SESSION: &str = "yaz_session";
/// The cookie that names a sign-in under way.
const FLOW: &str = "yaz_sign_in";
/// How long a session lasts. A working day; the provider's own session
/// usually signs the person in again without asking.
const SESSION_LIFE: Duration = Duration::from_secs(12 * 60 * 60);
/// How long a person has to finish signing in at the provider.
const FLOW_LIFE: Duration = Duration::from_secs(10 * 60);

/// What the command line gave for sign-in.
pub struct Settings {
    /// The provider's issuer address, e.g. a Keycloak realm.
    pub issuer: String,
    /// The client this server is registered as.
    pub client_id: String,
    /// The address people open this server at, e.g. `https://yaz.example.org`.
    pub public_url: String,
    /// Who may sign in: e-mail addresses, user names or groups.
    pub allow: Vec<String>,
}

/// The provider's addresses, read once from its discovery document.
#[derive(Clone, Deserialize)]
struct Endpoints {
    authorization_endpoint: String,
    token_endpoint: String,
    userinfo_endpoint: String,
    end_session_endpoint: Option<String>,
}

/// A sign-in between leaving for the provider and coming back.
struct Flow {
    state: String,
    verifier: String,
    next: String,
    started: Instant,
}

/// Somebody who signed in.
struct Session {
    name: String,
    until: Instant,
}

/// What the provider says about the person a token is for.
#[derive(Deserialize)]
struct UserInfo {
    name: Option<String>,
    preferred_username: Option<String>,
    email: Option<String>,
    #[serde(default)]
    groups: Vec<String>,
}

/// What a request to `/auth/callback` carries.
pub struct Back {
    flow: Option<String>,
    code: Option<String>,
    state: Option<String>,
}

impl Back {
    /// Read from the request, before anything is awaited.
    pub fn of(request: &Request) -> Self {
        Self {
            flow: cookie(request, FLOW),
            code: query(request, "code"),
            state: query(request, "state"),
        }
    }
}

/// Where the person wanted to go, from a request to `/auth/login`.
pub fn wanted(request: &Request) -> Option<String> {
    query(request, "next")
}

/// The session a request names, if any.
pub fn session_of(request: &Request) -> Option<String> {
    cookie(request, SESSION)
}

/// Sign-in, as the server holds it while it runs.
pub struct SignIn {
    settings: Settings,
    secret: String,
    http: reqwest::Client,
    endpoints: tokio::sync::OnceCell<Endpoints>,
    flows: Mutex<HashMap<String, Flow>>,
    sessions: Mutex<HashMap<String, Session>>,
}

impl SignIn {
    /// Sign-in with these settings; the client secret comes from the
    /// environment, never from the command line, where every user of the
    /// machine could read it.
    pub fn new(settings: Settings) -> anyhow::Result<Self> {
        let secret = std::env::var("YAZ_WEB_OIDC_SECRET")
            .context("--oidc-issuer needs the client secret in YAZ_WEB_OIDC_SECRET")?;
        if settings.allow.is_empty() {
            bail!(
                "--oidc-issuer needs at least one --allow: without it everybody the provider \
                 knows could sign in, and signing in amounts to a shell on this machine"
            );
        }
        if !settings.public_url.starts_with("https://") {
            bail!(
                "--public-url must be an https address: the session cookie is sent only over TLS"
            );
        }
        Ok(Self {
            settings,
            secret,
            http: yaz_core::net::http_client().context("could not build the HTTP client")?,
            endpoints: tokio::sync::OnceCell::new(),
            flows: Mutex::new(HashMap::new()),
            sessions: Mutex::new(HashMap::new()),
        })
    }

    /// The provider this server asks, for the log.
    pub fn issuer(&self) -> &str {
        &self.settings.issuer
    }

    async fn endpoints(&self) -> anyhow::Result<&Endpoints> {
        self.endpoints
            .get_or_try_init(|| async {
                let address = format!(
                    "{}/.well-known/openid-configuration",
                    self.settings.issuer.trim_end_matches('/')
                );
                let endpoints = self
                    .http
                    .get(&address)
                    .send()
                    .await
                    .and_then(reqwest::Response::error_for_status)
                    .with_context(|| format!("could not read {address}"))?
                    .json::<Endpoints>()
                    .await
                    .context("the provider's discovery document is not what was expected")?;
                Ok(endpoints)
            })
            .await
    }

    fn callback(&self) -> String {
        format!(
            "{}/auth/callback",
            self.settings.public_url.trim_end_matches('/')
        )
    }

    /// Whether this request carries a session that is still good.
    pub fn signed_in(&self, request: &Request) -> bool {
        let Some(id) = cookie(request, SESSION) else {
            return false;
        };
        let mut sessions = self.sessions.lock().expect("the sessions are not poisoned");
        sessions.retain(|_, session| session.until > Instant::now());
        sessions.contains_key(&id)
    }

    /// `/auth/login`: note where the person wanted to go, and send them to the provider.
    pub async fn login(&self, next: Option<String>) -> Response {
        let endpoints = match self.endpoints().await {
            Ok(endpoints) => endpoints,
            Err(error) => return unavailable(&error),
        };
        let next = next
            .filter(|next| next.starts_with('/') && !next.starts_with("//"))
            .unwrap_or_else(|| "/".to_owned());
        let (Ok(id), Ok(state), Ok(verifier)) = (random(), random(), random()) else {
            return (StatusCode::INTERNAL_SERVER_ERROR, "no random numbers").into_response();
        };
        let challenge = base64_url(&Sha256::digest(verifier.as_bytes()));

        let mut address = match url::Url::parse(&endpoints.authorization_endpoint) {
            Ok(address) => address,
            Err(error) => return unavailable(&error.into()),
        };
        address
            .query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", &self.settings.client_id)
            .append_pair("redirect_uri", &self.callback())
            .append_pair("scope", "openid profile email")
            .append_pair("state", &state)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256");

        {
            let mut flows = self.flows.lock().expect("the flows are not poisoned");
            flows.retain(|_, flow| flow.started.elapsed() < FLOW_LIFE);
            flows.insert(
                id.clone(),
                Flow {
                    state,
                    verifier,
                    next,
                    started: Instant::now(),
                },
            );
        }
        redirect(address.as_str(), &[set_cookie(FLOW, &id, FLOW_LIFE)])
    }

    /// `/auth/callback`: the person is back; find out who they are.
    pub async fn finish(&self, back: Back) -> Response {
        let flow = back.flow.and_then(|id| {
            self.flows
                .lock()
                .expect("the flows are not poisoned")
                .remove(&id)
        });
        let (Some(flow), Some(code)) = (flow, back.code) else {
            return refused("this sign-in has expired; open the page again");
        };
        if flow.started.elapsed() >= FLOW_LIFE || back.state.as_deref() != Some(&flow.state) {
            return refused("this sign-in does not belong to this browser; open the page again");
        }

        let info = match self.who(&code, &flow.verifier).await {
            Ok(info) => info,
            Err(error) => {
                tracing::warn!(%error, "a sign-in failed at the provider");
                return (
                    StatusCode::BAD_GATEWAY,
                    "the sign-in service did not confirm the sign-in",
                )
                    .into_response();
            }
        };
        let name = info
            .name
            .clone()
            .or_else(|| info.preferred_username.clone())
            .or_else(|| info.email.clone())
            .unwrap_or_else(|| "somebody".to_owned());
        if !allowed(&self.settings.allow, &info) {
            tracing::warn!(%name, "refused a sign-in by somebody this server was not started for");
            return (
                StatusCode::FORBIDDEN,
                format!("{name} is not among the people this yaz was started for."),
            )
                .into_response();
        }

        let Ok(id) = random() else {
            return (StatusCode::INTERNAL_SERVER_ERROR, "no random numbers").into_response();
        };
        tracing::info!(%name, "signed in");
        self.sessions
            .lock()
            .expect("the sessions are not poisoned")
            .insert(
                id.clone(),
                Session {
                    name,
                    until: Instant::now() + SESSION_LIFE,
                },
            );
        redirect(
            &flow.next,
            &[
                set_cookie(SESSION, &id, SESSION_LIFE),
                set_cookie(FLOW, "", Duration::ZERO),
            ],
        )
    }

    /// `/auth/logout`: forget the session here, and end it at the provider.
    pub async fn logout(&self, session: Option<String>) -> Response {
        if let Some(id) = session
            && let Some(session) = self
                .sessions
                .lock()
                .expect("the sessions are not poisoned")
                .remove(&id)
        {
            tracing::info!(name = %session.name, "signed out");
        }
        let home = self.settings.public_url.clone();
        let to = match self
            .endpoints()
            .await
            .map(|e| e.end_session_endpoint.clone())
        {
            Ok(Some(end)) => url::Url::parse(&end)
                .map(|mut address| {
                    address
                        .query_pairs_mut()
                        .append_pair("client_id", &self.settings.client_id)
                        .append_pair("post_logout_redirect_uri", &home);
                    address.to_string()
                })
                .unwrap_or(home),
            _ => home,
        };
        redirect(&to, &[set_cookie(SESSION, "", Duration::ZERO)])
    }

    /// Exchange the code for a token and ask the provider whom it is for.
    ///
    /// The token comes straight from the provider over TLS and goes straight
    /// back to it, so nothing here has to check a signature.
    async fn who(&self, code: &str, verifier: &str) -> anyhow::Result<UserInfo> {
        #[derive(Deserialize)]
        struct Tokens {
            access_token: String,
        }
        let endpoints = self.endpoints().await?;
        let callback = self.callback();
        let form = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("grant_type", "authorization_code")
            .append_pair("code", code)
            .append_pair("redirect_uri", &callback)
            .append_pair("client_id", &self.settings.client_id)
            .append_pair("client_secret", &self.secret)
            .append_pair("code_verifier", verifier)
            .finish();
        let tokens: Tokens = self
            .http
            .post(&endpoints.token_endpoint)
            .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(form)
            .send()
            .await?
            .error_for_status()
            .context("the provider refused the code")?
            .json()
            .await?;
        let info = self
            .http
            .get(&endpoints.userinfo_endpoint)
            .bearer_auth(tokens.access_token)
            .send()
            .await?
            .error_for_status()
            .context("the provider did not say whom the token is for")?
            .json()
            .await?;
        Ok(info)
    }
}

/// Whether the person is one of those the server was started for: by e-mail
/// address, by user name, or by a group the provider says they are in.
fn allowed(allow: &[String], info: &UserInfo) -> bool {
    let has = |value: &str| {
        let value = value.trim_start_matches('/');
        allow
            .iter()
            .any(|wanted| wanted.eq_ignore_ascii_case(value))
    };
    info.email.as_deref().is_some_and(has)
        || info.preferred_username.as_deref().is_some_and(has)
        || info.groups.iter().any(|group| has(group))
}

/// The value of one of the request's cookies.
fn cookie(request: &Request, name: &str) -> Option<String> {
    request
        .headers()
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value.to_owned())
        .filter(|value| !value.is_empty())
}

/// One value of the request's query.
fn query(request: &Request, name: &str) -> Option<String> {
    url::form_urlencoded::parse(request.uri().query().unwrap_or_default().as_bytes())
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
}

/// A cookie only this server reads, sent only over TLS and not from another site's requests.
fn set_cookie(name: &str, value: &str, life: Duration) -> String {
    format!(
        "{name}={value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age={}",
        life.as_secs()
    )
}

fn redirect(to: &str, cookies: &[String]) -> Response {
    let mut response = StatusCode::FOUND.into_response();
    if let Ok(to) = HeaderValue::from_str(to) {
        response.headers_mut().insert(header::LOCATION, to);
    }
    for cookie in cookies {
        if let Ok(cookie) = HeaderValue::from_str(cookie) {
            response.headers_mut().append(header::SET_COOKIE, cookie);
        }
    }
    response
}

fn refused(why: &'static str) -> Response {
    (StatusCode::BAD_REQUEST, why).into_response()
}

fn unavailable(error: &anyhow::Error) -> Response {
    tracing::error!(%error, "the sign-in service cannot be reached");
    (
        StatusCode::BAD_GATEWAY,
        "the sign-in service cannot be reached",
    )
        .into_response()
}

/// Thirty-two random bytes, as text that fits a cookie and a query.
fn random() -> Result<String, getrandom::Error> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes)?;
    Ok(base64_url(&bytes))
}

/// Base64 with the URL alphabet and no padding (RFC 4648 §5), which is what PKCE asks for.
fn base64_url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut text = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let group = u32::from(chunk[0]) << 16
            | u32::from(*chunk.get(1).unwrap_or(&0)) << 8
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for (index, shift) in [18, 12, 6, 0].into_iter().enumerate() {
            if index <= chunk.len() {
                text.push(char::from(ALPHABET[(group >> shift & 0x3f) as usize]));
            }
        }
    }
    text
}

#[cfg(test)]
mod tests {
    use super::{UserInfo, allowed, base64_url};

    fn person(email: &str, user: &str, groups: &[&str]) -> UserInfo {
        UserInfo {
            name: None,
            preferred_username: Some(user.to_owned()),
            email: Some(email.to_owned()),
            groups: groups.iter().map(|group| (*group).to_owned()).collect(),
        }
    }

    #[test]
    fn base64_for_urls_has_no_padding() {
        // RFC 4648 §10, with the padding left off.
        assert_eq!(base64_url(b""), "");
        assert_eq!(base64_url(b"f"), "Zg");
        assert_eq!(base64_url(b"fo"), "Zm8");
        assert_eq!(base64_url(b"foo"), "Zm9v");
        assert_eq!(base64_url(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64_url(&[0xfb, 0xff]), "-_8");
    }

    #[test]
    fn a_person_is_let_in_by_address_name_or_group() {
        let allow = ["Ada@Example.org".to_owned(), "writers".to_owned()];
        assert!(allowed(&allow, &person("ada@example.org", "ada", &[])));
        assert!(allowed(
            &allow,
            &person("eve@example.org", "eve", &["/writers"])
        ));
        assert!(!allowed(
            &allow,
            &person("eve@example.org", "eve", &["readers"])
        ));
    }

    #[test]
    fn nobody_is_let_in_by_an_empty_list() {
        assert!(!allowed(
            &[],
            &person("ada@example.org", "ada", &["writers"])
        ));
    }
}
