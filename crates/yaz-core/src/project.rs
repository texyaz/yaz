//! What a project is: a root directory, an entry document, and build settings.

use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex, PoisonError};

use camino::{Utf8Path, Utf8PathBuf};
use serde::{Deserialize, Serialize};

use crate::error::Error as CoreError;

/// A yaz project — a directory on disk plus the metadata in `yaz.toml`.
///
/// A project is deliberately thin. It does not own the documents inside it; it
/// describes where they are and how they are built. Nothing about a project
/// requires yaz to have created it, so an existing LaTeX directory can simply be
/// opened.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    /// Absolute path to the project root. All project-relative paths resolve
    /// against this, and the `fs:project` capability is bounded by it.
    pub root: Utf8PathBuf,

    /// The document passed to the compiler, relative to [`Project::root`].
    pub entry: Utf8PathBuf,

    /// Which compilation engine to use for this project.
    ///
    /// Persisted per project because journal templates frequently require a
    /// specific engine. See
    /// [ADR-0007](https://github.com/GeneralPawz/yaz/blob/main/docs/adr/0007-latex-compilation-engines.md).
    #[serde(default)]
    pub engine: EngineChoice,

    /// The language the document is written in — distinct from the interface
    /// locale. Drives spellcheck, `babel`/`polyglossia`, and quotation marks.
    #[serde(default)]
    pub document_locale: Option<String>,

    /// Where pictures brought into the document are kept, relative to the root.
    ///
    /// Per project because a template dictates it: some want `images/`, some
    /// `figures/`, and a thesis whose supervisor supplied the skeleton does not
    /// get to choose. Defaulting rather than asking, because a directory a
    /// paste has to stop and ask about is a paste nobody uses.
    #[serde(default = "default_images")]
    pub images: Utf8PathBuf,
}

/// Where pictures go when the project has not said otherwise.
///
/// `images` rather than `figures` or `img`: it is what the LaTeX templates this
/// was built against use, and a directory that already exists is one nobody has
/// to think about.
pub fn default_images() -> Utf8PathBuf {
    Utf8PathBuf::from("images")
}

