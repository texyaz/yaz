---
layout: home

hero:
  name: yaz
  text: LaTeX, from the sources you already collected
  tagline: A writing environment that starts where the writing does — your Zotero library and your Obsidian notes — and ends at a manuscript a journal will accept.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Write a plugin
      link: /plugins/writing-a-plugin
    - theme: alt
      text: Why it is built this way
      link: /reference/generated/adr-index

features:
  - title: Write however you think
    details: A source mode with highlighting, completion and diagnostics, and a visual mode that renders the document as rich text. They are the same editor over the same buffer, so Vim works in both, undo is shared, and switching modes cannot change a byte of your file.
  - title: Zotero, without the friction
    details: Live library search and cite-as-you-write through Better BibTeX, falling back through the local API, an exported .bib, and finally a read-only copy of the library. The project .bib stays the compile-time source of truth, so your document still builds on a co-author's machine that has never heard of Zotero.
  - title: Obsidian, without a plugin
    details: A vault is a folder of Markdown, so yaz reads it directly. Wikilinks, embeds, callouts and frontmatter map to LaTeX through a mapping file you can edit, because everyone's vault conventions are different.
  - title: Templates that just work
    details: Tectonic is embedded, so a fresh install compiles with no TeX distribution and no missing-package archaeology. When a template demands pdflatex or lualatex, yaz uses your system TeX instead — the choice is per project and travels with it.
  - title: Extensible, and honest about it
    details: Plugins are TypeScript, and the six that ship with yaz are written against the same public API anybody else would use — there is no privileged tier for the ones we wrote. They declare their capabilities, and every filesystem, network and subprocess call is brokered by the Rust core against what you granted.
  - title: Actually native on ARM
    details: Not an x86_64 build under emulation. Windows and Linux on ARM64 are tier-1 targets, built and tested on native ARM runners, with performance budgets enforced on both architectures.
---

## Status

**Pre-alpha,** but no longer a plan. What works today: open a project, write in
source or preview mode, format from a bar that follows the selection or from the
ribbon, set the text plain, in a centred column or on the declared sheet, follow
the outline and the citations, cite from Zotero by dragging a source or a
highlight in, keep the task list in Todoist, compile, and read the PDF beside the
source with SyncTeX both ways. Six plugins ship with it, each its own repository
and each written against the same public API anybody else would use.

What is not there yet: a new-project wizard, loading a plugin from a directory
while developing it, and the Better BibTeX citation-key tier. There are no
released binaries — building from source is the only way to run it.

The [decision records](/reference/generated/adr-index) describe the whole design,
including the parts not yet written; they are a plan as much as a history.

## Why the decisions are published

A plugin author asking _why is the API shaped like this_ should be able to read
the answer rather than guess. So the reasoning is part of the documentation, not
an internal artefact — including the decisions that turned out to be wrong and
were superseded, and the measurements that contradicted our own estimates.
