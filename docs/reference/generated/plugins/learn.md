<!--
  GENERATED FILE - DO NOT EDIT.
  Produced by scripts/generate-docs.mjs from the code it describes.
  Edit the source, not this page. See docs/adr/0016-documentation-strategy.md.
-->

# ▣ Learn

> Capture any part of the application as a clean image or a short clip, for documenting how it works.

| | |
| --- | --- |
| Identifier | `com.yaz.learn` |
| Version | 0.1.0 |
| Needs yaz | 0.3.0 or newer |
| Asks for | `fs-project` |
| Source | [texyaz/yaz-learn](https://github.com/texyaz/yaz-learn) |

Capture any part of yaz as a clean image or a short clip, without leaving yaz.

A plugin for [yaz](https://github.com/texyaz/yaz).

## What it is for

Documenting the application. Point at a ribbon group, a dialog, a pane; get a
PNG or a WebM of exactly that, with the padding you asked for, saved into
`docs/media/` under a name you will still recognise next month.

It exists because the alternative is a system screenshot, and a system
screenshot is of a *screen*: wrong scale factor, whatever was behind the window
in it, a permission dialog on two platforms out of three, and cropping it to
"the Zotero group in the ribbon" is a manual job every single time. Rendering
the DOM makes the capture repeatable — same element, same padding, same result.

## Using it

Two commands:

| Command | What it does |
| --- | --- |
| **Capture element** | One still, as PNG |
| **Capture clip** | Six seconds, as WebM |

Then point:

- **Move the pointer** — whatever is under it is outlined.
- **↑ / ↓** — grow the selection to the parent, or shrink it to the first
  child. The thing under the pointer is usually a label inside a button inside
  a group, and which of those you want changes every time.
- **Click** or **Enter** — take it.
- **Esc** — never mind.

You are then offered names built from what the element says about itself, so
the file is called `ribbon-work-compile.png` rather than `screenshot-3.png`.

## Framing

Padding is pixels of context kept on every side, and it is why the whole
document is rendered and then cropped rather than the element being rendered
alone: padding *around* something means the pixels beside it, which only exist
if its neighbours were drawn too. Rendering the element by itself would give a
border of blank.

## What it costs

A frame is a full render of the document to a canvas, then a crop —
milliseconds for a dialog, tens of milliseconds for a whole window. Fine for a
still. It is also why clips record at eight frames a second rather than sixty:
a clip here is for showing a menu opening, not an animation.

## Capabilities

```json
"capabilities": [{ "kind": "fs-project" }]
```

One, and only to write the file. `fs-project` is scoped to the open project, so
this plugin can put an image in `docs/media/` and cannot read anything else on
your disk ([ADR-0006](https://texyaz.github.io/yaz/adr/0006-plugin-runtime-and-capabilities)).

It reads the DOM directly, which every plugin can do — plugins run in the
webview ([ADR-0006](https://texyaz.github.io/yaz/adr/0006-plugin-runtime-and-capabilities))
— and it reaches no network at all.

## Development

```sh
git clone https://github.com/texyaz/yaz-learn
cd yaz-learn
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
