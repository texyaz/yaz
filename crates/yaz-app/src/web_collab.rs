//! The link between a page and its session host (ADR-0035).
//!
//! `GET /api/collab/link?root=<absolute path>`, a WebSocket upgrade. The
//! frames are the host's ([`yaz_collab::wire`] and the Yjs sync and awareness
//! messages), one message each, and this only moves them between the socket
//! and the host's pair of channels. A page's connection ends here: it never
//! carries a token and never reaches a collaboration server.
//!
//! The route is inside the host and session checks and outside the marker
//! header, which a browser cannot set on a WebSocket. What stands in for the
//! header is the `Origin`: it must be there and name the host the request was
//! sent to, so a page of another site cannot open a link with the cookie of
//! somebody who is signed in.

use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::extract::ws::rejection::WebSocketUpgradeRejection;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use camino::Utf8PathBuf;
use yaz_collab::wire::{self, HostMessage, State as SessionState};
use yaz_collab::{Host, LINK_PROTOCOL};

use super::Shared;

/// The largest message either way: a whole project's text in one update.
const MAX_MESSAGE: usize = 32 * 1024 * 1024;

/// WebSocket close codes the page tells apart.
mod close {
    /// A text frame: the link carries binary frames only.
    pub const UNSUPPORTED: u16 = 1003;
    /// The host ended the link; the page attaches again.
    pub const ENDED: u16 = 1011;
    /// The sign-in the link was opened with is over.
    pub const SIGNED_OUT: u16 = 4401;
}

/// How often an open link asks whether its sign-in is still good. A request
/// is checked when it arrives; a link stays open for hours, and would
/// otherwise outlive the session that let it in (ADR-0033, ADR-0035).
const RECHECK: Duration = Duration::from_secs(300);

/// Whether the request's `Origin` is the host it was sent to.
///
/// A browser sends `Origin` on every WebSocket handshake and a page cannot
/// change it. Missing, `null`, or another host: refused.
fn same_origin(headers: &HeaderMap) -> bool {
    let value = |name| headers.get(name).and_then(|value| value.to_str().ok());
    let (Some(origin), Some(host)) = (value(header::ORIGIN), value(header::HOST)) else {
        return false;
    };
    origin
        .split_once("://")
        .is_some_and(|(_, authority)| authority.eq_ignore_ascii_case(host))
}

/// The project the link is for: `root`, which must be an absolute path.
fn root_of(uri: &Uri) -> Option<Utf8PathBuf> {
    let query = uri.query()?;
    let (_, root) = url::form_urlencoded::parse(query.as_bytes()).find(|(key, _)| key == "root")?;
    let root = Utf8PathBuf::from(root.into_owned());
    root.is_absolute().then_some(root)
}

/// Open a link.
pub async fn link(
    State(shared): State<Arc<Shared>>,
    headers: HeaderMap,
    uri: Uri,
    upgrade: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
) -> Response {
    if !same_origin(&headers) {
        tracing::warn!("refused a collaboration link whose Origin is not this server");
        return (StatusCode::FORBIDDEN, "the Origin is not this server").into_response();
    }
    let Some(root) = root_of(&uri) else {
        return (StatusCode::BAD_REQUEST, "root must be an absolute path").into_response();
    };
    let upgrade = match upgrade {
        Ok(upgrade) => upgrade,
        Err(rejection) => return rejection.into_response(),
    };
    let host = shared.collab.clone();
    // With sign-in, the request got here because its session was good. Which
    // one it was is kept, to ask again while the link is open.
    let session = shared
        .sign_in
        .as_ref()
        .and_then(|_| super::sign_in::session_in(&headers));
    upgrade
        .max_message_size(MAX_MESSAGE)
        .max_frame_size(MAX_MESSAGE)
        .on_upgrade(move |socket| {
            let still = move || match (&shared.sign_in, &session) {
                (Some(sign_in), Some(id)) => sign_in.still_signed_in(id),
                (Some(_), None) => false,
                (None, _) => true,
            };
            relay(socket, host, root, RECHECK, still)
        })
}

