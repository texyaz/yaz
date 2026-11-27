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
//! The page is told who is signed in so that it can say so and offer to sign
//! out: `GET /auth/me` answers with the name, the e-mail address and the
//! picture the provider gave, and nothing else. The picture is the standard
//! `picture` claim, read from the provider's userinfo answer or, when that
//! lacks one, from the payload of the ID token it came with. That payload is
//! decoded and not verified, for the reason the token needs no check anywhere
//! else here: it came from the provider's token endpoint over TLS. Only an
//! `https://` address is kept. The browser loads the picture itself; the server
//! never fetches or relays it, because it may sit on a network only the person
//! can reach.
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
use serde::{Deserialize, Deserializer};
use serde_json::{Value, json};
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
    email: Option<String>,
    picture: Option<String>,
    until: Instant,
}

impl Session {
    /// What the page is told: no more than it shows.
    fn about(&self) -> Value {
        let mut person = json!({ "name": self.name });
        if let Some(email) = &self.email {
            person["email"] = json!(email);
        }
        if let Some(picture) = &self.picture {
            person["picture"] = json!(picture);
        }
        person
    }
}

/// What the provider says about the person a token is for.
#[derive(Deserialize)]
struct UserInfo {
    name: Option<String>,
    preferred_username: Option<String>,
    email: Option<String>,
    #[serde(default, deserialize_with = "https_only")]
    picture: Option<String>,
    #[serde(default)]
    groups: Vec<String>,
}

/// The one claim read from the payload of an ID token.
#[derive(Deserialize)]
struct Claims {
    #[serde(default, deserialize_with = "https_only")]
    picture: Option<String>,
}

/// A picture address, if it is one the browser should be sent to.
///
/// Only `https://`, with a host and without credentials in it: the page puts
/// the address in an `<img>`, and anything else is either a mixed-content
/// request, a `data:` or `javascript:` address, or a way to tell a third party
/// who is looking. The address is returned as parsed, so what reaches the page
/// is the normalised form.
fn https_picture(address: &str) -> Option<String> {
    let address = url::Url::parse(address.trim()).ok()?;
    let plain = address.scheme() == "https"
        && address.host_str().is_some()
        && address.username().is_empty()
        && address.password().is_none();
    (plain && address.as_str().len() <= 2048).then(|| address.into())
}

