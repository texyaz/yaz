/**
 * The state of AI writing in the open paper, shared by the tab, the commands
 * and the agent tools (ADR-0032).
 *
 * Proofing is an ordinary edit in the one buffer (ADR-0004): `\ai` becomes
 * `\proofed`, undoable like any other change. What makes it more than that is
 * what is recorded alongside — a journal entry with the before and after, and
 * a git version in the author's name — so that "a human checked this" is a
 * fact in the history and the AI can learn how this author writes.
 */

import type { App } from "@yaz/api";

import {
  DEFAULT_SETTINGS,
  lessons,
  originalFor,
  projectName,
  wasEdited,
  type Entry,
  type Settings,
} from "./journal";
import { marks, normalise, type Mark } from "./marks";

/** How a mark stands, as the tab and the agent describe it. */
export type Status = "open" | "edited" | "proofed";

/** Longest excerpt in a version message. */
const SUBJECT_EXCERPT = 60;

export class Writing {
  private cached: Entry[] | null = null;
  private listeners = new Set<() => void>();
  /** Said once per session, not on every proof. */
  private toldNoRepository = false;

  constructor(readonly app: App) {}

  /** Be told when something the tab shows changed outside the buffer. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  async entries(): Promise<Entry[]> {
    this.cached ??= await this.app.journal.read<Entry>(2000);
    return this.cached;
  }

  private async append(entry: Entry): Promise<void> {
    await this.app.journal.append(entry as unknown as Record<string, unknown>);
    (await this.entries()).push(entry);
  }

  async settings(): Promise<Settings> {
    const stored = await this.app.settings.get<Partial<Settings>>();
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    await this.app.settings.set({ ...(await this.settings()), ...patch });
    this.changed();
  }

  /** The marks in the open document, or none. */
  marks(): Mark[] {
    const editor = this.app.editor;
    return editor ? marks(editor.getText()) : [];
  }

  statusOf(mark: Mark, entries: readonly Entry[]): Status {
    if (mark.kind === "proofed") return "proofed";
    const original = originalFor(entries, mark, projectName(this.app));
    return wasEdited(original, mark.body) ? "edited" : "open";
  }

  /** What the AI wrote for a mark, where the journal has it. */
  async original(mark: Mark): Promise<string | null> {
    return (
      originalFor(await this.entries(), mark, projectName(this.app))?.text ??
      null
    );
  }

  async recordInserted(keys: string[], text: string): Promise<void> {
    await this.append({
      kind: "inserted",
      at: new Date().toISOString(),
      project: projectName(this.app),
      keys,
      text,
    });
    this.changed();
  }

  async lessons(limit: number) {
    return lessons(await this.entries(), limit);
  }

  async propose(guide: string): Promise<void> {
    await this.updateSettings({
      proposedGuide: { text: guide, at: new Date().toISOString() },
    });
  }

  /**
   * Find a mark again in the document as it is now.
   *
   * The tab holds offsets from the last time it read the text; the author may
   * have typed since. Same start and same kind is the same mark; otherwise the
   * nearest one with the same keys and body.
   */
  private current(mark: Mark): Mark | null {
    const now = this.marks();
    return (
      now.find((m) => m.from === mark.from && m.kind === mark.kind) ??
      now.find(
        (m) =>
          m.kind === mark.kind &&
          m.keys.join(",") === mark.keys.join(",") &&
          normalise(m.body) === normalise(mark.body),
      ) ??
      null
    );
  }

  /** Select a mark's sentence in the editor. */
  reveal(mark: Mark): void {
    this.app.editor?.revealRange(mark.bodyFrom, mark.bodyTo);
  }

  /** Open the highlight behind a mark in Zotero. */
  async showHighlight(mark: Mark): Promise<void> {
    if (!(await this.app.zotero.revealAnnotation(mark.keys))) {
      this.app.notices.show("ai-notice-highlight-not-in-library", {
        key: mark.keys.join(", "),
      });
    }
  }

