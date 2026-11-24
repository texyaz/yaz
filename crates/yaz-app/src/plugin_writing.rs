//! What a plugin may keep about writing, and how it records a version.
//!
//! Two small pieces of public API (ADR-0032), both drawn on the same boundary
//! as everything else a plugin can do (ADR-0006):
//!
//! - **A journal** per plugin: lines of JSON appended over time and kept with
//!   the user's configuration, not with any one project. Settings are one value
//!   replaced whole; a journal grows, and what it remembers is meant to carry
//!   from one paper to the next. Namespaced by the plugin's identity, like its
//!   settings, so a plugin reads its own and cannot name another's.
//! - **A version of named files**, under the `vcs` capability: only files
//!   inside the open project, only into a repository it already has, and only
//!   those files — other work in progress stays out of a version whose message
//!   does not describe it.

use std::io::{BufRead, Write};

use camino::{Utf8Path, Utf8PathBuf};

use yaz_plugin::Request;
use yaz_vcs::{BackendKind, Commit};

use crate::commands::CommandError;
use crate::plugin_host::PluginHost;

type Result<T> = std::result::Result<T, CommandError>;

/// Longest single journal entry, serialised. A sentence pair with its context
/// is a few kilobytes; anything near this is not what a journal is for.
const MAX_ENTRY: usize = 64 * 1024;

/// Most entries one read returns.
const MAX_READ: usize = 2000;

/// Most files one version may name.
const MAX_FILES: usize = 16;

/// Longest version message.
const MAX_MESSAGE: usize = 4000;

/// Where a plugin's journal lives, or `None` when there is no configuration
/// directory or the id is not one a manifest could have declared.
fn journal_path(plugin_id: &str) -> Option<Utf8PathBuf> {
    let well_formed = !plugin_id.is_empty()
        && plugin_id.len() <= 128
        && plugin_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        && !plugin_id.starts_with('.');
    if !well_formed {
        return None;
    }
    Some(
        yaz_core::settings::config_dir()?
            .join("journals")
            .join(format!("{plugin_id}.jsonl")),
    )
}

fn io_error(error: std::io::Error) -> CommandError {
    CommandError::new("error-fs-io", error)
}

/// Add one entry to the end of a plugin's journal.
pub fn append(path: &Utf8Path, entry: &serde_json::Value) -> Result<()> {
    let line = serde_json::to_string(entry)
        .map_err(|error| CommandError::new("error-journal-entry", error))?;
    if line.len() > MAX_ENTRY {
        return Err(CommandError::new(
            "error-journal-entry",
            format!("entry is {} bytes; at most {MAX_ENTRY}", line.len()),
        ));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(io_error)?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(io_error)?;
    // One write per line, so a crash mid-way leaves at worst one torn last
    // line, which `read` skips.
    file.write_all(format!("{line}\n").as_bytes())
        .map_err(io_error)
}

/// The last `limit` entries, oldest first. Lines that do not parse are skipped.
pub fn read(path: &Utf8Path, limit: usize) -> Result<Vec<serde_json::Value>> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(io_error(error)),
    };
    let limit = limit.clamp(1, MAX_READ);
    let mut kept = std::collections::VecDeque::with_capacity(limit);
    for line in std::io::BufReader::new(file).lines() {
        let line = line.map_err(io_error)?;
        let Ok(entry) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if kept.len() == limit {
            kept.pop_front();
        }
        kept.push_back(entry);
    }
    Ok(kept.into())
}

/// Append to the calling plugin's journal.
#[tauri::command]
pub fn plugin_journal_append(plugin_id: String, entry: serde_json::Value) -> Result<()> {
    let path = journal_path(&plugin_id)
        .ok_or_else(|| CommandError::new("error-fs-not-found", "no place for a journal"))?;
    append(&path, &entry)
}

/// Read the calling plugin's journal: its last `limit` entries, oldest first.
#[tauri::command]
pub fn plugin_journal_read(
    plugin_id: String,
    limit: Option<usize>,
) -> Result<Vec<serde_json::Value>> {
    let path = journal_path(&plugin_id)
        .ok_or_else(|| CommandError::new("error-fs-not-found", "no place for a journal"))?;
    read(&path, limit.unwrap_or(200))
}

