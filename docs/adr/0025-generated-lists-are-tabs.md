# 0025 — A generated list is a tab, not pages

- **Status:** Accepted
- **Date:** 2026-08-21
- **Amends:** [0024](0024-page-view-fixed-sheets.md)
- **Superseded by:** —

## Context

`\tableofcontents` is one word in the source and eight pages in the PDF.
`\printglossaries` is one word and a hundred and forty terms. The preview tried
to be those pages: build the entries out of the buffer, estimate how tall each
one is, divide them into sheets, and keep each sheet exactly one sheet tall so
that they tile the paper on their own.

[ADR-0024](0024-page-view-fixed-sheets.md) kept that as the one exception to
"the page is a fixed box": a gap cannot be put inside a widget, so a listing was
allowed to divide itself, and it was the only construct left that still needed a
row count.

It never came out right, over four rounds of reports. Not because the division
was badly implemented — because **nothing in the buffer decides how long a
generated list is.** Its length comes from typesetting: how many pages the
contents runs to depends on where the compiler breaks its pages, which depends
in turn on how long the contents list is. The preview does not typeset. Every
answer it gave was a guess, the guess was wrong by whole pages, and a wrong
number of pages in the middle of a document makes everything after it start in
the wrong place.

The estimate was also the last thing on the keystroke path that had to know how
wide a character is and how tall a row is.

## Decision

**The preview does not draw a generated list. It draws a card standing in for
one, and the list itself lives in a tab.**

Where `\tableofcontents` or `\printglossaries` stands, the preview replaces the
line with a short card: the list's name, and — where something can show it — a
line of text that opens it. A card is one line's worth of paper, which is what
the command occupies in the source, and its height is a fact rather than an
estimate.

Which tab shows which list is not the editor's to know. It asks, through a
facet, whether anything can show a kind of list and calls back when the card is
clicked:

```ts
export interface ListingTabs {
  has(kind: ListingKind): boolean;
  open(kind: ListingKind): void;
}
```

The shell answers for the contents with the **outline**, which is the document's
own headings and now carries their section numbers. A plugin answers for the
rest, through `workspace.registerView(type, factory, { titleKey, listing })` —
so the **glossary tab lives in `yaz-latex-packages`**, because
`\printglossaries` is the glossaries package's command and
[ADR-0023](0023-latex-vocabulary-boundary.md) puts a package's constructs in a
plugin. No privileged back door: the glossary tab uses the same public API any
community plugin would ([ADR-0005](0005-extensibility-tiers.md)).

## Consequences

- **ADR-0024's exception is withdrawn.** Nothing divides itself into sheets any
  more, so the page really is a fixed box with no exceptions. The row count and
  the character measure are gone from the editor entirely.
- **No page is opened for a listing.** A forced break around a card would put a
  blank sheet either side of it, which is what the blank pages before and after
  the glossary were.
- **A list can be as long as it is.** A tab is not a sheet of paper, so a
  glossary of a hundred and forty terms is a hundred and forty rows and nobody
  has to decide where to cut it.
- **There are still no page numbers in the contents.** A page number comes from
  typesetting, and a wrong one in the one place a reader trusts numbers is worse
  than none. Section numbers are shown, because those the document does decide.
- **The preview says less about the finished document than it did.** That is the
  point: it now says only what the buffer actually determines. The pages are the
  compiler's answer, and the PDF tab is where they are.
