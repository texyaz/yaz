# 0032 — The preview reads the document's own definitions

- **Status:** Accepted
- **Date:** 2026-11-17
- **Supersedes:** none
- **Amends:** [0023 — The preview knows LaTeX; packages are plugins](0023-latex-vocabulary-boundary)

## Context

[ADR-0023](0023-latex-vocabulary-boundary) drew one
line: LaTeX itself is yaz's, and what a package adds is a plugin's. That left a
third kind of command with nowhere to go, and a real thesis is full of it.

A doctoral thesis opened in the preview showed 108 `\begin{plan}` … `\end{plan}`
pairs, 28 `\begin{hypothesis}[…]`, a title page made of `\thesistitle` and
`\thesisauthor`, and `\data{corpus.documents}` wherever a number stood. None of
those is LaTeX's and none is a package's. They are the document's: defined in
its own preamble, a few lines above where they are used. No vocabulary anybody
ships can hold them, because nobody else has them.

The preamble that defines them is in the buffer — the joined document
([ADR-0020](0020-stitched-multi-file-editing)) puts it there — so
the document was already saying what each of them is. The preview was not
listening.

## Decision

**The preview reads what the document defines for itself, and draws those
commands and environments the way their definitions say.**

It recognises the shapes a definition takes when it is _naming_ something, and
only those:

- **A command without arguments** (`\newcommand{\x}{text}`,
  `\NewDocumentCommand{\x}{}{text}`, `\def\x{text}`) is drawn as its text. An
  empty one is drawn as nothing.
- **A command with one mandatory argument** is drawn as its argument: styled
  like the command it wraps (`\code` around `\texttt`), plain otherwise, and
  not at all if the definition never uses it. Where the body builds a name
  from it — `\csname data@#1\endcsname` — it is drawn as the value defined
  under that name, and left as written if there is none.
- **An environment** (`\newenvironment`, `\NewDocumentEnvironment`) is set
  apart under its own name, with its `\begin` and `\end` gone.
- **A theorem** (`\newtheorem`, and any command a plugin declares as
  `{ kind: "theorem" }`) heads its environment with its title, its number and
  the statement's own name, and a `\ref` to a label inside it prints that
  number.

**It is a reader, not an expander.** Optional arguments, stars, two or more
parameters, a `\def` with a parameter text: all left as source. A definition
that cannot be read costs nothing — the command is shown as written, which is
true.

**TeX's conditionals are machinery.** A line that is nothing but `\if…`,
`\else` or `\fi` and commands is hidden with the rest of the document
machinery. The test is not evaluated, so both branches stay on the page.

**Definitions are read from the buffer and nowhere else.** A chapter opened on
its own has no preamble and is drawn without them.

The same change adds what the packages needed to say and could not:
`quantity` (a number with its unit, drawn as one piece), `symbol` in the
public contract, `leading` arguments on a quotation, a `drawing` environment
(a card where the compiler will put a picture) and a `theorems` listing.

## Why this is not a second vocabulary

A vocabulary is a table somebody maintains. This has no table: every entry is
derived, on each pass, from the text it then decorates. Change
`\newcommand{\thesistitle}{…}` and the title page changes in the same
keystroke, for the same reason `\title{…}` already did (ADR-0004: there is one
document and it is the `.tex`).

What LaTeX or a package defines keeps its meaning even when the document
redefines it. `\renewcommand{\emph}{…}` changes how the document prints, not
what `\emph` is, and a preview that followed it would be running the
document's code.

## Cost

Definitions are found in the token index the pass has already built
(ADR-0015), so reading them is a filter over that list, remembered by text
like every other scanner. The bodies and arguments it then looks inside are
tokenised **without** touching the remembered index — asking the shared
tokeniser about forty characters would throw away the manuscript's index and
make the next scanner walk the document again. Measured on the thesis this
was built against (97 000 characters, 41 files): 7.6 ms per keystroke before,
9.1 ms after, in jsdom, drawing about four hundred more things.

## Consequences

- A document that programs TeX heavily is drawn no worse than before and no
  better. The reader's shapes are the ones people use to name things.
- Both branches of a conditional are shown. A draft-only note looks like
  text in the preview; the PDF is where the switch is honoured.
- A statement's number is counted the way its declaration says and prefixed
  with the unit it is numbered within. A document that redefines
  `\thehypothesis` to something else will see a different number in the PDF.
- A `\newcommand` in a file that is not in the buffer does not exist as far as
  the preview is concerned.