/// A project-relative path that stays inside the project, or `None`.
fn inside(path: &str) -> Option<&Utf8Path> {
    let path = Utf8Path::new(path);
    let plain = !path.as_str().is_empty()
        && path.is_relative()
        && path
            .components()
            .all(|part| matches!(part, camino::Utf8Component::Normal(_)));
    plain.then_some(path)
}

/// Record a version of the named files, in the user's name.
///
/// Refused without the `vcs` capability, for paths outside the project, and in
/// a project that has no repository: creating one is the author's decision,
/// made under Version history, not a plugin's.
#[tauri::command]
pub async fn plugin_vcs_commit(
    plugin_id: String,
    message: String,
    paths: Vec<String>,
    host: tauri::State<'_, PluginHost>,
) -> Result<Option<Commit>> {
    host.authorise(&plugin_id, &Request::Vcs).await?;
    let root = host
        .project_root()
        .await
        .ok_or_else(|| CommandError::new("error-no-project", "no project is open"))?;

    let message = message.trim();
    if message.is_empty() || message.len() > MAX_MESSAGE {
        return Err(CommandError::new(
            "vcs-error-message",
            format!("a version message of 1 to {MAX_MESSAGE} characters"),
        ));
    }
    if paths.is_empty() || paths.len() > MAX_FILES {
        return Err(CommandError::new(
            "vcs-error-paths",
            format!("name 1 to {MAX_FILES} files"),
        ));
    }
    let mut relative = Vec::with_capacity(paths.len());
    for given in &paths {
        let path =
            inside(given).ok_or_else(|| CommandError::new("vcs-error-paths", given.clone()))?;
        // The same check every project write makes, so the `fs-project`
        // boundary applies here too.
        host.authorise(&plugin_id, &Request::FsWrite(&root.join(path)))
            .await?;
        relative.push(path);
    }

    let settings = yaz_core::project::ProjectSettings::load(&root)?;
    let kind = settings
        .version_control
        .as_deref()
        .and_then(BackendKind::from_id)
        .unwrap_or_default();
    let message = message.to_owned();
    let owned: Vec<Utf8PathBuf> = relative.iter().map(|path| path.to_path_buf()).collect();
    tokio::task::spawn_blocking(move || {
        let borrowed: Vec<&Utf8Path> = owned.iter().map(Utf8PathBuf::as_path).collect();
        yaz_vcs::backend(kind)
            .commit_files(&root, &message, &borrowed)
            .map_err(|error| CommandError::new(error.message_key(), error))
    })
    .await
    .map_err(|error| CommandError::new("vcs-error-tool", error))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_journal_keeps_the_last_entries_in_order() {
        let dir = tempfile::tempdir().unwrap();
        let path = Utf8PathBuf::from_path_buf(dir.path().join("j.jsonl")).unwrap();
        assert!(read(&path, 10).unwrap().is_empty());
        for n in 0..5 {
            append(&path, &serde_json::json!({ "n": n })).unwrap();
        }
        // A torn last line, as a crash mid-write would leave, is skipped.
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(b"{\"n\":")
            .unwrap();
        let last: Vec<i64> = read(&path, 3)
            .unwrap()
            .iter()
            .map(|entry| entry["n"].as_i64().unwrap())
            .collect();
        assert_eq!(last, vec![2, 3, 4]);
    }

    #[test]
    fn an_oversized_entry_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = Utf8PathBuf::from_path_buf(dir.path().join("j.jsonl")).unwrap();
        let huge = "x".repeat(MAX_ENTRY + 1);
        assert!(append(&path, &serde_json::json!({ "text": huge })).is_err());
    }

    #[test]
    fn a_plugin_id_cannot_name_a_path() {
        assert!(journal_path("../settings").is_none());
        assert!(journal_path("com/yaz").is_none());
        assert!(journal_path(".hidden").is_none());
        assert!(journal_path("").is_none());
    }

    #[test]
    fn only_plain_relative_paths_are_inside() {
        assert!(inside("main.tex").is_some());
        assert!(inside("chapters/intro.tex").is_some());
        assert!(inside("../other/main.tex").is_none());
        assert!(inside("/etc/passwd").is_none());
        assert!(inside("chapters/../../x").is_none());
        assert!(inside("").is_none());
    }
}
