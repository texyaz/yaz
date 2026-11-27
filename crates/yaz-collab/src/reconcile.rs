//! Where the folder and the session meet.
//!
//! One decision per shared path, from three digests: what the host last wrote
//! or imported (`base`), what is on disk now, and what the session holds now.
//! There is no diverged state and nothing waits for a choice: the folder wins,
//! and the session's competing text becomes a file beside it, so that nothing
//! typed is dropped (ADR-0035).

use crate::text::Digest;

/// What to do with one path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Both sides are as the host left them.
    Nothing,
    /// Only the session changed: write its text to disk.
    WriteSession,
    /// Only the disk changed: take it into the session as an edit.
    ImportDisk,
    /// Both changed to the same text: remember it as the base.
    Adopt,
    /// Both changed, differently: write the session's text beside the file,
    /// then take the disk in.
    KeepThenImport,
    /// A file the session has no entry for: add it, whole, as a new entry.
    Seed,
    /// The file is gone and the session did not change it: drop the entry.
    RemoveEntry,
    /// The file is gone but the session changed it: keep its text beside the
    /// folder's, then drop the entry.
    KeepThenRemove,
}

/// The decision for one path. A digest is `None` where there is nothing: no
/// record, no file, no entry.
///
/// Two rows go beyond the table of the design, because a table with a hole
/// would have to guess there. A file on disk with no entry is seeded whatever
/// the base says (the folder wins, so an entry another host removed comes
/// back until deletions are propagated, which is not yet), and a path with a
/// session entry and no file and no base is written.
pub fn decide(base: Option<&Digest>, disk: Option<&Digest>, session: Option<&Digest>) -> Action {
    match (disk, session) {
        (None, None) => Action::Nothing,
        (Some(_), None) => Action::Seed,
        (None, Some(_)) => match base {
            // A file that was there and is gone.
            Some(base) if session == Some(base) => Action::RemoveEntry,
            Some(_) => Action::KeepThenRemove,
            // An entry the folder has never had.
            None => Action::WriteSession,
        },
        (Some(disk), Some(session)) => {
            let disk_changed = base != Some(disk);
            let session_changed = base != Some(session);
            match (disk_changed, session_changed) {
                (false, false) => Action::Nothing,
                (false, true) => Action::WriteSession,
                (true, false) => Action::ImportDisk,
                (true, true) if disk == session => Action::Adopt,
                (true, true) => Action::KeepThenImport,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A row: what it is, then base, disk and session, then the decision.
    type Row<'a> = (
        &'a str,
        Option<&'a Digest>,
        Option<&'a Digest>,
        Option<&'a Digest>,
        Action,
    );

    fn d(text: &str) -> Digest {
        Digest::of(text)
    }

    /// The whole table of the design, row by row.
    #[test]
    fn the_table() {
        let (base, other, third) = (d("base"), d("other"), d("third"));
        #[rustfmt::skip]
        let rows: [Row; 17] = [
            // disk same, session same
            ("same, same",                   Some(&base),  Some(&base),  Some(&base),  Action::Nothing),
            // disk same, session changed
            ("same, changed",                Some(&base),  Some(&base),  Some(&other), Action::WriteSession),
            // disk changed, session same
            ("changed, same",                Some(&base),  Some(&other), Some(&base),  Action::ImportDisk),
            // both changed
            ("changed, changed, equal",      Some(&base),  Some(&other), Some(&other), Action::Adopt),
            ("changed, changed, differ",     Some(&base),  Some(&other), Some(&third), Action::KeepThenImport),
            // new on disk, absent from the session
            ("new on disk, absent",          None,         Some(&other), None,         Action::Seed),
            ("on disk, entry gone, base",    Some(&base),  Some(&base),  None,         Action::Seed),
            // deleted
            ("deleted, same",                Some(&base),  None,         Some(&base),  Action::RemoveEntry),
            ("deleted, changed",             Some(&base),  None,         Some(&other), Action::KeepThenRemove),
            // absent from the folder, present in the session, no base
            ("absent, present, no base",     None,         None,         Some(&other), Action::WriteSession),
            // nothing anywhere
            ("nothing",                      None,         None,         None,         Action::Nothing),
            ("nothing but a base",           Some(&base),  None,         None,         Action::Nothing),
            // no base, both present
            ("no base, equal",               None,         Some(&other), Some(&other), Action::Adopt),
            ("no base, differ",              None,         Some(&other), Some(&third), Action::KeepThenImport),
            // the base is stale on one side only
            ("disk equals base, session new", Some(&other), Some(&other), Some(&third), Action::WriteSession),
            ("session equals base, disk new", Some(&other), Some(&third), Some(&other), Action::ImportDisk),
            ("both moved to a third text",   Some(&base),  Some(&third), Some(&third), Action::Adopt),
        ];
        for (name, base, disk, session, expected) in rows {
            assert_eq!(decide(base, disk, session), expected, "{name}");
        }
    }
}