/// Canonicalise, keeping the result UTF-8 and free of Windows `\\?\` prefixes.
pub fn canonical_root(path: &Utf8Path) -> crate::Result<Utf8PathBuf> {
    let canonical = std::fs::canonicalize(path).map_err(|source| {
        if source.kind() == std::io::ErrorKind::NotFound {
            CoreError::NotFound {
                path: path.to_owned(),
            }
        } else {
            CoreError::Io {
                path: path.to_owned(),
                source,
            }
        }
    })?;
    // Windows canonicalisation yields a `\\?\C:\…` extended-length path, which
    // compares badly against ordinary paths and looks alarming in the UI.
    let text = canonical.to_string_lossy();
    let trimmed = text.strip_prefix(r"\\?\").unwrap_or(&text);
    Ok(Utf8PathBuf::from(trimmed))
}

/// Resolve a project-relative path and refuse anything outside the root.
///
/// Canonicalisation happens *before* the comparison, so `..` traversal and
/// symlink escapes are refused rather than followed. This is the invariant the
/// capability broker will inherit, and it is why the check cannot be a simple
/// `starts_with` on the untouched input.
pub fn resolve_in_root(root: &Utf8Path, relative: &str) -> crate::Result<Utf8PathBuf> {
    let root_canonical = canonical_root(root)?;
    let joined = root.join(relative);

    // A file being written may not exist yet, so canonicalise the parent and
    // re-attach the final component.
    let candidate = if joined.exists() {
        canonical_root(&joined)?
    } else {
        let outside = || CoreError::OutsideRoot {
            path: joined.clone(),
            root: root_canonical.clone(),
        };
        let parent = joined.parent().ok_or_else(outside)?;
        let file_name = joined.file_name().ok_or_else(outside)?;
        canonical_root(parent)?.join(file_name)
    };

    if !candidate.starts_with(&root_canonical) {
        return Err(CoreError::OutsideRoot {
            path: candidate,
            root: root_canonical,
        });
    }

    Ok(candidate)
}

/// One lock per project folder, shared by everything that reads the whole
/// folder or writes it in bulk: a compile, a recorded version, a restore.
///
/// Two compiles of one root otherwise run into the same `build/` at once, and a
/// commit taken while a compile is writing records half a build. The lock is
/// per *canonical* root, so two spellings of one folder share it, and a clone
/// shares the same locks.
#[derive(Debug, Clone, Default)]
pub struct FolderLocks {
    held: Arc<Mutex<HashMap<Utf8PathBuf, Arc<Held>>>>,
}

/// Whether a folder is taken, and the way to wait for it to be let go.
#[derive(Debug, Default)]
struct Held {
    taken: Mutex<bool>,
    released: Condvar,
}

impl FolderLocks {
    /// Wait for the folder's lock and take it.
    ///
    /// Blocks the calling thread, which is what the synchronous commands
    /// already do for the compile itself. The folder must exist: the key is
    /// its canonical path.
    pub fn lock(&self, root: &Utf8Path) -> crate::Result<FolderGuard> {
        let key = canonical_root(root)?;
        let held = {
            let mut map = self.held.lock().unwrap_or_else(PoisonError::into_inner);
            Arc::clone(map.entry(key).or_default())
        };
        let mut taken = held.taken.lock().unwrap_or_else(PoisonError::into_inner);
        while *taken {
            taken = held
                .released
                .wait(taken)
                .unwrap_or_else(PoisonError::into_inner);
        }
        *taken = true;
        drop(taken);
        Ok(FolderGuard { held })
    }
}

/// The lock on one folder, released when it is dropped.
#[derive(Debug)]
#[must_use = "the folder is unlocked as soon as the guard is dropped"]
pub struct FolderGuard {
    held: Arc<Held>,
}

impl Drop for FolderGuard {
    fn drop(&mut self) {
        *self
            .held
            .taken
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = false;
        self.held.released.notify_one();
    }
}

/// Which LaTeX engine a project compiles with.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[non_exhaustive]
pub enum EngineChoice {
    /// Embedded Tectonic. The default: native on every architecture we ship and
    /// requires no system TeX installation.
    #[default]
    Tectonic,
    /// A detected system distribution, driven through `latexmk` where available.
    System {
        /// The engine binary to invoke, e.g. `pdflatex` or `lualatex`.
        engine: String,
    },
    /// Typst — a different document language, not another LaTeX engine.
    ///
    /// Unlike the other two this does not compile `.tex` at all: a Typst project
    /// is written in `.typ`. Selecting it for an existing LaTeX project is
    /// therefore not a preference but a category error, and the caller is
    /// expected to refuse rather than try.
    Typst,
}

impl EngineChoice {
    /// Stable identifier: `tectonic`, or `system:<binary>`.
    ///
    /// A flat string rather than a nested table because `yaz.toml` is meant to
    /// be edited by hand, and `engine = "system:xelatex"` reads better than the
    /// two-line table a tagged enum would produce.
    pub fn to_id(&self) -> String {
        match self {
            EngineChoice::Tectonic => "tectonic".to_owned(),
            EngineChoice::Typst => "typst".to_owned(),
            EngineChoice::System { engine } => format!("system:{engine}"),
        }
    }

    /// The source language this engine compiles.
    ///
    /// Not cosmetic: a `.tex` project cannot be built by Typst, and offering the
    /// choice as though it were interchangeable would produce a baffling
    /// syntax error rather than a useful refusal.
    pub fn language(&self) -> DocumentLanguage {
        match self {
            EngineChoice::Tectonic | EngineChoice::System { .. } => DocumentLanguage::Latex,
            EngineChoice::Typst => DocumentLanguage::Typst,
        }
    }

    /// Parse an identifier produced by [`EngineChoice::to_id`].
    ///
    /// Returns `None` for anything unrecognised rather than guessing — a typo in
    /// a hand-edited `yaz.toml` should surface as "that engine is not
    /// available", not silently compile with something else.
    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "tectonic" => Some(EngineChoice::Tectonic),
            "typst" => Some(EngineChoice::Typst),
            other => other
                .strip_prefix("system:")
                .filter(|binary| !binary.is_empty())
                .map(|binary| EngineChoice::System {
                    engine: binary.to_owned(),
                }),
        }
    }
}

