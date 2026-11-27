# 0030 — A web server hosts the same commands

- **Status:** Accepted
- **Date:** 2026-11-16
- **Supersedes:** none
- **Amends:** [0002 — Application shell](0002-application-shell-tauri),
  [0006 — Plugin runtime and capabilities](0006-plugin-runtime-and-capabilities)

## Context

yaz is a desktop application, and the project and the TeX installation are on
the machine it runs on. That is the wrong machine often enough to matter: the
thesis lives on a workstation or a VM, with the compiler, the bibliography and
the build cache, and the writing happens on a laptop that has none of them.

The frontend could already be opened in a browser — `pnpm web:dev` serves it —
but it could do nothing there. Every file read, every compile and every plugin
call goes through Tauri's IPC, and a browser tab has no Rust process behind it.

Two things make this hard rather than tedious:

- There are about seventy-five commands. A second implementation of them is a
  second place for each one to be wrong, and it would be wrong first for the
  commands nobody uses over the web.
- The Rust process is the security boundary ([ADR-0006](0006-plugin-runtime-and-capabilities)).
  On the desktop the only thing that can reach it is yaz's own window. A server
  is reachable by whatever can open a socket to it.

## Decision

**There is a second host for the command surface, `yaz-web`, and it serves the
same handler the desktop application registers.**

- `yaz-app` is a library with two binaries. `yaz_app::install` attaches the
  state and the command list to a Tauri builder; the desktop binary calls it on
  the real runtime and `yaz-web` calls it on Tauri's **mock runtime**, which
  has a command handler and no window. A request to
  `POST /api/invoke/<command>` is handed to that handler as an IPC message.
  There is one list of commands, and one copy of how an argument is decoded.
- The frontend is the same source. A build in `web` mode aliases the four Tauri
  modules it imports — `core`, `event`, `window`, `plugin-dialog` — to files in
  `apps/desktop/src/web/`. No component asks which host it is in, and the
  desktop bundle contains none of it.
- `yaz-web` is behind the `web` cargo feature. A desktop build compiles neither
  an HTTP server nor the mock runtime.
- **The server authenticates nobody, and says so.** It listens on loopback
  unless given an address, refuses a `Host` it was not started for (DNS
  rebinding), and refuses an API request without a header another origin
  cannot send without a preflight (cross-site requests). Reaching the port is
  equivalent to a shell as the user who started it; it belongs on an address
  only that user can reach, such as a VPN interface or loopback behind SSH.
- It serves **one user**. The plugin host, the preferences and the recent-
  projects list are process state, as they are on the desktop, and two people
  on one server share them. **The open project is not**: each command takes
  the root it works on, and the page holds which one it has open, so two
  browser tabs keep two projects ([ADR-0034](0034-a-web-address-can-name-the-project)).

## Consequences

- A command added to `install` works over the web without anybody thinking
  about the web. This is the property the design was chosen for.
- `yaz-web` links Tauri, so building it needs Tauri's system libraries even
  though it never opens a window. On Linux that is WebKitGTK's development
  package on a machine with no display.
- It depends on `tauri::test`, an API Tauri publishes for testing. It is public
  and documented, but it was not written to be a server, and an upgrade of
  Tauri has to be checked against it.
- Bytes cross as JSON arrays of numbers, as they do on the desktop. Over a
  network that is four times the size of the PDF before compression. The
  server compresses responses; a binary path is the obvious next step and is
  not taken here.
- **Nothing travels from Rust to the page.** The one event yaz emits — an
  agent calling a plugin's MCP tool — is not delivered, so that call fails
  with a timeout. Core MCP tools are unaffected.
- A folder is chosen by typing its path, because the browser's file picker
  browses the wrong machine. Recent projects make this a once-per-project cost.
- The OS keychain may not exist on a headless server, in which case storing a
  plugin credential fails with the error the keychain gives
  ([ADR-0026](0026-task-providers-and-credentials)). It is not worked around:
  a token in a file is what that record forbids.
- The window buttons are not drawn in a tab.

## Alternatives considered

- **A second, hand-written dispatcher** — a `match` from command name to
  function. Rejected for the reason in the context: seventy-five arms that
  must each repeat Tauri's argument decoding, kept in step by hand.
- **Moving the commands out of `yaz-app` into a crate without Tauri.** The
  right shape eventually, and it removes the system-library cost. It is a
  rewrite of every command signature and of the security-critical plugin
  host, to get a server that behaves identically to this one. Not now.
- **Streaming the desktop window** (a virtual display and a VNC client in the
  page). No code, and every feature works. But the keystroke crosses the
  network before it reaches the editor, which is exactly what
  [ADR-0015](0015-performance-budgets) exists to prevent; here the buffer
  stays in the browser and only saves and compiles cross.
- **Authentication in the server.** A password over plain HTTP protects less
  than it appears to, and TLS in this binary is a certificate-management
  feature nobody asked for. The network is the right layer, so the server
  refuses to pretend otherwise.
