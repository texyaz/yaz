//! The folder: reading shared files, writing them atomically, finding them.
//!
//! Every path here is a [`SharedPath`], so the policy has already said yes,
//! and every one is resolved through [`yaz_core::project::resolve_in_root`],
//! so a symlink that leads out of the folder is refused and not followed.

use std::io::Write as _;
use std::time::SystemTime;

use camino::{Utf8Path, Utf8PathBuf};
use yaz_core::project::{canonical_root, resolve_in_root};

use crate::error::Error;
use crate::policy::{KEPT_MARK, MAX_SHARED_BYTES, SharedPath, shared_path};
use crate::text::{Digest, LineEnding, to_shared};

/// What a shared path holds in the folder.
#[derive(Debug)]
pub enum Disk {
    /// No such file.
    Missing,
    /// A text file, in its shared form.
    Text {
        /// The content with `\n` line endings.
        text: String,
        /// How the file ends its lines.
        ending: LineEnding,
        /// The digest of `text`.
        digest: Digest,
    },
    /// A file that is there and cannot be shared.
    Refused,
}

fn io(path: &Utf8Path, source: std::io::Error) -> Error {
    Error::Io {
        path: path.to_owned(),
        source,
    }
}

/// Read a shared path from the folder.
///
/// A file over [`MAX_SHARED_BYTES`], one that is not valid UTF-8 and one that
/// is not a regular file are [`Disk::Refused`]: they stay as they are.
pub fn read(root: &Utf8Path, path: &SharedPath) -> Result<Disk, Error> {
    let target = match resolve_in_root(root, path.as_str()) {
        Ok(target) => target,
        // The folder it would be in does not exist, so the file does not.
        Err(yaz_core::Error::NotFound { .. }) => return Ok(Disk::Missing),
        Err(error) => return Err(error.into()),
    };
    let metadata = match std::fs::metadata(&target) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Disk::Missing),
        Err(error) => return Err(io(&target, error)),
    };
    if !metadata.is_file() || metadata.len() > MAX_SHARED_BYTES {
        return Ok(Disk::Refused);
    }
    let bytes = std::fs::read(&target).map_err(|error| io(&target, error))?;
    let Ok(raw) = String::from_utf8(bytes) else {
        return Ok(Disk::Refused);
    };
    let (text, ending) = to_shared(&raw);
    let digest = Digest::of(&text);
    Ok(Disk::Text {
        text,
        ending,
        digest,
    })
}

/// Write a file so that nobody reading it sees half of it: the content goes to
/// a temporary file beside it and is renamed over it. A folder the path needs
/// is made, one level at a time, each checked to be inside the project.
pub fn write_atomic(root: &Utf8Path, path: &SharedPath, contents: &str) -> Result<(), Error> {
    ensure_parent(root, path)?;
    let target = resolve_in_root(root, path.as_str())?;
    let parent = target.parent().expect("a file in the project has a parent");
    let name = target.file_name().expect("a shared path names a file");
    let temporary = parent.join(format!(".{name}.yaz-{}.tmp", std::process::id()));
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&temporary)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        if let Ok(existing) = std::fs::metadata(&target) {
            // Keep the mode the file had.
            std::fs::set_permissions(&temporary, existing.permissions())?;
        }
        std::fs::rename(&temporary, &target)
    })();
    if let Err(source) = result {
        let _ = std::fs::remove_file(&temporary);
        return Err(io(&target, source));
    }
    Ok(())
}

/// Make the folders a path lies in, checking each against the root.
fn ensure_parent(root: &Utf8Path, path: &SharedPath) -> Result<(), Error> {
    let mut components: Vec<&str> = path.as_str().split('/').collect();
    components.pop();
    let mut relative = String::new();
    for component in components {
        if !relative.is_empty() {
            relative.push('/');
        }
        relative.push_str(component);
        let folder = resolve_in_root(root, &relative)?;
        if !folder.exists() {
            std::fs::create_dir(&folder).map_err(|error| io(&folder, error))?;
        }
    }
    Ok(())
}

