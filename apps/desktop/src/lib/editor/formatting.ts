/**
 * Applying formatting to a selection.
 *
 * # Toggling, not just wrapping
 *
 * `Ctrl+B` on bold text has to make it not-bold. A command that only ever
 * wraps turns `\textbf{word}` into `\textbf{\textbf{word}}` on the second
 * press, which is how a shortcut stops being usable — you can no longer press
 * it without looking at what you have.
 *
 * So each command asks first: is the selection already inside this command? If
 * it is, the command comes off. The check is on the source, because the source
 * is the document (ADR-0004) — there is no separate model holding "this run is
 * bold" that could disagree with it.
 *
 * # With nothing selected
 *
 * The markup is inserted empty and the cursor put between the braces, which is
 * what pressing Ctrl+B before typing means everywhere else.
 */

import { braceCommands, environments, matchBrace } from "./structure";

/** An edit to apply. */
export interface Edit {
  changes: { from: number; to: number; insert: string }[];
  /** Where the selection ends up. */
  from: number;
  to: number;
}

/** The inline commands formatting can apply. */
export type InlineFormat =
  "textbf" | "textit" | "underline" | "texttt" | "textsc" | "emph";

/**
 * Wrap or unwrap a selection in an inline command.
 *
 * The unwrap case looks for a command of this kind whose argument *is* the
 * selection, or which contains it entirely — pressing Ctrl+B anywhere inside a
 * bold run should un-bold the run, not bold a word inside it.
 */
export function toggleInline(
  text: string,
  from: number,
  to: number,
  command: InlineFormat,
): Edit {
  const existing = braceCommands(text, [command]).find(
    (found) => found.argFrom <= from && found.argTo >= to,
  );

  if (existing) {
    // Remove `\command{` and its closing brace, and keep everything between.
    const inner = text.slice(existing.argFrom, existing.argTo);
    const shift = existing.argFrom - existing.from;
    return {
      changes: [{ from: existing.from, to: existing.to, insert: inner }],
      from: from - shift,
      to: to - shift,
    };
  }

  const selected = text.slice(from, to);
  const opening = `\\${command}{`;
  return {
    changes: [{ from, to, insert: `${opening}${selected}}` }],
    from: from + opening.length,
    to: from + opening.length + selected.length,
  };
}

/**
 * Wrap or unwrap the selected lines in an environment.
 *
 * Used for `quote`, which is a block: the whole paragraph is quoted, never
 * half of one, so this works in whole lines rather than at the selection's
 * exact edges.
 */
export function toggleEnvironment(
  text: string,
  from: number,
  to: number,
  name: string,
): Edit {
  const existing = environments(text, [name]).find(
    (found) => found.bodyFrom <= from && found.bodyTo >= to,
  );

  if (existing) {
    const body = text
      .slice(existing.bodyFrom, existing.bodyTo)
      .replace(/^\n|\n$/g, "");
    const shift = existing.bodyFrom - existing.from + 1;
    return {
      changes: [{ from: existing.from, to: existing.to, insert: body }],
      from: Math.max(from - shift, existing.from),
      to: Math.max(to - shift, existing.from),
    };
  }

  const start = text.lastIndexOf("\n", Math.max(from - 1, 0)) + 1;
  const finish =
    text.indexOf("\n", to) === -1 ? text.length : text.indexOf("\n", to);
  const body = text.slice(start, finish);
  const opening = `\\begin{${name}}\n`;
  return {
    changes: [
      { from: start, to: finish, insert: `${opening}${body}\n\\end{${name}}` },
    ],
    from: from + opening.length,
    to: to + opening.length,
  };
}

/** Sectioning commands by the level a shortcut names. */
const HEADINGS = ["section", "subsection", "subsubsection"];

/**
 * Make the current line a heading, or stop it being one.
 *
 * Pressing the same level again removes it, which is how the heading buttons in
 * a word processor behave — and without it there is no shortcut for "this is
 * not a heading after all".
 */
