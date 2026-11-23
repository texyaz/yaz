//! Finding a LaTeX distribution already on the machine.
//!
//! [`system_engine`](crate::system_engine) answers "is this binary name on
//! `PATH`", which misses the common case of TeX Live or MiKTeX installed but
//! never added to `PATH` (routine on Windows). This module answers a
//! different question — "what does this directory provide" — so a user can
//! point yaz at an install directly, and so a short list of conventional
//! install locations can be offered as candidates.
//!
//! Nothing here runs unasked: like engine detection, probing spawns a
//! process per candidate binary, so [`scan`] is only ever called from a user
//! action (a "Scan" button), never at startup.

use camino::{Utf8Path, Utf8PathBuf};
use std::process::{Command, Stdio};
use yaz_core::settings::LatexInstall;

use crate::system_engine::suppress_console;

/// Binaries a LaTeX install is checked for, in the order they are reported.
const CANDIDATES: [&str; 4] = ["xelatex", "lualatex", "pdflatex", "latexmk"];

/// Which of the candidate binaries exist and actually run in `dir`.
///
/// A file with the right name proves nothing on its own — the same
/// liveness check `system_engine`'s `binary_exists` uses for a bare `PATH`
/// lookup is used here, just against a specific directory instead of `PATH`.
pub fn probe_dir(dir: &Utf8Path) -> Vec<String> {
    CANDIDATES
        .iter()
        .filter(|name| runs(&binary_path(dir, name)))
        .map(|name| (*name).to_owned())
        .collect()
}

/// `dir` as a [`LatexInstall`], or `None` if it provides none of the
/// candidate binaries — e.g. a folder the user picked that is not a TeX
/// `bin` directory at all.
pub fn probe(dir: &Utf8Path) -> Option<LatexInstall> {
    let engines = probe_dir(dir);
    if engines.is_empty() {
        return None;
    }
    // Whichever engine answered first is good enough for a display string;
    // the exact `--version` banner does not otherwise vary between engines
    // from the same install.
    let version = engines
        .iter()
        .find_map(|name| version_line(&binary_path(dir, name)));
    Some(LatexInstall {
        path: dir.to_owned(),
        engines,
        version,
    })
}

/// Conventional locations a TeX distribution puts its `bin` directory,
/// probed for [`scan`]. Not exhaustive — a user can always add a directory
/// manually — just the handful of places TeX Live and MiKTeX install
/// themselves to by default.
pub fn scan() -> Vec<LatexInstall> {
    candidate_dirs()
        .into_iter()
        .filter_map(|dir| probe(&dir))
        .collect()
}

fn binary_path(dir: &Utf8Path, name: &str) -> Utf8PathBuf {
    dir.join(format!("{name}{}", std::env::consts::EXE_SUFFIX))
}

fn runs(binary: &Utf8Path) -> bool {
    if !binary.is_file() {
        return false;
    }
    let mut command = Command::new(binary);
    command
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null());
    suppress_console(&mut command);
    command
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// The first line of `--version` output, e.g. `XeTeX 3.141592653-...`.
fn version_line(binary: &Utf8Path) -> Option<String> {
    let mut command = Command::new(binary);
    command
        .arg("--version")
        .stderr(Stdio::null())
        .stdin(Stdio::null());
    suppress_console(&mut command);
    let output = command.output().ok()?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(|line| line.trim().to_owned())
}

/// Immediate subdirectories of `root` — TeX Live's per-year install roots,
/// e.g. `/usr/local/texlive/2024`. `walkdir` only to keep the version number
/// out of this code; nothing here recurses past depth 1.
fn version_dirs(root: &Utf8Path) -> Vec<Utf8PathBuf> {
    walkdir::WalkDir::new(root.as_std_path())
        .min_depth(1)
        .max_depth(1)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_dir())
        .filter_map(|entry| Utf8PathBuf::from_path_buf(entry.into_path()).ok())
        .collect()
}

/// Immediate subdirectories of `dir` — used to find a TeX Live `bin`
/// directory's single platform-named child without hardcoding an
/// architecture string that drifts (`x86_64-linux`, `universal-darwin`, ...).
#[cfg(not(target_os = "windows"))]
fn child_dirs(dir: &Utf8Path) -> Vec<Utf8PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir.as_std_path()) else {
        return Vec::new();
    };
    entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter_map(|entry| Utf8PathBuf::from_path_buf(entry.path()).ok())
        .collect()
}

#[cfg(target_os = "windows")]
fn candidate_dirs() -> Vec<Utf8PathBuf> {
    let mut dirs: Vec<Utf8PathBuf> = version_dirs(Utf8Path::new("C:/texlive"))
        .into_iter()
        .map(|version| version.join("bin/windows"))
        .collect();
    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        dirs.push(Utf8PathBuf::from(local_appdata).join("Programs/MiKTeX/miktex/bin/x64"));
    }
    dirs.push(Utf8PathBuf::from("C:/Program Files/MiKTeX/miktex/bin/x64"));
    dirs.push(Utf8PathBuf::from(
        "C:/Program Files (x86)/MiKTeX/miktex/bin",
    ));
    dirs
}

#[cfg(target_os = "macos")]
fn candidate_dirs() -> Vec<Utf8PathBuf> {
    let mut dirs = vec![Utf8PathBuf::from("/Library/TeX/texbin")];
    for version in version_dirs(Utf8Path::new("/usr/local/texlive")) {
        dirs.extend(child_dirs(&version.join("bin")));
    }
    dirs
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn candidate_dirs() -> Vec<Utf8PathBuf> {
    let mut dirs = Vec::new();
    for version in version_dirs(Utf8Path::new("/usr/local/texlive")) {
        dirs.extend(child_dirs(&version.join("bin")));
    }
    dirs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_directory_provides_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        assert!(probe_dir(&path).is_empty());
        assert!(probe(&path).is_none());
    }

    #[test]
    fn a_directory_with_only_unrelated_files_provides_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        std::fs::write(path.join("readme.txt"), "not a typesetter").unwrap();
        assert!(probe(&path).is_none());
    }

    #[test]
    fn scan_does_not_panic_when_no_conventional_location_exists() {
        // Exercises the real candidate_dirs() on whatever machine runs the
        // test — asserting only that it terminates and returns something
        // list-shaped, since whether TeX is actually installed here is not
        // this test's business.
        let _ = scan();
    }
}
