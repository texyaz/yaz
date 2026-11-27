# 0035 — Whoever owns the folder hosts the session

- **Status:** Proposed
- **Date:** 2026-11-27
- **Supersedes:** —
- **Amends:** [0004 — Editor core](0004-editor-core-codemirror-single-buffer),
  [0020 — Stitched multi-file editing](0020-stitched-multi-file-editing),
  [0026 — Task providers and credentials](0026-task-providers-and-credentials),
  [0030 — A web server hosts the same commands](0030-a-web-server-hosts-the-same-commands),
  [0033 — The web server can ask who is there](0033-the-web-server-can-ask-who-is-there)

## Context

Several people write one document. With sign-in
([ADR-0033](0033-the-web-server-can-ask-who-is-there)) they can all reach one
`yaz-web`, and then each page holds its own copy of a file and saves it whole:
the last save wins and the others' paragraphs are gone, with nothing saying so.
Two compiles of the same folder run into the same `build/` at once.

A collaboration server exists in its own repository. It merges Yjs documents
over a WebSocket, keeps each project's state on disk and checks one token per
project. No yaz ever connected to it: it reads the token from a request header
a browser cannot set, and nothing in yaz speaks its protocol.

Four things make this hard rather than a matter of adding a library:

- **The folder has other writers.** The TeX engine reads it, Git reads and
  rewrites it, and other programs write `.tex` files into it while people
  type. A merged document that lives only in memory is one the compiler
  cannot see, and a folder written by several pages is one in which nobody
  can tell a stale save from somebody else's change.
- **The buffer is not a file.** In stitched mode
  ([ADR-0020](0020-stitched-multi-file-editing)) one buffer holds several
  files, the `\include` lines are in the files and not in the buffer, and an
  edit at a seam belongs to a file by a rule. A binding that maps one shared
  text to one editor document cannot describe that.
- **A token must not reach the page.**
  [ADR-0026](0026-task-providers-and-credentials) says so for plugins, and a
  web page is read by everybody who signs in.
- **The desktop application has to be able to join later**, from its own
  machine and its own copy of the folder, and to keep working on a train.

## Decision

**The process that owns a project's folder hosts that project's session.** It
keeps a replica of the shared document, it is the only thing that writes the
shared text into the folder, and it passes changes between its own pages and,
if one is configured, a collaboration server. On a server that process is
`yaz-web`; on a desktop it is the application.

- **One shared document per project.** A map `files` from project-relative
  path to a shared text, with `\n` line endings, and a map `meta` with the
  schema number and an epoch. Shared are the text files of a LaTeX project by
  extension, valid UTF-8 and no larger than 1 MiB, outside `build/` and
  dot-folders; `yaz.toml` never is. Pictures and PDFs are not in it.
- **A file enters the document whole, as a new map entry**, never by typing
  its content into an empty text. Two hosts that seed the same file then end
  with one copy, not two.
- **A page never writes a shared file.** Its editor is bound to the shared
  texts; the host writes them into the folder shortly after they change, one
  atomic write per file, holding a lock per folder that a compile and a
  recorded version also take. A file that is not shared opens read-only while
  a session is on.
- **Every other writer is an outside writer, and the folder wins.** The host
  remembers a digest of what it last wrote. A file that changed on disk while
  the session's text did not is taken into the session as an edit. If both
  changed, the session's text is first written beside the file as
  `<name>.kept-<time>.<ext>`, then the file is taken in, and every page is
  told. Nothing waits for a choice, and no text is dropped.
- **The page's connection ends at its own yaz.** In the web build that is a
  WebSocket to the server the page came from, let through by the session
  cookie and by an `Origin` that matches the `Host`; on the desktop it is the
  application's own channel. It carries the Yjs sync and awareness messages
  and one more kind, from the host only, that says what state the session is
  in and what happened to the folder.
- **The collaboration server is optional, and only a host talks to it**, over
  one connection per project, with a token that lives in the environment of
  `yaz-web` or in the operating system's keychain. `yaz.toml` names the room,
  `[collaboration] project = "<uuid>"`, and may name the server; it never
  holds a secret, and a token is only ever sent to the address it was stored
  with.
- **A session that uses a server starts only after one complete exchange with
  it.** A host that seeded a room it could not see would fork it.
