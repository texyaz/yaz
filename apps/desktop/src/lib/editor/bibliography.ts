/**
 * Which `.bib` a document loads, and what is in it.
 *
 * # Why a citation was always red
 *
 * The preview draws an unknown citation key as unresolved, which is right —
 * a `\cite` to a key no bibliography defines is a citation that will not
 * compile, and saying so early is the point. But the shell never told the
 * editor what the bibliography *said*, so every key was unknown and every
 * citation was red, including the ones that were perfectly fine.
 *
 * # Why the declared name matters more than it looks
 *
 * A document says which file it loads — `\addbibresource{BIMwissT.bib}` — and
 * that name is not a detail. Writing an entry into `references.bib` because
 * that is a sensible default produces a file LaTeX never reads, a key that
 * never resolves, and a citation that stays red with the entry sitting right
 * there on disk. Which is exactly what happened.
 *
 * So the declaration is read from the source, and it is what everything else
 * follows: what to load, and where a new entry goes.
 *
 * # The parser is deliberately small
 *
 * It reads keys and the few fields a citation shows — author, year, title —
 * and ignores the rest. A `.bib` is a big format with `@string` macros,
 * concatenation and cross-references, and none of that changes what a citation
 * draws. What it must not do is *mis-read*: an entry it cannot parse is left
 * out rather than guessed at, because a wrong label on a citation is worse than
 * the key it was drawn as before.
 */

import type { BibEntry } from "./semanticView";

/** A backslash, so the patterns below read as what they are. */
const B = String.fromCharCode(92);

/**
 * The bibliography files a document declares, in the order it declares them.
 *
 * Both spellings, because a document uses one or the other and which depends on
 * whether it is biblatex or BibTeX:
 *
 * - `\addbibresource{a.bib}` — biblatex, one file per call, extension included
 * - `\bibliography{a,b}` — BibTeX, comma-separated, extension omitted
 *
 * The `.bib` is added where it is missing, so a caller gets a filename it can
 * open either way.
 */
export function declaredBibliographies(text: string): string[] {
  const found: string[] = [];

  const add = (name: string): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const withExtension = /\.bib$/i.test(trimmed) ? trimmed : `${trimmed}.bib`;
    if (!found.includes(withExtension)) found.push(withExtension);
  };

  for (const match of text.matchAll(
    new RegExp(
      `${B}${B}addbibresource\\s*(?:\\[[^\\]]*\\])?\\s*\\{([^}]*)\\}`,
      "g",
    ),
  )) {
    if (commented(text, match.index)) continue;
    add(match[1] ?? "");
  }

  for (const match of text.matchAll(
    new RegExp(`${B}${B}bibliography\\s*\\{([^}]*)\\}`, "g"),
  )) {
    if (commented(text, match.index)) continue;
    // `\bibliography{a,b}` loads two files from one command.
    for (const name of (match[1] ?? "").split(",")) add(name);
  }

  return found;
}

/** Whether an offset is inside a comment, judged from its own line. */
function commented(text: string, at: number): boolean {
  const start = text.lastIndexOf("\n", at - 1) + 1;
  for (let cursor = start; cursor < at; cursor += 1) {
    if (text[cursor] === B) {
      cursor += 1;
      continue;
    }
    if (text[cursor] === "%") return true;
  }
  return false;
}