export function toggleHeading(
  text: string,
  at: number,
  level: 1 | 2 | 3,
): Edit {
  const command = HEADINGS[level - 1]!;
  const start = text.lastIndexOf("\n", Math.max(at - 1, 0)) + 1;
  const finish =
    text.indexOf("\n", at) === -1 ? text.length : text.indexOf("\n", at);
  const line = text.slice(start, finish);

  const heading =
    /^(\s*)\\(part|chapter|section|subsection|subsubsection|paragraph)\*?(?:\[[^\]]*\])?\{/.exec(
      line,
    );

  if (heading) {
    const open = start + heading[0].length - 1;
    const close = matchBrace(text, open);
    const title =
      close === null
        ? line.slice(heading[0].length)
        : text.slice(open + 1, close - 1);
    const indent = heading[1] ?? "";

    // The same level again: back to plain text. A different level: re-mark it.
    if (heading[2] === command) {
      return {
        changes: [{ from: start, to: finish, insert: `${indent}${title}` }],
        from: start + indent.length,
        to: start + indent.length + title.length,
      };
    }
    const replacement = `${indent}\\${command}{${title}}`;
    return {
      changes: [{ from: start, to: finish, insert: replacement }],
      from: start + replacement.length - 1,
      to: start + replacement.length - 1,
    };
  }

  const indent = /^\s*/.exec(line)?.[0] ?? "";
  const title = line.trim();
  const replacement = `${indent}\\${command}{${title}}`;
  return {
    changes: [{ from: start, to: finish, insert: replacement }],
    from: start + replacement.length - 1,
    to: start + replacement.length - 1,
  };
}

/**
 * Strip the inline formatting from a selection.
 *
 * Only the commands formatting applies — an unknown command in the selection is
 * the author's and is left alone. "Clear formatting" that also removed a
 * `\cite` would be a data-loss button wearing a tidy label.
 */
export function clearFormatting(text: string, from: number, to: number): Edit {
  const known: InlineFormat[] = [
    "textbf",
    "textit",
    "underline",
    "texttt",
    "textsc",
    "emph",
  ];
  const inside = braceCommands(text, known).filter(
    (found) => found.from >= from && found.to <= to,
  );
  if (inside.length === 0) return { changes: [], from, to };

  // Innermost first, so removing an outer command does not move the offsets of
  // an inner one that has not been removed yet.
  const ordered = [...inside].sort((a, b) => b.from - a.from);
  const changes = ordered.map((found) => ({
    from: found.from,
    to: found.to,
    insert: text.slice(found.argFrom, found.argTo),
  }));

  const removed = inside.reduce(
    (total, found) =>
      total + (found.to - found.from) - (found.argTo - found.argFrom),
    0,
  );
  return { changes, from, to: to - removed };
}

/**
 * The font families LaTeX itself has.
 *
 * Three, because LaTeX has three. A word processor offers a list of typeface
 * names, but a `.tex` file does not choose a typeface at this level — it says
 * *roman*, *sans* or *typewriter*, and the document class decides what those
 * are. Offering "Calibri" here would be offering something the compiler cannot
 * honour, and the author would find that out at compile time.
 */
export const FONT_FAMILIES = ["textrm", "textsf", "texttt"] as const;

/** One of the three. */
export type FontFamily = (typeof FONT_FAMILIES)[number];

/**
 * The sizes LaTeX itself has, smallest first.
 *
 * Relative names rather than points, again because that is what LaTeX has: a
 * `\large` is large *relative to the document base size*, which the class and
 * the `\documentclass` option set. A control offering 14pt would be inventing
 * a scale the document does not use.
 */
export const FONT_SIZES = [
  "tiny",
  "scriptsize",
  "footnotesize",
  "small",
  "normalsize",
  "large",
  "Large",
  "LARGE",
  "huge",
  "Huge",
] as const;

/** One of the ten. */
export type FontSize = (typeof FONT_SIZES)[number];

/**
 * The colours offered by name.
 *
 * The base names `xcolor` already knows, so that what is offered compiles
 * without a `\definecolor`. A picker offering any of sixteen million would
 * produce definition lines nobody asked for, and a document whose palette
 * cannot be named.
 */
