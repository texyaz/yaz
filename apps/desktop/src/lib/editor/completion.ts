/**
 * What to suggest, and when.
 *
 * # Why this is a module and not an editor extension
 *
 * Deciding *whether* somebody is typing a command, *which* command's argument
 * they are inside, and *what* the candidates are is arithmetic over a string and
 * a position. Arithmetic that decides what appears under somebody's cursor is
 * worth being able to ask directly, rather than by driving an editor and reading
 * the DOM. The extension in `completions.ts` is the surface; this is the part
 * that can be wrong.
 *
 * # Triggers are syntax, not word characters
 *
 * VS Code fires on every word character because JavaScript gives it no marker.
 * LaTeX gives us unambiguous ones: `\` begins a command, and `{` after a known
 * command begins an argument of a known kind. Firing anywhere else would pop a
 * list up in the middle of a sentence, which is the behaviour people switch off
 * ([ADR-0027](https://texyaz.github.io/yaz/adr/0027-completion-while-typing)).
 *
 * # Nothing here scans on every keystroke
 *
 * The functions that read the whole document — {@link labelsIn} — are called
 * when a trigger fires, not when the text changes. The decoration pass already
 * walks the buffer once per keystroke and is the budget's hot spot; a second
 * walk costs more than everything else in it put together.
 */

/** A backslash, so the patterns below read as what they are. */
const B = String.fromCharCode(92);

/** What kind of thing an argument wants. */
export type ArgumentKind =
  | "label"
  | "citation"
  | "glossary"
  | "environment"
  | "image"
  | "file"
  | "package"
  | "class";

/** Somebody is typing something completable. */
export interface Trigger {
  /** A command name after a backslash, or an argument inside braces. */
  kind: "command" | "argument";
  /** Which kind of argument, when it is one. */
  argument?: ArgumentKind;
  /** The command whose argument this is, for the detail line. */
  command?: string;
  /** Where the typed part starts, so a completion knows what it replaces. */
  from: number;
  /** What has been typed so far. */
  query: string;
}

/**
 * Which commands take an argument worth completing, and what kind.
 *
 * A second place that knows `\cite` takes a citation key — the vocabulary
 * registry is the first. ADR-0027 records why that is tolerated for now and
 * what the right fix is.
 */
const ARGUMENTS: Record<string, ArgumentKind> = {
  // Cross-references. `cref` and `Cref` are cleveref's; they are here because
  // what they *take* is a label whether or not that package is loaded.
  ref: "label",
  eqref: "label",
  pageref: "label",
  autoref: "label",
  nameref: "label",
  cref: "label",
  Cref: "label",
  vref: "label",

  // Citations, in every spelling the common packages give them.
  cite: "citation",
  citep: "citation",
  citet: "citation",
  citeauthor: "citation",
  citeyear: "citation",
  parencite: "citation",
  textcite: "citation",
  footcite: "citation",
  autocite: "citation",
  nocite: "citation",

  // Glossaries.
  gls: "glossary",
  Gls: "glossary",
  glspl: "glossary",
  Glspl: "glossary",
  acrshort: "glossary",
  acrlong: "glossary",
  acrfull: "glossary",
  glsentrytext: "glossary",

  begin: "environment",
  end: "environment",
  includegraphics: "image",
  input: "file",
  include: "file",
  usepackage: "package",
  RequirePackage: "package",
  documentclass: "class",
};

/**
 * How far back to look for the command an argument belongs to.
 *
 * Long enough for `\includegraphics[width=0.8\textwidth]{`, short enough that a
 * `{` in the middle of a paragraph does not go hunting up the page. A brace
 * whose command is further away than this is not one this can help with.
 */
const REACH = 120;

/**
 * What is being typed at `at`, or `null` if it is not worth offering anything.
 *
 * `null` is the common answer and costs almost nothing: prose is not a trigger.
 */
export function triggerAt(text: string, at: number): Trigger | null {
  return commandTrigger(text, at) ?? argumentTrigger(text, at);
}

/** A command name being typed after a backslash. */
function commandTrigger(text: string, at: number): Trigger | null {
  let start = at;
  while (start > 0 && /[a-zA-Z]/.test(text[start - 1] ?? "")) start -= 1;
  if (start === 0 || text[start - 1] !== B) return null;

  // `\\` is a line break, not the start of a command name.
  if (text[start - 2] === B) return null;

  return { kind: "command", from: start, query: text.slice(start, at) };
}

