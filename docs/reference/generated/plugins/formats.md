<!--
  GENERATED FILE - DO NOT EDIT.
  Produced by scripts/generate-docs.mjs from the code it describes.
  Edit the source, not this page. See docs/adr/0016-documentation-strategy.md.
-->

# ≡ Text formats

> Highlighting for the files a LaTeX project is full of that are not LaTeX: Markdown, TOML, YAML and BibTeX.

| | |
| --- | --- |
| Identifier | `com.yaz.formats` |
| Version | 0.2.0 |
| Needs yaz | 0.2.0 or newer |
| Asks for | nothing |
| Source | [texyaz/yaz-formats](https://github.com/texyaz/yaz-formats) |

Highlighting for the files a LaTeX project is full of that are not LaTeX:
**Markdown**, **TOML**, **YAML** and **BibTeX**.

A plugin for [yaz](https://github.com/texyaz/yaz).

## What it does, and what it does not

yaz opens every text file whether or not this plugin is installed. Line
numbers, wrapping, Vim and search are the editor's floor, and no plugin is
needed to reach it. What this adds is knowing what the file *is*.

That distinction is deliberate and it is the rule for any format plugin: a
format makes a file better to work with, and is never what makes it openable.
Switch this plugin off and your `.bib` still opens — as plain text, which is
what an editor with no opinion about BibTeX should show.

| Format | Extensions | Where the language comes from |
| --- | --- | --- |
| Markdown | `.md`, `.markdown`, `.mdown`, `.mkd` | written here |
| BibTeX | `.bib`, `.bibtex` | written here |
| TOML | `.toml` | CodeMirror's legacy mode |
| YAML | `.yaml`, `.yml` | CodeMirror's legacy mode |

Markdown and BibTeX are written here rather than pulled in, because the
alternative was a dependency whose whole value would have been highlighting six
constructs. TOML and YAML are not, because CodeMirror's own modes exist and are
correct, and a hand-written tokeniser for either would be worse for no reason.

## Why this is a plugin

A LaTeX project is full of files that are not LaTeX, and *"the editor should
understand this format too"* is the most obvious thing anyone will ever want to
add to yaz. If that cannot be done from outside the application, the plugin API
is not finished.

So this is done from outside, against the same public
[`@yaz/api`](https://github.com/texyaz/yaz/tree/main/packages/api) an external
author gets — no privileged access, no shortcuts
([ADR-0005](https://texyaz.github.io/yaz/adr/0005-extensibility-tiers)). If you
want to teach yaz a format it does not know, this repository is the worked
example, and `src/main.ts` is about sixty lines.

## Adding a format

```ts
this.registerFormat({
  id: "rust",
  extensions: ["rs"],
  nameKey: "format-rust",
  load: async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    const { rust } = await import("@codemirror/legacy-modes/mode/rust");
    return StreamLanguage.define(rust);
  },
});
```

`load` is called the first time a file of that format is opened, and never
before. That is the whole reason it is a function: handing the language over at
registration would put it in the bundle for every user who never opens the
format.

## Capabilities

None. This plugin reads no files, reaches no network and touches nothing
outside the editor, so its manifest declares no capabilities and the broker in
the Rust process grants it none
([ADR-0006](https://texyaz.github.io/yaz/adr/0006-plugin-runtime-and-capabilities)).

## Development

```sh
git clone https://github.com/texyaz/yaz-formats
cd yaz-formats
pnpm install
pnpm check
```

To run it against a local yaz, point yaz at this directory in
**Settings → Plugins → Development plugin**, and use **Reload plugins**. No
commit, no push, no release — see
[writing a plugin](https://texyaz.github.io/yaz/plugins/writing-a-plugin).

## Licence

MIT. The application is AGPL-3.0, but its plugin API is MIT and so is this, so
that anyone can copy it as a starting point without inheriting a licence they
did not choose.
