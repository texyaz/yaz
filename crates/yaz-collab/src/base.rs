//! What the host last wrote into the folder or took out of it.
//!
//! Per shared path, the digest of that text and the line ending the file was
//! read with. It is what lets the host tell its own write from an outside
//! change: a file whose digest is the base was left alone.

use std::collections::HashMap;

use crate::policy::SharedPath;
use crate::text::{Digest, LineEnding};

/// One path's record.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Base {
    /// The digest of the shared form of the text.
    pub digest: Digest,
    /// The line ending to write the file back with.
    pub ending: LineEnding,
}

/// The records of one session.
///
/// Kept in memory: a session of a host without a collaboration server does not
/// outlive the process, and a record without the replica it belongs to would
/// only mislead the next one.
#[derive(Debug, Default)]
pub struct BaseRecord {
    entries: HashMap<SharedPath, Base>,
}

impl BaseRecord {
    /// The record of a path, if the host has one.
    pub fn get(&self, path: &SharedPath) -> Option<&Base> {
        self.entries.get(path)
    }

    /// Remember what a path holds now.
    pub fn set(&mut self, path: SharedPath, base: Base) {
        self.entries.insert(path, base);
    }

    /// Forget a path.
    pub fn remove(&mut self, path: &SharedPath) {
        self.entries.remove(path);
    }

    /// Every path that has a record.
    pub fn paths(&self) -> impl Iterator<Item = &SharedPath> {
        self.entries.keys()
    }
}
