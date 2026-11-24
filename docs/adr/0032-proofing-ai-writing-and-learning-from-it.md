# 0032 — Proofing AI writing happens in a tab, and what the author changes is remembered

- **Status:** Proposed
- **Date:** 2026-11-24
- **Supersedes:** none
- **Amends:** [0030 — White-box AI writing](0030-white-box-ai-writing) (§4,
  the tab), [0031 — An agent writes only marked text](0031-an-agent-writes-only-marked-text)
  (where the writing tools live)

## Context

ADR-0030 put a mark on every AI-written sentence and ADR-0031 let an agent
write them. What was missing is the author's half: going through the marked
sentences, checking each against its highlight, and deciding. ADR-0030 §4
sketched a tab for it.

Two more wishes came with it:

- **"Checked by a human" should be a fact in git**, not only a word in the
  `.tex` — saved the moment the author decides, without them having to commit
  by hand.
- **The AI should learn from the author's edits.** When the author rewrites
  "a significant share" as "27 %", the next sentence should come out closer to
  how they write — in this paper and the next.

Committing on every keystroke would give a history nobody can read and diffs
made of re-wrapped lines. Training a model on the author's text is neither
possible with a subscription nor wanted. Both wishes come down to keeping the
right two moments.

## Decision

### 1. A plugin of its own: `yaz-ai` (`com.yaz.ai`)

Resolves ADR-0031's open question 3. The AI group is not Zotero's: the Zotero
plugin keeps the library tools (`search_library`, `list_highlights`,
`add_to_bibliography`) and offers **Show in Zotero** on cited works; the new
plugin owns the writing tools (`insert_ai_text`, `list_ai_marks`), the tab and
the journal. It reads highlights through the public `app.zotero` API and never
writes to Zotero (ADR-0008). It ships in-tree under `plugins/ai` until it gets
its own repository (ADR-0021), as `todoist` does.

### 2. The **AI writing** tab

Every `\ai` and `\proofed` in the open document, in reading order, with:

- a progress count and filters _to check / edited by you / proofed / all_;
- per sentence, on selection: the highlighted passage, page and source, the
  AI's comment, and — when the author changed the sentence — a word diff
  against what the AI wrote;
- **Show in Zotero**, **Proof ✓** (`\ai` → `\proofed`), **Reject ✗** (delete
  the sentence); Previous/Next step through what is still to check.

Proof and Reject are ordinary edits in the one buffer (ADR-0004), so Ctrl+Z
undoes them. The same four actions are commands (palette; `Alt+.` / `Alt+,`
step), because a browser in between swallows some shortcuts. The tab re-reads
the document debounced, never on the keystroke path (ADR-0015).

### 3. Two moments are recorded, not every keystroke

- **When the agent inserts** a sentence, the plugin appends what it wrote,
  exactly.
- **When the author proofs or rejects** it, the plugin appends the sentence as
  it now stands, the verdict, and the passage it rests on.

The pair is matched by paper and highlight keys, and among several inserts on
one highlight by word similarity — no id is added to the `.tex`, which is noisy
enough already.

### 4. The journal stays on the author's computer, and spans papers

New public API, `app.journal` (`append`, `read`): lines of JSON per plugin in
yaz's configuration directory (`journals/<plugin-id>.jsonl`), namespaced like
settings, entries at most 64 KiB. It is never committed or synced by yaz.
Because it is not per project, what the AI learns from one paper carries to the
next.

### 5. A git version at each decision, in the author's name

New public API, `app.vcs` (`commitDocument`, `commit`), behind a new capability
**`vcs`**. Rust checks it, then commits **only the named files** (a pathspec
commit, `git commit -- <paths>`), so unrelated work in progress stays out of a
version whose message does not describe it. It refuses paths outside the
project and projects without a repository — creating one is the author's
decision under Version history. Hooks run, including the paper's `commit-msg`
hook (ADR-0030). Messages read
`Proofed AI sentence: "<excerpt>"` / `Rejected AI sentence: "<excerpt>"` with
the highlight keys in the body. A setting in the tab switches this off.

### 6. How the AI "learns": examples and a guide the author approves

No model is trained. Two tools give the agent context before it writes:

- **`writing_style`** returns the author's style guide and their recent
  rewrites (AI text → author text) and rejects, from every paper.
- **`propose_style_guide`** lets the agent distil those into short rules. The
  proposal waits in the tab; it takes effect only when the author accepts it.
  The author can also edit the guide by hand.

Both live in the plugin's settings and journal, so the author can read exactly
what the AI is told.

### 7. Right-click actions on cited works

New public API, `Plugin.registerCitationAction({ id, labelKey, isAvailable?,
run })`. The Citations tab stays core and knows no reference manager; plugins
add entries to a work's right-click menu, shown greyed out when
`isAvailable` says no. The Zotero plugin adds **Show in Zotero**.

## Consequences

- Checking AI text is one place with the evidence beside the sentence; most
  claims can be checked without opening the PDF.
- The paper's git history records who checked what and when, one small commit
  per decision. A busy session produces many commits; that is the record, and
  it can be switched off.
- A pathspec commit of `main.tex` includes the author's other edits _in that
  file_ since the last commit. The journal, not the diff, is the precise pair.
- What the AI learns stays on one machine. A second machine starts empty
  unless the author copies the journal.
- `\ai` text written by an agent started before this plugin existed has no
  journal entry; it shows as _open_ and its proof records `ai: null`.

## Alternatives considered

- **Commit on every save or keystroke.** Unreadable history, and the before
  of an AI sentence is lost among edits.
- **The journal in the paper repository.** Rejected by the author: it would
  share their editing with every co-author, and would not carry to the next
  paper.
- **An id in each mark (`\ai[KEY|id]{…}`).** Exact matching, at the price of
  more noise in every sentence; similarity matching has been enough.
- **Fine-tuning a model on the pairs.** Not available on a subscription, opaque
  to the author, and unnecessary at this scale: a handful of examples and a
  short guide in context do the job and can be read.

## Open questions

1. Should the journal be exportable/importable, for a second machine?
2. Should the tab show marks from all files of a joined project, or only the
   open document?
3. Should the `vcs` commit offer to batch decisions (one commit per tab
   session) for people who find one per sentence too many?
