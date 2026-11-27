# Getting started

::: warning Pre-alpha
yaz is not yet usable for real work. There are no released binaries; the only
way to run it today is to build from source.
:::

## Build and run

Requires **Rust 1.85+**, **Node 22+** and **pnpm 9+**.

```bash
git clone https://github.com/GeneralPawz/yaz.git
cd yaz
pnpm install
pnpm dev
```

`pnpm app:build` produces a release binary and an installer.

::: danger Do not use `cargo build --release`
It produces a binary whose window shows the webview's _"cannot reach this page"_
error, and nothing in that message suggests a build problem.

`tauri-build` distinguishes development from production using environment the
Tauri CLI sets. Run bare, it defaults to development: the dev server URL is
compiled in and the frontend is never embedded, so the binary looks for a Vite
server that is not running. The build script warns about it, but cargo warnings
are easy to miss.

Plain `cargo` is fine for the other crates — it is only `yaz-app` that needs
the CLI.
:::

Both commands run from the repository root, not from `apps/desktop`. The Tauri
configuration lives at `crates/yaz-app/tauri.conf.json`, and the CLI finds it by
searching downward from the working directory.

Platform prerequisites — including the two ARM64 Windows toolchain traps whose
error messages never mention ARM64 — are in
[development setup](/contributing/setup).

## Your first document

1. Click the blue **y** in the corner and choose **Open folder**. Pick a
   directory containing a `.tex` file.
2. Pick a file from the list. `main.tex` is preferred as the entry document, or
   the first `.tex` found.
3. Edit. `Mod+S` saves; the Vim toggle switches keybindings without losing your
   undo history or cursor. Select some text and a formatting bar appears under
   it.
4. **Compile**, from the Work tab of the ribbon. The PDF appears beside your
   source, and clicking in it takes you to the line that produced it.

A compile can produce both errors _and_ a usable PDF — that is normal LaTeX
behaviour, so success is reported from whether a document actually appeared, not
from the compiler's exit status.

[Writing in yaz](/guide/writing) covers the rest: the preview, the three ways of
setting the text, the tabs, the command palette, and how citations and tasks
reach the document.

## What is there

Source and preview modes over one buffer; plain, continuous and page views;
the outline, citations, glossary, tasks, details, history and PDF tabs; the
command palette; version control; themes; German and English; and the six
[bundled plugins](/reference/generated/plugins/) — Zotero, Obsidian, Todoist,
text formats, LaTeX packages and Learn.

## What is not there yet

A new-project wizard, loading a plugin from a directory while developing it, and
the Better BibTeX citation-key tier. Released binaries do not exist; building
from source is the only way to run it.

## Using yaz from a browser

yaz can run on one machine and be used from a browser on another — the
project and the TeX installation stay where they are
([ADR-0030](../adr/0030-a-web-server-hosts-the-same-commands)).

```bash
pnpm web:build:server
./target/release/yaz-web --dist apps/desktop/dist-web --listen 127.0.0.1:4173
```

::: danger There is no login
Whoever can reach the port can read and write files and run the compiler as
you. Listen on loopback and use an SSH forward, or on a VPN address — never on
a public interface. A name other than the listen address has to be allowed
explicitly: `--allow-host my-machine.example.net`.
:::

::: warning A server needs an engine to compile with
`pnpm web:build:server` builds `yaz-web` **without** the embedded Tectonic
engine, as `pnpm app:build` does for the desktop. On a machine with no TeX
installation every compile then answers that this build does not include
Tectonic. Either install a TeX distribution on the server, or build with the
engine:

```bash
pnpm web:build:server:tectonic
```

which is the same build with `--features web,tectonic-engine`
([choosing an engine](engines)).
:::

To cite from the Zotero on your own computer, forward its port over the same
private network and tell the server where it is
([ADR-0008](../adr/0008-zotero-integration)):

```bash
# on the computer Zotero runs on, with its local API switched on
tailscale serve --bg --tcp 23119 tcp://127.0.0.1:23119
# on the server
./target/release/yaz-web --dist apps/desktop/dist-web --zotero my-laptop:23119
```

### The first compile is slow

The embedded engine fetches the TeX files a document needs on first use and
builds its format from them, into `~/.cache/tectonic` of the user the server
runs as. On a machine that has never compiled this takes a few minutes, and
the page says so while it waits; every compile after it is quick, and so is the
first one of another project that needs the same packages.

