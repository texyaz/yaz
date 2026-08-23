/**
 * Finding text, and replacing it.
 *
 * # Why this is a module and not a component
 *
 * Searching is three fiddly decisions — how a query is turned into a pattern,
 * what "whole word" means at the edges, and what a replacement does with a
 * capture group — and every one of them is wrong in a way that only shows up on
 * somebody's real document. So the deciding is here, where it can be tested,
 * and the tab is only the surface. The same split pagination and the formatting
 * bar needed.
 *
 * # What a match carries
 *
 * Enough to draw a result line without going back to the text: the line number,
 * the words either side, and the offsets to jump to. A results list that had to
 * re-read the file to draw itself would re-read it once per row.
 */

/** How to read the query. */
export interface SearchOptions {
  /** `Bau` does not match `bau`. */
  matchCase: boolean;
  /** `Bau` does not match `Bauwerk`. */
  wholeWord: boolean;
  /** The query is a regular expression rather than literal text. */
  regex: boolean;
}

/** Every option off, which is what a search starts as. */
export const PLAIN_SEARCH: SearchOptions = {
  matchCase: false,
  wholeWord: false,
  regex: false,
};

/** One place the query was found. */
export interface Match {
  /** Offsets into the text searched. */
  from: number;
  to: number;
  /** Which line it is on, counting from 1 as an editor does. */
  line: number;
  /** The line's text up to the match, trimmed to something readable. */
  before: string;
  /** What matched. */
  text: string;
  /** The rest of the line after it, likewise trimmed. */
  after: string;
  /** The capture groups, when the query was a regular expression. */
  groups: string[];
}

/**
 * How much of the line to keep either side of a match.
 *
 * Enough to recognise where you are; not so much that a result from a minified
 * line pushes every other result off the pane.
 */
const CONTEXT = 60;

/**
 * Turn a query into a pattern, or `null` if it cannot be one.
 *
 * `null` rather than a throw: an unfinished regular expression is the normal
 * state of one being typed, and a search box that reported an error on every
 * other keystroke would be a search box nobody left open.
 */
export function patternFor(
  query: string,
  options: SearchOptions,
): RegExp | null {
  if (query === "") return null;

  const source = options.regex ? query : escapeLiteral(query);
  // `\b` is wrong for a query that starts or ends with punctuation — there is
  // no word boundary before `(` — so the guard is only applied to the side
  // that is actually a word character.
  const opensWord = /^\w/.test(query);
  const closesWord = /\w$/.test(query);
  const bounded = options.wholeWord
    ? `${opensWord ? "\\b" : ""}(?:${source})${closesWord ? "\\b" : ""}`
    : source;

  try {
    return new RegExp(bounded, options.matchCase ? "gu" : "giu");
  } catch {
    try {
      // Without `u`, because a literal backslash a user is halfway through
      // typing is an invalid escape under Unicode mode but fine without it.
      return new RegExp(bounded, options.matchCase ? "g" : "gi");
    } catch {
      return null;
    }
  }
}

/** Everything in `text` a regular expression would take literally. */
function escapeLiteral(query: string): string {
  return query.replace(/[.*+?^${}()|[\]\\]/g, (found) => `\\${found}`);
}

/**
 * Every match of the query in the text.
 *
 * Capped, because a one-character query on a thesis is a hundred thousand
 * matches and nobody is going to read them — and building the list is what
 * would make the window stop responding, not showing it.
 */
export function findMatches(
  text: string,
  query: string,
  options: SearchOptions,
  limit = 500,
): Match[] {
  const pattern = patternFor(query, options);
  if (!pattern) return [];

  const found: Match[] = [];
  // Where each line starts, so a match's line is a lookup rather than a count
  // of newlines from the top of the file per match.
  const starts = lineStarts(text);

  let guard = 0;
  for (const hit of text.matchAll(pattern)) {
    if (hit.index === undefined) continue;
    // A pattern that can match nothing — `a*` — would otherwise spin.
    if (hit[0] === "") {
      guard += 1;
      if (guard > limit) break;
      continue;
    }

    const from = hit.index;
    const to = from + hit[0].length;
    const line = lineOf(starts, from);
    const lineFrom = starts[line - 1] ?? 0;
    const lineTo = starts[line] ?? text.length;

    found.push({
      from,
      to,
      line,
      before: text.slice(Math.max(lineFrom, from - CONTEXT), from),
      text: hit[0],
      after: text.slice(to, Math.min(lineTo, to + CONTEXT)).replace(/\n$/, ""),
      groups: hit.slice(1).map((group) => group ?? ""),
    });
    if (found.length >= limit) break;
  }
  return found;
}

/** The offset each line begins at. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (
    let at = text.indexOf("\n");
    at !== -1;
    at = text.indexOf("\n", at + 1)
  ) {
    starts.push(at + 1);
  }
  return starts;
}

/** Which line an offset is on, counting from 1. Binary search over the starts. */
function lineOf(starts: number[], at: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle]! <= at) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

/**
 * What a replacement actually inserts.
 *
 * `$1` is the first capture group and `$$` is a dollar sign, which is what
 * every other tool means by them. Only under `regex`: somebody replacing a
 * literal price with `$5` should get `$5`.
 */
export function expandReplacement(
  replacement: string,
  match: Match,
  options: SearchOptions,
): string {
  if (!options.regex) return replacement;
  return replacement.replace(/\$(\$|&|\d{1,2})/g, (whole, token: string) => {
    if (token === "$") return "$";
    if (token === "&") return match.text;
    const index = Number(token) - 1;
    return match.groups[index] ?? whole;
  });
}

/** An edit, in the shape the editor takes. */
export interface Change {
  from: number;
  to: number;
  insert: string;
}

/** The edit that replaces one match. */
export function replaceOne(
  match: Match,
  replacement: string,
  options: SearchOptions,
): Change {
  return {
    from: match.from,
    to: match.to,
    insert: expandReplacement(replacement, match, options),
  };
}

/**
 * The edits that replace every match.
 *
 * Handed back as a list rather than applied, so the caller can make it one
 * step of undo — replacing four hundred things and having to press Ctrl+Z four
 * hundred times is not a feature.
 *
 * In document order, because that is the order an editor wants changes in.
 */
export function replaceAll(
  matches: readonly Match[],
  replacement: string,
  options: SearchOptions,
): Change[] {
  return matches.map((match) => replaceOne(match, replacement, options));
}