export const TEXT_COLOURS = [
  "black",
  "red",
  "blue",
  "green",
  "orange",
  "violet",
  "brown",
  "gray",
] as const;

/** One of the eight. */
export type TextColour = (typeof TEXT_COLOURS)[number];

/**
 * Which package an edit needs in the preamble, where it needs one.
 *
 * Reported rather than written here, because the preamble is often in another
 * file — `main.tex`, while a chapter is what is open — and this module works on
 * one string. The shell puts the line where it belongs.
 */
export interface Requirement {
  package: string;
}

/** An edit, and whatever the preamble has to gain for it to compile. */
export interface RequiringEdit extends Edit {
  requires?: Requirement | undefined;
}

/**
 * Set or clear the family of the selected text.
 *
 * Asking for the family the selection already has takes it off again, the same
 * way pressing the bold button twice does; `null` takes off whichever it has.
 */
export function setFamily(
  text: string,
  from: number,
  to: number,
  family: FontFamily | null,
): Edit {
  const existing = braceCommands(text, [...FONT_FAMILIES]).find(
    (found) => found.argFrom <= from && found.argTo >= to,
  );

  if (existing) {
    const inner = text.slice(existing.argFrom, existing.argTo);
    const off = family === null || existing.command === family;
    const insert = off ? inner : `\\${family}{${inner}}`;
    const opening = off ? 0 : family.length + 2;
    const shift = existing.argFrom - existing.from - opening;
    return {
      changes: [{ from: existing.from, to: existing.to, insert }],
      from: from - shift,
      to: to - shift,
    };
  }

  if (family === null) return { changes: [], from, to };
  return toggleInline(text, from, to, family as InlineFormat);
}

/**
 * Set or clear the size of the selected text.
 *
 * A size in LaTeX is a *declaration*, not a command with an argument: it applies
 * from where it is written to the end of the enclosing group. So the selection
 * is wrapped in a group of its own — `{\large ...}` — which is what stops the
 * size running on into the rest of the paragraph.
 */
export function setSize(
  text: string,
  from: number,
  to: number,
  size: FontSize | null,
): Edit {
  const existing = sizeGroupAround(text, from, to);

  if (existing) {
    const inner = text.slice(existing.bodyFrom, existing.bodyTo);
    if (size === null || size === existing.size) {
      const shift = existing.bodyFrom - existing.from;
      return {
        changes: [{ from: existing.from, to: existing.to, insert: inner }],
        from: from - shift,
        to: to - shift,
      };
    }
    const opening = `{\\${size} `;
    const shift = existing.bodyFrom - existing.from - opening.length;
    return {
      changes: [
        { from: existing.from, to: existing.to, insert: `${opening}${inner}}` },
      ],
      from: from - shift,
      to: to - shift,
    };
  }

  if (size === null) return { changes: [], from, to };
  const selected = text.slice(from, to);
  const opening = `{\\${size} `;
  return {
    changes: [{ from, to, insert: `${opening}${selected}}` }],
    from: from + opening.length,
    to: from + opening.length + selected.length,
  };
}

/** A `{\large ...}` group the selection sits inside. */
interface SizeGroup {
  size: FontSize;
  from: number;
  to: number;
  bodyFrom: number;
  bodyTo: number;
}

/**
 * Find the size group the selection sits in.
 *
 * Scanned rather than read with the brace-command machinery, because this is
 * not a command with an argument — it is a brace group whose first token
 * happens to be a size declaration, and nothing else in a document has that
 * shape.
 */
function sizeGroupAround(
  text: string,
  from: number,
  to: number,
): SizeGroup | null {
  for (const size of FONT_SIZES) {
    const opening = `{\\${size} `;
    let at = text.indexOf(opening);
    while (at !== -1) {
      const close = matchBrace(text, at);
      if (close !== null) {
        const bodyFrom = at + opening.length;
        const bodyTo = close - 1;
        if (bodyFrom <= from && bodyTo >= to) {
          return { size, from: at, to: close, bodyFrom, bodyTo };
        }
      }
      at = text.indexOf(opening, at + 1);
    }
  }
  return null;
}

