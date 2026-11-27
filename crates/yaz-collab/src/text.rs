//! The text of a shared file: line endings, a digest, and a minimal edit.
//!
//! The shared text always uses `\n`, because that is what CodeMirror holds. A
//! file on disk may use `\r\n`, and a text that holds `\r\n` would drift from
//! the editor's buffer by one unit per line.

use sha2::{Digest as _, Sha256};
use yrs::{Text, TextRef, TransactionMut};

/// The digest of a text, as the base record and the reconcile table compare.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Digest([u8; 32]);

impl Digest {
    /// The digest of the shared form of a text.
    pub fn of(text: &str) -> Self {
        Self(Sha256::digest(text.as_bytes()).into())
    }
}

/// How a file on disk ends its lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LineEnding {
    /// `\n`. Also what a file with no line break, or a mix, is written with.
    #[default]
    Lf,
    /// `\r\n` throughout.
    Crlf,
}

/// The shared form of a file's content, and the line ending to write it back
/// with.
///
/// `\r\n` becomes `\n`, and so does a lone `\r`. A file that uses `\r\n` on
/// every line is remembered as such so it is written back the way it was; a
/// file that mixes the two is written back with `\n`, which is the one place
/// this is not lossless.
pub fn to_shared(raw: &str) -> (String, LineEnding) {
    let ending = if raw.contains("\r\n") && !raw.replace("\r\n", "").contains('\n') {
        LineEnding::Crlf
    } else {
        LineEnding::Lf
    };
    let shared = if raw.contains('\r') {
        raw.replace("\r\n", "\n").replace('\r', "\n")
    } else {
        raw.to_owned()
    };
    (shared, ending)
}

/// The shared text as it goes into a file.
pub fn to_disk(shared: &str, ending: LineEnding) -> String {
    match ending {
        LineEnding::Lf => shared.to_owned(),
        LineEnding::Crlf => shared.replace('\n', "\r\n"),
    }
}

/// One replacement, in the units the document counts: UTF-16, as the page's
/// editor and Yjs do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Edit {
    /// Where the replaced part starts.
    pub index: u32,
    /// How many units are removed.
    pub remove: u32,
    /// What is put in their place.
    pub insert: String,
}

/// The smallest single replacement that turns `old` into `new`: what they
/// share at the start and at the end stays, so a collaborator's caret in the
/// untouched text does not move.
///
/// Found on `char` boundaries, so it never cuts a character that needs two
/// UTF-16 units (an emoji) in half; the counts are then in UTF-16.
pub fn diff(old: &str, new: &str) -> Option<Edit> {
    let prefix = old
        .chars()
        .zip(new.chars())
        .take_while(|(a, b)| a == b)
        .count();
    let old_rest = old.chars().count() - prefix;
    let new_rest = new.chars().count() - prefix;
    let suffix = old
        .chars()
        .rev()
        .zip(new.chars().rev())
        .take(old_rest.min(new_rest))
        .take_while(|(a, b)| a == b)
        .count();
    let removed: String = old.chars().skip(prefix).take(old_rest - suffix).collect();
    let inserted: String = new.chars().skip(prefix).take(new_rest - suffix).collect();
    if removed.is_empty() && inserted.is_empty() {
        return None;
    }
    let index: usize = old.chars().take(prefix).map(char::len_utf16).sum();
    Some(Edit {
        index: index as u32,
        remove: removed.chars().map(char::len_utf16).sum::<usize>() as u32,
        insert: inserted,
    })
}

