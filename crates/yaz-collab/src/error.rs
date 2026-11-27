//! What can go wrong, as the commands and the link report it.

use camino::Utf8PathBuf;

/// A failure of the session host.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Sharing is not switched on for this server.
    #[error("sharing is not enabled")]
    NotShared,

    /// The session could not start.
    #[error("the session is unavailable: {reason}")]
    Unavailable {
        /// What went wrong, for the log; the page shows the message key.
        reason: String,
    },

    /// A shared document written by a newer yaz.
    #[error(
        "the shared document has schema {found}, this yaz knows {}",
        crate::SCHEMA
    )]
    Schema {
        /// The schema number found in the document.
        found: u32,
    },

    /// The host did not reach the state the page had seen in time.
    #[error("the folder could not be brought up to date in time")]
    FlushTimedOut,

    /// A path failed the containment check.
    #[error(transparent)]
    Path(#[from] yaz_core::Error),

    /// Reading or writing the folder failed.
    #[error("i/o error at {path}")]
    Io {
        /// The path being operated on.
        path: Utf8PathBuf,
        /// The underlying error.
        #[source]
        source: std::io::Error,
    },

    /// A frame that is not the protocol.
    #[error("protocol error: {0}")]
    Protocol(String),

    /// The session ended while it was being used.
    #[error("the session is closed")]
    Closed,
}

impl Error {
    /// The message key the page resolves against its locale.
    ///
    /// A sentence in the page's own language is what a person reads; the
    /// detail stays in the log.
    pub fn message_key(&self) -> &'static str {
        match self {
            Error::NotShared => "error-collab-not-shared",
            Error::Unavailable { .. } | Error::Io { .. } | Error::Closed | Error::Protocol(_) => {
                "error-collab-unavailable"
            }
            Error::Schema { .. } => "error-collab-schema",
            Error::FlushTimedOut => "error-collab-flush-timeout",
            Error::Path(error) => error.message_key(),
        }
    }
}
