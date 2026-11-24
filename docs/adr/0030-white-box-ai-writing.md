# 0030 — AI-written sentences carry their evidence, and only a human proofs them

- **Status:** Proposed
- **Date:** 2026-11-23
- **Supersedes:** none
- **Amends:** [0008 — Zotero integration](0008-zotero-integration) (reads
  annotations by key; still read-only)

## Context

AI now helps write papers: it drafts sentences from sources, or picks the
passage in a source that backs a sentence somebody else wrote. Both are fine
only as a **white box**. A reader of the draft — first the author, later a
co-author or a supervisor — has to be able to see which sentences an AI touched,
jump from such a sentence to the exact passage in the PDF it rests on, and see
whether a human has checked that the passage really says what the sentence
claims.

Three facts shape the answer:

- **The evidence already lives in Zotero.** A separate tool (outside yaz,
  planned as `zotero-quellen`) creates real highlight annotations through the
  Zotero Web API: purple `#a28ae5`, tagged `ai`, `paper/<name>` and
  `ai/direct` or `ai/partial`, with a comment that says why the passage
  supports the claim. Zotero syncs them like any annotation, so yaz's copied
  `zotero.sqlite` has them.
- **Zotero can open a PDF at an annotation.**
  `zotero://open-pdf/library/items/<attachment>?page=<n>&annotation=<key>`
  (groups: `zotero://open-pdf/groups/<id>/items/…`). It needs the attachment
  key and the page, which only the library knows; the annotation key alone is
  not a link.
- **The `.tex` is the only thing every collaborator shares.** A side file that
  maps sentences to highlights goes stale on the first edit and is invisible in
  review. The mark has to be in the sentence.

And one constraint we do not want to soften: **journals must never see any of
it.** The marks are a working state, not part of the paper.

## Decision

### 1. Two macros in the source

```latex
\ai[ANNKEY]{Sentence an AI wrote or found evidence for \cite{key}.}
\proofed[ANNKEY]{Sentence a human has checked against the highlight \cite{key}.}
```

- `ANNKEY` is the Zotero annotation key of the highlight that backs the
  sentence; a comma-separated list when several sources do.
- `\ai` means _written by an AI, not yet checked by a human_. A sentence the
  author wrote stays unmarked, even when an AI later found the passage that
  backs it: the mark is about who wrote the claim, and the author's own text
  needs no proofing step.
- **An AI may write `\ai`, never `\proofed`.** Only the human turns one into the
  other. Git records who did; a `commit-msg` hook in the paper repository
  rejects a commit that adds `\proofed` and carries an AI co-author trailer.
- The macros come from a small package, `aimarks.sty`: in `draft` (the default)
  `\ai` prints in purple and `\proofed` prints normally; with `final` both print
  their text only. Both are robust, so a mark inside a `\caption` works.

### 2. yaz resolves the key and opens Zotero there

The existing "Show citation in Zotero" command (`Mod+Shift+O`) becomes "as
precise as the text allows":

- Cursor inside `\ai[…]{…}` / `\proofed[…]{…}` (anywhere in the sentence or the
  keys) → open the PDF at the highlight. With several keys: the key under the
  cursor, else the highlight whose source is the `\cite` under the cursor, else
  the first key that resolves.
- Elsewhere in a `\cite` → select the item, as before.
- A key the library copy does not have (yet) → say so, and fall back to the
  cited source.

The plugin passes **annotation keys, never a URL** (ADR-0006). `yaz-zotero`
looks the key up in the copy — annotation → attachment key, page from
`position.pageIndex`, library and group id, citation key of the parent item —
validates both keys as eight characters of Zotero's alphabet, and builds the
`zotero://open-pdf` link itself. Public API: `zotero.revealAnnotation(keys,
citationKey?)`.

yaz stays read-only toward Zotero. Creating annotations is the other tool's job.

### 3. Submission strips everything

`scripts/submission.py` in the paper writes `build/submission/`: every
`\proofed[…]{text}` becomes `text`, `\usepackage{aimarks}` is removed, and the
script **refuses while any `\ai` is left**, listing each one with its line.
After stripping it checks that no mark survived. yaz can offer this later as an
export; the script is the reference behaviour.

### 4. Next (not in this change): the "Proofed by human" tab

A generated tab (ADR-0025) listing every `\ai` and `\proofed` in the project:
status, section, source, the highlighted passage and the AI's comment (read
from the annotation), filters for _open_, _partial support_ (tag `ai/partial`)
and _done_. Its one write action turns `\ai[K]{…}` into `\proofed[K]{…}` as an
ordinary editor edit, so it is undoable and shows in the diff like any other.

## Consequences

- From any marked sentence, one keystroke opens the passage it rests on. That
  is the white box: the claim and its evidence are one jump apart.
- What an AI did is visible in the draft PDF (purple) and in the source, and
  "checked by a human" is a fact in git history rather than a promise.
- The `.tex` gets noisier: a sentence is wrapped in a macro with an opaque key.
  We accept that for the working draft; the submission copy has none of it.
- The jump needs the annotation in yaz's library copy. A highlight created a
  minute ago is not there until the copy is refreshed, and the message says so.
- A sentence that spans an environment boundary (a figure, a table row) cannot
  be wrapped whole; the mark goes on the caption text or the table cell.
- The `commit-msg` hook is local (hooks are not cloned); each collaborator has
  to enable it once (`git config core.hooksPath scripts/hooks`). It catches the
  honest mistake, not a determined one.

## Alternatives considered

- **A side file mapping sentences to annotations** (the first prototype:
  `source-check/annotations.json` + a Markdown checklist). Lost because it goes
  stale on the first edit to the sentence, and because nothing in the `.tex`
  tells a co-author that a sentence was AI-assisted.
- **The key in `\cite`'s optional argument** (`\cite[ANNKEY]{key}`). That
  argument already means "page" or "postnote" and is printed; overloading it
  would put annotation keys into the journal PDF.
- **LaTeX comments** (`% ai: ANNKEY` after the sentence). Invisible in the PDF,
  so the draft would not show what is unchecked, and a comment is not tied to
  the sentence it follows once the paragraph is re-flowed.
- **yaz writes the annotations itself.** Would make yaz a writer of the Zotero
  database, which ADR-0008 and the plugin roadmap rule out.
- **Colour only, no `\proofed`.** Deleting the `\ai` wrapper after checking
  would lose the link to the evidence exactly when it has been confirmed; a
  reviewer could no longer jump to it.

## Open questions

For Markus:

1. Should `\proofed` stay invisible in draft PDFs, or get a subtle mark (e.g. a
   thin margin line) so checked and unmarked human text differ?
2. ~~Should `\ai` also mark human-written sentences whose evidence an AI
   chose?~~ Decided 2026-11-23: no. Only AI-written sentences are marked.

For the colleague (yaz maintainer):

3. Is extending "Show citation in Zotero" the right home, or should the jump be
   its own command next to it?
4. Should `aimarks.sty` ship with yaz (e.g. via the latex-packages plugin, which
   would also teach the preview to render `\ai` / `\proofed`), or stay in each
   paper?
5. The tab in §4: core generated tab, or part of the zotero plugin?
