/**
 * What the plugin remembers about AI writing, across papers (ADR-0032).
 *
 * Two moments per sentence are worth keeping, not every keystroke:
 *
 * - **inserted** — exactly what the AI wrote, when it wrote it;
 * - **proofed** / **rejected** — what the author made of it.
 *
 * Together they are a before/after pair: how this author rewrites an AI's
 * sentence, or which claims they throw out. The journal lives with the user's
 * configuration, so it stays on this machine and carries to the next paper;
 * the paper repository only ever sees the text itself.
 *
 * Alongside it, in the plugin's settings: the author's style guide, and a
 * guide the AI proposed that waits for the author to accept it.
 */

import type { App } from "@yaz/api";

import { normalise, similarity, type Mark } from "./marks";

export interface Inserted {
  kind: "inserted";
  at: string;
  project: string;
  keys: string[];
  text: string;
}

export interface Verdict {
  kind: "proofed" | "rejected";
  at: string;
  project: string;
  keys: string[];
  /** What the AI wrote, where the journal still has it. */
  ai: string | null;
  /** What the sentence was when the author decided. */
  human: string;
  /** The highlighted passage it rests on, for context. */
  highlight: string | null;
  citationKey: string | null;
}

export type Entry = Inserted | Verdict;

export interface Settings {
  /** The author's style guide, which the AI reads before writing. */
  styleGuide: string;
  /** A guide the AI proposed, waiting for the author. */
  proposedGuide: { text: string; at: string } | null;
  /** Record a git version when a sentence is proofed or rejected. */
  commitOnProof: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  styleGuide: "",
  proposedGuide: null,
  commitOnProof: true,
};

/** The paper's name, as entries record it: the project folder's name. */
export function projectName(app: App): string {
  const root = app.project?.root ?? "";
  return root.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

function sameKeys(a: string[], b: string[]): boolean {
  return [...a].sort().join(",") === [...b].sort().join(",");
}

/**
 * What the AI originally wrote for a mark, if the journal has it.
 *
 * Matched by paper and highlight keys, and among several inserts on the same
 * highlight by which is closest to the sentence as it stands. No id goes into
 * the `.tex` for this: the source is noisy enough with the keys.
 */
export function originalFor(
  entries: readonly Entry[],
  mark: Pick<Mark, "keys" | "body">,
  project: string,
): Inserted | null {
  let best: Inserted | null = null;
  let bestScore = 0;
  for (const entry of entries) {
    if (entry.kind !== "inserted" || entry.project !== project) continue;
    if (!sameKeys(entry.keys, mark.keys)) continue;
    const score = similarity(entry.text, mark.body);
    if (score >= bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

/** Whether the author changed a sentence from what the AI wrote. */
export function wasEdited(original: Inserted | null, body: string): boolean {
  return original !== null && normalise(original.text) !== normalise(body);
}

/**
 * What the AI should learn from: recent rewrites and rejects, newest first.
 *
 * Only pairs where the author actually changed something count as examples;
 * a sentence proofed unchanged says "this was fine", which is worth a count
 * but not a place in a prompt.
 */
export function lessons(entries: readonly Entry[], limit: number) {
  const verdicts = entries.filter(
    (entry): entry is Verdict => entry.kind !== "inserted",
  );
  const rewritten = verdicts
    .filter(
      (entry) =>
        entry.kind === "proofed" &&
        entry.ai !== null &&
        normalise(entry.ai) !== normalise(entry.human),
    )
    .slice(-limit)
    .reverse()
    .map((entry) => ({
      paper: entry.project,
      aiWrote: entry.ai,
      authorMadeIt: entry.human,
    }));
  const rejected = verdicts
    .filter((entry) => entry.kind === "rejected")
    .slice(-limit)
    .reverse()
    .map((entry) => ({
      paper: entry.project,
      aiWrote: entry.ai ?? entry.human,
      highlight: entry.highlight,
    }));
  const acceptedUnchanged = verdicts.filter(
    (entry) =>
      entry.kind === "proofed" &&
      entry.ai !== null &&
      normalise(entry.ai) === normalise(entry.human),
  ).length;
  return { rewritten, rejected, acceptedUnchanged, decided: verdicts.length };
}