/// Say that the session cannot be had, in the one place a page looks.
async fn refuse(mut socket: WebSocket, error: &yaz_collab::Error) {
    tracing::info!(%error, "a collaboration link was refused");
    let hello = wire::encode(&HostMessage::Hello {
        protocol: LINK_PROTOCOL,
        epoch: String::new(),
        state: SessionState::Unavailable,
        reason: Some(error.message_key().to_owned()),
    });
    let _ = socket.send(Message::Binary(hello.into())).await;
    let _ = socket.send(Message::Close(None)).await;
}

async fn end(mut socket: WebSocket, code: u16, reason: &'static str) {
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code,
            reason: reason.into(),
        })))
        .await;
}

/// Pass frames between the page's socket and the host until either ends.
///
/// `still` is asked every `recheck` whether the person may still be here; a
/// link whose sign-in has ended is closed and nothing more is relayed on it.
async fn relay(
    mut socket: WebSocket,
    host: Host,
    root: Utf8PathBuf,
    recheck: Duration,
    still: impl Fn() -> bool,
) {
    let mut link = match host.attach(&root).await {
        Ok(link) => link,
        Err(error) => return refuse(socket, &error).await,
    };
    let mut asked = tokio::time::interval_at(tokio::time::Instant::now() + recheck, recheck);
    loop {
        tokio::select! {
            _ = asked.tick() => {
                if !still() {
                    tracing::info!("closed a collaboration link whose sign-in ended");
                    return end(socket, close::SIGNED_OUT, "the sign-in ended").await;
                }
            }
            frame = socket.recv() => match frame {
                Some(Ok(Message::Binary(bytes))) => {
                    if link.to_session.send(bytes.to_vec()).await.is_err() {
                        return end(socket, close::ENDED, "the session ended").await;
                    }
                }
                Some(Ok(Message::Text(_))) => {
                    return end(socket, close::UNSUPPORTED, "binary frames only").await;
                }
                // Ping and pong are answered by the library.
                Some(Ok(Message::Ping(_) | Message::Pong(_))) => {}
                Some(Ok(Message::Close(_)) | Err(_)) | None => return,
            },
            frame = link.from_session.recv() => match frame {
                Some(bytes) => {
                    if socket.send(Message::Binary(bytes.into())).await.is_err() {
                        return;
                    }
                }
                None => return end(socket, close::ENDED, "the session ended").await,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderValue;

    use super::*;

    fn headers(origin: Option<&str>, host: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, HeaderValue::from_str(host).unwrap());
        if let Some(origin) = origin {
            headers.insert(header::ORIGIN, HeaderValue::from_str(origin).unwrap());
        }
        headers
    }

    #[test]
    fn an_origin_that_is_the_host_is_let_in() {
        assert!(same_origin(&headers(
            Some("http://127.0.0.1:4173"),
            "127.0.0.1:4173"
        )));
        assert!(same_origin(&headers(
            Some("https://yaz.example.org"),
            "yaz.example.org"
        )));
        assert!(same_origin(&headers(
            Some("https://YAZ.example.org"),
            "yaz.example.org"
        )));
    }

    #[test]
    fn a_missing_null_or_foreign_origin_is_not() {
        for origin in [
            None,
            Some("null"),
            Some("https://evil.example"),
            Some("http://127.0.0.1:9999"),
            Some("https://yaz.example.org.evil.example"),
            Some("yaz.example.org"),
        ] {
            assert!(
                !same_origin(&headers(origin, "yaz.example.org")),
                "{origin:?}"
            );
        }
        assert!(!same_origin(&headers(
            Some("http://yaz.example.org"),
            "yaz.example.org:8080"
        )));
    }

    #[test]
    fn the_root_is_a_path_the_page_names_in_full() {
        let uri = |text: &str| text.parse::<Uri>().unwrap();
        assert_eq!(
            root_of(&uri("/api/collab/link?root=%2Fwork%2Fpaper%20one")),
            Some(Utf8PathBuf::from("/work/paper one"))
        );
        assert_eq!(root_of(&uri("/api/collab/link")), None);
        assert_eq!(root_of(&uri("/api/collab/link?root=relative%2Fpath")), None);
    }
}
