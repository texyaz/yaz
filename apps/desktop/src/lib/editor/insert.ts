/**
 * The LaTeX a paper is made of, as things you can insert.
 *
 * # Why these and not a hundred others
 *
 * A table, a figure, an equation, a list, a section. Those are what somebody
 * writing a paper reaches for over and over, and each of them is several lines
 * of markup with an easy mistake in it — a `tabular` whose column count does
 * not match its rows, a `figure` with no caption, a `\[` with no `\]`.
 *
 * Everything rarer stays typed. A palette of two hundred snippets is a palette
 * nobody reads, and the ones past this list are reached for once a paper.
 *
 * # Where the caret ends up
 *
 * Each of these says where the writing starts, because an insertion that leaves
 * the caret at the end has put five lines between the author and what they were
 * about to type. `‸` marks it below and is never part of the output.
 *
 * # These are the kernel's, not a package's
 *
 * `tabular`, `figure`, `itemize`, `\section` are LaTeX itself, so they belong
 * here rather than in a plugin — the same line
 * [ADR-0023](https://generalpawz.github.io/yaz/adr/0023-latex-vocabulary-boundary)
 * draws for the preview. A package's construct is a package's plugin's to
 * offer, through the command it registers.
 */

/** A backslash, so the templates below read as what they are. */
const B = String.fromCharCode(92);

/** Where the caret goes, marked in a template. */
const CARET = "‸";

/** Something the palette can put into the document. */
export interface Insertion {
  /** Stable identifier, used as the command id. */
  id: string;
  /** Message key naming it. */
  labelKey: string;
  /** The LaTeX, with `‸` marking where the caret goes. */
  template: string;
}

/** What can be inserted, in the order a palette should offer them. */
export const INSERTIONS: readonly Insertion[] = [
  {
    id: "table",
    labelKey: "insert-table",
    // A caption and a label as well as the grid: a table in a paper is
    // referred to, and one without a label is one that cannot be. `[h]` is
    // what an author almost always means and almost never remembers.
    template: [
      `${B}begin{table}[h]`,
      `  ${B}centering`,
      `  ${B}begin{tabular}{|l|l|}`,
      `    ${B}hline`,
      `    ${CARET} & ${B}${B}`,
      `     & ${B}${B}`,
      `    ${B}hline`,
      `  ${B}end{tabular}`,
      `  ${B}caption{}`,
      `  ${B}label{tab:}`,
      `${B}end{table}`,
    ].join("\n"),
  },
  {
    id: "figure",
    labelKey: "insert-figure",
    template: [
      `${B}begin{figure}[h]`,
      `  ${B}centering`,
      // A width relative to the measure, because a figure at its natural size
      // is a figure that runs off the paper.
      `  ${B}includegraphics[width=0.8${B}textwidth]{${CARET}}`,
      `  ${B}caption{}`,
      `  ${B}label{fig:}`,
      `${B}end{figure}`,
    ].join("\n"),
  },
  {
    id: "equation",
    labelKey: "insert-equation",
    template: [
      `${B}begin{equation}`,
      `  ${CARET}`,
      `  ${B}label{eq:}`,
      `${B}end{equation}`,
    ].join("\n"),
  },
  {
    id: "itemize",
    labelKey: "insert-itemize",
    template: [
      `${B}begin{itemize}`,
      `  ${B}item ${CARET}`,
      `  ${B}item `,
      `${B}end{itemize}`,
    ].join("\n"),
  },
  {
    id: "enumerate",
    labelKey: "insert-enumerate",
    template: [
      `${B}begin{enumerate}`,
      `  ${B}item ${CARET}`,
      `  ${B}item `,
      `${B}end{enumerate}`,
    ].join("\n"),
  },
  {
    id: "section",
    labelKey: "insert-section",
    template: `${B}section{${CARET}}${"\n"}${B}label{sec:}`,
  },
  {
    id: "subsection",
    labelKey: "insert-subsection",
    template: `${B}subsection{${CARET}}`,
  },
  {
    id: "quote",
    labelKey: "insert-quote",
    template: [`${B}begin{quote}`, `  ${CARET}`, `${B}end{quote}`].join("\n"),
  },
  {
    id: "footnote",
    labelKey: "insert-footnote",
    template: `${B}footnote{${CARET}}`,
  },
];

/** What to insert and where the caret lands, from a template. */
export interface Prepared {
  text: string;
  /** How far into the inserted text the caret goes. */
  caret: number;
}

/**
 * Turn a template into text and a caret offset.
 *
 * A template with no mark puts the caret at the end, which is what an
 * insertion with nothing to fill in should do.
 */
export function prepare(template: string): Prepared {
  const at = template.indexOf(CARET);
  return at === -1
    ? { text: template, caret: template.length }
    : { text: template.replace(CARET, ""), caret: at };
}

/**
 * The same, indented to sit where it is going.
 *
 * A `tabular` inserted inside an already-indented environment should line up
 * with what is around it — otherwise every insertion has to be re-indented by
 * hand, which is exactly the tedium this exists to remove.
 */
export function prepareAt(template: string, lineSoFar: string): Prepared {
  const indent = /^[ \t]*/.exec(lineSoFar)?.[0] ?? "";
  if (!indent) return prepare(template);

  const prepared = prepare(template);
  // Every line but the first: the first is already at the caret, which is
  // where the existing indent has put it.
  const lines = prepared.text.split("\n");
  const text = lines
    .map((line, index) => (index === 0 || line === "" ? line : indent + line))
    .join("\n");

  // The caret moves by one indent for each line break before it.
  const before = prepared.text.slice(0, prepared.caret).split("\n").length - 1;
  return { text, caret: prepared.caret + before * indent.length };
}
