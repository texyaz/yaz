//! What the host says to a page besides the Yjs messages.
//!
//! Tag 100 of the link: one message, from the host only, a lib0 var-uint tag
//! and then a var-uint-prefixed UTF-8 JSON document. A page that sends one is
//! ignored, and one is never forwarded to a collaboration server.

use serde::Serialize;

/// The tag of a host message.
pub const TAG_HOST: u8 = 100;

/// The state of a session as a page sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    /// Reading the folder; no sync message follows yet.
    Starting,
    /// Sync may begin.
    Ready,
    /// The session could not start; `reason` says why.
    Unavailable,
}

/// How the host stands to a collaboration server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Upstream {
    /// There is none: this host is the whole session.
    None,
}

/// A file the session kept a copy of, and where.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Kept {
    /// The shared path whose session text was kept.
    pub path: String,
    /// The copy, beside it.
    pub copy: String,
}

/// What happened to the folder behind the pages' backs.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct FolderReport {
    /// Paths taken in from the folder after the session began.
    pub imported: Vec<String>,
    /// Session texts that were written beside the folder's version.
    pub kept: Vec<Kept>,
    /// Entries removed because the file is gone.
    pub removed: Vec<String>,
    /// Files in the folder that are too large or not UTF-8 text, and so not
    /// shared.
    pub refused: Vec<String>,
}

impl FolderReport {
    /// Whether nothing happened.
    pub fn is_empty(&self) -> bool {
        self.imported.is_empty()
            && self.kept.is_empty()
            && self.removed.is_empty()
            && self.refused.is_empty()
    }

    /// Add another report's entries to this one.
    pub fn merge(&mut self, other: FolderReport) {
        self.imported.extend(other.imported);
        self.kept.extend(other.kept);
        self.removed.extend(other.removed);
        for path in other.refused {
            if !self.refused.contains(&path) {
                self.refused.push(path);
            }
        }
    }
}

/// A message from the host to a page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum HostMessage {
    /// The first frame of every attach, repeated on a state change.
    Hello {
        /// The version of this contract.
        protocol: u32,
        /// Changes when the session starts afresh, so that a page that synced
        /// before does not merge into it.
        epoch: String,
        /// Where the session is.
        state: State,
        /// The message key, when `state` is `unavailable`.
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    /// How the collaboration server link stands.
    Upstream {
        /// The link's state.
        state: Upstream,
    },
    /// The folder changed under the session.
    Folder(FolderReport),
    /// A compile finished.
    Compiled {
        /// Whether it produced a PDF.
        succeeded: bool,
        /// When, as RFC 3339.
        at: String,
    },
}

/// The frame for a host message.
pub fn encode(message: &HostMessage) -> Vec<u8> {
    let json = serde_json::to_vec(message).expect("a host message serialises");
    let mut frame = vec![TAG_HOST];
    write_var_uint(&mut frame, json.len());
    frame.extend_from_slice(&json);
    frame
}

/// lib0's variable-length unsigned integer: seven bits at a time, low first,
/// the high bit of a byte saying that another follows.
fn write_var_uint(out: &mut Vec<u8>, mut value: usize) {
    while value > 0x7f {
        out.push(0x80 | (value & 0x7f) as u8);
        value >>= 7;
    }
    out.push(value as u8);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json_of(frame: &[u8]) -> serde_json::Value {
        assert_eq!(frame[0], TAG_HOST);
        // Skip the length, whose width depends on it.
        let mut at = 1;
        while frame[at] & 0x80 != 0 {
            at += 1;
        }
        serde_json::from_slice(&frame[at + 1..]).unwrap()
    }

    #[test]
    fn hello_is_the_documented_json() {
        let frame = encode(&HostMessage::Hello {
            protocol: 1,
            epoch: "ab12".to_owned(),
            state: State::Ready,
            reason: None,
        });
        assert_eq!(
            json_of(&frame),
            serde_json::json!({"t":"hello","protocol":1,"epoch":"ab12","state":"ready"})
        );
    }

    #[test]
    fn a_folder_message_lists_what_happened() {
        let frame = encode(&HostMessage::Folder(FolderReport {
            imported: vec!["a.tex".to_owned()],
            kept: vec![Kept {
                path: "b.tex".to_owned(),
                copy: "b.kept-20261127-101500.tex".to_owned(),
            }],
            ..FolderReport::default()
        }));
        assert_eq!(
            json_of(&frame),
            serde_json::json!({
                "t": "folder",
                "imported": ["a.tex"],
                "kept": [{"path": "b.tex", "copy": "b.kept-20261127-101500.tex"}],
                "removed": [],
                "refused": []
            })
        );
    }

    #[test]
    fn a_length_over_127_takes_two_bytes() {
        let frame = encode(&HostMessage::Hello {
            protocol: 1,
            epoch: "x".repeat(200),
            state: State::Unavailable,
            reason: Some("error-collab-unavailable".to_owned()),
        });
        assert!(frame[1] & 0x80 != 0, "a continuation bit is set");
        assert_eq!(json_of(&frame)["state"], "unavailable");
    }

    #[test]
    fn upstream_and_compiled_are_tagged() {
        assert_eq!(
            json_of(&encode(&HostMessage::Upstream {
                state: Upstream::None
            })),
            serde_json::json!({"t":"upstream","state":"none"})
        );
        assert_eq!(
            json_of(&encode(&HostMessage::Compiled {
                succeeded: true,
                at: "2026-11-27T10:15:00Z".to_owned()
            })),
            serde_json::json!({"t":"compiled","succeeded":true,"at":"2026-11-27T10:15:00Z"})
        );
    }
}
