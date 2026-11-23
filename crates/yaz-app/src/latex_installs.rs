//! Registering a LaTeX distribution the user pointed yaz at.
//!
//! `yaz-compile::install` answers "what does this directory provide"; this
//! module is the thin IPC surface over it plus the persistence a `PATH`
//! lookup alone cannot offer — an install found once needs to still be
//! found after a restart, and (routinely on Windows) is not on `PATH` at all.

use camino::Utf8PathBuf;
use serde::{Deserialize, Serialize};
use yaz_core::settings::{LatexInstall, Settings};

use crate::appearance::config_dir;
use crate::commands::{CommandError, Result};

/// A registered LaTeX install, as sent to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatexInstallDto {
    path: String,
    engines: Vec<String>,
    version: Option<String>,
}

impl From<LatexInstall> for LatexInstallDto {
    fn from(install: LatexInstall) -> Self {
        Self {
            path: install.path.to_string(),
            engines: install.engines,
            version: install.version,
        }
    }
}

/// Every LaTeX install the user has registered, most recently added last.
#[tauri::command]
pub fn get_latex_installs() -> Result<Vec<LatexInstallDto>> {
    Ok(Settings::load(&config_dir()?)
        .latex_installs
        .into_iter()
        .map(LatexInstallDto::from)
        .collect())
}

/// Conventional install locations, probed for a LaTeX distribution.
///
/// Only ever called from a user action (a "Scan" button) — never at
/// startup. Each candidate is a process spawn, and yaz already pays that
/// cost lazily for engine detection for the same reason.
#[tauri::command]
pub fn scan_latex_installs() -> Vec<LatexInstallDto> {
    yaz_compile::install::scan()
        .into_iter()
        .map(LatexInstallDto::from)
        .collect()
}

/// Register a directory as a LaTeX install, once it is shown to provide one.
///
/// Probed here rather than trusted, so a folder that is not a TeX `bin`
/// directory is refused while the person is looking at the dialog — the same
/// reasoning `set_development_plugin` uses for a plugin manifest.
#[tauri::command]
pub fn add_latex_install(path: String) -> Result<LatexInstallDto> {
    let dir = Utf8PathBuf::from(path);
    let install = yaz_compile::install::probe(&dir).ok_or_else(|| {
        CommandError::new(
            "latex-install-not-found",
            format!("{dir}: no LaTeX engine found in this directory"),
        )
    })?;

    let directory = config_dir()?;
    let mut settings = Settings::load(&directory);
    settings
        .latex_installs
        .retain(|existing| existing.path != install.path);
    settings.latex_installs.push(install.clone());
    settings.save(&directory)?;

    Ok(install.into())
}

/// Forget a registered install. Does not touch the LaTeX distribution itself.
#[tauri::command]
pub fn remove_latex_install(path: String) -> Result<()> {
    let directory = config_dir()?;
    let mut settings = Settings::load(&directory);
    settings
        .latex_installs
        .retain(|existing| existing.path.as_str() != path);
    Ok(settings.save(&directory)?)
}

/// Re-probe a registered install on demand, e.g. to drive its status dot.
///
/// `None` means it no longer provides anything at that path — moved,
/// upgraded out from under yaz, or uninstalled — without yaz assuming that on
/// its own and silently dropping it from Settings.
#[tauri::command]
pub fn verify_latex_install(path: String) -> Option<LatexInstallDto> {
    yaz_compile::install::probe(&Utf8PathBuf::from(path)).map(LatexInstallDto::from)
}