/**
 * Set or clear the colour of the selected text.
 *
 * Needs `xcolor`, which is a package and not the kernel — so the edit says so
 * and the shell adds the line. Writing `\textcolor` into a document that cannot
 * compile it would be a formatting button that breaks the build.
 */
export function setColour(
  text: string,
  from: number,
  to: number,
  colour: TextColour | null,
): RequiringEdit {
  const existing = colourAround(text, from, to);

  if (existing) {
    const inner = text.slice(existing.argFrom, existing.argTo);
    if (colour === null || colour === existing.colour) {
      const shift = existing.argFrom - existing.from;
      return {
        changes: [{ from: existing.from, to: existing.to, insert: inner }],
        from: from - shift,
        to: to - shift,
      };
    }
    const opening = `\\textcolor{${colour}}{`;
    const shift = existing.argFrom - existing.from - opening.length;
    return {
      changes: [
        { from: existing.from, to: existing.to, insert: `${opening}${inner}}` },
      ],
      from: from - shift,
      to: to - shift,
      requires: { package: "xcolor" },
    };
  }

  if (colour === null) return { changes: [], from, to };
  const selected = text.slice(from, to);
  const opening = `\\textcolor{${colour}}{`;
  return {
    changes: [{ from, to, insert: `${opening}${selected}}` }],
    from: from + opening.length,
    to: from + opening.length + selected.length,
    requires: { package: "xcolor" },
  };
}

/** A `\textcolor{name}{...}` the selection sits inside. */
interface ColourCommand {
  colour: string;
  from: number;
  to: number;
  argFrom: number;
  argTo: number;
}

/**
 * Find the `\textcolor` around the selection.
 *
 * Hand-scanned because `\textcolor` takes *two* arguments and the brace-command
 * machinery reads one. Its first argument is the colour, which is what has to
 * be read to know whether the button being pressed is the one already on.
 */
function colourAround(
  text: string,
  from: number,
  to: number,
): ColourCommand | null {
  const marker = "\\textcolor{";
  let at = text.indexOf(marker);
  while (at !== -1) {
    const nameEnd = text.indexOf("}", at + marker.length);
    if (nameEnd !== -1 && text[nameEnd + 1] === "{") {
      const close = matchBrace(text, nameEnd + 1);
      if (close !== null) {
        const argFrom = nameEnd + 2;
        const argTo = close - 1;
        if (argFrom <= from && argTo >= to) {
          return {
            colour: text.slice(at + marker.length, nameEnd),
            from: at,
            to: close,
            argFrom,
            argTo,
          };
        }
      }
    }
    at = text.indexOf(marker, at + 1);
  }
  return null;
}

/**
 * What the selection already is, so the controls can show it.
 *
 * A formatting bar whose buttons never light up is a bar that cannot tell you
 * the word you are looking at is already bold — which is half of what such a
 * bar is for.
 */
export interface AppliedFormatting {
  inline: InlineFormat[];
  family: FontFamily | null;
  size: FontSize | null;
  colour: string | null;
}

/** Every inline command the formatting controls know how to apply. */
const KNOWN_INLINE: InlineFormat[] = [
  "textbf",
  "textit",
  "underline",
  "texttt",
  "textsc",
  "emph",
];

/** Read {@link AppliedFormatting} off the source around a selection. */
export function appliedFormatting(
  text: string,
  from: number,
  to: number,
): AppliedFormatting {
  const inline = braceCommands(text, KNOWN_INLINE)
    .filter((found) => found.argFrom <= from && found.argTo >= to)
    .map((found) => found.command as InlineFormat);

  const family = braceCommands(text, [...FONT_FAMILIES]).find(
    (found) => found.argFrom <= from && found.argTo >= to,
  )?.command;

  return {
    inline,
    family: (family as FontFamily | undefined) ?? null,
    size: sizeGroupAround(text, from, to)?.size ?? null,
    colour: colourAround(text, from, to)?.colour ?? null,
  };
}