/** An argument being typed inside the braces of a command that takes one. */
function argumentTrigger(text: string, at: number): Trigger | null {
  // Back to the opening brace, refusing to cross one that has been closed —
  // otherwise a `{` far above would claim a caret that is not inside anything.
  let open = -1;
  let depth = 0;
  const floor = Math.max(0, at - REACH);
  for (let index = at - 1; index >= floor; index -= 1) {
    const character = text[index];
    if (character === "\n" && depth === 0) break;
    if (character === "}") depth += 1;
    else if (character === "{") {
      if (depth === 0) {
        open = index;
        break;
      }
      depth -= 1;
    }
  }
  if (open === -1) return null;

  // The command name immediately before the brace, skipping an optional
  // `[...]` — `\includegraphics[width=...]{` is the ordinary shape.
  let cursor = open;
  if (text[cursor - 1] === "]") {
    const bracket = text.lastIndexOf("[", cursor - 1);
    if (bracket === -1 || bracket < floor) return null;
    cursor = bracket;
  }

  let start = cursor;
  while (start > 0 && /[a-zA-Z]/.test(text[start - 1] ?? "")) start -= 1;
  if (start === cursor || text[start - 1] !== B) return null;

  const command = text.slice(start, cursor);
  const argument = ARGUMENTS[command];
  if (!argument) return null;

  const query = text.slice(open + 1, at);
  // A comma separates several keys in one `\cite{a,b}`, so the last one is what
  // is being typed. Anything else with a brace in it is not a key at all.
  const comma = query.lastIndexOf(",");
  if (query.includes("{") || query.includes("}")) return null;

  return {
    kind: "argument",
    argument,
    command,
    from: open + 1 + comma + 1,
    query: query.slice(comma + 1),
  };
}

/** One thing that can be offered. */
export interface Suggestion {
  /** What is inserted. */
  label: string;
  /** The right-hand column: what it is, or where it came from. */
  detail?: string | undefined;
  /** The longer explanation, shown beside the list. */
  info?: string | undefined;
  /** Sorts above the rest, for the handful that are usually what is wanted. */
  boost?: number | undefined;
}

/**
 * Every `\label{...}` in the text.
 *
 * A regular expression rather than the structure parser, because this is one
 * question — where are the labels — and running the whole parser to answer it
 * would be the second document walk ADR-0027 forbids. It runs on a trigger, not
 * on a change.
 *
 * Labels inside a comment are skipped: `% \label{old}` is not a label, and
 * offering it sends somebody to a reference that will not resolve.
 */
export function labelsIn(text: string): Suggestion[] {
  const found: Suggestion[] = [];
  const seen = new Set<string>();

  const pattern = new RegExp(`${B}${B}label${B}s*{([^}]*)}`, "g");
  for (const match of text.matchAll(pattern)) {
    const key = (match[1] ?? "").trim();
    if (!key || seen.has(key)) continue;
    if (commented(text, match.index ?? 0)) continue;
    seen.add(key);

    found.push({
      label: key,
      // What the label is attached to, which is what tells `fig:ablauf` from
      // `tab:ablauf` at a glance.
      detail: kindOfLabel(key),
    });
  }
  return found;
}

/** Whether an offset is inside a comment — a `%` earlier on the same line. */
function commented(text: string, at: number): boolean {
  const start = text.lastIndexOf("\n", at) + 1;
  for (let index = start; index < at; index += 1) {
    if (text[index] === "%" && text[index - 1] !== B) return true;
  }
  return false;
}

/** What a label's prefix says it names, by the convention everybody uses. */
function kindOfLabel(key: string): string | undefined {
  const prefix = key.split(":")[0];
  if (!prefix || prefix === key) return undefined;
  return prefix;
}

/**
 * The commands the vocabulary does not list, because it does not need to.
 *
 * The vocabulary registry answers "how is this drawn", and the preview draws
 * sectioning, environments and list items from the document's *structure*
 * rather than by looking a name up — so `\\section` is not in it. That is right
 * for the preview and wrong for completion, which is a list of what somebody
 * might type, and `\\section` is close to the top of it.
 *
 * Found by a test: `\\sec` offered nothing at all.
 *
 * Only the kernel's. Anything a package adds arrives through the vocabulary,
 * which is where a plugin declares it (ADR-0023).
 */
export const STRUCTURAL_COMMANDS = [
  // Sectioning, drawn from the heading parser.
  "part",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "paragraph",
  "subparagraph",

  // Environments and their items.
  "begin",
  "end",
  "item",

  // The preamble.
  "documentclass",
  "usepackage",

  // The title block, drawn from the frontmatter rather than per command.
  "title",
  "author",
  "date",
  "maketitle",

  // Floats and what fills them.
  "caption",
  "includegraphics",

  // The files a document is made of.
  "input",
  "include",
  "bibliography",
  "addbibresource",
];

/** The document classes LaTeX itself has. */
export const STANDARD_CLASSES = [
  "article",
  "report",
  "book",
  "letter",
  "beamer",
];

/**
 * Rank and cut a list of candidates against what has been typed.
 *
 * A prefix match sorts above a match anywhere, because that is what somebody
 * typing three letters means. Beyond that the order is left alone: the sources
 * hand these over already sorted, and re-sorting a thousand entries per
 * keystroke is the kind of cost that does not show up until a real library.
 */
export function rank(
  candidates: readonly Suggestion[],
  query: string,
  limit = 50,
): Suggestion[] {
  if (query === "") return candidates.slice(0, limit);

  const wanted = query.toLowerCase();
  const starts: Suggestion[] = [];
  const contains: Suggestion[] = [];

  for (const candidate of candidates) {
    const label = candidate.label.toLowerCase();
    if (label.startsWith(wanted)) starts.push(candidate);
    else if (label.includes(wanted)) contains.push(candidate);
    // Stop as soon as there is more than anybody will read. The list is
    // already sorted, so the ones dropped are the ones further down it.
    if (starts.length >= limit) break;
  }

  return [...starts, ...contains].slice(0, limit);
}