- **The binding is yaz's own, over the segment map.** A local change goes to
  the shared texts through the same mapping the editor judges it by. A remote
  change arrives as a transaction that carries its own moved map, is marked
  remote and is kept out of the undo history, so undo stays CodeMirror's and
  undoes one's own typing. A remote change to text the stitched buffer does
  not contain, the `\include` lines, re-stitches the document.
- **Presence is awareness.** A page says who it is (a name, a picture address,
  an id derived from the sign-in), which file its caret is in and where,
  relative to that file's text. Others draw it as a layer over the editor, in
  one of eight theme colours that every page computes the same way, in the
  file list and in the title bar.
- **Saving means bringing the folder up to date now**, and recording a version
  if version control is on. Autosave has nothing to do in a session. A compile
  flushes first, with what the page has seen, and is refused if the folder
  cannot be brought there.
- `yaz-web --share` turns this on for every project that server opens.
  Without it nothing changes.

## Consequences

- Three people can type in the same file on one server and see each other,
  with no second program running. The collaboration server is needed for
  people on other machines and for a session to outlive a restart of
  `yaz-web`.
- The compiler, Git and an assistant writing files all see one folder that is
  at most a second or so behind the editors, and a compile sees exactly what
  its author saw.
- **yaz now contains a second implementation of the Yjs room**, in Rust, next
  to the server's. The two have to agree byte for byte, and fixtures in both
  directions are what says they do.
- **Something now travels from Rust to the page.** ADR-0030 said nothing did;
  this is one WebSocket, for sessions, and not a general event channel.
- **ADR-0020's shell copy of the files is not used in a session.** The shared
  texts are the files' content, and the editor's map says where they are on
  screen.
- A remote edit of an `\include` line replaces the buffer, and the local undo
  history goes with it.
- An outside change that collides with typing leaves a `.kept-` file in the
  project. It is in the file list and in `git status`, and somebody has to
  read it and delete it.
- Between reading a file and replacing it there is a moment in which an
  outside writer can still be overwritten. A lock the other program does not
  take cannot close it.
- Without a collaboration server a restart of `yaz-web` ends every session.
  Pages with nothing unsent rejoin on their own; a page with unsent typing
  says so and keeps the text on screen.
- Every page holds the whole project's text and its editing history in
  memory. That suits a paper; a very large project will want the files loaded
  one at a time.
- Who somebody is in a session is what their page says. Among people who
  already share a shell on the server (ADR-0033) that is not a boundary, and
  it must not be read as one.
- A name and a picture address now reach the other pages and, with a server,
  the server. The e-mail address does not.
- The first secret that is yaz's own, and not a plugin's, goes into the
  keychain under the same rule ADR-0026 set for plugins.
- Dependencies: `yrs` in Rust, `yjs`, `y-protocols` and `lib0` in the page.
  All are pure Rust or JavaScript ([ADR-0014](0014-target-platforms-and-arm64)),
  and the page loads its three only when a session starts.

## Alternatives considered

- **`yaz-web` forwards each page's socket to the collaboration server and
  adds the token.** The least code. The folder would then be written from a
  copy that arrives by way of the server, sharing would stop whenever the
  server did, and a desktop that has to save offline needs a replica of its
  own anyway.
- **No replica in Rust: ask the server for a snapshot and write that.** It
  keeps every line of CRDT code in JavaScript. An outside change would then
  have to be taken in by the server, so the rule for the folder would live in
  two repositories, and a write whose path came from another machine would be
  checked outside the process that is the security boundary
  ([ADR-0006](0006-plugin-runtime-and-capabilities)).
- **Pages write the folder, as they do now.** Their texts converge, their
  saves do not: a late save of an older state looks exactly like an outside
  change.
- **Give the page a token.** It would be in the memory of a page everybody
  signed in can read, and the server would need a second way to check it.
- **`y-codemirror.next`.** It binds one shared text to one document, and the
  stitched buffer is many texts with gaps.
- **Yjs's own undo manager.** Vim's `u`, the menu and the keyboard all call
  CodeMirror's undo, which already steps over changes that are not one's own.
- **One shared document per file.** Many rooms or a protocol to carry them
  over one socket, which the server does not have, and no single moment at
  which the whole project can be read.
- **Stop and ask when the folder and the session disagree.** Until somebody
  answers, the compiler builds text that is not in the editor.