/// Apply an edit to a shared text.
pub fn apply(text: &TextRef, txn: &mut TransactionMut<'_>, edit: &Edit) {
    if edit.remove > 0 {
        text.remove_range(txn, edit.index, edit.remove);
    }
    if !edit.insert.is_empty() {
        text.insert(txn, edit.index, &edit.insert);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::{Doc, GetString, OffsetKind, Options, Transact};

    fn replace(old: &str, new: &str) -> String {
        let doc = Doc::with_options(Options {
            offset_kind: OffsetKind::Utf16,
            ..Options::default()
        });
        let text = doc.get_or_insert_text("t");
        text.insert(&mut doc.transact_mut(), 0, old);
        if let Some(edit) = diff(old, new) {
            apply(&text, &mut doc.transact_mut(), &edit);
        }
        text.get_string(&doc.transact())
    }

    #[test]
    fn a_crlf_file_is_written_back_with_crlf() {
        let (shared, ending) = to_shared("one\r\ntwo\r\n");
        assert_eq!(shared, "one\ntwo\n");
        assert_eq!(ending, LineEnding::Crlf);
        assert_eq!(to_disk(&shared, ending), "one\r\ntwo\r\n");
    }

    #[test]
    fn a_file_that_mixes_endings_is_written_back_with_lf() {
        let (shared, ending) = to_shared("one\r\ntwo\nthree\r\n");
        assert_eq!(shared, "one\ntwo\nthree\n");
        assert_eq!(ending, LineEnding::Lf);
    }

    #[test]
    fn a_lone_carriage_return_becomes_a_line_break() {
        let (shared, ending) = to_shared("old\rmac\rfile");
        assert_eq!(shared, "old\nmac\nfile");
        assert_eq!(ending, LineEnding::Lf);
    }

    #[test]
    fn text_with_no_line_break_keeps_lf() {
        assert_eq!(to_shared("x").1, LineEnding::Lf);
        assert_eq!(to_shared("").1, LineEnding::Lf);
    }

    #[test]
    fn equal_texts_have_no_edit_and_equal_digests() {
        assert_eq!(diff("same", "same"), None);
        assert_eq!(Digest::of("same"), Digest::of("same"));
        assert_ne!(Digest::of("same"), Digest::of("Same"));
    }

    #[test]
    fn the_edit_is_the_middle_that_differs() {
        assert_eq!(
            diff("hello big world", "hello small world"),
            Some(Edit {
                index: 6,
                remove: 3,
                insert: "small".to_owned()
            })
        );
        assert_eq!(
            diff("ab", "abc"),
            Some(Edit {
                index: 2,
                remove: 0,
                insert: "c".to_owned()
            })
        );
        assert_eq!(
            diff("abc", ""),
            Some(Edit {
                index: 0,
                remove: 3,
                insert: String::new()
            })
        );
    }

    #[test]
    fn repeated_text_does_not_overlap_prefix_and_suffix() {
        for (old, new) in [("aa", "aaa"), ("aaa", "aa"), ("abab", "ab"), ("ab", "abab")] {
            assert_eq!(replace(old, new), new, "{old} -> {new}");
        }
    }

    #[test]
    fn umlauts_and_an_emoji_are_counted_in_utf16() {
        let old = "Grüße 😀 aus Weimar\nZweite Zeile";
        let new = "Grüße 😀 aus der Bauhaus-Stadt Weimar 😁\nZweite Zeile";
        let edit = diff(old, new).unwrap();
        // "Grüße " is 6 units and the emoji two, so the edit starts after
        // "Grüße 😀 aus ", 6 + 2 + 5 = 13 units in.
        assert_eq!(edit.index, 13);
        assert_eq!(replace(old, new), new);
    }

    #[test]
    fn an_edit_never_cuts_a_surrogate_pair() {
        // U+1F600 and U+1F601 share their first UTF-16 unit.
        let edit = diff("a\u{1F600}b", "a\u{1F601}b").unwrap();
        assert_eq!((edit.index, edit.remove), (1, 2));
        assert_eq!(edit.insert, "\u{1F601}");
        assert_eq!(replace("a\u{1F600}b", "a\u{1F601}b"), "a\u{1F601}b");
        // And the same at the end of the text.
        assert_eq!(replace("x\u{1F600}", "x\u{1F601}"), "x\u{1F601}");
        assert_eq!(
            replace("\u{1F600}", "\u{1F601}\u{1F600}"),
            "\u{1F601}\u{1F600}"
        );
    }
}
