//! Showing an item in Zotero, from a citation key in the document — or the
//! exact highlight, from the annotation key a `\ai[KEY]{…}` or
//! `\proofed[KEY]{…}` sentence carries (ADR-0030).
//!
//! # Why a citation key, and why the native field
//!
//! The thing under the writer's cursor is `\cite{key}`, so the question is
//! "which Zotero item is `key`?". Zotero has stored citation keys in its own
//! `citationKey` field since Better BibTeX started writing them there, which
//! means the copied database answers it in one indexed query, for every
//! library, with Zotero closed. A key that is only in a `.bib` and nowhere in
//! the library is honestly "not found" rather than guessed at by title.
//!
//! # Why the link is built here
//!
//! Zotero addresses an item by its key *within a library*: the same eight
//! characters can name different items in the personal library and in a group.
//! So the `zotero://` link needs the library, and only this side knows it.
//!
//! It also keeps [ADR-0006] intact. A plugin asks *show this citation key*; it
//! never hands over a URL, and nothing it says reaches the system opener except
//! an item key that has been checked to be eight characters of Zotero's
//! alphabet and a group id that is a number. There is no way to make this open
//! anything but Zotero.
//!
//! [ADR-0006]: https://github.com/texyaz/yaz/blob/main/docs/adr/0006-plugin-runtime-and-capabilities.md

use std::process::Command;

use crate::error::{Error, Result};

/// Which library an item lives in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LibraryRef {
    /// The user's own library, which Zotero links call `library`.
    User,
    /// A group library, by Zotero's group id (not its local `libraryID`).
    Group(i64),
}

/// An item, located precisely enough to link to it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Location {
    /// Zotero's item key, e.g. `XEFVP3U8`.
    pub item_key: String,
    /// The library that key belongs to.
    pub library: LibraryRef,
}

/// An annotation, located precisely enough to open its PDF at it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnnotationLocation {
    /// Zotero's key for the annotation itself.
    pub annotation_key: String,
    /// The attachment (the PDF) the annotation is drawn on.
    pub attachment_key: String,
    /// One-based page, when the annotation has one (EPUB and snapshot
    /// annotations do not; Zotero then opens at the annotation regardless).
    pub page: Option<u32>,
    /// The library both keys belong to.
    pub library: LibraryRef,
    /// The citation key of the item the PDF belongs to, if it has one. Lets a
    /// sentence backed by several sources pick the one the cursor is on.
    pub citation_key: Option<String>,
    /// The highlighted text, as Zotero stored it.
    pub text: Option<String>,
    /// The comment on the highlight — for an AI highlight, why it backs the
    /// sentence.
    pub comment: Option<String>,
    /// Highlight colour, e.g. `#a28ae5` for AI highlights.
    pub color: Option<String>,
}

/// Whether `key` has the shape of a Zotero item key.
///
/// Eight characters, upper-case letters and digits. Zotero's own alphabet is
/// narrower (it leaves out characters that are easy to misread), but nothing
/// outside this one can be a key, and this is what keeps a value read from a
/// database from ever carrying anything else into a link.
pub fn is_item_key(key: &str) -> bool {
    key.len() == 8
        && key
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
}

/// The `zotero://select` link for an item, or `None` for a malformed key.
pub fn select_uri(location: &Location) -> Option<String> {
    if !is_item_key(&location.item_key) {
        return None;
    }
    Some(match location.library {
        LibraryRef::User => format!("zotero://select/library/items/{}", location.item_key),
        LibraryRef::Group(group) => {
            format!("zotero://select/groups/{group}/items/{}", location.item_key)
        }
    })
}

/// The `zotero://open-pdf` link that opens the PDF at an annotation, or
/// `None` if either key is malformed.
pub fn open_pdf_uri(location: &AnnotationLocation) -> Option<String> {
    if !is_item_key(&location.annotation_key) || !is_item_key(&location.attachment_key) {
        return None;
    }
    let library = match location.library {
        LibraryRef::User => "library".to_owned(),
        LibraryRef::Group(group) => format!("groups/{group}"),
    };
    let page = location
        .page
        .map(|page| format!("page={page}&"))
        .unwrap_or_default();
    Some(format!(
        "zotero://open-pdf/{library}/items/{}?{page}annotation={}",
        location.attachment_key, location.annotation_key
    ))
}