/// The name of the copy that keeps a session's text beside `path`:
/// `<stem>.kept-<yyyymmdd-hhmmss>.<ext>`, with `-2`, `-3`, … when a copy of
/// the same second is already there.
pub fn kept_copy(root: &Utf8Path, path: &SharedPath, now: SystemTime) -> Result<SharedPath, Error> {
    let stamp = timestamp(now);
    let (folder, name) = match path.as_str().rsplit_once('/') {
        Some((folder, name)) => (format!("{folder}/"), name),
        None => (String::new(), path.as_str()),
    };
    let (stem, extension) = name
        .rsplit_once('.')
        .expect("a shared path has an extension");
    for attempt in 1.. {
        let suffix = if attempt == 1 {
            String::new()
        } else {
            format!("-{attempt}")
        };
        let candidate = format!("{folder}{stem}{KEPT_MARK}{stamp}{suffix}.{extension}");
        // The mark makes the policy refuse it on purpose, so check by hand.
        match resolve_in_root(root, &candidate) {
            // Not even its folder is there, so the copy is not.
            Err(yaz_core::Error::NotFound { .. }) => {
                return Ok(SharedPath::kept_copy(candidate));
            }
            Err(error) => return Err(error.into()),
            Ok(resolved) if !resolved.exists() => {
                return Ok(SharedPath::kept_copy(candidate));
            }
            Ok(_) => {}
        }
    }
    unreachable!("the loop ends by returning")
}

/// `yyyymmdd-hhmmss` in UTC.
fn timestamp(now: SystemTime) -> String {
    let seconds = now
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    let (days, rest) = (seconds / 86_400, seconds % 86_400);
    // Days since 1970-01-01 to a calendar date (Hinnant's civil_from_days).
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}{month:02}{day:02}-{:02}{:02}{:02}",
        rest / 3_600,
        rest % 3_600 / 60,
        rest % 60
    )
}

