# 0034 — A web address can name the project to open

- **Status:** Proposed
- **Date:** 2026-11-27
- **Supersedes:** —
- **Amends:** [0030 — A web server hosts the same commands](0030-a-web-server-hosts-the-same-commands)

## Context

A yaz served to a browser ([ADR-0030](0030-a-web-server-hosts-the-same-commands))
starts on the project the tab had open, or on none. Another application that
holds a link to a document cannot say which project it belongs to, so the
person who follows it has to type the folder's path into the picker first.

## Decision

**The address may name the folder to open: `/?project=<path>`**, the path
absolute and as the server sees it, URL-encoded (`/?project=%2Fwork%2Fpaper`).
This is the web build only; the desktop build has no address to follow.

- At start-up, after the preferences are read, the page opens that folder
  **instead of** the one the tab remembered, through the same `open_project`
  command the picker uses.
- Once it has tried, the page takes `project` out of the address
  (`history.replaceState`, so Back does not return to it). A reload, or a
  project opened from the page later, is then not overridden.
- If the folder cannot be opened the page shows the error a failed open always
  shows and **starts as it would have without the parameter**: on the project
  the tab remembered, if any. The error stays on screen.
- The parameter survives sign-in
  ([ADR-0033](0033-the-web-server-can-ask-who-is-there)): the server sends a
  person without a session to `/auth/login?next=<path and query>` and, once
  they are back, to `next`, so the link is followed after the provider.

## Consequences

- **It opens nothing a person could not already open.** The server restricts no
  roots: `open_project` takes any directory the user running the server can
  read, whether the path is typed into the picker or arrives in an address,
  and both go through the same command. Signed in or not, a link is a way to
  type the path, not a way past a check. If the server ever limits which
  roots may be opened, the limit belongs in `open_project`, where the address
  and the picker are both covered.
- **Following a link changes the server's open project.** The open project and
  the plugin host are process state ([ADR-0033](0033-the-web-server-can-ask-who-is-there)),
  so a signed-in person who follows a link switches it for everybody who
  shares the server, exactly as choosing the folder themselves would. A page
  on another site can send a person to such a link. It can name only a
  folder the server can open and it reads nothing, but it can move the
  shared project under the people working in it. Nothing here prevents that;
  a server whose people must not be moved by a link is one whose project
  should not be shared.
- Nothing tells the link's author whether the folder opened. A link that does
  not work shows the error to whoever followed it, on the project they had.
- Without sign-in the same holds for anybody who can reach the port, who could
  already do everything else.

## Alternatives considered

- **A path relative to a configured projects folder.** It would let the server
  refuse everything outside it, and it is the version to build if roots are
  ever restricted. Today there is no such setting, and adding one is a feature
  of its own.
- **A route such as `/open/<path>`.** The same information in a worse place:
  the page is one document served at one address, and the parameter leaves the
  address as soon as it has been read.
- **Keeping the parameter in the address.** Simpler, and wrong: a reload after
  the person switched project would switch back.
