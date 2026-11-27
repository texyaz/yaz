//! The collaboration session host of yaz (ADR-0035).
//!
//! Whoever owns a project's folder hosts that project's session: a replica of
//! the shared text ([yrs](https://docs.rs/yrs)), the only writer of it into the
//! folder, and a relay between the pages attached to it. A page's connection
//! ends at its own host and carries Yjs sync and awareness messages and one
//! more kind, from the host only ([`wire`]).
//!
//! The shared document is one `Y.Doc` per project: `files`, a map from the
//! project-relative path to a `Y.Text` with `\n` line endings, and `meta`, a
//! map with the `schema` number and the session's `epoch`. [`policy`] says
//! which files are in it. The folder and the session meet in one place,
//! [`reconcile`]: the folder always wins, and the session's competing text
//! becomes a file beside it, so nothing typed is dropped.
//!
//! This crate is the domain logic. `yaz-app` only wires it to a command
//! surface and, for the web server, to a WebSocket route.

#![deny(missing_docs)]
#![deny(unsafe_code)]
#![warn(clippy::all)]

pub mod base;
pub mod disk;
pub mod error;
pub mod policy;
pub mod reconcile;
pub mod text;
pub mod wire;

mod host;
mod session;

pub use error::Error;
pub use host::{Host, HostConfig, HostEvent, LocalLink, Status};
pub use policy::{MAX_SHARED_BYTES, SharedPath, shared_path};
pub use reconcile::{Action, decide};
pub use session::{FlushReport, Timing};

/// The version of the shared document's layout. A document with a higher
/// number was written by a newer yaz and is not touched.
pub const SCHEMA: u32 = 1;

/// The version of the contract between a page and its host, sent in `hello`.
pub const LINK_PROTOCOL: u32 = 1;
