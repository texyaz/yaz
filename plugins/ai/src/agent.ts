/**
 * Tools an AI agent can call through yaz's MCP server (ADR-0022, ADR-0031,
 * ADR-0032).
 *
 * The agent finds sources and highlights through the Zotero plugin's tools,
 * and writes through these: only as `\ai[HIGHLIGHT]{…}`, each sentence tied
 * to the passage it rests on and visibly not yet checked. Before writing it
 * can read how this author rewrites AI sentences — their style guide and
 * their recent edits, from every paper — and it can propose a better guide,
 * which waits for the author to accept it.
 *
 * What is enforced where:
 *
 * - **Rust** (the boundary, ADR-0006): no argument to any tool may contain
 *   `\proofed`, and a tool declared `"writes": true` in the manifest is refused
 *   until the author has allowed writing under Connections → AI.
 * - **Here**: the inserted text is wrapped by this code, never by the agent;
 *   every highlight key must exist in the library; the text may not carry
 *   markers of its own.
 */

import type { App } from "@yaz/api";

import {
  balanced,
  highlightKeys,
  isAnnotationKey,
  lineOf,
  marks,
} from "./marks";
import type { Writing } from "./writing";

/** Longest text one call may insert: a paragraph, not a chapter. */
const MAX_TEXT = 4000;

/** Longest style guide the agent may propose. */
const MAX_GUIDE = 6000;

/** A tool, in the shape `registerTool` takes. */
interface AgentTool {
  name: string;
  descriptionKey: string;
  schema?: Record<string, unknown>;
  run(args: Record<string, unknown>): Promise<unknown>;
}

function text(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`"${name}" is required and must be text`);
  }
  return value;
}

function editorOf(app: App) {
  const editor = app.editor;
  if (!editor) {
    throw new Error("no document is open in yaz; ask the author to open it");
  }
  return editor;
}

export function agentTools(writing: Writing): AgentTool[] {
  const { app } = writing;
  return [
    {
      name: "insert_ai_text",
      descriptionKey: "ai-tool-insert-ai-text",
      schema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description:
              "LaTeX for one or a few sentences, with their \\cite{…}. Without any \\ai or \\proofed: yaz wraps it.",
          },
          highlightKeys: {
            type: "array",
            items: { type: "string" },
            description:
              "Zotero annotation keys of the highlights that back the text (at least one).",
          },
          after: {
            type: "string",
            description:
              "Exact text in the document to insert after; must occur exactly once. Omit to insert at the author's cursor.",
          },
        },
        required: ["text", "highlightKeys"],
      },
      async run(args) {
        const body = text(args, "text").trim();
        if (body.length > MAX_TEXT) {
          throw new Error(
            `the text is longer than ${MAX_TEXT} characters; insert it in parts`,
          );
        }
        if (/\\(ai|proofed)(?![A-Za-z])/.test(body)) {
          throw new Error(
            "the text must not contain \\ai or \\proofed; yaz adds the \\ai marker itself",
          );
        }
        if (!balanced(body)) {
          throw new Error("the braces in the text do not pair up");
        }
        const keys = highlightKeys(args.highlightKeys);
        if (keys.length === 0) {
          throw new Error(
            "at least one highlight key is required: every AI sentence rests on a passage",
          );
        }
        const malformed = keys.filter((key) => !isAnnotationKey(key));
        if (malformed.length > 0) {
          throw new Error(`not Zotero annotation keys: ${malformed.join(", ")}`);
        }
        const found = await Promise.all(
          keys.map((key) => app.zotero.highlight(key)),
        );
        const missing = keys.filter((_, i) => found[i] === null);
        if (missing.length > 0) {
          throw new Error(
            `no highlight with these keys in the author's library (yet): ${missing.join(", ")}. ` +
              "A highlight made a moment ago reaches yaz once Zotero has synced it.",
          );
        }

        const editor = editorOf(app);
        const document = editor.getText();
        let at = editor.getSelection().from;
        if (typeof args.after === "string" && args.after !== "") {
          const first = document.indexOf(args.after);
          if (first < 0) throw new Error('"after" does not occur in the document');
          if (document.indexOf(args.after, first + 1) >= 0) {
            throw new Error(
              '"after" occurs more than once; give a longer, unique passage',
            );
          }
          at = first + args.after.length;
        }
        const before = at > 0 ? document[at - 1] : "\n";
        const gap = before === undefined || /\s/.test(before) ? "" : " ";
        const marked = `${gap}\\ai[${keys.join(",")}]{${body}}`;
        editor.replaceRange(at, at, marked);
        editor.revealRange(at + gap.length, at + marked.length);
        // What the AI wrote, exactly, so the author's edit can be compared
        // with it when they proof the sentence.
        await writing.recordInserted(keys, body);
        return {
          inserted: marked.trim(),
          line: lineOf(document, at),
          note: "Inserted as \\ai: the author checks it against the highlight in the AI writing tab and marks it \\proofed.",
        };
      },
    },
    {
      name: "list_ai_marks",
      descriptionKey: "ai-tool-list-ai-marks",
      schema: { type: "object", properties: {} },
      async run() {
        const document = editorOf(app).getText();
        const entries = await writing.entries();
        return marks(document).map((mark) => ({
          status: writing.statusOf(mark, entries),
          highlightKeys: mark.keys,
          line: lineOf(document, mark.from),
          text: mark.body.length > 400 ? `${mark.body.slice(0, 400)}…` : mark.body,
        }));
      },
    },
    {
      name: "writing_style",
      descriptionKey: "ai-tool-writing-style",
      schema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "At most this many examples of each kind (default 20).",
          },
        },
      },
      async run(args) {
        const limit = Math.min(Math.max(Number(args.limit ?? 20) || 20, 1), 100);
        const settings = await writing.settings();
        return {
          styleGuide: settings.styleGuide || null,
          ...(await writing.lessons(limit)),
          note:
            "Read before writing. 'rewritten' shows how this author changed AI sentences they kept; " +
            "'rejected' shows sentences they deleted, often claims the highlight did not support. " +
            "Write the way the author rewrites, not the way the AI first wrote.",
        };
      },
    },
    {
      name: "propose_style_guide",
      descriptionKey: "ai-tool-propose-style-guide",
      schema: {
        type: "object",
        properties: {
          guide: {
            type: "string",
            description:
              "A complete style guide in short rules, distilled from writing_style. Replaces the current one once the author accepts it.",
          },
        },
        required: ["guide"],
      },
      async run(args) {
        const guide = text(args, "guide").trim();
        if (guide.length > MAX_GUIDE) {
          throw new Error(`the guide is longer than ${MAX_GUIDE} characters`);
        }
        await writing.propose(guide);
        return {
          note: "Proposed. The author sees it in the AI writing tab and accepts or dismisses it; until then the current guide stays in force.",
        };
      },
    },
  ];
}
