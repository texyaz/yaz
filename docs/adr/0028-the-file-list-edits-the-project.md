# 0028 — The file list edits the project

- **Status:** Accepted
- **Date:** 2026-08-24
- **Supersedes:** none
- **Amends:** [0025 — Generated lists are tabs](0025-generated-lists-are-tabs)

## Context

The file list was a reader, and a region rather than a tab. Two consequences,
and they turned out to be the same consequence.

**As a region**, it had a pin and a hover-to-open of its own invention. It was
the one part of the window that could not be moved, could not be split against,
and could not be dragged next to the outline by somebody who wanted both. It had
two ways to hide it — the pin, and a View entry — that the rest of the window
knew nothing about. Every pane rule in ADR-0025 applied to everything except the
list of files.

**As a reader**, it disagreed with the folder. Renaming a chapter meant leaving
yaz for Explorer, and coming back to a project whose entry document had moved
under it. A file manager beside the editor is what people actually had open, and
the reason was always the same four operations.

## Decision

**The file list is a tab, and it can change what it lists.**

### 1. A tab like the others

It opens on the left by default, because that is where a file list belongs and
where this one already was. Everything after that is the pane system's:
dragging, splitting, closing, and reopening from View → Tabs. The pin is gone —
closing the tab is what it meant, and there is now one way to do that rather
than two.

This is ADR-0025's rule applied to the last thing that was exempt from it:
a view is a tab, and the shell has no privileged regions except the title bar,
the ribbon and the status bar.

#### The stored arrangement has a version now

Every project stores its pane layout, and none of them mentioned the file list,
because it was not a tab. Read literally, that is "the file list is closed" —
which would have taken it away from every existing project at once and left it
findable only by somebody who thought to look under View.

So a stored layout carries a version. Unversioned means "written before the file
list was a tab", and the list is put back on the left. Versioned means the
arrangement knew about it, and its absence is somebody's decision. Without the
stamp there is no way to tell those apart, and the guess would be wrong for
somebody either way.

### 2. Four operations, and the boundary does not move

Rename, delete, new file, new folder. Every one of them goes through a Tauri
command that resolves the path against the project root before touching
anything — the same guard the reads use, for the same reason (ADR-0006). The
webview composes a _name_; it never composes a permission.

Two specifics worth writing down, because both are the kind of thing that looks
like fussiness until it costs somebody a file:

- **A rename takes a name, not a path.** `rename_entry` accepts the new final
  component and rebuilds the path itself. A rename that accepted a path would be
  a move, and one nobody meant to ask for. The root guard would refuse the
  obvious escapes anyway; this refuses them with an error that says what is
  actually wrong.

- **Windows names are checked before they are used.** A file called `con` cannot
  afterwards be opened, renamed or deleted by ordinary means, and a name ending
  in a space or a dot is silently trimmed into something the caller cannot then
  address. Refusing at creation is the only chance to refuse at all.

### 3. Delete means the recycle bin

This is the load-bearing decision of the four.

A delete on a right-click menu is eventually a delete on the wrong row — not
because anybody is careless, but because a context menu is aimed at rather than
read, and the row under the pointer is not always the row that was intended. The
difference between "get it back from the bin" and "restore last night's backup"
is the difference between five seconds and an afternoon.

So `delete_entry` calls `trash::delete`, which on Windows is the shell's own
file operation — the same one Explorer performs, landing in the same place the
user already knows to look. The confirmation says where the thing went rather
than warning that it cannot be undone, because it can.

The cost is a dependency, and ADR-0014 makes that a real question: `trash` uses
`windows-sys` and builds for `aarch64-pc-windows-msvc`, so it is not an x86-only
path. It is pulled in without default features, which drops `chrono` — that is
there for _listing_ the bin's contents on Linux, and nothing here lists anything.

### 4. A new project is a wizard, not an empty folder

"Open folder" on a folder with nothing in it produced a project with no entry
document, an empty editor, and nothing to compile. The first hour of a LaTeX
project goes on a preamble every project has, and it is where people give up.

The wizard asks the two questions that cannot be guessed — where it goes, and
what kind of document it is — and writes the rest: `images/`, `build/`, and a
`main.tex` that compiles.

**The boilerplate is in Rust**, with the other writes, and for a second reason
beyond the boundary: what a new project contains is a decision about LaTeX, and
the side that knows LaTeX is that one. The kinds offered are the standard
classes only, on the same rule ADR-0023 uses for the preview — yaz cannot know
what is installed without reading the TeX tree, and offering a class that is not
there produces a project that does not compile.

The document is a real one, with a section and a sentence in it. A `main.tex`
holding a `\documentclass` and an empty `document` compiles to a blank page,
which teaches nobody anything and is the first thing they delete.

### 5. Empty folders exist

The tree was built from file paths, so a folder existed only as the prefix of
something inside it. Fine for a reader. Fatal for a file manager: "New folder"
would create one, the project would refresh, and it would be gone — not deleted,
just never visible.

So the scan reports directories alongside files, and the tree places them before
anything is filed into them. The opposite case is unchanged: a folder left empty
_by the filters_ is still dropped, because a `build` folder that survives the
switch that hides build output is the switch not working.

## Consequences

**Good.** The file list is subject to the same rules as everything else, which
is one rule instead of two. The four operations mean a project can be
reorganised without leaving the editor — and renaming the open file follows it
rather than closing it. A new user can get from "installed yaz" to "a document
that compiles" without knowing what a document class is. Building it turned up
the empty-folder gap, which was latent the whole time and would have surfaced
the first time anybody made a folder outside yaz and looked for it inside.

**Bad.** A dependency for the recycle bin, in a security-relevant path. Deleting
is the one operation here with no in-app undo — the bin is the undo, and on a
system where it is disabled there is none. Neither move nor copy is offered: a
rename cannot move a file between folders, which is a deliberate narrowing and
also a real limitation, and drag-and-drop within the tree is the obvious way to
answer it. There is no multi-select, so deleting forty build artefacts is forty
right-clicks or one switch under View.

**Watch.** The wizard's document kinds are a third place that knows the standard
classes — completion has `STANDARD_CLASSES` and the preview has its own view of
what a class means. Those cannot drift far, because LaTeX's list has not changed
in thirty years, but a fifth kind added in one place and not the others is the
shape the mistake would take.
