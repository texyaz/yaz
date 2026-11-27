//! The engine abstraction.

use camino::{Utf8Path, Utf8PathBuf};
use yaz_core::project::Project;

/// Where every engine writes its artefacts, relative to the project root.
pub const BUILD_DIR: &str = "build";

/// What an earlier compile left behind for one entry document.
#[derive(Debug, PartialEq, Eq)]
pub struct PreviousOutput {
    /// The PDF, `build/<stem>.pdf` in the project.
    pub pdf: Utf8PathBuf,
    /// The SyncTeX database beside it, when the engine wrote one.
    pub synctex: Option<Utf8PathBuf>,
}

/// The output of an earlier compile of `entry`, if it is still there.
///
/// The same names [`CompileOutput`] carries after a compile, found without
/// compiling: every engine writes `<stem>.pdf` and `<stem>.synctex.gz` into
/// [`BUILD_DIR`]. Nothing is said about whether the PDF is current; that is
/// for the caller to compare against its sources.
#[must_use]
pub fn previous_output(root: &Utf8Path, entry: &Utf8Path) -> Option<PreviousOutput> {
    let stem = entry.file_stem()?;
    let out_dir = root.join(BUILD_DIR);
    let pdf = out_dir.join(format!("{stem}.pdf"));
    if !pdf.is_file() {
        return None;
    }
    let synctex = out_dir.join(format!("{stem}.synctex.gz"));
    Some(PreviousOutput {
        pdf,
        synctex: synctex.is_file().then_some(synctex),
    })
}

/// Outcome of a compilation attempt.
#[derive(Debug)]
pub struct CompileOutput {
    /// The produced PDF, if compilation reached that point.
    pub pdf: Option<Utf8PathBuf>,
    /// The SyncTeX database, for forward and inverse search.
    pub synctex: Option<Utf8PathBuf>,
    /// Structured diagnostics parsed from the engine log.
    pub diagnostics: Vec<crate::diagnostics::Diagnostic>,
    /// Whether a usable PDF was produced. LaTeX frequently emits errors and a
    /// PDF simultaneously, so this is not the inverse of "has errors".
    pub succeeded: bool,
}

/// A LaTeX compilation backend.
///
/// Implementors are responsible only for running the typesetter. Log parsing,
/// diagnostic mapping, and artefact placement are shared and must not be
/// duplicated per engine.
pub trait CompileEngine: Send + Sync {
    /// Stable identifier, e.g. `tectonic` or `system:pdflatex`.
    fn id(&self) -> &str;

    /// Whether this engine is usable on this machine right now.
    ///
    /// A system engine reports `false` when the distribution is absent, which is
    /// what lets the UI say precisely that instead of surfacing a confusing
    /// compile failure.
    fn is_available(&self) -> bool;

    /// Compile the project's entry document.
    fn compile(&self, project: &Project) -> yaz_core::Result<CompileOutput>;
}

// TODO(phase-2): TectonicEngine (embedded), SystemEngine (latexmk-driven),
// engine detection at startup, shell-escape opt-in gate.

#[cfg(test)]
mod tests {
    use super::*;

    fn project() -> (tempfile::TempDir, Utf8PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        std::fs::create_dir_all(root.join(BUILD_DIR)).unwrap();
        (dir, root)
    }

    #[test]
    fn finds_the_pdf_and_the_synctex_file_beside_it() {
        let (_dir, root) = project();
        std::fs::write(root.join("build/main.pdf"), b"%PDF").unwrap();
        std::fs::write(root.join("build/main.synctex.gz"), b"x").unwrap();

        let found = previous_output(&root, Utf8Path::new("main.tex")).unwrap();
        assert_eq!(found.pdf, root.join("build/main.pdf"));
        assert_eq!(found.synctex, Some(root.join("build/main.synctex.gz")));
    }

    #[test]
    fn a_pdf_without_synctex_is_still_found() {
        let (_dir, root) = project();
        std::fs::write(root.join("build/main.pdf"), b"%PDF").unwrap();

        let found = previous_output(&root, Utf8Path::new("main.tex")).unwrap();
        assert_eq!(found.synctex, None);
    }

    #[test]
    fn nothing_is_found_without_a_pdf_for_that_entry() {
        let (_dir, root) = project();
        // Another document's build, and a synctex file with no PDF.
        std::fs::write(root.join("build/other.pdf"), b"%PDF").unwrap();
        std::fs::write(root.join("build/main.synctex.gz"), b"x").unwrap();

        assert_eq!(previous_output(&root, Utf8Path::new("main.tex")), None);
        assert_eq!(previous_output(&root, Utf8Path::new("")), None);
    }

    #[test]
    fn the_entry_may_sit_in_a_folder() {
        let (_dir, root) = project();
        std::fs::write(root.join("build/paper.pdf"), b"%PDF").unwrap();

        assert!(previous_output(&root, Utf8Path::new("src/paper.tex")).is_some());
    }
}