impl Serialize for EngineChoice {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_id())
    }
}

impl<'de> Deserialize<'de> for EngineChoice {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let id = String::deserialize(deserializer)?;
        EngineChoice::from_id(&id)
            .ok_or_else(|| serde::de::Error::custom(format!("unknown engine {id:?}")))
    }
}

/// The source language a project is written in.
///
/// yaz supports two, and they are not interchangeable — this is the difference
/// between "which engine typesets my LaTeX" and "which language am I writing".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DocumentLanguage {
    /// LaTeX. `.tex`, plus `.bib`, `.cls` and `.sty`.
    Latex,
    /// Typst. `.typ`.
    Typst,
}

impl DocumentLanguage {
    /// File extensions belonging to this language's projects.
    pub fn extensions(&self) -> &'static [&'static str] {
        match self {
            DocumentLanguage::Latex => &["tex", "bib", "cls", "sty"],
            DocumentLanguage::Typst => &["typ", "bib"],
        }
    }

    /// The extension of a document this language can be asked to compile.
    pub fn entry_extension(&self) -> &'static str {
        match self {
            DocumentLanguage::Latex => "tex",
            DocumentLanguage::Typst => "typ",
        }
    }
}

/// The per-project settings file, `yaz.toml`.
///
/// Deliberately small and hand-editable. Absent means "use the defaults", not
/// "this is not a project" — an existing LaTeX directory opens without yaz
/// having to write anything into it first.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProjectSettings {
    /// The document passed to the compiler, relative to the project root.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry: Option<Utf8PathBuf>,

    /// Which engine to compile with.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engine: Option<EngineChoice>,

    /// The language the document is written in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_locale: Option<String>,

    /// Where pictures brought into the document are kept.
    ///
    /// Absent means the default, so a project that never changed it keeps a
    /// `yaz.toml` that says nothing about pictures — which is the point of
    /// every optional field here.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub images: Option<Utf8PathBuf>,

    /// Which version-control backend records this project, if any.
    ///
    /// Absent means yaz is not recording versions. It deliberately does **not**
    /// mean there is no history: switching version control off leaves the
    /// repository and everything in it alone, so switching it back on finds the
    /// history where it was left.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_control: Option<String>,

    /// The pane arrangement, as the frontend serialises it.
    ///
    /// Stored opaquely on purpose. The layout tree is a interface concern —
    /// which views are open, in what splits, at what sizes — and giving the
    /// domain layer a parallel definition of it would mean two schemas to keep
    /// in step for no gain here. This crate's interest is only that it round
    /// trips.
    ///
    /// Per project rather than global: a thesis and a conference paper want
    /// different arrangements, and the engine choice already lives here.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,

    /// What each plugin has stored *about this project*, keyed by plugin id.
    ///
    /// The other half of the per-install store in
    /// [`crate::settings::Settings::plugins`]. Which Todoist project a paper is
    /// linked to belongs to the paper, not to the machine — a thesis and a
    /// conference paper are different work with different task lists, and the
    /// link should travel with the project rather than be re-made on every
    /// machine the author opens it on.
    ///
    /// Opaque here, like the workspace above: this crate's interest is only
    /// that it round trips.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub plugins: std::collections::BTreeMap<String, toml::Value>,
}

impl ProjectSettings {
    /// The settings file name, at the project root.
    pub const FILE_NAME: &'static str = "yaz.toml";

