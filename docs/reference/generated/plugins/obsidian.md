<!--
  GENERATED FILE - DO NOT EDIT.
  Produced by scripts/generate-docs.mjs from the code it describes.
  Edit the source, not this page. See docs/adr/0016-documentation-strategy.md.
-->

# ◇ Obsidian

> Bring a note from your Obsidian vault into the document, translated to LaTeX.

| | |
| --- | --- |
| Identifier | `com.yaz.obsidian` |
| Version | 0.2.0 |
| Needs yaz | 0.2.0 or newer |
| Asks for | `obsidian` |
| Source | [texyaz/yaz-obsidian](https://github.com/texyaz/yaz-obsidian) |

Bring a note from your Obsidian vault into the document, translated to LaTeX.

A plugin for [yaz](https://github.com/texyaz/yaz).

## What it does

One command — **Insert note from vault** — which lists your notes, and puts the
chosen one into the document at the caret as LaTeX rather than as Markdown.

That is the whole plugin, and the size is the point: yaz's claim is that it
starts where writing actually begins, in the references you have collected and
the notes you have taken, and carries them through to a manuscript. A note that
has to be reformatted by hand on the way in is a note that stays where it is.

## The translation is not this plugin's

`app.obsidian.translate()` runs in the Rust process, against the project's own
mapping. This plugin chooses the note and where it lands; it does not decide
what a heading or a callout becomes.

That split matters for a reason worth stating: a co-author who has never
installed this plugin still compiles the same document. If the translation
lived here, a document would depend on a plugin its readers do not have —
which is the thing an editor built around one `.tex` file
([ADR-0004](https://texyaz.github.io/yaz/adr/0004-editor-core-codemirror-single-buffer))
must never let happen.

## Capabilities

```json
"capabilities": [{ "kind": "obsidian" }]
```

One, and it is checked in the Rust process rather than here. A plugin declares
what it needs and the capability broker grants exactly that
([ADR-0006](https://texyaz.github.io/yaz/adr/0006-plugin-runtime-and-capabilities));
this plugin has no filesystem access of its own and cannot read your vault
except through the calls that capability opens.

## Development

```sh
git clone https://github.com/texyaz/yaz-obsidian
cd yaz-obsidian
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