/** Strip the braces and markup a BibTeX field is written with. */
function plain(value: string): string {
  return value
    .replace(/[{}]/g, "")
    .replace(/\\[a-zA-Z]+\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The surname of the first author, which is what a citation shows.
 *
 * BibTeX writes a name either way round — `Meister, Ulrich` or
 * `Ulrich Meister` — and the comma is what says which. An institutional author
 * in braces (`{Deutsches Institut für Normung}`) is one name and is kept whole.
 */
export function firstSurname(authors: string): string {
  const first = authors.split(/\s+and\s+/i)[0] ?? "";
  const cleaned = plain(first);
  if (!cleaned) return "";
  if (first.includes(",")) return plain(first.split(",")[0] ?? "");
  // Braced whole, so it was one institutional name rather than a person.
  if (/^\s*\{/.test(first)) return cleaned;
  const words = cleaned.split(" ");
  return words.length > 1 ? words[words.length - 1]! : cleaned;
}

/** Read one `{...}` or `"..."` field value, and say where it ended. */
function value(
  text: string,
  at: number,
): { text: string; after: number } | null {
  let cursor = at;
  while (/\s/.test(text[cursor] ?? "")) cursor += 1;

  if (text[cursor] === "{") {
    let depth = 0;
    for (let scan = cursor; scan < text.length; scan += 1) {
      if (text[scan] === B) {
        scan += 1;
        continue;
      }
      if (text[scan] === "{") depth += 1;
      else if (text[scan] === "}") {
        depth -= 1;
        if (depth === 0) {
          return { text: text.slice(cursor + 1, scan), after: scan + 1 };
        }
      }
    }
    return null;
  }

  if (text[cursor] === '"') {
    const close = text.indexOf('"', cursor + 1);
    if (close === -1) return null;
    return { text: text.slice(cursor + 1, close), after: close + 1 };
  }

  // A bare value: a year, or a `@string` macro this does not expand.
  const match = /^[^,\s}]+/.exec(text.slice(cursor));
  return match ? { text: match[0], after: cursor + match[0].length } : null;
}

/** The fields of one entry, from just after its key. */
function fields(text: string, from: number): Record<string, string> {
  const found: Record<string, string> = {};
  let cursor = from;
  let depth = 1;

  while (cursor < text.length && depth > 0) {
    const character = text[cursor];
    if (character === B) {
      cursor += 2;
      continue;
    }
    if (character === "{") {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      cursor += 1;
      continue;
    }

    const name = /^([a-zA-Z][a-zA-Z0-9_-]*)\s*=/.exec(text.slice(cursor));
    if (!name) {
      cursor += 1;
      continue;
    }
    const read = value(text, cursor + name[0].length);
    if (!read) {
      cursor += name[0].length;
      continue;
    }
    found[name[1]!.toLowerCase()] = read.text;
    cursor = read.after;
  }

  return found;
}

/**
 * Every entry a `.bib` defines, keyed by its citation key.
 *
 * `@comment`, `@string` and `@preamble` are not entries and are skipped —
 * treating `@string{foo = "bar"}` as a work called `foo` would put a fictional
 * source in the list and make a typo'd citation resolve to it.
 */
export function readBib(text: string): Map<string, BibEntry> {
  const entries = new Map<string, BibEntry>();
  const NOT_ENTRIES = new Set(["comment", "string", "preamble"]);

  for (const match of text.matchAll(/@([a-zA-Z]+)\s*\{\s*([^,\s{}]+)\s*,/g)) {
    const kind = (match[1] ?? "").toLowerCase();
    if (NOT_ENTRIES.has(kind)) continue;
    const key = match[2] ?? "";
    if (!key || entries.has(key)) continue;

    const read = fields(text, match.index + match[0].length);
    const author = firstSurname(read["author"] ?? read["editor"] ?? "");
    // biblatex's `date` is `2025-01`, and the year is the front of it.
    const year = (read["year"] ?? read["date"] ?? "").trim().slice(0, 4);
    const title = plain(read["title"] ?? "");

    // What LaTeX would print, near enough: the reader is checking that the
    // citation points at the work they meant, not proof-reading the style.
    const label = [author, year].filter(Boolean).join(" ") || key;
    const detail = [title, read["journaltitle"] ?? read["journal"] ?? ""]
      .map((part) => plain(part))
      .filter(Boolean)
      .join(" — ");

    entries.set(key, { key, label, detail: detail || key });
  }

  return entries;
}

/**
 * What is wrong with a document's bibliography, when something is.
 *
 * Worked out only when an unresolved citation is clicked, never on a timer:
 * this reads the project directory, and doing that on every keystroke would put
 * the filesystem on the typing path for the sake of a message almost nobody
 * needs to see.
 */
export type BibProblem =
  /** The document declares nothing, and there is a `.bib` sitting there. */
  | { kind: "undeclared"; candidates: string[] }
  /** The document declares a file that is not in the project. */
  | { kind: "missing"; declared: string; candidates: string[] }
  /** Everything is declared and present; the key is simply not in it. */
  | { kind: "absent"; declared: string };

/**
 * Diagnose the bibliography, given what the source says and what is on disk.
 *
 * A pure function over the two lists, so the reasoning is testable without a
 * project: the caller supplies the declarations and the `.bib` files it found.
 */
export function diagnoseBibliography(
  declared: readonly string[],
  present: readonly string[],
): BibProblem {
  const base = (path: string): string =>
    path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const here = new Set(present.map(base));

  if (declared.length === 0) {
    return { kind: "undeclared", candidates: [...present] };
  }

  const absent = declared.filter((name) => !here.has(base(name)));
  if (absent.length > 0) {
    return {
      kind: "missing",
      declared: absent[0]!,
      // What it could have meant instead. A project usually holds one `.bib`,
      // and a declaration that names a file which is not there next to a file
      // that is, is almost always a renamed file.
      candidates: present.filter(
        (name) => !declared.some((d) => base(d) === base(name)),
      ),
    };
  }

  return { kind: "absent", declared: declared[0]! };
}