    /// Load settings for a project root, or defaults when the file is absent.
    ///
    /// A malformed file is an error rather than a silent fallback to defaults:
    /// quietly ignoring a typo would compile the wrong thing and give the author
    /// no clue why their engine choice stopped taking effect.
    pub fn load(root: &camino::Utf8Path) -> crate::Result<Self> {
        let path = root.join(Self::FILE_NAME);
        if !path.exists() {
            return Ok(Self::default());
        }
        let text = std::fs::read_to_string(&path).map_err(|source| crate::Error::Io {
            path: path.clone(),
            source,
        })?;
        toml::from_str(&text).map_err(|error| crate::Error::Io {
            path: path.clone(),
            source: std::io::Error::new(std::io::ErrorKind::InvalidData, error.to_string()),
        })
    }

    /// Write the settings back to the project root.
    pub fn save(&self, root: &camino::Utf8Path) -> crate::Result<()> {
        let path = root.join(Self::FILE_NAME);
        let text = toml::to_string_pretty(self).map_err(|error| crate::Error::Io {
            path: path.clone(),
            source: std::io::Error::new(std::io::ErrorKind::InvalidData, error.to_string()),
        })?;
        std::fs::write(&path, text).map_err(|source| crate::Error::Io { path, source })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_ids_round_trip() {
        for choice in [
            EngineChoice::Tectonic,
            EngineChoice::System {
                engine: "xelatex".to_owned(),
            },
        ] {
            let id = choice.to_id();
            assert_eq!(EngineChoice::from_id(&id), Some(choice));
        }
    }

    #[test]
    fn unknown_engine_ids_are_rejected_not_guessed() {
        assert_eq!(EngineChoice::from_id("teqtonic"), None);
        assert_eq!(EngineChoice::from_id("system:"), None);
        assert_eq!(EngineChoice::from_id(""), None);
    }

    #[test]
    fn settings_round_trip_through_toml() {
        let settings = ProjectSettings {
            entry: Some(Utf8PathBuf::from("paper.tex")),
            engine: Some(EngineChoice::System {
                engine: "lualatex".to_owned(),
            }),
            document_locale: Some("de-DE".to_owned()),
            images: Some(Utf8PathBuf::from("figures")),
            version_control: Some("git".to_owned()),
            workspace: Some(r#"{"kind":"leaf","tabs":["editor"]}"#.to_owned()),
            // What a plugin stores about this project — the Todoist project a
            // paper is linked to, say. Empty here because the round trip is
            // what is being checked, and it is checked on its own below.
            plugins: std::collections::BTreeMap::new(),
        };
        let text = toml::to_string_pretty(&settings).expect("serialises");
        // The flat form is what makes the file pleasant to hand-edit.
        assert!(text.contains(r#"engine = "system:lualatex""#), "{text}");
        let parsed: ProjectSettings = toml::from_str(&text).expect("parses");
        assert_eq!(parsed.engine, settings.engine);
        assert_eq!(parsed.entry, settings.entry);
        // Opaque to this layer, so the only requirement is that it survives.
        assert_eq!(parsed.workspace, settings.workspace);
    }

    #[test]
    fn a_project_without_a_stored_layout_still_loads() {
        // Every project that predates the workspace has no `workspace` key, and
        // must open rather than fail to parse.
        let text = "entry = \"main.tex\"\nengine = \"tectonic\"\n";
        let parsed: ProjectSettings = toml::from_str(text).expect("parses");
        assert_eq!(parsed.workspace, None);
    }

    #[test]
    fn absent_file_yields_defaults() {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = camino::Utf8Path::from_path(dir.path()).expect("utf8 path");
        let settings = ProjectSettings::load(root).expect("loads");
        assert!(settings.engine.is_none());
        assert!(settings.entry.is_none());
    }

    #[test]
    fn malformed_file_is_an_error_not_a_silent_default() {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = camino::Utf8Path::from_path(dir.path()).expect("utf8 path");
        std::fs::write(root.join(ProjectSettings::FILE_NAME), "engine = \"nope\"\n")
            .expect("write");
        assert!(ProjectSettings::load(root).is_err());
    }

    #[test]
    fn a_path_inside_the_root_resolves_even_before_the_file_exists() {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = Utf8Path::from_path(dir.path()).expect("utf8 path");
        let resolved = resolve_in_root(root, "new.tex").expect("resolves");
        assert_eq!(resolved, canonical_root(root).unwrap().join("new.tex"));
    }

    #[test]
    fn traversal_out_of_the_root_is_refused() {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = Utf8Path::from_path(dir.path()).expect("utf8 path");
        std::fs::create_dir(root.join("project")).unwrap();
        std::fs::create_dir(root.join("project/a")).unwrap();
        let project = root.join("project");
        for attempt in ["../escape", "..", "a/../../escape"] {
            let error = resolve_in_root(&project, attempt).unwrap_err();
            assert_eq!(error.message_key(), "error-fs-outside-root", "{attempt}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_root_is_refused_not_followed() {
        let dir = tempfile::tempdir().expect("temp dir");
        let base = Utf8Path::from_path(dir.path()).expect("utf8 path");
        std::fs::create_dir(base.join("project")).unwrap();
        std::fs::create_dir(base.join("elsewhere")).unwrap();
        std::fs::write(base.join("elsewhere/secret.tex"), "x").unwrap();
        std::os::unix::fs::symlink(base.join("elsewhere"), base.join("project/link")).unwrap();
        let error = resolve_in_root(&base.join("project"), "link/secret.tex").unwrap_err();
        assert_eq!(error.message_key(), "error-fs-outside-root");
    }

    #[test]
    fn a_missing_folder_is_not_found() {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = Utf8Path::from_path(dir.path()).expect("utf8 path");
        let error = canonical_root(&root.join("nothing")).unwrap_err();
        assert_eq!(error.message_key(), "error-fs-not-found");
    }

    #[test]
    fn two_threads_never_hold_one_folder_at_once() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let dir = tempfile::tempdir().expect("temp dir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8 path");
        let locks = FolderLocks::default();
        let inside = Arc::new(AtomicUsize::new(0));
        let overlapped = Arc::new(AtomicUsize::new(0));
        let entries = Arc::new(AtomicUsize::new(0));

        let workers: Vec<_> = (0..4)
            .map(|index| {
                let (locks, inside, overlapped, entries) = (
                    locks.clone(),
                    inside.clone(),
                    overlapped.clone(),
                    entries.clone(),
                );
                // Half of them reach the folder by a different spelling.
                let root = if index % 2 == 0 {
                    root.clone()
                } else {
                    root.join(".")
                };
                std::thread::spawn(move || {
                    for _ in 0..5 {
                        let _guard = locks.lock(&root).expect("lock");
                        if inside.fetch_add(1, Ordering::SeqCst) != 0 {
                            overlapped.fetch_add(1, Ordering::SeqCst);
                        }
                        entries.fetch_add(1, Ordering::SeqCst);
                        std::thread::sleep(std::time::Duration::from_millis(2));
                        inside.fetch_sub(1, Ordering::SeqCst);
                    }
                })
            })
            .collect();
        for worker in workers {
            worker.join().expect("worker");
        }
        assert_eq!(overlapped.load(Ordering::SeqCst), 0, "two held the folder");
        assert_eq!(entries.load(Ordering::SeqCst), 20);
    }

    #[test]
    fn different_folders_do_not_wait_for_each_other() {
        let first = tempfile::tempdir().expect("temp dir");
        let second = tempfile::tempdir().expect("temp dir");
        let locks = FolderLocks::default();
        let _one = locks
            .lock(Utf8Path::from_path(first.path()).unwrap())
            .unwrap();
        // Would block forever if the two folders shared a lock.
        let _two = locks
            .lock(Utf8Path::from_path(second.path()).unwrap())
            .unwrap();
    }

    #[test]
    fn a_guard_dropped_during_a_panic_still_releases_the_folder() {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8 path");
        let locks = FolderLocks::default();
        let again = locks.clone();
        let there = root.clone();
        let result = std::thread::spawn(move || {
            let _guard = again.lock(&there).expect("lock");
            panic!("a compile that panics");
        })
        .join();
        assert!(result.is_err());
        let _guard = locks.lock(&root).expect("the folder is free again");
    }
}