/// `picture`, whatever the provider put there: a claim that is not an address
/// is no picture, and is not a reason to refuse the person.
fn https_only<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    let claim = Option::<Value>::deserialize(deserializer)?;
    Ok(claim
        .as_ref()
        .and_then(Value::as_str)
        .and_then(https_picture))
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
        Self::with_secret(settings, secret)
    }

    fn with_secret(settings: Settings, secret: String) -> anyhow::Result<Self> {
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
                    email: info.email,
                    picture: info.picture,
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

    /// `/auth/me`: who the request's session is for, as JSON.
    ///
    /// 401 for a request without a session that is still good. Never cached:
    /// the answer is about whoever holds the cookie.
    pub fn me(&self, session: Option<String>) -> Response {
        let person = session.and_then(|id| {
            let mut sessions = self.sessions.lock().expect("the sessions are not poisoned");
            sessions.retain(|_, session| session.until > Instant::now());
            sessions.get(&id).map(Session::about)
        });
        match person {
            Some(person) => {
                ([(header::CACHE_CONTROL, "no-store")], axum::Json(person)).into_response()
            }
            None => (StatusCode::UNAUTHORIZED, "not signed in").into_response(),
        }
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
            id_token: Option<String>,
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
        let mut info: UserInfo = self
            .http
            .get(&endpoints.userinfo_endpoint)
            .bearer_auth(&tokens.access_token)
            .send()
            .await?
            .error_for_status()
            .context("the provider did not say whom the token is for")?
            .json()
            .await?;
        // Some providers put the picture in the ID token and not in userinfo.
        if info.picture.is_none() {
            info.picture = tokens.id_token.as_deref().and_then(picture_in_id_token);
        }
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

/// The `picture` in the payload of an ID token (`header.payload.signature`).
///
/// Not verified: see the module documentation. A token that is not what was
/// expected has no picture, which is not an error.
fn picture_in_id_token(token: &str) -> Option<String> {
    let payload = base64_url_decode(token.split('.').nth(1)?)?;
    serde_json::from_slice::<Claims>(&payload).ok()?.picture
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

/// Base64 with the URL alphabet, with or without padding; `None` if it is not.
fn base64_url_decode(text: &str) -> Option<Vec<u8>> {
    let digits = text.trim_end_matches('=');
    let mut bytes = Vec::with_capacity(digits.len() * 3 / 4);
    let (mut bits, mut held) = (0_u32, 0_u32);
    for digit in digits.bytes() {
        let value = match digit {
            b'A'..=b'Z' => digit - b'A',
            b'a'..=b'z' => digit - b'a' + 26,
            b'0'..=b'9' => digit - b'0' + 52,
            b'-' => 62,
            b'_' => 63,
            _ => return None,
        };
        bits = bits << 6 | u32::from(value);
        held += 6;
        if held >= 8 {
            held -= 8;
            bytes.push((bits >> held & 0xff) as u8);
            bits &= (1 << held) - 1;
        }
    }
    // One digit alone carries no whole byte.
    (digits.len() % 4 != 1).then_some(bytes)
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use axum::http::{StatusCode, header};

    use super::{
        Session, Settings, SignIn, UserInfo, allowed, base64_url, base64_url_decode, https_picture,
        picture_in_id_token,
    };

    fn person(email: &str, user: &str, groups: &[&str]) -> UserInfo {
        UserInfo {
            name: None,
            preferred_username: Some(user.to_owned()),
            email: Some(email.to_owned()),
            picture: None,
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

    #[test]
    fn base64_for_urls_reads_back_what_it_wrote() {
        for bytes in [&b""[..], b"f", b"fo", b"foo", b"foobar", &[0xfb, 0xff]] {
            assert_eq!(
                base64_url_decode(&base64_url(bytes)).as_deref(),
                Some(bytes)
            );
        }
        // Padding is tolerated, anything outside the alphabet is not.
        assert_eq!(base64_url_decode("Zm8=").as_deref(), Some(&b"fo"[..]));
        assert_eq!(base64_url_decode("Zm+/"), None);
        assert_eq!(base64_url_decode("Z"), None);
    }

    #[test]
    fn only_an_https_address_is_a_picture() {
        assert_eq!(
            https_picture("https://pictures.example.org/ada.png?size=64").as_deref(),
            Some("https://pictures.example.org/ada.png?size=64")
        );
        assert_eq!(
            https_picture(" https://Pictures.example.org ").as_deref(),
            Some("https://pictures.example.org/")
        );
        for refused in [
            "http://pictures.example.org/ada.png",
            "data:image/png;base64,AAAA",
            "javascript:alert(1)",
            "//pictures.example.org/ada.png",
            "/ada.png",
            "https://",
            "https://ada:secret@pictures.example.org/ada.png",
            "not an address",
            "",
        ] {
            assert_eq!(https_picture(refused), None, "{refused}");
        }
        let long = format!("https://pictures.example.org/{}", "a".repeat(2100));
        assert_eq!(https_picture(&long), None);
    }

    #[test]
    fn userinfo_keeps_a_picture_only_if_it_is_https() {
        let read = |json: &str| serde_json::from_str::<UserInfo>(json).expect("userinfo");
        assert_eq!(
            read(r#"{"picture":"https://pictures.example.org/ada.png"}"#)
                .picture
                .as_deref(),
            Some("https://pictures.example.org/ada.png")
        );
        assert_eq!(
            read(r#"{"picture":"http://pictures.example.org/a.png"}"#).picture,
            None
        );
        // A claim of the wrong kind costs the picture, not the sign-in.
        assert_eq!(
            read(r#"{"picture":42,"email":"ada@example.org"}"#).picture,
            None
        );
        assert_eq!(read(r#"{"picture":null}"#).picture, None);
        assert_eq!(read("{}").picture, None);
    }

    #[test]
    fn the_id_token_can_stand_in_for_userinfo() {
        let token = |payload: &str| format!("e30.{}.c2ln", base64_url(payload.as_bytes()));
        assert_eq!(
            picture_in_id_token(&token(
                r#"{"picture":"https://pictures.example.org/a.png","sub":"1"}"#
            ))
            .as_deref(),
            Some("https://pictures.example.org/a.png")
        );
        assert_eq!(
            picture_in_id_token(&token(r#"{"picture":"http://x.example.org/a.png"}"#)),
            None
        );
        assert_eq!(picture_in_id_token(&token("{}")), None);
        assert_eq!(picture_in_id_token(&token("not json")), None);
        assert_eq!(picture_in_id_token("one-part-only"), None);
        assert_eq!(picture_in_id_token("a.!!!.c"), None);
    }

    fn signed_in_with(sessions: &[(&str, Option<&str>, Option<&str>, Duration)]) -> SignIn {
        let sign_in = SignIn::with_secret(
            Settings {
                issuer: "https://sso.example.org/realms/company".to_owned(),
                client_id: "yaz".to_owned(),
                public_url: "https://yaz.example.org".to_owned(),
                allow: vec!["writers".to_owned()],
            },
            "secret".to_owned(),
        )
        .expect("sign-in with these settings");
        for (id, email, picture, life) in sessions {
            sign_in.sessions.lock().expect("sessions").insert(
                (*id).to_owned(),
                Session {
                    name: "Ada Lovelace".to_owned(),
                    email: email.map(str::to_owned),
                    picture: picture.map(str::to_owned),
                    until: Instant::now() + *life,
                },
            );
        }
        sign_in
    }

    async fn answer(response: axum::response::Response) -> (StatusCode, String) {
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .expect("a body");
        (status, String::from_utf8(body.to_vec()).expect("text"))
    }

    #[tokio::test]
    async fn me_says_who_is_signed_in() {
        let hour = Duration::from_secs(3600);
        let sign_in = signed_in_with(&[
            (
                "full",
                Some("ada@example.org"),
                Some("https://pictures.example.org/a.png"),
                hour,
            ),
            ("bare", None, None, hour),
        ]);

        let response = sign_in.me(Some("full".to_owned()));
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let (status, body) = answer(response).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&body).expect("json"),
            serde_json::json!({
                "name": "Ada Lovelace",
                "email": "ada@example.org",
                "picture": "https://pictures.example.org/a.png",
            })
        );

        // Nothing is invented for what the provider did not say.
        let (_, body) = answer(sign_in.me(Some("bare".to_owned()))).await;
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&body).expect("json"),
            serde_json::json!({ "name": "Ada Lovelace" })
        );
    }

    #[tokio::test]
    async fn me_refuses_a_request_without_a_good_session() {
        let sign_in = signed_in_with(&[("ended", None, None, Duration::ZERO)]);
        for session in [None, Some("unknown".to_owned()), Some("ended".to_owned())] {
            let (status, _) = answer(sign_in.me(session)).await;
            assert_eq!(status, StatusCode::UNAUTHORIZED);
        }
    }
}
