/**
 * AI writing as a white box (ADR-0030, ADR-0031, ADR-0032).
 *
 * - The **AI writing** tab lists every AI sentence with the passage it rests
 *   on, and the author proofs or rejects each one.
 * - Commands step through the sentences still to check, and proof or reject
 *   the one under the cursor — reachable from the palette and a hotkey.
 * - Agent tools let an AI write only as `\ai[HIGHLIGHT]{…}`, and read how
 *   this author rewrites AI sentences before it writes the next one.
 *
 * Highlights come from the Zotero plugin's library through the public API;
 * this plugin never writes to Zotero (ADR-0008).
 */

import { Plugin } from "@yaz/api";

import { agentTools } from "./agent";
import { WRITING_STYLE } from "./style";
import { mountWritingView } from "./view";
import { Writing } from "./writing";

export default class AiWritingPlugin extends Plugin {
  onload(): void {
    const writing = new Writing(this.app);

    this.app.workspace.registerView(
      "writing",
      (container) => mountWritingView(writing, container),
      { titleKey: "ai-tab-title" },
    );

    const hasEditor = () => this.app.editor !== null;
    this.addCommand({
      id: "next",
      nameKey: "ai-command-next",
      descriptionKey: "ai-command-next-description",
      defaultHotkey: "Alt+.",
      isAvailable: hasEditor,
      callback: async () => {
        if (!(await writing.step(1))) this.app.notices.show("ai-notice-all-proofed");
      },
    });
    this.addCommand({
      id: "previous",
      nameKey: "ai-command-previous",
      descriptionKey: "ai-command-previous-description",
      defaultHotkey: "Alt+,",
      isAvailable: hasEditor,
      callback: async () => {
        if (!(await writing.step(-1))) this.app.notices.show("ai-notice-all-proofed");
      },
    });
    this.addCommand({
      id: "proof",
      nameKey: "ai-command-proof",
      descriptionKey: "ai-command-proof-description",
      isAvailable: hasEditor,
      callback: async () => {
        const mark = writing.atCursor();
        if (!mark || mark.kind !== "ai") {
          this.app.notices.show("ai-notice-no-mark-here");
          return;
        }
        await writing.proof(mark);
      },
    });
    this.addCommand({
      id: "reject",
      nameKey: "ai-command-reject",
      descriptionKey: "ai-command-reject-description",
      isAvailable: hasEditor,
      callback: async () => {
        const mark = writing.atCursor();
        if (!mark || mark.kind !== "ai") {
          this.app.notices.show("ai-notice-no-mark-here");
          return;
        }
        await writing.reject(mark);
      },
    });

    for (const tool of agentTools(writing)) this.registerTool(tool);

    styleOnce();
  }
}

/** The tab's stylesheet, added once. */
function styleOnce(): void {
  const id = "yaz-ai-style";
  if (document.getElementById(id)) return;
  const sheet = document.createElement("style");
  sheet.id = id;
  sheet.textContent = WRITING_STYLE;
  document.head.append(sheet);
}
