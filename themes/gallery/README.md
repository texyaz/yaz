# Theme gallery

Four installable themes built from well-known editor palettes: [Nord](nord),
[Dracula](dracula), [Solarized](solarized), and [Gruvbox](gruvbox). Each is a
self-contained bundle — `manifest.json` + `theme.css` — in the exact shape
Settings → Appearance → "Install a theme" expects (the same shape the
in-app theme builder exports, per [ADR-0010](../../docs/adr/0010-theming.md)).

None of these are bundled into the application; installing one copies its
folder into `<config>/themes/<id>/`, the same as installing any other theme.

## Installing one

In yaz: **Settings → Appearance → Install a theme**, then choose one of this
directory's four subfolders (`themes/gallery/nord`, etc.) directly — no
zipping or copying needed, the picker reads `manifest.json`/`theme.css`
straight out of the folder you point it at.

## Where the palettes came from

- **Nord** — Arctic Ice Studio and Sven Greb's palette
  (<https://www.nordtheme.com>). Ships dark only upstream; light mode here
  pairs the same Frost/Aurora accents with Nord's own Snow Storm tones,
  darkened for contrast on a light background.
- **Dracula** — <https://draculatheme.com>. Also dark only upstream; light
  mode keeps the same fixed accent set (pink, purple, cyan, green, orange,
  red, yellow) on Dracula's own foreground colour as the page.
- **Solarized** — Ethan Schoonover's palette
  (<https://ethanschoonover.com/solarized/>), which ships both modes
  officially with a base03–base3 background ladder measured for contrast,
  and one accent set shared by both.
- **Gruvbox** — morhetz's palette (<https://github.com/morhetz/gruvbox>),
  which also ships an official light ladder, so both modes here use
  Gruvbox's own colours rather than an improvised complement.

Every value is a token from [`themes/tokens.css`](../tokens.css) and nothing
else, same as the bundled `yaz` theme — restyling one is changing values, not
hunting through component code.