To have that done before anybody is waiting, compile once as the user the
server runs as, with a document that loads what yours do: open a project in
the server and press **Compile**. The cache is plain files and can be copied to
another machine of the same architecture. A server without network access
cannot fetch what it does not have, so warm it where it can.

### Serving several people

By itself the server asks nobody who they are, so it belongs on an address
only you can reach. For a project several people write, start it with your
organisation's sign-in (any OpenID Connect provider, such as Keycloak) and
name who may come in:

```sh
export YAZ_WEB_OIDC_SECRET=…   # the client's secret, from the provider
./target/release/yaz-web --dist apps/desktop/dist-web \
    --allow-host yaz.example.org \
    --oidc-issuer https://sso.example.org/realms/company \
    --oidc-client-id yaz --public-url https://yaz.example.org \
    --allow ada@example.org --allow writers
```

Register the client at the provider with `https://yaz.example.org/auth/callback`
as its redirect address. `--allow` takes e-mail addresses, user names and
groups.

Once signed in, the title bar shows who you are: your profile picture (the
provider's `picture` claim, if it is an `https` address, which your browser
loads itself) or your initials, and under it a menu with your name, your
e-mail address and **Sign out**. A server started without sign-in shows
neither.

Everybody you let in can open any folder on that machine the user running the
server can read, and do there what that user can. Each browser tab has its own
project open, but yaz has no notion of whose project is whose, and the
preferences and the recently opened list are shared. Sign-in decides who gets
in, not what they see: for a project some of them must not read, run a second server
as a user that cannot read it.

Folders are on the machine yaz runs on, so "Open" asks you to type the path.

An address can name the project to open, which is how another application can
link straight to a document: `https://yaz.example.org/?project=%2Fwork%2Fpaper`
opens the folder `/work/paper` on the server (the path as the server sees it,
URL-encoded) instead of the one the tab had. The page takes the parameter out
of the address once it has tried, so reloading does not return to it. If the
folder cannot be opened you see the usual message and the page starts as it
would have without the link. Following such a link changes the project of that
tab only
([ADR-0034](../adr/0034-a-web-address-can-name-the-project)).

### Writing together

Several people can write in one project at once. Start the server with
`--share`:

```sh
./target/release/yaz-web --dist apps/desktop/dist-web --share
```

Everybody who opens the same folder (`/?project=…`) is then in one session.
Each of them sees the others' carets in the text, with a flag that carries the
name the sign-in gave them (or "Someone" without sign-in) in a colour that is
the same on every screen, and their avatars in the title bar. Typing at the
same moment converges: nobody's paragraph is lost to somebody else's save.

The server keeps one copy of the project's text files and writes them into the
folder a moment after they change, so a compile, Git and an assistant all read
what the editors show. **Save** brings the folder up to date at once, and
records a version if version control is on; there is nothing to switch on for
saving by itself. A compile first asks the server to do the same, and is
refused, with a message, if that does not work.

What is shared are the text files of a LaTeX project (`.tex`, `.bib`, `.cls`,
`.sty`, `.md` and a few more) up to 1 MiB each, not those under `build/` or in
a folder that starts with a dot. A file that is not shared opens read-only
while the project is shared.

A document that is several files opens joined as one, shared or not. What you
type goes to the file it is in, and so does what the others type: somebody who
has a chapter open by itself and somebody who has the whole document open are
writing the same text, and each sees the other's caret where that text is. If
somebody edits an `\include` line that your joined view shows as the chapter it
names, the view is put together again with your caret where it was.

The file list shows a dot in each person's colour on the file they are in, and
a click on somebody's picture in the title bar takes you to their caret. When
somebody compiles, everybody else is told and shown the new PDF; the folder is
one, so the PDF is too. A tab that holds typing the server has not yet received
asks before it is closed.

Another program may write into the folder meanwhile. A file it changes while
nobody is typing in it appears in every editor within a couple of seconds. If
somebody was typing in it, the folder's version wins and what they had is kept
beside it as `name.kept-<time>.tex`; yaz says so, and the copy is yours to read
and delete.

Without `--share` nothing changes: each tab saves whole files, and the last
save wins. A restart of the server ends the session. A page with nothing
unsent joins the new one by itself; a page with unsent typing says so, keeps
the text on screen and does not add it to the new session
([ADR-0035](../adr/0035-whoever-owns-the-folder-hosts-the-session)).