/// Open the PDF in Zotero at the annotation.
pub fn reveal_annotation(location: &AnnotationLocation) -> Result<()> {
    let uri = open_pdf_uri(location).ok_or_else(|| Error::CannotOpen {
        detail: format!(
            "not an annotation: {:?} on {:?}",
            location.annotation_key, location.attachment_key
        ),
    })?;
    open(&uri)
}

/// Select the item in Zotero, starting Zotero if the system does that for
/// `zotero://` links (it does wherever Zotero is installed).
///
/// Returns once the link has been handed to the system, not once Zotero shows
/// it — the opener does not report that, on any platform.
pub fn reveal(location: &Location) -> Result<()> {
    let uri = select_uri(location).ok_or_else(|| Error::CannotOpen {
        detail: format!("not an item key: {:?}", location.item_key),
    })?;
    open(&uri)
}

fn open(uri: &str) -> Result<()> {
    opener(uri).spawn().map_err(|error| Error::CannotOpen {
        detail: format!("{uri}: {error}"),
    })?;
    Ok(())
}

/// The platform's "open this link with whatever handles it".
fn opener(uri: &str) -> Command {
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("/usr/bin/open");
        command.arg(uri);
        command
    }
    #[cfg(target_os = "windows")]
    {
        // Explorer hands a URL to its registered protocol handler, as a
        // double-click would. The link is validated above, so no quoting games.
        let mut command = Command::new("explorer.exe");
        command.arg(uri);
        command
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let mut command = Command::new("xdg-open");
        command.arg(uri);
        command
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(key: &str, library: LibraryRef) -> Location {
        Location {
            item_key: key.to_owned(),
            library,
        }
    }

    #[test]
    fn the_personal_library_is_called_library_in_a_link() {
        assert_eq!(
            select_uri(&at("XEFVP3U8", LibraryRef::User)).as_deref(),
            Some("zotero://select/library/items/XEFVP3U8")
        );
    }

    #[test]
    fn a_group_item_is_addressed_through_its_group_id() {
        assert_eq!(
            select_uri(&at("ABCD2345", LibraryRef::Group(98765))).as_deref(),
            Some("zotero://select/groups/98765/items/ABCD2345")
        );
    }

    fn annotation(page: Option<u32>, library: LibraryRef) -> AnnotationLocation {
        AnnotationLocation {
            annotation_key: "Z5QQBSIE".to_owned(),
            attachment_key: "YEU5NIW2".to_owned(),
            page,
            library,
            citation_key: None,
            text: None,
            comment: None,
            color: None,
        }
    }

    #[test]
    fn an_annotation_opens_its_pdf_at_the_page() {
        assert_eq!(
            open_pdf_uri(&annotation(Some(36), LibraryRef::User)).as_deref(),
            Some("zotero://open-pdf/library/items/YEU5NIW2?page=36&annotation=Z5QQBSIE")
        );
        assert_eq!(
            open_pdf_uri(&annotation(None, LibraryRef::Group(98765))).as_deref(),
            Some("zotero://open-pdf/groups/98765/items/YEU5NIW2?annotation=Z5QQBSIE")
        );
    }

    #[test]
    fn a_malformed_annotation_key_reaches_no_link() {
        let mut bad = annotation(Some(1), LibraryRef::User);
        bad.annotation_key = "Z5QQ&x=1".to_owned();
        assert_eq!(open_pdf_uri(&bad), None);
    }

    #[test]
    fn nothing_but_an_item_key_reaches_a_link() {
        for bad in [
            "",
            "short",
            "TOOLONGKEY",
            "abcd2345",
            "ABCD/../",
            "ABC 2345",
            "ABCD234;",
        ] {
            assert!(!is_item_key(bad), "{bad:?} accepted");
            assert_eq!(select_uri(&at(bad, LibraryRef::User)), None);
        }
    }
}
