/**
 * The white-box marks in a document, and how two versions of a sentence
 * differ (ADR-0030, ADR-0032).
 *
 * Pure functions over text: no editor, no library. The Zotero plugin has its
 * own copy of the parser for jumping to a highlight; plugins do not import
 * each other, because each is its own repository (ADR-0021).
 */

/** One `\ai[…]{…}` or `\proofed[…]{…}` in a document. */
export interface Mark {
  kind: "ai" | "proofed";
  keys: string[];
  /** Offset of the backslash. */
  from: number;
  /** Offset just past the closing brace. */
  to: number;
  /** Offset of the first character inside the braces. */
  bodyFrom: number;
  /** Offset of the closing brace. */
  bodyTo: number;
  /** What is inside the braces. */
  body: string;
}

/** Index of the `}` closing the `{` at `open`, or `null` if it is not closed. */
export function matchingBrace(text: string, open: number): number | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return null;
}

/** Whether `{` and `}` pair up, with `\{` and `\}` not counting. */
export function balanced(source: string): boolean {
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth < 0) return false;
  }
  return depth === 0;
}

/** Whether `key` has the shape of a Zotero key: eight of A–Z and 0–9. */
export function isAnnotationKey(key: string): boolean {
  return /^[A-Z0-9]{8}$/.test(key);
}

/** Whether an offset is on a line that LaTeX ignores (after an unescaped `%`). */
function commentedOut(text: string, offset: number): boolean {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  for (let i = lineStart; i < offset; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "%") return true;
  }
  return false;
}

/**
 * Every white-box mark in a document, in order.
 *
 * A mark that is never closed is skipped rather than guessed at, and so is
 * one in a comment: it is not in the paper. Read when the tab asks, debounced
 * — never on the keystroke path (ADR-0015, ADR-0027).
 */
export function marks(text: string): Mark[] {
  const found: Mark[] = [];
  const pattern = /\\(ai|proofed)\s*\[([^\]]*)\]\s*\{/g;
  for (const match of text.matchAll(pattern)) {
    if (commentedOut(text, match.index)) continue;
    const open = match.index + match[0].length - 1;
    const close = matchingBrace(text, open);
    if (close === null) continue;
    found.push({
      kind: match[1] as "ai" | "proofed",
      keys: match[2]!
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean),
      from: match.index,
      to: close + 1,
      bodyFrom: open + 1,
      bodyTo: close,
      body: text.slice(open + 1, close),
    });
  }
  return found;
}

/**
 * The highlight keys an agent sent, as a list.
 *
 * Agents do not all send what the schema says: an array arrives as an array,
 * or as a JSON string of one, or as "A, B". All three mean the same keys.
 */
export function highlightKeys(given: unknown): string[] {
  let list: unknown[] = [];
  if (Array.isArray(given)) list = given;
  else if (typeof given === "string") {
    const trimmed = given.trim();
    try {
      const parsed: unknown = JSON.parse(trimmed);
      list = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      list = trimmed.split(/[\s,]+/);
    }
  }
  return [...new Set(list.map((key) => String(key).trim()).filter(Boolean))];
}

/** Line number (one-based) of an offset. */
export function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

/** Whitespace collapsed, so a re-wrapped sentence is the same sentence. */
export function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** One run of a word diff. */
export interface DiffPart {
  kind: "same" | "removed" | "added";
  text: string;
}

/**
 * How `after` differs from `before`, word by word.
 *
 * A longest common subsequence over words: enough for a sentence or a
 * paragraph, which is all a mark holds. Whitespace changes are not changes.
 */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = normalise(before).split(" ").filter(Boolean);
  const b = normalise(after).split(" ").filter(Boolean);
  // Long inputs are compared as a whole rather than spending n·m on them.
  if (a.length * b.length > 250_000) {
    return [
      { kind: "removed", text: a.join(" ") },
      { kind: "added", text: b.join(" ") },
    ];
  }
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], word: string) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += ` ${word}`;
    else parts.push({ kind, text: word });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]!);
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      push("removed", a[i++]!);
    } else {
      push("added", b[j++]!);
    }
  }
  while (i < a.length) push("removed", a[i++]!);
  while (j < b.length) push("added", b[j++]!);
  return parts;
}

/** Share of words two texts have in common, 0 to 1. */
export function similarity(before: string, after: string): number {
  const parts = wordDiff(before, after);
  const count = (kind: DiffPart["kind"]) =>
    parts
      .filter((part) => part.kind === kind)
      .reduce((sum, part) => sum + part.text.split(" ").length, 0);
  const same = count("same");
  const total = same + Math.max(count("removed"), count("added"));
  return total === 0 ? 1 : same / total;
}
