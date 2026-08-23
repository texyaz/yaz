# Getting started

::: warning Pre-alpha
yaz is not yet usable for real work. There are no released binaries; the only
way to run it today is to build from source.
:::

## Build and run

Requires **Rust 1.85+**, **Node 22+** and **pnpm 9+**.

```bash
git clone https://github.com/GeneralPawz/yaz.git
cd yaz
pnpm install
pnpm dev
```

`pnpm app:build` produces a release binary and an installer.

::: danger Do not use `cargo build --release`
It produces a binary whose window shows the webview's _"cannot reach this page"_
error, and nothing in that message suggests a build problem.

`tauri-build` distinguishes development from production using environment the
Tauri CLI sets. Run bare, it defaults to development: the dev server URL is
compiled in and the frontend is never embedded, so the binary looks for a Vite
server that is not running. The build script warns about it, but cargo warnings
are easy to miss.

Plain `cargo` is fine for the other crates — it is only `yaz-app` that needs
the CLI.
:::

Both commands run from the repository root, not from `apps/desktop`. The Tauri
configuration lives at `crates/yaz-app/tauri.conf.json`, and the CLI finds it by
searching downward from the working directory.

Platform prerequisites — including the two ARM64 Windows toolchain traps whose
error messages never mention ARM64 — are in
[development setup](/contributing/setup).

## Your first document

1. Click the blue **y** in the corner and choose **Open folder**. Pick a
   directory containing a `.tex` file.
2. Pick a file from the list. `main.tex` is preferred as the entry document, or
   the first `.tex` found.
3. Edit. `Mod+S` saves; the Vim toggle switches keybindings without losing your
   undo history or cursor. Select some text and a formatting bar appears under
   it.
4. **Compile**, from the Work tab of the ribbon. The PDF appears beside your
   source, and clicking in it takes you to the line that produced it.

A compile can produce both errors _and_ a usable PDF — that is normal LaTeX
behaviour, so success is reported from whether a document actually appeared, not
from the compiler's exit status.

[Writing in yaz](/guide/writing) covers the rest: the preview, the three ways of
setting the text, the tabs, the command palette, and how citations and tasks
reach the document.

## What is there

Source and preview modes over one buffer; plain, continuous and page views;
the outline, citations, glossary, tasks, details, history and PDF tabs; the
command palette; version control; themes; German and English; and the six
[bundled plugins](/reference/generated/plugins/) — Zotero, Obsidian, Todoist,
text formats, LaTeX packages and Learn.

## What is not there yet

A new-project wizard, loading a plugin from a directory while developing it, and
the Better BibTeX citation-key tier. Released binaries do not exist; building
from source is the only way to run it.
