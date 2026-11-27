//! The commands of a collaboration session (ADR-0035).
//!
//! A page does not write a file that is shared: the host that owns the folder
//! does. What a page asks of the host through the ordinary command surface is
//! small: whether a project is shared, to bring the folder up to date before a
//! compile or a save, and to look at the folder for changes made by others.
//! The session itself runs over a link of its own, which the transport
//! provides (`web_collab.rs` for the web server).

use std::sync::RwLock;

use camino::Utf8Path;
use yaz_collab::{FlushReport, Host, Status};

use crate::commands::{CommandError, Result};

/// The session host this process has, which shares nothing until a host that
/// has somewhere to attach pages asks for it.
pub(crate) struct Sharing(RwLock<Host>);

impl Default for Sharing {
    fn default() -> Self {
        Self(RwLock::new(Host::disabled()))
    }
}

impl Sharing {
    fn host(&self) -> Host {
        self.0
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    /// Put a host in place of the one that shares nothing, and hand it back.
    pub(crate) fn replace(&self, host: Host) -> Host {
        *self
            .0
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = host.clone();
        host
    }
}

fn error(error: yaz_collab::Error) -> CommandError {
    CommandError::new(error.message_key(), error)
}

/// Whether this project is shared, and why not if it is not.
#[tauri::command]
pub fn collab_status(sharing: tauri::State<'_, Sharing>, root: String) -> Result<Status> {
    Ok(sharing.host().status(Utf8Path::new(&root)))
}

/// Bring the folder up to date with everything the page has seen.
///
/// `state_vector` is the page's encoded Yjs state vector. The host waits until
/// its replica holds all of it, writes the shared files, and answers what it
/// wrote. Without that, a compile would read a folder the page's own typing
/// has not reached.
#[tauri::command]
pub async fn collab_flush(
    sharing: tauri::State<'_, Sharing>,
    root: String,
    state_vector: Vec<u8>,
) -> Result<FlushReport> {
    sharing
        .host()
        .flush(Utf8Path::new(&root), &state_vector)
        .await
        .map_err(error)
}

/// Look at the folder now, for files written by something other than yaz.
#[tauri::command]
pub async fn collab_rescan(sharing: tauri::State<'_, Sharing>, root: String) -> Result<()> {
    sharing
        .host()
        .rescan(Utf8Path::new(&root))
        .await
        .map_err(error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_process_that_has_not_asked_for_sharing_shares_nothing() {
        let sharing = Sharing::default();
        let status = sharing.host().status(Utf8Path::new("/anywhere"));
        assert!(!status.shared);
        assert_eq!(status.reason.as_deref(), Some("error-collab-not-shared"));
    }

    #[test]
    fn the_error_keys_are_the_documented_ones() {
        assert_eq!(
            error(yaz_collab::Error::NotShared).message_key(),
            "error-collab-not-shared"
        );
        assert_eq!(
            error(yaz_collab::Error::FlushTimedOut).message_key(),
            "error-collab-flush-timeout"
        );
    }
}
