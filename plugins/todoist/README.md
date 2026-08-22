# yaz-todoist

Keep a paper's task list in Todoist, and see it beside the writing.

Writing a paper is three jobs and yaz is good at one of them. Zotero manages the
sources, Todoist manages what is left to do, and yaz manages the writing — so
this plugin is a **bridge**. It does not add a task list to yaz; it shows one
that lives in Todoist and lets you add to it without leaving the document.

## What it does

| | |
| --- | --- |
| Sign in | A personal API token, kept in your system keychain — **Settings → Plugins → Todoist** |
| Link a paper | Choose a Todoist project, or create one — **Connections → Todoist** in the ribbon |
| See the list | In the **Tasks** tab, beside the editor |
| Add a task | From the tab, or from the selected text with a command |
| Tick one off | The checkbox in the tab |

**Two settings in two places, because they are two different things.** The token
is per install — one sign-in serves every paper on this machine — so it lives in
the plugin's own settings panel. The list a paper uses is per project, so it
lives under Connections and is stored in that project's own `yaz.toml`, where it
travels with the paper rather than being re-made on every machine. A thesis and
a conference paper are different work with different lists.

## Where the token lives

In the operating system's credential store — Windows Credential Manager, the
macOS Keychain, or the Secret Service on Linux. Never in a configuration file,
which would put it in every backup and every synced folder.

**This plugin cannot read it.** It says which request to make and yaz attaches
the token in the Rust process, against `api.todoist.com` and no other host. See
[ADR-0026](https://generalpawz.github.io/yaz/adr/0026-task-providers-and-credentials).

Forgetting a token removes it from this computer. It does **not** revoke it —
only Todoist can do that, in its own settings.

## Roadmap

- **OAuth instead of a pasted token.** The better sign-in, and a real feature:
  a loopback listener, a registered client, and a round trip through the system
  browser. A personal token is a copy and a paste and is exactly as revocable,
  so it is what this starts with.
- **Due dates and priorities when adding.** Reading them already works; setting
  them from yaz means a date picker, and Todoist's own natural-language date
  parsing may be the better answer than one.
- **Sections and sub-tasks.** A long paper's list has structure, and a flat
  list of forty things is a list nobody reads.
- **A task from a citation or a figure.** "Chase the DIN 277 page number" knows
  which citation it came from; a link back to that spot in the document would
  make the tab a way around the paper rather than only a list.

## Not planned

- **Being a task manager.** If Todoist is not open, yaz does not keep a shadow
  copy or queue writes for later. A bridge that silently diverged from the
  thing it bridges to would be worse than one that says it cannot reach it.

## Licence

MIT. The application is AGPL-3.0, but its plugin API is MIT and so is this, so
that anyone can copy it as a starting point without inheriting a licence they
did not choose.
