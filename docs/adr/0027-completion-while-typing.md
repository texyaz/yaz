# 0027 — Completion while typing

- **Status:** Accepted
- **Date:** 2026-08-24
- **Supersedes:** none
- **Amends:** [0015 — Performance budgets](0015-performance-budgets)

## Context

yaz has no while-typing completion. `autocompletion()` is mounted in the editor
with no sources, so the machinery is there and does nothing.

LaTeX is a language where completion is worth more than usual: the names are
long, the arguments are keys rather than words, and getting one wrong produces a
document that compiles and is quietly wrong — a `\cite{spielbaur2020}` resolves
to nothing and prints `[?]` four hundred pages later.

The obvious answer is a language server. TexLab exists, is maintained, and
already knows about the installed TeX tree. The obvious answer is also how this
gets slow.

## The observation that decides it

**Almost everything worth completing in a `.tex` is already in yaz's memory.**

| Trigger                | What it offers     | Where the data already is          |
| ---------------------- | ------------------ | ---------------------------------- |
| `\`                    | command names      | the vocabulary registry (ADR-0023) |
| `\begin{`              | environment names  | the same                           |
| `\ref{`, `\cref{`      | labels             | the buffer                         |
| `\cite{`               | citation keys      | the bibliography the shell loaded  |
| `\gls{`                | glossary terms     | the packages plugin                |
| `\includegraphics{`    | image files        | the project file list              |
| `\input{`, `\include{` | project files      | the same                           |
| `\documentclass{`      | standard classes   | a fixed list; LaTeX has five       |
| `\usepackage{`         | installed packages | **nowhere — needs the TeX tree**   |

Eight of nine need no new data source, no filesystem and no subprocess. Reaching
for a language server first would mean paying process-boundary cost to be told
our own labels.

## Decision

**Completion is a set of sources over data yaz already holds, and never puts
anything on the keystroke path.**

Four rules, in order of how expensive they are to get wrong.

### 1. Two latencies, two budgets

The mistake that makes an editor feel slow is treating "the suggestion appears"
as part of "the character appears". They are different:

- **keystroke → paint** must stay under 16 ms. This is ADR-0015's budget and it
  is the one that matters.
- **keystroke → suggestions** may take 50–150 ms and still feel instant, _as
  long as it never delays the first_.

CodeMirror's completion sources may return promises and the editor draws what it
has. So a suggestion arriving late costs nothing.

**A completion source may never make the editor await anything.** That is the
rule the rest of this follows from.

### 2. Nothing scans the document per keystroke

The decoration pass already walks the buffer once per keystroke and is the
budget's hot spot; a second walk costs more than everything else in the pass put
together (measured, on a joined 175 KB thesis).

So the document is scanned **on trigger, not on change** — when somebody types
the `{` of `\ref{`, not on every character — and the result is cached against
the document _object_, so filtering as they keep typing does not scan again.

**Deciding whether a trigger fired must not read the document either.** This is
the part the first implementation got wrong, and it is worth naming because it
looks like nothing: the source began by turning the whole document into a string
so it could look at the twenty characters behind the caret. That runs on every
keystroke — the usual answer being "this is prose, offer nothing" — so the cheap
half of the design was paying the expensive half's cost, and on a real thesis it
was the whole reason the suggestions felt slow.

Everything a trigger inspects is behind the caret and within a fixed reach of
it, so the source reads a window of that size and shifts the offsets back. The
scan-on-trigger rule is about the _document_ read; this is about the read nobody
counted as one.

Against the object rather than a fingerprint of it: CodeMirror's document is
immutable, so a change produces a different one and a stale answer is impossible
rather than merely unlikely. A fingerprint of length and line count would have
survived renaming `\label{a}` to `\label{b}`, which changes neither and changes
exactly what is cached.

A label scan of that thesis is about a millisecond. Once, on a keystroke that is
already a decision point, it is free. Per keystroke it would be a third of the
budget.

### 3. Triggers are syntax, not word characters

VS Code fires on every word character because JavaScript gives it no marker.
LaTeX gives us unambiguous ones: `\` begins a command, and `{` after a known
command begins an argument of a known kind. Completion fires there and nowhere
else.

This is not only cheaper. Popping a list up mid-word while somebody writes prose
is the behaviour people switch off.

### 4. A list nobody can read is not a feature

Three of the sources answer with keys, and a key is a handle rather than a name.
This is not a presentation detail — it decides whether the feature works:

- `\cite{` offering `spielbauer2020`, `spielbauer2021`, `spielbauer2021a` asks
  the author to remember which book is which. The list shows **the work** —
  author, year, title — and inserts the key. CodeMirror separates the two
  (`displayLabel` against `label`), and matching stays on the key, because
  somebody typing `spiel` means the key.
- `\gls{` offering `AIA — AIA` is what you get from an acronym whose short form
  is its own key, which is most of them. The **expansion** is the only part of
  the entry that says anything, so that is what shows.
- `\ref{` offering forty labels asks a question nobody can answer from a list.

The last one is different in kind, and gets a different answer.

### 5. A reference is asked in two steps

"Which of the forty labels" is unanswerable from a list. "Am I referring to a
section or a figure" is answerable by everybody. So `\ref{` offers the _kinds_
of thing — section, figure, table — and the labels arrive once the colon is
there. Choosing a kind inserts `sec:` and asks the next question immediately, so
the two steps read as one narrowing rather than as an obstacle.

Each kind says how many there are, because "12 sections" and "no figures yet"
are different answers to the same question.

The prefixes are a convention rather than a rule — nothing in LaTeX requires
`sec:` — so a document that labels its figures `bild:` gets `bild:` offered too,
read from what it actually uses. The conventional seven come first; what the
document invented follows.

And a label shows **what it names**, not its key: `3.2 Kosten`, with the number
LaTeX will print, taken from the same walk that numbers the outline so the two
cannot disagree. Doing that turned up a real defect in that shared walk — an
article, having no `\chapter`, was numbering its first section `0.1`, in the
outline and in every cross-reference.

### 6. One source now, a registry when there is a second

Today there is exactly one source and it is core's. It is mounted through
CodeMirror's `override`, which takes a list — so a second is a line, not a
redesign.

**The public API for a plugin to register one is not built yet**, and saying so
is the point of writing this down: the door is the right shape, but it is not
open. `\usepackage{` needs the installed TeX tree, which only the Rust process
may read (ADR-0006); cross-project references and rename are genuinely hard and
should not be written here. When those are wanted, the work is a
`registerCompletionSource` on `Plugin` in the same shape as
`registerDropHandler`, taking an **async** source — and if the API cannot
express that, the hole is ours to fix rather than to route around (ADR-0005).

What matters is that nothing about the current source has to change to allow it.
A source may already return a promise; CodeMirror merges a late answer in.

**We are not shipping a language server now.** A subprocess means a binary per
architecture — and ARM64 is tier 1 (ADR-0014), so "TexLab probably has a build"
is not good enough — an index to warm, and a protocol to marshal for data we
already hold.

## The budgets

Added to ADR-0015's table, measured the same way:

| Budget                     | Limit                     | Conditions                         |
| -------------------------- | ------------------------- | ---------------------------------- |
| Index update per keystroke | **0 ms** — no scan at all | any document                       |
| Trigger scan               | < 5 ms (p99)              | 5000-line document                 |
| Suggestions visible        | < 150 ms (p99)            | 5000-line document, from keystroke |

The first is the one that will actually bite. It is written as zero rather than
as a small number on purpose: the failure mode is somebody adding a "cheap"
per-keystroke index and the cost only showing up on a real thesis, which is
exactly how the decoration pass nearly went wrong. If a change makes completion
scan on `docChanged`, that is a design error and not a slow function.

The third is tracked but non-blocking: conflating it with keystroke latency is
how a slow source gets blamed on typing, or worse, hides behind it.

## Consequences

**Good.** Completion covers most of what a LaTeX author types on day one, with
no new dependency, no subprocess and no capability. Building it turned up two
real defects on the way. The vocabulary registry answers "how is this drawn" and
so does not list `\section`, which the preview draws from the document's
structure — a list of commands to _offer_ is a different list, and it is now
written down as one. And the heading numbering, asked for the first time by
something other than the outline, was numbering an article's first section
`0.1`: the chapter counter it does not use was being counted anyway. It works
offline and on a machine with no TeX installed. The sources are pure functions over data and a
position, so they are tested directly rather than by driving an editor.

**Bad.** No plugin can add a source yet, so a language server cannot be tried
without editor changes — small ones, but changes. `\usepackage{` offers only
what yaz's plugins know about rather than what is installed, and says so. There is no cross-file label completion in
single-file mode — joined mode has it, because then the labels are in the
buffer. Neither is fixed without reading the filesystem, which is the language
server's job when it arrives.

**Watch.** The two-step reference assumes a prefix is where the kind lives. A
document that labels everything `label1`, `label2` gets a list of one useless
prefix and has to type through it — no worse than the flat list it replaced, but
no better either. Worth revisiting if anybody writes one.

The trigger table is a second place that knows `\cite` takes a
citation key, and the vocabulary registry is the first. If those drift,
completion offers the wrong thing for a command the preview draws correctly. The
right fix is for the vocabulary to carry its argument kind — worth doing when
the next command is added, not worth a migration now.
