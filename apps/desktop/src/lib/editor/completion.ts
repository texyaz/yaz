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
  /** The *kind* of thing being referred to: `sec`, `fig`, `tab`. */
  | "labelKind"
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
 * How much text behind the caret {@link triggerAt} needs to see.
 *
 * Everything it does looks backwards and stops at {@link REACH}, so a caller
 * holding a large document can hand over a window of this size instead of the
 * whole thing. That matters: deciding "this is prose, offer nothing" is the
 * answer on almost every keystroke, and it should not cost a copy of the
 * thesis to arrive at (ADR-0027).
 *
 * Two characters more than the reach, because the check for `\\` — a line
 * break rather than the start of a command — reads one character further back
 * than the name it rejects.
 */
export const LOOKBEHIND = REACH + 2;

/**
 * What is being typed at `at`, or `null` if it is not worth offering anything.
 *
 * `null` is the common answer and costs almost nothing: prose is not a trigger.
 */
export function triggerAt(text: string, at: number): Trigger | null {
  return commandTrigger(text, at) ?? argumentTrigger(text, at);
}

/**
 * A command name being typed after a backslash.
 *
 * Not on the bare backslash. There are hundreds of commands and the first
 * screenful of them alphabetically is no use to anybody — a list that appears
 * saying `ac`, `acrfull`, `acrlong` the moment you press `\\` is a list you
 * dismiss rather than read. One letter cuts it to something worth looking at.
 */
function commandTrigger(text: string, at: number): Trigger | null {
  let start = at;
  while (start > 0 && /[a-zA-Z]/.test(text[start - 1] ?? "")) start -= 1;
  if (start === 0 || text[start - 1] !== B) return null;

  // `\\` is a line break, not the start of a command name.
  if (text[start - 2] === B) return null;

  const query = text.slice(start, at);
  if (query === "") return null;

  return { kind: "command", from: start, query };
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

  const typed = query.slice(comma + 1);
  const from = open + 1 + comma + 1;

  // A reference is asked in two steps. `\ref{` on its own offers the *kinds*
  // of thing that can be referred to — a section, a figure, a table — because
  // "which of the forty labels" is a question nobody can answer from a list,
  // and "am I referring to a section or a figure" is one everybody can. Once
  // the colon is there, the labels of that kind arrive.
  if (argument === "label") {
    const colon = typed.indexOf(":");
    if (colon === -1) {
      return {
        kind: "argument",
        argument: "labelKind",
        command,
        from,
        query: typed,
      };
    }
    return { kind: "argument", argument: "label", command, from, query: typed };
  }

  return { kind: "argument", argument, command, from, query: typed };
}

/** One thing that can be offered. */
export interface Suggestion {
  /** What is inserted, and what typing is matched against. */
  label: string;
  /**
   * What is shown, where that differs from what is inserted.
   *
   * A citation key is a handle rather than a name — `spielbauer2020` tells
   * nobody which of four books it is — so the list reads "Spielbauer 2020" and
   * the document still gets the key. Matching stays on the label, because
   * somebody typing `spiel` means the key.
   */
  display?: string | undefined;
  /**
   * Whether choosing this should ask the next question straight away.
   *
   * A label prefix is half an answer: picking "Section" means `sec:` and then
   * the very list that could not usefully have been shown before. Closing the
   * tooltip there would make the two-step feel like an obstacle rather than a
   * narrowing.
   */
  reopen?: boolean | undefined;
  /**
   * What to insert instead of the label, as a CodeMirror snippet.
   *
   * Where a command is worth more than its name: `\section` arrives with its
   * `\label` beneath it and the two linked, so typing the title fills the key.
   * See {@link SNIPPETS}.
   */
  snippet?: string | undefined;
  /** The right-hand column: what it is, or where it came from. */
  detail?: string | undefined;
  /** The longer explanation, shown beside the list. */
  info?: string | undefined;
  /** Sorts above the rest, for the handful that are usually what is wanted. */
  boost?: number | undefined;
}

/**
 * The prefixes a label conventionally carries, and what each one names.
 *
 * `\ref{` on its own offers these rather than every label in the document,
 * because "which of the forty labels" is a question nobody can answer from a
 * list and "am I referring to a section or a figure" is one everybody can. The
 * labels themselves arrive once the colon is typed.
 *
 * The list is the convention rather than a rule: a document may label anything
 * anything, and one that does still gets its labels offered — they simply
 * arrive under whatever prefix it used.
 */
