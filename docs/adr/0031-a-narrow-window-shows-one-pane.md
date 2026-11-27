# 0031 — A narrow window shows one pane

- **Status:** Accepted
- **Date:** 2026-11-17
- **Supersedes:** none
- **Amends:** [0030 — A web server hosts the same commands](0030-a-web-server-hosts-the-same-commands)

## Context

Since [ADR-0030](0030-a-web-server-hosts-the-same-commands) yaz can be opened
on a phone, and on a phone it could not be used. The workspace is a tree of
splits, sized for a desk: at 390 px the file list, the editor and the PDF each
got a column a few words wide, the ribbon ran off the side with its Compile
button, and the status bar was cut mid-word.

What somebody does on a phone is also narrower than what they do at a desk.
They read, they fix a sentence, they check how a page came out. They write in
the preview, because raw LaTeX on a five-inch screen is mostly backslashes.

## Decision

**Below 720 px the workspace is three panes in a row, one on screen: how you
get around, the editor, the PDF.**

- The row is a scroll container with snap points. **The swipe is the
  browser's scroll, not a gesture recogniser**, so it tracks the finger at the
  display's rate and a pane that scrolls sideways itself keeps its drag until
  it runs out.
- The first pane holds the outline, the files and the search results, and
  whichever other tab was last asked for. Nothing is "open" or "closed" here:
  asking for a tab goes to it.
- A bar along the bottom names the three panes, switches preview and source,
  and compiles. It replaces the status bar, whose contents do not fit.
- The ribbon is across the top, one row, and **shut until a tab is tapped**.
  Its strip scrolls sideways with its own buttons pinned at the end.
- The editor starts in the preview.
- **None of it is stored.** Which pane, whether the ribbon is open and whether
  the preview is on are the session's. The desktop arrangement belongs to the
  project and the desktop preferences to the user; picking up the phone must
  not change what the desk looks like.
- It is a width, not a device and not a host: a desktop window dragged narrow
  gets the same layout, and no component asks whether it is on the web.
- A reloaded tab reopens the project it had, from session storage. A phone
  discards background tabs, and without this, answering a message costs the
  open project. A fresh start — a new tab, or the application launched — is
  still an empty one.

## Consequences

- The editor is still one component drawn once ([ADR-0004](0004-editor-core-codemirror-single-buffer)):
  the narrow layout renders the same tab snippet the tree does. Crossing the
  720 px line remounts it, with the buffer kept by the application.
- Splitting, dragging tabs and resizing do not exist below the line. That is
  the point, and also a loss on a tablet held upright.
- Commands that open a tab had to learn to go to it: a second thing to
  remember when adding one. `showTab` is the one place that knows.
- A sideways drag that starts on a horizontally scrolled table or a zoomed
  page scrolls that first. Correct, and occasionally surprising.
- The breakpoint is written in five places — once in script, four times in
  CSS — because a media query cannot read a custom property.

## Alternatives considered

- **Squeezing the tree** — the same splits, smaller. This is what there was.
- **A gesture library for the swipe.** More control over thresholds, and a
  JavaScript handler on every touch move in the same thread as the editor
  ([ADR-0015](0015-performance-budgets)). The browser already does this.
- **Edge drawers over the editor**, as most phone applications have. The
  outline suits a drawer; the PDF does not — it is not a side panel of the
  document, it is the document.
- **Storing the narrow state with the preferences.** Then the last device
  used decides how the next one starts, which is wrong in both directions.
