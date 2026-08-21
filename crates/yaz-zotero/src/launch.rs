//! Starting Zotero, when it is installed but not running.
//!
//! # Why the plugin cannot name the binary
//!
//! [ADR-0006] makes the Rust process the security boundary, and "run this
//! program" is the request where that matters most. A capability of the shape
//! *"the Zotero plugin may start a process"* would be a capability to start
//! **any** process — the plugin would name the path and this side would run it,
//! which is a general-purpose process launcher wearing a citation manager's
//! name.
//!
//! So the plugin asks a question with no parameters — *start Zotero* — and this
//! module answers it from the same discovery the rest of the crate already does.
//! Nothing a plugin says decides which file is executed.
//!
//! # Why discovery is a list of places and not a search
//!
//! Zotero installs itself in one of a handful of locations per platform, and a
//! filesystem search for something called `zotero` is both slow and a way to
//! find the wrong thing — an unpacked download in a browser's cache, a
//! half-removed old version. The list below is where the installers put it, and
//! anything not on it is reported as "not found" rather than guessed at.
//!
//! [ADR-0006]: https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0006-plugin-runtime-and-capabilities.md

use camino::Utf8PathBuf;
use std::process::Command;

use crate::error::{Error, Result};

/// Where Zotero was found, and how it is started.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Installation {
    /// The thing to run. A bundle directory on macOS, an executable elsewhere.
    pub path: Utf8PathBuf,
}

/// A path under `base`, if there is a base and something is actually there.
///
/// Split from the environment lookup so it can be tested without setting a
/// variable: mutating the process environment is `unsafe` in current Rust, and
/// the crate denies unsafe code.
fn under(base: Option<String>, tail: &str) -> Option<Utf8PathBuf> {
    let path = Utf8PathBuf::from(base?).join(tail);
    path.exists().then_some(path)
}

/// Turn an environment variable into a path, if it is set and usable.
fn from_env(variable: &str, tail: &str) -> Option<Utf8PathBuf> {
    under(std::env::var(variable).ok(), tail)
}

/// The places each platform's installer puts Zotero.
///
/// Ordered most-likely first, but every one of them is checked for existence
/// before it is offered — the order only decides which of two installations
/// wins on a machine that has both.
fn candidates() -> Vec<Utf8PathBuf> {
    let mut found = Vec::new();

    #[cfg(target_os = "windows")]
    {
        for variable in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            if let Some(path) = from_env(variable, "Zotero/zotero.exe") {
                found.push(path);
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        for path in ["/Applications/Zotero.app"] {
            let path = Utf8PathBuf::from(path);
            if path.exists() {
                found.push(path);
            }
        }
        if let Some(path) = from_env("HOME", "Applications/Zotero.app") {
            found.push(path);
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for path in [
            "/usr/bin/zotero",
            "/usr/local/bin/zotero",
            "/opt/zotero/zotero",
        ] {
            let path = Utf8PathBuf::from(path);
            if path.exists() {
                found.push(path);
            }
        }
        if let Some(path) = from_env("HOME", ".local/bin/zotero") {
            found.push(path);
        }
    }

    // Silences the unused-function warning on platforms whose arm does not use
    // it, without a second `cfg` around the definition.
    let _ = from_env;
    found
}

/// Whether Zotero appears to be installed, and where.
pub fn installed() -> Option<Installation> {
    candidates()
        .into_iter()
        .next()
        .map(|path| Installation { path })
}

/// Start Zotero, and do not wait for it.
///
/// Detached on purpose: yaz is not Zotero's parent process in any meaningful
/// sense, and a citation manager that closed because the editor did would be a
/// surprising thing to have built. The library is re-probed by the caller once
/// the user says Zotero is up, rather than by polling from here — starting a
/// program and then blocking on it becoming ready is how a launch turns into a
/// hang.
pub fn launch() -> Result<Installation> {
    let installation = installed().ok_or_else(|| Error::CannotLaunch {
        detail: "zotero-launch-not-installed".to_owned(),
    })?;

    let mut command = spawner(&installation);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        /// `CREATE_NO_WINDOW`, from the Win32 process creation flags.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command.spawn().map_err(|error| Error::CannotLaunch {
        detail: format!("{}: {error}", installation.path),
    })?;
    Ok(installation)
}

/// The command that starts an installation.
///
/// macOS is the odd one: an `.app` is a directory, not something to execute, so
/// it is handed to `open` — which is also what gives the running application a
/// proper session rather than a child process of the editor.
fn spawner(installation: &Installation) -> Command {
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("/usr/bin/open");
        command.arg("-a").arg(installation.path.as_str());
        command
    }
    #[cfg(not(target_os = "macos"))]
    {
        Command::new(installation.path.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unset_variable_yields_no_path() {
        assert_eq!(under(None, "Zotero/zotero.exe"), None);
        // And through the real lookup, with a name no environment sets.
        assert_eq!(from_env("YAZ_NOT_A_REAL_VARIABLE", "Zotero"), None);
    }

    #[test]
    fn a_base_with_nothing_under_it_yields_no_path() {
        // The case that matters: every platform sets `HOME` or `ProgramFiles`
        // whether or not Zotero is underneath it, so being set is not enough.
        assert_eq!(
            under(Some("/definitely/not/here".to_owned()), "Zotero/zotero.exe"),
            None
        );
    }

    #[test]
    fn a_base_holding_the_file_yields_it() {
        // Proves the negative tests above are testing something: the same
        // function does return a path when one is really there.
        let directory = tempfile::tempdir().expect("temp dir");
        let base = directory.path().to_string_lossy().into_owned();
        std::fs::create_dir_all(directory.path().join("Zotero")).expect("create");
        std::fs::write(directory.path().join("Zotero/zotero.exe"), b"").expect("write");
        assert!(under(Some(base), "Zotero/zotero.exe").is_some());
    }

    #[test]
    fn every_candidate_offered_actually_exists() {
        // The whole point of the list: a path is offered because it is there,
        // never because the platform usually puts it there. Reporting a Zotero
        // that is not installed would turn "start Zotero" into an error the
        // user cannot act on.
        for path in candidates() {
            assert!(path.exists(), "offered a path that is not there: {path}");
        }
    }

    #[test]
    fn installed_agrees_with_the_candidates() {
        assert_eq!(installed().is_some(), !candidates().is_empty());
    }
}
