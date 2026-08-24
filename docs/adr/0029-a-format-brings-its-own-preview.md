# 0029 — A format brings its own preview

- **Status:** Accepted
- **Date:** 2026-08-24
- **Supersedes:** none
- **Amends:** [0004 — One buffer](0004-editor-core-codemirror-single-buffer),
  [0005 — Extensibility tiers](0005-extensibility-tiers)

## Context

Preview was LaTeX's and nothing else's. The View switch said so — greyed out
for every other format — and for a while that was honest, because LaTeX was the
only format with anything to draw.

It stopped being honest when the formats plugin arrived. A LaTeX project is full
of Markdown: a README, a notes file, an Obsidian vault next door. Markdown is a
markup language whose entire point is that it reads better rendered, and yaz was
showing it as hashes and asterisks with no way to ask for anything else.

The obvious answer — teach the editor about Markdown — is the answer ADR-0005
exists to refuse. Markdown support is a plugin's, and if a plugin cannot supply
a preview then the plugin API is missing something rather than Markdown being
special.

## Decision

**A format contribution may carry a preview, and yaz decides when it is
mounted.**

```ts
registerFormat({
  id: "markdown",
  extensions: ["md"],
  nameKey: "format-markdown",
  load: async () => (await import("./markdown")).markdown(),
  preview: async () => (await import("./markdownPreview")).markdownPreview(),
});
```

### 1. There is nothing to read

The extension a plugin returns is mounted in a compartment while preview is on
for a buffer of that format, and reconfigured to nothing when it is off.

This is the part worth defending. The obvious design is a flag the plugin
reads — `isPreviewOn()` on the API, or a facet — and it is worse in every way
that matters. A flag is a thing to get wrong; two plugins reading it can
disagree about it; and every plugin then contains the same three lines deciding
whether to draw. Mounting is the same decision made once, in the place that
already owns it.

So a preview is written as though preview were always on. It is taken away
rather than switched off.

### 2. Decorations, not a rendered copy

ADR-0004's rule holds for a plugin exactly as it holds for core: there is one
buffer, it holds the file, and a preview is decorations over it. A read-only
rendered pane beside the source would be two things to keep in step and a
second place for the caret to be.

What this buys is that the preview is _editable_. A heading is large because a
decoration makes it large, so clicking in it puts the caret in the file. Ticking
a task box writes `[x]` into the document. That is not a bonus feature — it is
the whole reason Obsidian users do not want a preview pane.

### 3. The markup returns where the caret is

Every construct that hides its own syntax shows it again when the caret is on
that line. You cannot select what you cannot see, and an editor that hides the
asterisks you are trying to delete is an editor you fight.

This is a convention rather than something the API enforces, because it cannot
be enforced — a decoration is a decoration. It is written down here because a
preview that does not do it will feel broken and its author will not know why.

### 4. Two chunks, not one

`load` and `preview` are separate dynamic imports because they are separate
jobs: highlighting is what a file gets for being _open_, and a preview is what
it gets for being _looked at_. Somebody reading a README in source never loads
the preview; somebody who never opens a `.md` loads neither.

### 5. LaTeX's preview is not one of these

It is woven through the editor rather than being a single extension, and it
reads the preview flag directly. So its registry entry has no `preview` and the
shell special-cases it.

That is a wart and this ADR would rather say so than pretend otherwise. It is
not worth unpicking today: the day a _second_ built-in format wants a preview is
the day LaTeX's should arrive the same way everyone else's does.

## What the Markdown preview covers

Obsidian's dialect, because that is what people write:

- headings, quotes and nested quotes, horizontal rules
- callouts — `> [!warning] Careful` — with the sign and colour each kind asks
  for, and an unknown kind drawn as a callout rather than refused, because
  Obsidian lets you invent one
- task checkboxes, which are real checkboxes and write their tick into the file
- bullet and numbered lists, indented by depth; a numbered list keeps its
  numbers because those are content, a bullet list gets a bullet
- emphasis, strong, strikethrough, `==highlight==`, code spans
- Markdown links and wikilinks, showing the words rather than the address
- fenced code blocks, inside which nothing is markup — a `#` in a shell script
  is a comment, and drawing it as a heading would be a lie about the file

Not tables, and not emphasis nested inside links inside list items. Those need a
real parser; they are drawn as their source, which looks unstyled rather than
looking wrong.

## Consequences

**Good.** Markdown previews, and the switch that always looked broken now works
for it. The mechanism is public, so a plugin for AsciiDoc or Typst or reStructured
Text needs nothing from us. Building it turned up a real gap in the bundling
seam: `vite.config.ts` lends a plugin the packages it may import, and the list
had `@codemirror/language` but not `@codemirror/state` or `@codemirror/view` —
enough to _tokenise_ but not to _draw_. Any plugin trying to decorate would have
failed to build with a resolution error, and nobody had tried.

**Bad.** A second copy of the Markdown grammar, loosely: the highlighter
tokenises it and the preview matches it again with its own patterns. They can
disagree — the highlighter thinking something is emphasis while the preview does
not — and the symptom would be a colour without the styling. Sharing a parse is
the fix, and it costs a parser neither of them currently needs.

The preview does its own line matching per redraw rather than reading a syntax
tree. It is bounded by the viewport so the document's size does not matter, but
it is a regex pass per visible line on every selection move — well inside
ADR-0015's budget at a screenful, and the first thing to look at if it ever is
not.

**Watch.** The vite and vitest alias lists are the same loan written twice, kept
in step by hand. They are short and a mismatch fails immediately — a test that
cannot import what the build can — but they are two lists that mean one thing.