  /** The author checked the sentence against its highlight: `\ai` → `\proofed`. */
  async proof(given: Mark): Promise<void> {
    const editor = this.app.editor;
    const mark = this.current(given);
    if (!editor || !mark || mark.kind !== "ai") {
      this.app.notices.show("ai-notice-mark-moved");
      return;
    }
    const ai = await this.original(mark);
    const head = editor.getText().slice(mark.from, mark.from + 3);
    if (head !== "\\ai") {
      this.app.notices.show("ai-notice-mark-moved");
      return;
    }
    editor.replaceRange(mark.from, mark.from + 3, "\\proofed");
    await this.decided("proofed", mark, ai);
  }

  /** The author threw the sentence out. */
  async reject(given: Mark): Promise<void> {
    const editor = this.app.editor;
    const mark = this.current(given);
    if (!editor || !mark) {
      this.app.notices.show("ai-notice-mark-moved");
      return;
    }
    const ai = await this.original(mark);
    const text = editor.getText();
    // Take one neighbouring space with it, so no double space is left behind.
    let from = mark.from;
    let to = mark.to;
    if (text[to] === " ") to++;
    else if (from > 0 && text[from - 1] === " ") from--;
    editor.replaceRange(from, to, "");
    await this.decided("rejected", mark, ai);
  }

  private async decided(
    verdict: "proofed" | "rejected",
    mark: Mark,
    ai: string | null,
  ): Promise<void> {
    let highlight: string | null = null;
    let citationKey: string | null = null;
    try {
      const found = await this.app.zotero.highlight(mark.keys[0] ?? "");
      highlight = found?.text ?? null;
      citationKey = found?.citationKey ?? null;
    } catch {
      /* The journal entry is worth keeping without the passage. */
    }
    await this.append({
      kind: verdict,
      at: new Date().toISOString(),
      project: projectName(this.app),
      keys: mark.keys,
      ai,
      human: mark.body,
      highlight,
      citationKey,
    });
    this.changed();
    if ((await this.settings()).commitOnProof) await this.commit(verdict, mark);
  }

  /** A version in the author's name, naming what they decided. */
  private async commit(
    verdict: "proofed" | "rejected",
    mark: Mark,
  ): Promise<void> {
    const excerpt = normalise(mark.body);
    const short =
      excerpt.length > SUBJECT_EXCERPT
        ? `${excerpt.slice(0, SUBJECT_EXCERPT)}…`
        : excerpt;
    const subject =
      verdict === "proofed"
        ? `Proofed AI sentence: "${short}"`
        : `Rejected AI sentence: "${short}"`;
    const message =
      `${subject}\n\nHighlight: ${mark.keys.join(", ")}\n` +
      (verdict === "proofed"
        ? "Checked against the highlighted source by the author in yaz (ADR-0030).\n"
        : "Removed by the author in yaz (ADR-0030).\n");
    try {
      await this.app.vcs.commitDocument(message);
    } catch (error) {
      // Errors from the Rust side arrive as { messageKey, detail }.
      const failure = error as { messageKey?: string; detail?: string };
      const text = failure?.detail ?? String(error);
      if (failure?.messageKey === "vcs-error-not-initialised") {
        if (!this.toldNoRepository) {
          this.app.notices.show("ai-notice-no-repository");
          this.toldNoRepository = true;
        }
        return;
      }
      this.app.notices.show("ai-notice-commit-failed", { error: text });
    }
  }

  /**
   * The next (or previous) mark still to check, from the cursor, wrapping
   * round. `null` when every mark is proofed.
   */
  async step(direction: 1 | -1): Promise<Mark | null> {
    const editor = this.app.editor;
    if (!editor) return null;
    const entries = await this.entries();
    const open = this.marks().filter(
      (mark) => this.statusOf(mark, entries) !== "proofed",
    );
    if (open.length === 0) return null;
    const cursor = editor.getSelection().from;
    const target =
      direction === 1
        ? (open.find((mark) => mark.bodyFrom > cursor) ?? open[0]!)
        : ([...open].reverse().find((mark) => mark.bodyTo < cursor) ??
          open[open.length - 1]!);
    this.reveal(target);
    return target;
  }

  /** The mark the cursor is in, if any. */
  atCursor(): Mark | null {
    const editor = this.app.editor;
    if (!editor) return null;
    const cursor = editor.getSelection().from;
    return (
      this.marks().find((mark) => mark.from <= cursor && cursor <= mark.to) ??
      null
    );
  }
}
