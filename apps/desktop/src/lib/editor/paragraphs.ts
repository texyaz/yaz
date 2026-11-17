/**
 * Paragraphs that flow, whatever line the source breaks them on.
 *
 * TeX treats a single line break as a space, and plenty of writers put one
 * sentence on a line so a diff shows which sentence changed. Drawn as written
 * that is a page of ragged one-line sentences, which is not what the document
 * says. The preview therefore draws such a break as the space it is.
 *
 * Only breaks between two lines of prose are joined. A line that is a command
 * and nothing else — a heading, a label, `\begin{…}` — is a thing of its own
 * in the preview, and material that is laid out by its lines (mathematics,
 * tables, verbatim text, drawings) is left exactly as written.
 *
 * Unlike most of the preview this does not step aside for the caret: a
 * paragraph that reflowed whenever the caret crossed a join would be
 * unreadable while editing. "Explicit line breaks" shows the source's lines.
 */

import { Decoration, WidgetType } from "@codemirror/view";

import { definitions } from "./definitions";
import type { Pass } from "./pass";
import { showLineBreaks } from "./viewModes";
import { environmentRenderingOf, renderingOf } from "./vocabulary";

const B = String.fromCharCode(92);

/** The space a line break stands for. */
class JoinWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  override toDOM(): HTMLElement {
    const node = document.createElement("span");
    node.className = "cm-yaz-join";
    node.textContent = " ";
    // An ordinary space, where the editor's own are kept as typed: one that
    // falls at the end of a drawn line must vanish there, not start the next
    // line with a gap.
    node.style.whiteSpace = "normal";
    return node;
  }
}

const join = Decoration.replace({ widget: new JoinWidget() });

/** Environments laid out by their lines, beyond what the vocabulary names. */
const LINED = new Set([
  "align",
  "alignat",
  "flalign",
  "gather",
  "multline",
  "split",
  "cases",
  "array",
  "matrix",
  "math",
  "tabularx",
  "longtable",
  "lstlisting",
  "minted",
  "Verbatim",
  "filecontents",
  "thebibliography",
]);

/** Renderings that are part of a sentence rather than a thing of their own. */
const IN_A_SENTENCE = new Set([
  "inline",
  "symbol",
  "quote",
  "quotation",
  "citation",
  "reference",
  "quantity",
  "date",
  "glossary",
]);

function lined(name: string): boolean {
  const kind = environmentRenderingOf(name)?.kind;
  if (kind === "math" || kind === "table" || kind === "verbatim") return true;
  if (kind === "drawing") return true;
  return LINED.has(name.replace(/\*$/, ""));
}

const BEGIN = new RegExp(`${B}${B}begin\\{([^}]*)\\}`, "g");
const END = new RegExp(`${B}${B}end\\{([^}]*)\\}`, "g");
/** A line that is one command with its arguments, and nothing else. */
const COMMAND_ONLY = new RegExp(
  `^${B}${B}([a-zA-Z@]+)\\*?\\s*(?:\\[[^\\]]*\\]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*$`,
);
const STARTS_ITEM = new RegExp(`^${B}${B}item(?![a-zA-Z])`);
const ENDS_PARAGRAPH = new RegExp(
  `(?:${B}${B}${B}${B}(?:\\[[^\\]]*\\])?|${B}${B}par\\}?|${B}${B}newline)$`,
);

interface Line {
  from: number;
  to: number;
  /** May be joined to the line before. */
  before: boolean;
  /** May be joined to the line after. */
  after: boolean;
}

/** Draw the breaks inside a paragraph as spaces. */
export function flow(pass: Pass): void {
  if (pass.state.field(showLineBreaks, false)) return;

  const text = pass.text;
  const defined = definitions(text);
  const own = (name: string) =>
    defined.texts.has(name) ||
    defined.wrappers.has(name) ||
    defined.named.has(name);

  // A fragment with no `\begin{document}` is an `\input`-ed chapter.
  const marker = `${B}begin{document}`;
  const begins = text.indexOf(marker);
  let at = begins < 0 ? 0 : begins;

  let depth = 0;
  let display = false;
  let previous: Line | null = null;

  while (at <= text.length) {
    let to = text.indexOf("\n", at);
    if (to < 0) to = text.length;
    const raw = text.slice(at, to);
    const line = raw.trim();

    const wasLined = depth > 0 || display;
    for (const found of line.matchAll(BEGIN)) if (lined(found[1]!)) depth++;
    for (const found of line.matchAll(END)) {
      if (lined(found[1]!)) depth = Math.max(0, depth - 1);
    }
    if (line.startsWith(`${B}[`) || line.startsWith("$$")) display = true;
    if (line.endsWith(`${B}]`) || (line.length > 2 && line.endsWith("$$"))) {
      display = false;
    } else if (line === "$$" && wasLined) {
      display = false;
    }
    const isLined = wasLined || depth > 0 || display;

    const command = COMMAND_ONLY.exec(line);
    const alone =
      line === "" ||
      isLined ||
      line.startsWith("%") ||
      line.startsWith(`${B}begin{`) ||
      line.startsWith(`${B}end{`) ||
      (command !== null &&
        !own(command[1]!) &&
        !IN_A_SENTENCE.has(renderingOf(command[1]!)?.kind ?? ""));

    const current: Line = {
      from: at,
      to,
      before: !alone && !STARTS_ITEM.test(line),
      after: !alone && !ENDS_PARAGRAPH.test(line),
    };

    if (previous?.after && current.before) {
      // The spaces around the break go with it, or an indented continuation
      // line would start with a gap.
      let from = previous.to;
      while (from > previous.from && /[ \t]/.test(text[from - 1]!)) from--;
      let until = current.from;
      while (until < current.to && /[ \t]/.test(text[until]!)) until++;
      if (pass.covered.claim(from, until)) {
        pass.ranges.push(join.range(from, until));
      } else if (pass.covered.claim(previous.to, current.from)) {
        pass.ranges.push(join.range(previous.to, current.from));
      }
    }

    previous = current;
    at = to + 1;
  }
}
