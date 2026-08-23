<!--
  GENERATED FILE - DO NOT EDIT.
  Produced by scripts/generate-docs.mjs from the code it describes.
  Edit the source, not this page. See docs/adr/0016-documentation-strategy.md.
-->

# ∑ LaTeX packages

> Preview support for what the common LaTeX packages add: glossaries, biblatex, csquotes, amsmath, hyperref and the rest.

| | |
| --- | --- |
| Identifier | `com.yaz.latex-packages` |
| Version | 0.1.0 |
| Needs yaz | 0.3.0 or newer |
| Asks for | nothing |
| Source | [texyaz/yaz-latex-packages](https://github.com/texyaz/yaz-latex-packages) |

Preview support for what the common LaTeX packages add: **glossaries**,
**biblatex**, **csquotes**, **amsmath**, **hyperref**, **cleveref**,
**microtype**, **booktabs**, **longtable**, **pdflscape** and the rest.

A plugin for [yaz](https://github.com/texyaz/yaz).

## The line this is on the far side of

yaz knows **LaTeX itself** — the kernel and the standard classes — and nothing
else. `\section`, `itemize`, `$x^2$`, `\textbf`, `figure`: those are what a
`.tex` file *is*, and an editor for LaTeX that needed a plugin to show a
heading would not be doing its job.

Everything a package adds is here. `\gls` is glossaries. `\parencite` is
biblatex. `\enquote` is csquotes. Each is somebody's package, each could be
replaced by a different package doing the same job, and there is no end to the
list — which is exactly the shape of thing that should live outside the
application rather than accumulate inside it.

**The test is not "does a real thesis use it".** A real thesis uses `\gls` 561
times. The test is: *does `\documentclass{article}` alone define it?*

## What is in here

| Package | What yaz learns |
| --- | --- |
| `glossaries` | `\gls` and its seven relatives, `\printglossaries`, `\makeglossaries` |
| `biblatex` | `\parencite`, `\textcite`, `\footcite`, `\autocite`, `\printbibliography` |
| `natbib` | `\citep`, `\citet` |
| `csquotes` | `\enquote` and `\textquote`, drawn with the marks the document's language uses — and `\textquote`'s optional argument kept as the citation it attributes the passage to |
| `amsmath` | `align`, `gather`, `multline`, `flalign`, `alignat`, `\eqref` |
| `hyperref` | `\autoref`, `\nameref` |
| `cleveref` | `\cref`, `\Cref` |
| `microtype` | `\textls` |
| `booktabs` | `\toprule`, `\midrule`, `\bottomrule` |
| `longtable`, `tabularx` | the tables, and their run-on rules |
| `pdflscape`, `rotating` | `landscape`, `sidewaystable` — which turn the page |
| `placeins`, `ragged2e`, `makeidx`, `graphicx` | the smaller ones |

`\usepackage` is not consulted. A document that uses `\gls` gets it drawn
whether or not it loaded glossaries — because a document using `\gls` without
loading it is a document that does not compile, and reporting that is the
compiler's job rather than the preview's.

## The Glossary tab

`\printglossaries` does not produce pages in the preview. It produces a **card**
where it stands and a **tab** beside the document, which this plugin registers
through the public `workspace.registerView`
([ADR-0025](https://texyaz.github.io/yaz/adr/0025-generated-lists-are-tabs)).

The reason is that nothing in the buffer knows how long a glossary is going to
be. Drawing one across pages meant guessing, and the guess was confidently
wrong — entries split mid-definition, the page count off by three. A tab makes
no claim about pagination and shows every entry, which is what somebody opening
a glossary wanted in the first place.

Clicking an entry describes it in the **Details** tab: its short form, its long
form, and where it is defined.

## It declares; it does not scan

This plugin never walks a document, and the API does not let it.

yaz walks the document once per keystroke, and that constraint is load-bearing:
measured against a joined 175 KB thesis, a second walk costs more than
everything else in the decoration pass put together. A dozen plugins each
walking it would be a dozen times that.

So a contribution is a *declaration* — this name, drawn this way — and yaz does
the finding. A plugin never sees an offset:

```ts
this.registerLatexVocabulary({
  commands: {
    gls: { kind: "glossary" },
    parencite: { kind: "citation" },
    enquote: { kind: "quotation" },
  },
  environments: {
    landscape: { kind: "turned" },
    align: { kind: "math" },
  },
});
```

A contribution may not claim a name LaTeX itself defines. `\section` means what
LaTeX says it means, and a preview that depended on which plugins happened to be
installed would be a preview of something other than the document.

## Adding a package

`src/vocabulary.ts` is grouped by package, one `const` per `\usepackage`,
because the question anyone will have is *why does yaz know this command* — and
the answer should be readable in one place. Add a group, add it to the exported
object, done.

## Capabilities

None. This plugin reads nothing, writes nothing and reaches no network; it hands
yaz a table of names and a tab, and stops.

## Development

```sh
git clone https://github.com/texyaz/yaz-latex-packages
cd yaz-latex-packages
pnpm install
pnpm check
```

Point yaz at this directory in **Settings → Plugins → Development plugin** and
use **Reload plugins**. See
[writing a plugin](https://texyaz.github.io/yaz/plugins/writing-a-plugin).

## Licence

MIT. The application is AGPL-3.0, but its plugin API is MIT and so is this, so
that anyone can copy it as a starting point without inheriting a licence they
did not choose.