/// Every shared file in the folder, in a stable order. Symlinks are not
/// followed, and `build/` and dot-folders are not entered.
pub fn scan(root: &Utf8Path) -> Result<Vec<SharedPath>, Error> {
    let root = canonical_root(root)?;
    let mut found = Vec::new();
    let walker = walkdir::WalkDir::new(&root)
        .follow_links(false)
        .sort_by_file_name()
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            entry.depth() == 0 || !name.starts_with('.')
        });
    for entry in walker {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() {
            continue;
        }
        let Some(relative) = Utf8Path::from_path(entry.path())
            .and_then(|path| path.strip_prefix(&root).ok())
            .map(Utf8PathBuf::from)
        else {
            continue;
        };
        if let Some(path) = shared_path(&relative.as_str().replace('\\', "/")) {
            found.push(path);
        }
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a_folder() -> (tempfile::TempDir, Utf8PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = canonical_root(Utf8Path::from_path(dir.path()).unwrap()).unwrap();
        (dir, root)
    }

    fn path(text: &str) -> SharedPath {
        shared_path(text).unwrap()
    }

    #[test]
    fn a_write_replaces_the_file_and_leaves_no_temporary_one() {
        let (_dir, root) = a_folder();
        std::fs::write(root.join("a.tex"), "old").unwrap();
        write_atomic(&root, &path("a.tex"), "new\n").unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("a.tex")).unwrap(),
            "new\n"
        );
        let names: Vec<_> = std::fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, ["a.tex"]);
    }

    #[test]
    fn a_write_makes_the_folders_it_needs() {
        let (_dir, root) = a_folder();
        write_atomic(&root, &path("chapters/deep/one.tex"), "x").unwrap();
        assert!(root.join("chapters/deep/one.tex").is_file());
    }

    #[test]
    fn a_path_outside_the_policy_never_reaches_the_disk() {
        let (_dir, root) = a_folder();
        // There is no way to hold a `SharedPath` for these: the policy is the
        // only constructor, and it says no.
        for attempt in ["../x.tex", "build/x.tex", ".git/x.tex", "yaz.toml"] {
            assert!(shared_path(attempt).is_none(), "{attempt}");
        }
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_that_leads_out_of_the_project_is_not_written_through() {
        let (_dir, root) = a_folder();
        let (_other, elsewhere) = a_folder();
        std::os::unix::fs::symlink(&elsewhere, root.join("link")).unwrap();
        let error = write_atomic(&root, &path("link/x.tex"), "x").unwrap_err();
        assert_eq!(error.message_key(), "error-fs-outside-root");
        assert!(!elsewhere.join("x.tex").exists());
        // And a new folder below it is not made out there either.
        assert!(write_atomic(&root, &path("link/new/x.tex"), "x").is_err());
        assert!(!elsewhere.join("new").exists());
    }

    #[test]
    fn a_file_is_read_in_its_shared_form() {
        let (_dir, root) = a_folder();
        std::fs::write(root.join("a.tex"), "one\r\ntwo\r\n").unwrap();
        match read(&root, &path("a.tex")).unwrap() {
            Disk::Text { text, ending, .. } => {
                assert_eq!(text, "one\ntwo\n");
                assert_eq!(ending, LineEnding::Crlf);
            }
            other => panic!("{other:?}"),
        }
        assert!(matches!(
            read(&root, &path("none.tex")).unwrap(),
            Disk::Missing
        ));
        assert!(matches!(
            read(&root, &path("no/folder.tex")).unwrap(),
            Disk::Missing
        ));
    }

    #[test]
    fn a_file_that_is_too_large_or_not_text_is_refused_not_read() {
        let (_dir, root) = a_folder();
        std::fs::write(
            root.join("big.tex"),
            vec![b'a'; MAX_SHARED_BYTES as usize + 1],
        )
        .unwrap();
        std::fs::write(root.join("latin1.tex"), [0x4d, 0xfc, 0x6c, 0x6c]).unwrap();
        std::fs::create_dir(root.join("dir.tex")).unwrap();
        for name in ["big.tex", "latin1.tex", "dir.tex"] {
            assert!(
                matches!(read(&root, &path(name)).unwrap(), Disk::Refused),
                "{name}"
            );
        }
    }

    #[test]
    fn the_scan_finds_shared_files_only() {
        let (_dir, root) = a_folder();
        for (name, body) in [
            ("main.tex", "x"),
            ("refs.bib", "x"),
            ("chapters/one.tex", "x"),
            ("build/main.tex", "x"),
            (".git/config.tex", "x"),
            ("figure.png", "x"),
            ("yaz.toml", "x"),
            ("main.kept-20261127-101500.tex", "x"),
        ] {
            let target = root.join(name);
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            std::fs::write(target, body).unwrap();
        }
        let found: Vec<String> = scan(&root)
            .unwrap()
            .iter()
            .map(ToString::to_string)
            .collect();
        assert_eq!(found, ["chapters/one.tex", "main.tex", "refs.bib"]);
    }

    #[test]
    fn a_kept_copy_is_named_for_the_time_and_never_taken_twice() {
        let (_dir, root) = a_folder();
        // 2026-11-27 10:15:00 UTC.
        let when = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_795_774_500);
        let first = kept_copy(&root, &path("chapters/one.tex"), when).unwrap();
        assert_eq!(first.as_str(), "chapters/one.kept-20261127-101500.tex");
        std::fs::create_dir_all(root.join("chapters")).unwrap();
        std::fs::write(root.join(first.as_str()), "x").unwrap();
        let second = kept_copy(&root, &path("chapters/one.tex"), when).unwrap();
        assert_eq!(second.as_str(), "chapters/one.kept-20261127-101500-2.tex");
    }

    #[test]
    fn the_calendar_is_right_on_a_leap_day() {
        // 2024-02-29 23:59:59 UTC.
        let when = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_709_251_199);
        assert_eq!(timestamp(when), "20240229-235959");
        assert_eq!(timestamp(SystemTime::UNIX_EPOCH), "19700101-000000");
    }
}
