# Writing in yaz

This is what the application looks like once a project is open, and why each
part is where it is.

## One buffer, two ways of seeing it

There is a single CodeMirror document holding the raw `.tex`. Preview mode is
not a second model of the document — it is decorations drawn over those same
bytes ([ADR-0004](/adr/0004-editor-core-codemirror-single-buffer)). That is why Vim works in both, why
undo is shared, and why switching modes cannot change a byte of the file.

When the caret enters a construct, its source comes back. A `\textbf{word}`
reads as **word** until you click into it, and then it reads as
`\textbf{word}` again, because that is what you are editing.

::: tip It knows LaTeX, not your packages
The preview understands the kernel and the standard classes and nothing else
([ADR-0023](/adr/0023-latex-vocabulary-boundary)). What `\usepackage{glossaries}`
adds is understood by the
[LaTeX packages plugin](/reference/generated/plugins/latex-packages), which
ships with yaz — the test for what belongs where is
"does `\documentclass{article}` alone define it", never "does a real thesis use
it".
:::

## Three ways to set the text

Under **View → the document**:

|                | What it is for                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| **Plain**      | The pane, filled. What a code editor does.                                                                     |
| **Continuous** | A column of sensible width in the middle of the pane. Nothing paginates; you scroll through one long document. |
| **Page**       | The sheet the document declares — A4, letter, landscape — drawn behind the text at its real proportions.       |

Page mode needs a paper size, and only a `.tex` declares one, so it is greyed
out for anything else.

The sheet is a **fixed box painted behind the text** and never built from the
content ([ADR-0024](/adr/0024-page-view-fixed-sheets)). A page assembled out of
what is on it can stretch, and four attempts proved it.

### Generated lists are tabs, not pages

`\tableofcontents` and `\printglossaries` produce a **card** on the paper and a
**tab** beside it, never a run of pages
([ADR-0025](/adr/0025-generated-lists-are-tabs)). Nothing in the buffer knows how
long a contents list is going to be, and pretending otherwise produced a preview
that was confidently wrong. Click the card and the tab opens.

## Formatting

Three routes to the same commands, because people arrive from different places.

**Select some text** and a bar appears under it: bold, italic, underline, small
capitals, monospace, the font family, the size, a colour, and clear formatting.

**The Start tab of the ribbon** has the same set, laid out the way a word
processor lays it out, for people who select text and then look up.

**The keyboard** — `Mod+B`, `Mod+I` and the rest, all rebindable under
Settings → Keyboard.

A table kept drawn — **View → keep tables drawn** — can be typed in where it
stands: click a cell, type, Tab to the next one, and Tab out of the last one to
get a new row. Bold, italic and the rest work inside a cell, from the bar, the
ribbon or the keyboard.

Hovering the table shows a **⊕ on every boundary**, inside and out — that is
where a new column or row goes, so "which side?" is never a question. Between
two columns the same boundary carries the drag handle that sets the width, and
the same on the left for row heights. The **⋮** in the corner has the rest:
insert above, below, left or right of the cell you are in, empty a cell, and
delete a row, a column or the table.

A cell holding something the preview cannot write back — a citation, a formula —
is not editable in place, because what the cell shows is the _result_ of that
markup. The test is the actual round trip: render the source, read the element
back, and see whether it says the same thing. That is why `	extbf{Kosten}` is
editable and `\cite{din277}` is not.

Everything writes LaTeX and reads LaTeX back. Bold _is_ `\textbf`, so the
buttons light up according to what the source already says. The font list has
three entries and the size list has ten because that is what LaTeX has: a
document says _roman_, _sans_ or _typewriter_ and lets the class decide what
those are, and `\large` is large relative to a base size the class sets. A
control offering "Calibri, 14pt" would be a control that lies.

Colour is the one command that needs a package. Applying it adds
`\usepackage{xcolor}` to the preamble — writing `\textcolor` into a document that
cannot compile it would be a formatting button that breaks the build.

