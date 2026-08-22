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

/**
 * The text with an `\addbibresource` for `name` in it.
 *
 * Replaces the declaration that is already there, or puts one above
 * `\begin{document}` — which is where a preamble command belongs and where
 * biblatex requires it.
 *
 * Here rather than in the component that calls it because the pattern needs a
 * literal backslash, and a regex escape written inline in a `.svelte` file is
 * one nobody can test. Two of them were wrong before this moved.
 */
export function withBibliography(text: string, name: string): string {
  const declaration = `${B}addbibresource{${name}}`;
  const existing = new RegExp(
    `${B}${B}addbibresource\\s*(?:\\[[^\\]]*\\])?\\s*\\{[^}]*\\}`,
  ).exec(text);

  if (existing) {
    return (
      text.slice(0, existing.index) +
      declaration +
      text.slice(existing.index + existing[0].length)
    );
  }

  const begins = text.indexOf(`${B}begin{document}`);
  const at = begins === -1 ? text.length : begins;
  return `${text.slice(0, at)}${declaration}\n\n${text.slice(at)}`;
}

/**
 * Whether this text is the one holding the preamble.
 *
 * Which decides where a fix is written. `\addbibresource` belongs in the
 * preamble and the preamble is in the entry file, but the citation that
 * prompted the fix is usually in a section — so the file the author is looking
 * at is very often the wrong one to edit.
 */
export function ownsPreamble(text: string): boolean {
  return (
    text.includes(`${B}begin{document}`) ||
    new RegExp(`${B}${B}addbibresource`).test(text)
  );
}

/** One work the document cites, and where. */
export interface CitedWork {
  key: string;
  /** What the bibliography calls it, or `null` when nothing defines it. */
  entry: BibEntry | null;
  /** Every offset in the source that cites it, in document order. */
  at: number[];
}

/**
 * Every work the document cites, resolved against the bibliography.
 *
 * Deliberately not a list of `\cite` commands: a work cited eleven times is one
 * source, and a list with eleven rows for it would bury the one cited once that
 * does not resolve. What a reader of this wants is the *works*, and for each,
 * whether it is going to compile.
 *
 * Unresolved first, because those are the ones that need doing something about;
 * within each group, in the order the document first cites them.
 */
export function citedWorks(
  text: string,
  books: ReadonlyMap<string, BibEntry>,
): CitedWork[] {
  const works = new Map<string, CitedWork>();

  // Any citation command, whoever's it is: `\cite` is LaTeX's, `\parencite` is
  // biblatex's, `\citep` is natbib's. Matching the shape rather than a list
  // keeps this from going out of date every time a package is supported.
  const pattern = new RegExp(
    `${B}${B}[a-zA-Z]*cite[a-zA-Z]*\\s*(?:\\[[^\\]]*\\]){0,2}\\s*\\{([^}]*)\\}`,
    "g",
  );

  for (const match of text.matchAll(pattern)) {
    if (commented(text, match.index)) continue;
    for (const raw of (match[1] ?? "").split(",")) {
      const key = raw.trim();
      if (!key) continue;
      const found = works.get(key);
      if (found) {
        found.at.push(match.index);
      } else {
        works.set(key, {
          key,
          entry: books.get(key) ?? null,
          at: [match.index],
        });
      }
    }
  }

  return [...works.values()].sort((left, right) => {
    const resolved = Number(left.entry !== null) - Number(right.entry !== null);
    return resolved !== 0 ? resolved : left.at[0]! - right.at[0]!;
  });
}

/**
 * How a citation prints, as far as it changes what a reader sees.
 *
 * Not a model of biblatex's forty styles — a model of the one distinction that
 * shows in the text. `numeric` prints `[1]` and `authoryear` prints
 * `[Meister 2021]`, and the preview drawing the second while the document is
 * set to the first means the preview disagrees with the PDF about every
 * citation in it.
 */
export type CitationStyle = "numeric" | "authoryear";

/**
 * Which of those the document asks for.
 *
 * `citestyle=` wins over `style=`, because that is what biblatex does: `style=`
 * sets both the bibliography and the citations, and `citestyle=` then overrides
 * the citations on their own.
 *
 * Numeric is biblatex's own default, and it is also what a document that loads
 * no bibliography package at all gets — plain LaTeX's `\cite` prints `[1]`.
 */
export function citationStyle(text: string): CitationStyle {
  const options =
    new RegExp(
      `${B}${B}usepackage\\s*\\[([^\\]]*)\\]\\s*\\{[^}]*biblatex[^}]*\\}`,
      "s",
    ).exec(text)?.[1] ?? "";

  const named =
    /\bcitestyle\s*=\s*([a-zA-Z-]+)/.exec(options)?.[1] ??
    /(?:^|,)\s*style\s*=\s*([a-zA-Z-]+)/.exec(options)?.[1] ??
    "";

  // Everything author-date-ish prints a name and a year; everything else
  // prints a number. A style this does not recognise is treated as numeric,
  // which is biblatex's default and the commoner answer.
  return /^(authoryear|authortitle|apa|mla|chicago|harvard)/i.test(named)
    ? "authoryear"
    : "numeric";
}

/**
 * The number each work will print, in first-citation order.
 *
 * What a numeric style does: the first work cited is `[1]`, whatever its key or
 * its author. Built from the same walk the Citations tab uses, so the two
 * cannot disagree.
 *
 * Only works the bibliography defines are numbered. An unresolved key prints
 * `[?]` in the PDF and is drawn as unresolved here, so giving it a number would
 * be inventing one — and would shift every number after it.
 */
export function numberCitations(
  works: readonly CitedWork[],
): Map<string, number> {
  const numbered = [...works]
    .filter((work) => work.entry !== null)
    .sort((left, right) => left.at[0]! - right.at[0]!);
  return new Map(numbered.map((work, index) => [work.key, index + 1]));
}
