//! The host: one session per project folder.

use std::collections::HashMap;
use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use serde::Serialize;
use tokio::sync::{Mutex, mpsc};
use yaz_core::project::{FolderLocks, canonical_root};
use yrs::StateVector;
use yrs::updates::decoder::Decode;

use crate::error::Error;
use crate::session::{FlushReport, SessionHandle, Settings, Timing};

/// How the host is set up.
#[derive(Debug, Clone)]
pub struct HostConfig {
    /// Share every project the server opens. The only choice there is for now;
    /// a host that shares some projects and not others comes with the
    /// project's own setting.
    pub share_all: bool,
    /// Where a host keeps what must outlive a session. Nothing yet: a session
    /// of a host without a collaboration server does not.
    pub state_dir: Utf8PathBuf,
    /// How long the host waits before it writes, looks, and ends a session.
    pub timing: Timing,
}

impl HostConfig {
    /// Share every project, with the usual timing.
    pub fn sharing(state_dir: Utf8PathBuf) -> Self {
        Self {
            share_all: true,
            state_dir,
            timing: Timing::default(),
        }
    }
}

/// A frame channel pair between a page and its session: the page's frames go
/// in at `to_session`, the host's come out at `from_session`.
///
/// The host closes `from_session` to end the link; closing `to_session`, or
/// dropping it, is how a page leaves.
#[derive(Debug)]
pub struct LocalLink {
    /// Frames from the page.
    pub to_session: mpsc::Sender<Vec<u8>>,
    /// Frames to the page.
    pub from_session: mpsc::Receiver<Vec<u8>>,
}

/// Something the host tells every page of a project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostEvent {
    /// A compile of the project finished.
    Compiled {
        /// Whether it produced a PDF.
        succeeded: bool,
        /// When, as RFC 3339.
        at: String,
    },
}

impl HostEvent {
    /// A compile that finished just now.
    #[must_use]
    pub fn compiled(succeeded: bool) -> Self {
        Self::Compiled {
            succeeded,
            at: crate::disk::rfc3339(std::time::SystemTime::now()),
        }
    }
}

/// Whether and how a project is shared, as a page asks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// Whether a page may attach.
    pub shared: bool,
    /// The message key saying why not, when it may not.
    pub reason: Option<String>,
    /// The collaboration server link: `none` for a host that is the whole
    /// session.
    pub upstream: String,
}

/// The sessions of one process.
#[derive(Clone)]
pub struct Host {
    inner: Option<Arc<Inner>>,
}

struct Inner {
    config: HostConfig,
    locks: FolderLocks,
    sessions: Mutex<HashMap<Utf8PathBuf, Arc<SessionHandle>>>,
}

impl Host {
    /// A host that shares nothing: every attach is refused.
    pub fn disabled() -> Self {
        Self { inner: None }
    }

    /// A host that shares what its configuration says. `locks` is the lock per
    /// folder that compiling and recording a version take as well.
    pub fn new(config: HostConfig, locks: FolderLocks) -> Self {
        if !config.share_all {
            return Self::disabled();
        }
        Self {
            inner: Some(Arc::new(Inner {
                config,
                locks,
                sessions: Mutex::new(HashMap::new()),
            })),
        }
    }

    fn inner(&self) -> Result<&Inner, Error> {
        self.inner.as_deref().ok_or(Error::NotShared)
    }

    /// Whether a page may attach to this project.
    pub fn status(&self, _root: &Utf8Path) -> Status {
        let reason = self
            .inner()
            .err()
            .map(|error| error.message_key().to_owned());
        Status {
            shared: reason.is_none(),
            reason,
            upstream: "none".to_owned(),
        }
    }

    /// The session of a project, started if it is not running.
    async fn session(&self, root: &Utf8Path) -> Result<Arc<SessionHandle>, Error> {
        let inner = self.inner()?;
        let root = canonical_root(root)?;
        let mut sessions = inner.sessions.lock().await;
        if let Some(session) = sessions.get(&root).filter(|session| !session.is_closed()) {
            return Ok(Arc::clone(session));
        }
        let session = Arc::new(
            SessionHandle::start(Settings {
                root: root.clone(),
                locks: inner.locks.clone(),
                timing: inner.config.timing,
            })
            .await?,
        );
        sessions.insert(root, Arc::clone(&session));
        Ok(session)
    }

    /// The session of a project if one is running.
    async fn running(&self, root: &Utf8Path) -> Result<Option<Arc<SessionHandle>>, Error> {
        let inner = self.inner()?;
        let root = canonical_root(root)?;
        let sessions = inner.sessions.lock().await;
        Ok(sessions
            .get(&root)
            .filter(|session| !session.is_closed())
            .cloned())
    }

    /// Attach a page to the project's session.
    ///
    /// The first frame the page gets is `hello`. A session that ends just as
    /// the page arrives is started again.
    pub async fn attach(&self, root: &Utf8Path) -> Result<LocalLink, Error> {
        for _ in 0..3 {
            match self.session(root).await?.attach().await {
                Err(Error::Closed) => {}
                other => return other,
            }
        }
        Err(Error::Closed)
    }

    /// Wait until the session holds everything a page has seen, as the page's
    /// encoded state vector says, and bring the folder up to date.
    ///
    /// A session that has ended has nothing to flush into: the page is told so
    /// with [`Error::Closed`] and attaches afresh.
    pub async fn flush(&self, root: &Utf8Path, seen: &[u8]) -> Result<FlushReport, Error> {
        let seen =
            StateVector::decode_v1(seen).map_err(|error| Error::Protocol(error.to_string()))?;
        match self.running(root).await? {
            Some(session) => session.flush(seen).await,
            None => Err(Error::Closed),
        }
    }

    /// Look at the folder now, for changes made by others.
    pub async fn rescan(&self, root: &Utf8Path) -> Result<(), Error> {
        match self.running(root).await? {
            Some(session) => session.rescan().await.map(|_| ()),
            None => Ok(()),
        }
    }

    /// Tell every page of a project something. Nobody is told if no session
    /// is running.
    pub fn announce(&self, root: &Utf8Path, event: HostEvent) {
        let Some(inner) = self.inner.as_deref() else {
            return;
        };
        let Ok(root) = canonical_root(root) else {
            return;
        };
        if let Ok(sessions) = inner.sessions.try_lock() {
            if let Some(session) = sessions.get(&root) {
                session.announce(event);
            }
        }
    }
}