## The tabs

Opened from **View → Tabs**. None of them opens itself; a pane that appeared
every time you clicked something would be a pane fighting the document for room.

| Tab           | What it holds                                                                   |
| ------------- | ------------------------------------------------------------------------------- |
| **Outline**   | The document's headings, numbered as LaTeX will number them. Click to go there. |
| **Search**    | What the search box found, grouped by file.                                     |
| **Citations** | Every work the document cites. Clicking one steps through its occurrences.      |
| **Glossary**  | The entries `glossaries` defines. From the packages plugin.                     |
| **Tasks**     | What is left to do, from whichever to-do application you connected.             |
| **Details**   | Whatever you last clicked — a citation, a glossary term, a task.                |
| **History**   | Commits, with restore, when version control is on.                              |
| **PDF**       | The compiled document, with SyncTeX both ways.                                  |

**Details** is worth a note. Clicking a citation shows what the bibliography
says; clicking a glossary term shows its definition; clicking a task shows its
description, dates and section. Those come from core, from a packages plugin and
from a to-do plugin — and a tab each would be three tabs to track for one
question the reader keeps asking: _what is this thing?_

## Finding things

`Ctrl+F` puts the caret in the search box at the top and opens the **Search**
tab beside the document. Results are grouped by file, in document order, because
that is how somebody works through them — a file at a time, top to bottom.

Three switches sit inside the box, the way every editor puts them: **Aa** for
match case, **ab** for whole word, **.\*** for a regular expression. The query
is taken literally unless the last of those is on, so searching for `200.` does
not find `200 `.

`Ctrl+H` opens a replace row under the box, with **replace this one** and
**replace all in this file**. Replacing works on the file you are looking at
only: a change in a file you cannot see is a change you cannot check. Under
regex, `$1` in the replacement is the first capture group.

The open file is searched from the buffer, so unsaved edits are found; the rest
of the project is read from disk. A very large number of matches is cut short
rather than built — and the tab says when it was.

## The command palette

`Ctrl+Shift+P`. Everything the ribbon can do, plus what plugins added, plus the
insertions — a table, a figure, an equation, a list, a section — each of which
is several lines of markup with an easy mistake in it.

Plugins declare commands through the public API and they appear here alongside
the built-in ones, with no special casing for the ones we wrote
([ADR-0005](/adr/0005-extensibility-tiers)).

## Citations

Drag a source out of Zotero and drop it into the text. yaz writes the entry into
the `.bib` the document actually loads, and inserts a `\cite`. Drag a
**highlight** and you get the quotation with its citation attached.

The project's `.bib` remains the compile-time source of truth
([ADR-0008](/adr/0008-zotero-integration)), so the document still builds on a
co-author's machine that has never heard of Zotero.

An unresolved citation draws in red. Click it and yaz offers to fix the
declaration — scanning the project for a `.bib` only at that moment, because
reading the filesystem on every keystroke to warn about something most documents
never hit is the wrong trade ([ADR-0015](/adr/0015-performance-budgets)).

See the [Zotero plugin](/reference/generated/plugins/zotero) for the citation-key
schemes and what ends up in the `.bib`.

## Tasks

Writing a paper is three jobs and yaz is good at one of them. Zotero manages the
sources, a to-do application manages what is left to do, and yaz manages the
writing ([ADR-0026](/adr/0026-task-providers-and-credentials)).

So the Tasks tab shows a list and does not keep one. Todoist fills it today; a
Things or Microsoft To Do plugin would fill the same tab tomorrow, and nothing
in yaz would change.

Which list a paper uses is stored **with the paper**, under Connections in the
ribbon — a thesis and a conference paper are different work with different
lists. The API token is per install and lives in the operating system's
keychain, never in a config file and never handed to the webview.

## The corner

The blue **y** in the top-left opens the project menu: open a folder, reopen a
recent one, close the project. Those are not part of writing a paper — they are
what you do before and after — so they are behind the mark rather than in the
ribbon.