export const LABEL_PREFIXES: { prefix: string; kindKey: string }[] = [
  { prefix: "sec", kindKey: "completion-label-section" },
  { prefix: "fig", kindKey: "completion-label-figure" },
  { prefix: "tab", kindKey: "completion-label-table" },
  { prefix: "eq", kindKey: "completion-label-equation" },
  { prefix: "ch", kindKey: "completion-label-chapter" },
  { prefix: "app", kindKey: "completion-label-appendix" },
  { prefix: "lst", kindKey: "completion-label-listing" },
];

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
export function labelsIn(
  text: string,
  named: ReadonlyMap<number, string> = new Map(),
): Suggestion[] {
  // Document order, which for sections is numeric order — 2 before 10, which
  // sorting the *text* "10" against "2" gets backwards. It falls out of walking
  // the text rather than being arranged afterwards: the labels are found in the
  // order they appear, and the order they appear is the order they are
  // numbered.
  const found: Suggestion[] = [];
  const seen = new Set<string>();

  const pattern = new RegExp(`${B}${B}label${B}s*{([^}]*)}`, "g");
  for (const match of text.matchAll(pattern)) {
    const key = (match[1] ?? "").trim();
    if (!key || seen.has(key)) continue;
    const at = match.index ?? 0;
    if (commented(text, at)) continue;
    seen.add(key);

    const names = nearest(named, at);
    found.push({
      label: key,
      // The heading itself is what the row reads as — "3.2 Kosten" — with the
      // number first because that is where it goes when LaTeX prints it and
      // where somebody scanning a numbered list expects to find it. It used to
      // be the second column, which put the number in the middle of the row
      // with the key on one side of it and the title on the other.
      //
      // The key is still what gets inserted, and still what typing is matched
      // against, so `kosten` finds it.
      ...(names ? { display: names } : {}),
      // The key moves to the quiet column once the title has the loud one.
      // Where there is no title — a label on something yaz cannot name — the
      // kind goes there instead and the key stays in front, which is all there
      // is to say about it.
      detail: names ? key : kindOfLabel(key),
    });
  }
  return found;
}

/**
 * What the nearest thing above an offset is called.
 *
 * A `\\label` follows whatever it labels, so the last entry at or before it is
 * the one it names. Linear rather than a search: the map is small — one entry
 * per heading and caption — and building an index of it would cost more than
 * walking it.
 */
function nearest(
  named: ReadonlyMap<number, string>,
  at: number,
): string | undefined {
  let best: string | undefined;
  let bestAt = -1;
  for (const [where, title] of named) {
    if (where <= at && where > bestAt) {
      bestAt = where;
      best = title;
    }
  }
  return best;
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
/**
 * What a command expands to, where it is worth more than its own name.
 *
 * # Why a sectioning command brings its label
 *
 * A `\section` without a `\label` is a section nothing can refer to, and the
 * moment somebody wants to refer to it they have to go back, invent a key, and
 * hope they remember the convention they used in chapter two. Writing the
 * label at the same time costs nothing and removes that entirely — which is
 * why every LaTeX house style says to do it and nobody does.
 *
 * # The title and the key are the same placeholder
 *
 * `\section{$title}` and `\label{sec:$title}` name the same placeholder, so
 * typing the title fills the key as it goes. CodeMirror's snippet machinery
 * links repeated names and edits them together; there is no second cursor to
 * manage and no step where the two can drift apart.
 *
 * It goes in verbatim rather than slugged. Slugging as you type would mean the
 * key changing shape under the cursor — `Kosten und` becoming `kosten-und`
 * mid-word — and a key that rewrites itself while being typed is worse than
 * one with a space in it. The author fixes the key once, at the end, or leaves
 * it: LaTeX takes a space in a label perfectly well.
 *
 * # The shape
 *
 * `${name}` is a placeholder Tab moves between; `${}` is one with no name,
 * which is where the caret ends up. This is CodeMirror's syntax, not one
 * invented here.
 */
export const SNIPPETS: Record<string, string> = {
  // Sectioning, each with the label it should always have had.
  part: "part{${title}}\n\\label{part:${title}}\n",
  chapter: "chapter{${title}}\n\\label{ch:${title}}\n",
  section: "section{${title}}\n\\label{sec:${title}}\n",
  subsection: "subsection{${title}}\n\\label{sec:${title}}\n",
  subsubsection: "subsubsection{${title}}\n\\label{sec:${title}}\n",

  // A float is three commands and an environment, and getting the order wrong
  // is the most common reason a caption comes out above the picture.
  figure:
    "begin{figure}[htbp]\n" +
    "  \\centering\n" +
    "  \\includegraphics[width=${width:0.8}\\textwidth]{${file}}\n" +
    "  \\caption{${caption}}\n" +
    "  \\label{fig:${caption}}\n" +
    "\\end{figure}\n",
  table:
    "begin{table}[htbp]\n" +
    "  \\centering\n" +
    "  \\caption{${caption}}\n" +
    "  \\label{tab:${caption}}\n" +
    "  \\begin{tabular}{${columns:ll}}\n" +
    "    ${}\n" +
    "  \\end{tabular}\n" +
    "\\end{table}\n",

  // An equation that can be referred to, which is the only kind worth
  // numbering.
  equation: "begin{equation}\n  ${}\n  \\label{eq:${name}}\n\\end{equation}\n",

  // The everyday one-argument commands. Not a saving in typing — a saving in
  // the closing brace nobody notices is missing until the compile fails.
  emph: "emph{${}}",
  textbf: "textbf{${}}",
  textit: "textit{${}}",
  footnote: "footnote{${}}",
  cite: "cite{${}}",
  ref: "ref{${}}",
  label: "label{${}}",
  href: "href{${url}}{${text}}",
  includegraphics: "includegraphics[width=${width:0.8}\\textwidth]{${file}}",
};

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
