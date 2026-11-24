# 0031 — An AI agent connects through MCP, and writes only marked text

- **Status:** Proposed
- **Date:** 2026-11-23
- **Supersedes:** none
- **Amends:** [0022 — MCP and tool declaration](0022-mcp-and-tool-declaration)
  (tools may write, declared as such),
  [0030 — White-box AI writing](0030-white-box-ai-writing)

## Context

ADR-0030 gave AI-written sentences a mark, `\ai[HIGHLIGHT]{…}`, that ties each
one to the Zotero highlight it rests on and that only a human turns into
`\proofed[…]{…}`. That settles what the text looks like. It does not settle how
the AI gets into yaz in the first place.

The tempting answer is an "AI" section where a user signs in to their AI
subscription and yaz calls the model itself. It does not hold up:

- **A consumer subscription is not an API.** Claude Pro/Max cannot be signed
  in to from a third-party application; programmatic use needs an API key,
  billed per use. The place a subscription _does_ work is the vendor's own
  agent — Claude Code — which is exactly the kind of client yaz's MCP server
  (ADR-0022) was built for.
- **The model is not the interesting part.** What yaz knows and the agent
  does not is the open paper, the cursor, the library copy and the highlights.
  That is what to expose; which model reads it should be the user's choice.
- **The white box needs rules the agent cannot argue with.** "Never write
  `\proofed`" and "write nothing until allowed" are worthless as instructions
  in a prompt. They have to be refusals in the process that holds the
  boundary — Rust (ADR-0006).

ADR-0022 deliberately left every _writing_ tool out, "to be taken on purpose".
This is that decision.

## Decision

### 1. Connect, don't embed

**Connections → AI** has two buttons:

- **Connect AI agent** starts the MCP server and writes the paper folder's
  `.mcp.json` with the address and token. An agent started in that folder —
  Claude Code on the user's own subscription, or any MCP client — finds this
  window with no setup. The file is owner-only, listed in
  `.git/info/exclude` so the token is never committed, and removed again on
  **Disconnect**.
- **Allow AI to write** / **Stop AI from writing.** Off at every start.
  Reading is allowed as soon as the agent is connected; changing the paper is
  a second, separate yes.

There is no tool that grants permission; only the window can.

### 2. Tools say whether they write, in the manifest

`provides.tools[].writes: true` (default `false`). Rust reads the flag from the
manifest when the plugin loads and overwrites whatever the webview reports, so
a plugin cannot under-declare at runtime.

### 3. Rules held in Rust, for every plugin tool

Before any plugin tool runs:

- **No argument may contain `\proofed`** — anywhere, in any tool, including
  ones added later. Only a human marks a sentence checked (ADR-0030).
- **A writing tool is refused unless writing is allowed.**

### 4. The tools

The Zotero plugin's (library) and, since ADR-0032, the AI writing plugin's
(`com.yaz.ai`, writing):

| Tool                  | Plugin | Writes | What it does                                                  |
| --------------------- | ------ | ------ | ------------------------------------------------------------- |
| `search_library`      | zotero | no     | Sources by title, author, year, with item and citation keys   |
| `list_highlights`     | zotero | no     | A source's highlights: key, passage, comment, page, AI-made   |
| `add_to_bibliography` | zotero | yes    | Put a source into the paper's `.bib`, return its citation key |
| `insert_ai_text`      | ai     | yes    | Insert text, which **yaz** wraps as `\ai[KEYS]{…}`            |
| `list_ai_marks`       | ai     | no     | Every `\ai` / `\proofed` in the paper, with status and line   |
| `writing_style`       | ai     | no     | The author's style guide and recent rewrites (ADR-0032)       |
| `propose_style_guide` | ai     | no     | A guide the author accepts or dismisses in yaz (ADR-0032)     |

`insert_ai_text` refuses text that carries `\ai` or `\proofed` itself, text
with unbalanced braces, and any highlight key that is not an annotation in the
library: every AI sentence must rest on a passage that exists. It inserts at
the author's cursor, or after a passage the agent names that occurs exactly
once. It goes into the editor buffer (ADR-0004), so it is undoable and the
author sees it appear.

### 5. Creating highlights stays outside yaz

yaz still only reads Zotero (ADR-0008). Highlights are created by a separate
tool through the Zotero Web API (planned: `zotero-quellen`), connected to the
same agent as its own MCP server. The agent reads the PDFs from Zotero's
storage folder — on one machine that is `storage/` beside `zotero.sqlite`.

### 6. Not now: an API key in yaz

For people without an agent of their own, the same AI group could later take
an API key (stored as a credential, ADR-0026) and run a small built-in agent
over the same tools under the same rules. Nothing in this design has to change
for it.

## Consequences

- The author's own subscription is used the way the vendor allows, and yaz
  ships no model, no prompt and no AI dependency.
- The white-box guarantees do not depend on the agent behaving: `\proofed` and
  unpermitted writes are refused in Rust whatever the prompt says.
- A token lands on disk in the paper folder while connected. It is owner-only,
  git-excluded and short-lived (a new one at every start), but a folder synced
  elsewhere (Syncthing, a cloud drive) would carry it.
- An agent started _before_ connecting, or after yaz restarts, needs to
  reconnect, because the port and token change.
- Highlights created a moment ago are not usable until Zotero has synced them
  into yaz's library copy; `insert_ai_text` says so rather than guessing.

## Alternatives considered

- **Sign in with the subscription inside yaz.** Not offered by the vendor for
  third-party applications; would also make yaz an AI product with a model
  dependency.
- **API key only.** Works, but makes every user pay per use even when they
  already have an agent; kept as the later option in §6.
- **Let the agent write the `.tex` on disk.** Bypasses the buffer: the open
  editor would not notice, the next save would overwrite it, and there would be
  no undo. Writing through the editor keeps ADR-0004's one buffer.
- **Enforce the rules in the plugin.** The webview is not the boundary
  (ADR-0006); a rule a plugin can skip is a convention.

## Open questions

1. Should the token file go somewhere outside the paper folder (e.g. a
   per-user config dir, with the agent pointed at it), to stay out of synced
   folders?
2. Should "Allow AI to write" be remembered per paper (in `yaz.toml`) or stay
   a per-session switch as now?
3. ~~Should the AI tools live in the Zotero plugin, or in a plugin of their
   own?~~ Decided in ADR-0032: their own, `yaz-ai`.
