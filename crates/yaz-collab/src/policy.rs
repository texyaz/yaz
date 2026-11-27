//! Which files of a project are shared.
//!
//! The one place that says so. Everything the host writes into a folder, and
//! every entry it admits into the shared document, goes through
//! [`shared_path`], so a path that came from another machine is checked here
//! and nowhere else needs to remember to.

/// The largest file that is shared, in bytes. A bigger one stays on disk and
/// is reported as refused.
pub const MAX_SHARED_BYTES: u64 = 1024 * 1024;

/// The extensions of the text files of a LaTeX project that are shared.
///
/// By extension, not by sniffing: a `.pdf` or a picture is not text, and a
/// file whose name says nothing about its content is not for yaz to decide on.
const EXTENSIONS: [&str; 12] = [
    "tex", "bib", "cls", "sty", "clo", "def", "bst", "bbx", "cbx", "tikz", "md", "txt",
];

/// What a copy kept beside a file is called, so that it is never itself shared.
pub(crate) const KEPT_MARK: &str = ".kept-";

/// A project-relative path the policy admits, with `/` separators.
///
/// Only [`shared_path`] makes one, so holding one is the proof that the path
/// is inside the project, not under `build/` or a dot-folder, and a text file
/// by name.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SharedPath(String);

impl SharedPath {
    /// The path as it is a key of the shared document.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl SharedPath {
    /// A path the host itself names beside a shared one, for a copy that is
    /// written and never shared. The caller derived it from a shared path, and
    /// the write resolves it against the root like any other.
    pub(crate) fn kept_copy(path: String) -> Self {
        Self(path)
    }
}

impl std::fmt::Display for SharedPath {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// The path, if the policy shares it; `None` otherwise.
///
/// Refused: anything absolute, with a `..`, `.` or empty component, a
/// backslash or a colon (a Windows path is not a key), a component that starts
/// with a dot (`.git`, `.hidden`), anything under `build/`, `yaz.toml`, a file
/// whose extension is not in the allow-list, and a copy that yaz itself kept
/// beside a file.
pub fn shared_path(relative: &str) -> Option<SharedPath> {
    if relative.is_empty() || relative.contains(['\\', ':', '\0']) {
        return None;
    }
    let components: Vec<&str> = relative.split('/').collect();
    if components
        .iter()
        .any(|part| part.is_empty() || part.starts_with('.'))
    {
        return None;
    }
    if components[0] == "build" || relative == "yaz.toml" {
        return None;
    }
    let name = components[components.len() - 1];
    if name.contains(KEPT_MARK) {
        return None;
    }
    let extension = name.rsplit_once('.')?.1.to_ascii_lowercase();
    EXTENSIONS
        .contains(&extension.as_str())
        .then(|| SharedPath(relative.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_text_files_of_a_project_are_shared() {
        for path in [
            "main.tex",
            "chapters/one.tex",
            "refs.bib",
            "thesis.cls",
            "a/b/c/style.sty",
            "notes.md",
            "README.txt",
            "Figure.TIKZ",
        ] {
            assert_eq!(
                shared_path(path).as_ref().map(SharedPath::as_str),
                Some(path)
            );
        }
    }

    #[test]
    fn a_path_that_leaves_the_folder_or_hides_in_it_is_not() {
        for path in [
            "",
            "../x.tex",
            "a/../../x.tex",
            "a/../b.tex",
            "./x.tex",
            "/etc/x.tex",
            "a//b.tex",
            "a/",
            "build/x.tex",
            "build/sub/x.tex",
            ".git/x.tex",
            "a/.hidden/x.tex",
            ".x.tex",
            "yaz.toml",
            "C:/x.tex",
            "a\\b.tex",
            "x\0.tex",
        ] {
            assert_eq!(shared_path(path), None, "{path:?}");
        }
    }

    #[test]
    fn what_is_not_text_or_not_a_latex_file_is_not() {
        for path in ["figure.png", "main.pdf", "Makefile", "x.toml", "x.", "a/b"] {
            assert_eq!(shared_path(path), None, "{path:?}");
        }
    }

    #[test]
    fn a_folder_called_build_inside_the_project_is_only_refused_at_the_top() {
        assert!(shared_path("chapters/build/x.tex").is_some());
    }

    #[test]
    fn a_kept_copy_is_never_shared_again() {
        assert_eq!(shared_path("main.kept-20261127-101500.tex"), None);
    }
}
