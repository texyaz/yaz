/**
 * What a document defines for itself.
 *
 * The vocabulary ([`vocabulary.ts`](./vocabulary.ts)) is what LaTeX and its
 * packages mean. A thesis also has words of its own: `\newcommand` for the
 * title it repeats, an environment for its planning notes, a theorem called
 * "Hypothese". Nobody can ship those, because nobody else has them — but the
 * document says what each one is, a few lines above where it uses it, and that
 * is read here ([ADR-0032]).
 *
 * # Read, not run
 *
 * This is not a macro expander. It recognises the handful of shapes a
 * definition takes when it is *naming* something — a fixed piece of text, a
 * wrapper around one argument, an environment, a numbered statement — and
 * leaves everything else as the source it is. A definition it cannot read
 * costs nothing: the command is shown as written, which is true.
 *
 * # From the buffer, and only the buffer
 *
 * A definition counts when it is in the text being edited, which for a
 * multi-file document means the joined view (ADR-0020). A chapter opened on
 * its own has no preamble and so no definitions, and is drawn that way.
 *
 * [ADR-0032]: https://github.com/texyaz/yaz/blob/main/docs/adr/0032-the-preview-reads-the-documents-own-definitions.md
 */

import { environments, matchBrace, matchBracket } from "./structure";
import type { Heading } from "./structure";
import { Kind, tokensIn, tokensOfFragment } from "./tokens";
import type { Span, Token } from "./tokens";
import { commandsOfKind, renderingOf } from "./vocabulary";

/** How a command the document defined with one argument is drawn. */
export type Wrapper =
  /** As the command it wraps would draw it: `\code` around `\texttt`. */
  | { kind: "inline"; className: string }
  /** As its argument, with the markup gone. */
  | { kind: "plain" }
  /** As nothing: the definition never uses what it is given. */
  | { kind: "dropped" }
  /**
   * As a value kept under a name built from the argument.
   *
   * `\csname data@#1\endcsname` is how a document prints numbers a script
   * wrote into a file, so that none is typed by hand. `before` and `after` are
   * what surrounds the argument in the name.
   */
  | { kind: "lookup"; before: string; after: string };

/** A numbered statement: `\newtheorem{hypothesis}{Hypothese}[chapter]`. */
export interface Theorem {
  /** What is printed in front of the number. */
  title: string;
  /** The heading command whose number it is counted within, if any. */
  within: string | null;
  /** The environment whose counter it shares, or its own name. */
  counter: string;
  numbered: boolean;
}

/** Everything a document defines that the preview can draw. */
export interface Definitions {
  /** Commands without arguments, and the source each stands for. */
  texts: Map<string, string>;
  /** Commands with one argument. */
  wrappers: Map<string, Wrapper>;
  /** Environments the document made, other than its theorems. */
  environments: Set<string>;
  theorems: Map<string, Theorem>;
  /** Values defined through `\csname`, by the name between the two. */
  named: Map<string, string>;
  /**
   * Where the definitions themselves are written, in document order.
   *
   * `\newcommand{\thesistitle}{…}` contains `\thesistitle`, and drawing that
   * as the title would turn every definition into a sentence about itself.
   */
  sites: Span[];
}

/** `\newcommand{\name}[n]{body}` and its relatives. */
const COMMAND_DEFINERS = new Set([
  "newcommand",
  "renewcommand",
  "providecommand",
  "DeclareRobustCommand",
]);

/** `\NewDocumentCommand{\name}{spec}{body}` and its relatives. */
const DOCUMENT_COMMAND_DEFINERS = new Set([
  "NewDocumentCommand",
  "RenewDocumentCommand",
  "ProvideDocumentCommand",
  "DeclareDocumentCommand",
]);

/** Everything that makes an environment; only the name is read. */
const ENVIRONMENT_DEFINERS = new Set([
  "newenvironment",
  "renewenvironment",
  "NewDocumentEnvironment",
  "RenewDocumentEnvironment",
  "ProvideDocumentEnvironment",
  "DeclareDocumentEnvironment",
]);

const NOTHING: Definitions = {
  texts: new Map(),
  wrappers: new Map(),
  environments: new Set(),
  theorems: new Map(),
  named: new Map(),
  sites: [],
};

// The last answer. A decoration pass asks more than once, with the same string
// object, and a document's definitions are a few dozen lines of it.
let memoisedText: string | null = null;
let memoised: Definitions = NOTHING;

/** Read a document's own definitions. */
export function definitions(text: string): Definitions {
  if (text === memoisedText) return memoised;

  const found: Definitions = {
    texts: new Map(),
    wrappers: new Map(),
    environments: new Set(),
    theorems: new Map(),
    named: new Map(),
    sites: [],
  };
  const theoremDefiners = new Set(commandsOfKind("theorem"));
  const tokens = tokensIn(text);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind !== Kind.Command) continue;

    if (COMMAND_DEFINERS.has(token.name)) {
      readCommand(text, token, false, found);
    } else if (DOCUMENT_COMMAND_DEFINERS.has(token.name)) {
      readCommand(text, token, true, found);
    } else if (token.name === "def") {
      readDef(text, token, tokens[index + 1], found);
    } else if (ENVIRONMENT_DEFINERS.has(token.name)) {
      const name = braced(text, skipStar(text, token.after));
      if (name) found.environments.add(name.value.trim());
    } else if (theoremDefiners.has(token.name)) {
      readTheorem(text, token, found);
    }
  }

  // A theorem is an environment too, and is drawn as the more specific thing.
  for (const name of found.theorems.keys()) found.environments.delete(name);

  memoisedText = text;
  memoised = found;
  return found;
}

/** A `{...}` group: what is in it, and where it ends. */
interface Group {
  value: string;
  /** Offset just past the closing brace. */
  end: number;
}

function braced(text: string, at: number): Group | null {
  if (text[at] !== "{") return null;
  const end = matchBrace(text, at);
  if (end === null) return null;
  return { value: text.slice(at + 1, end - 1), end };
}

function bracketed(text: string, at: number): Group | null {
  if (text[at] !== "[") return null;
  const end = matchBracket(text, at);
  if (end === null) return null;
  return { value: text.slice(at + 1, end - 1), end };
}

function skipStar(text: string, at: number): number {
  return text[at] === "*" ? at + 1 : at;
}

/** Past spaces and at most one line break, which TeX reads as nothing here. */
function skipSpace(text: string, at: number): number {
  let cursor = at;
  while (text[cursor] === " " || text[cursor] === "\t") cursor += 1;
  if (text[cursor] === "\n") {
    cursor += 1;
    while (text[cursor] === " " || text[cursor] === "\t") cursor += 1;
  }
  return cursor;
}

/** The name being defined: `{\name}` or a bare `\name`. */
function definedName(text: string, at: number): Group | null {
  const group = braced(text, at);
  const source = group ? group.value.trim() : text.slice(at, at + 80);
  const name = /^\\([a-zA-Z@]+)/.exec(source)?.[1];
  if (!name) return null;
  return { value: name, end: group ? group.end : at + name.length + 1 };
}

function readCommand(
  text: string,
  token: Token,
  documentCommand: boolean,
  found: Definitions,
): void {
  const name = definedName(text, skipStar(text, token.after));
  if (!name) return;
  // What LaTeX or a package defines keeps the meaning it has. A document that
  // redefines `\emph` has changed how it prints, not what it is.
  if (renderingOf(name.value)) return;

  let cursor = skipSpace(text, name.end);
  let parameters: number;
  if (documentCommand) {
    const spec = braced(text, cursor);
    if (!spec) return;
    const letters = spec.value.replace(/\s+/g, "");
    // Only the two shapes drawn below; anything with an optional argument or
    // a star is somebody's programming and stays as source.
    if (letters === "") parameters = 0;
    else if (letters === "m" || letters === "+m") parameters = 1;
    else return;
    cursor = skipSpace(text, spec.end);
  } else {
    const count = bracketed(text, cursor);
    parameters = count ? Number(count.value) : 0;
    if (count) cursor = skipSpace(text, count.end);
    // A default makes the first argument optional, which is not a wrapper.
    if (text[cursor] === "[") return;
  }

  const body = braced(text, cursor);
  if (!body) return;

  if (parameters === 0) found.texts.set(name.value, body.value);
  else if (parameters === 1) {
    found.wrappers.set(name.value, wrapperOf(body.value));
  } else return;
  found.sites.push({ from: token.at, to: body.end });
}

/** `\def\name{text}`, and `\def\csname a name\endcsname{text}`. */
function readDef(
  text: string,
  token: Token,
  next: Token | undefined,
  found: Definitions,
): void {
  if (!next || next.kind !== Kind.Command || next.at !== token.after) return;

  if (next.name === "csname") {
    const close = text.indexOf("\\endcsname", next.after);
    if (close === -1 || close - next.after > 200) return;
    const body = braced(text, close + "\\endcsname".length);
    if (!body) return;
    found.named.set(text.slice(next.after, close).trim(), body.value);
    return;
  }

  // Straight into the body: a `\def` with a parameter text is a parser.
  const body = braced(text, next.after);
  if (!body || renderingOf(next.name)) return;
  found.texts.set(next.name, body.value);
  found.sites.push({ from: token.at, to: body.end });
}

/** What a one-argument definition does with its argument. */
function wrapperOf(body: string): Wrapper {
  if (!body.includes("#1")) return { kind: "dropped" };

  const lookup = /\\csname\s*([^\\#{}]*)#1([^\\#{}]*)\\endcsname/.exec(body);
  if (lookup) {
    return { kind: "lookup", before: lookup[1]!, after: lookup[2]!.trimEnd() };
  }

  // The first command in it that styles an argument is what it wraps.
  for (const token of tokensOfFragment(body)) {
    if (token.kind !== Kind.Command) continue;
    const rendering = renderingOf(token.name);
    if (rendering?.kind === "inline") {
      return { kind: "inline", className: rendering.className };
    }
  }
  return { kind: "plain" };
}

/**
 * A theorem, in either of the two ways one is declared.
 *
 * The kernel's `\newtheorem{name}{Title}[within]` and
 * `\newtheorem{name}[shared]{Title}`, and thmtools'
 * `\declaretheorem[name=Title,numberwithin=part]{name}`. One reader for both:
 * they differ in where the title is written and in nothing the preview draws.
 */
function readTheorem(text: string, token: Token, found: Definitions): void {
  let cursor = token.after;
  const starred = text[cursor] === "*";
  cursor = skipStar(text, cursor);

  const options = bracketed(text, cursor);
  if (options) cursor = skipSpace(text, options.end);
  const name = braced(text, cursor);
  if (!name) return;
  cursor = name.end;

  const shared = bracketed(text, cursor);
  if (shared) cursor = shared.end;
  const title = braced(text, cursor);
  if (title) cursor = title.end;
  const within = bracketed(text, cursor);

  const keys = options ? keyValues(options.value) : new Map<string, string>();
  const key = name.value.trim();
  const counter = (
    keys.get("sibling") ??
    keys.get("numberlike") ??
    keys.get("sharenumber") ??
    shared?.value ??
    key
  ).trim();

  found.theorems.set(key, {
    title: (
      keys.get("name") ??
      keys.get("title") ??
      title?.value ??
      // What thmtools prints when told nothing: the name, capitalised.
      key.charAt(0).toUpperCase() + key.slice(1)
    ).trim(),
    within:
      (
        keys.get("numberwithin") ??
        keys.get("within") ??
        keys.get("parent") ??
        within?.value
      )?.trim() ?? null,
    counter,
    numbered: !starred && keys.get("numbered") !== "no",
  });
}

/** `a=1, b={two, three}` as a map. Braces around a value are dropped. */
function keyValues(source: string): Map<string, string> {
  const found = new Map<string, string>();
  let depth = 0;
  let start = 0;
  const take = (end: number) => {
    const [key, ...rest] = source.slice(start, end).split("=");
    if (!key?.trim()) return;
    const value = rest.join("=").trim();
    found.set(key.trim(), value.replace(/^\{([\s\S]*)\}$/, "$1"));
  };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    else if (character === "," && depth === 0) {
      take(index);
      start = index + 1;
    }
  }
  take(source.length);
  return found;
}

/** How deep one definition may refer to another before it is given up on. */
const DEPTH = 4;

/**
 * The source a defined command stands for, with the document's other
 * definitions filled in.
 *
 * Still source: `Prof.\ Dr.` and `\num{1885}` come back as written, for the
 * caller to draw or to flatten.
 */
export function expand(
  source: string,
  defined: Definitions,
  depth = DEPTH,
): string {
  if (depth === 0 || !source.includes("\\")) return source;

  let out = "";
  let cursor = 0;
  for (const token of tokensOfFragment(source)) {
    if (token.kind !== Kind.Command || token.at < cursor) continue;

    const text = defined.texts.get(token.name);
    if (text !== undefined) {
      out += source.slice(cursor, token.at) + expand(text, defined, depth - 1);
      // A command swallows the space after it, as TeX's reader does.
      cursor = token.after;
      continue;
    }

    const wrapper = defined.wrappers.get(token.name);
    const argument = wrapper ? braced(source, token.after) : null;
    if (!wrapper || !argument) continue;
    out += source.slice(cursor, token.at);
    if (wrapper.kind === "lookup") {
      const value = lookedUp(wrapper, argument.value, defined);
      out += value ?? source.slice(token.at, argument.end);
    } else if (wrapper.kind !== "dropped") {
      out += expand(argument.value, defined, depth - 1);
    }
    cursor = argument.end;
  }
  return out + source.slice(cursor);
}

/** The value a lookup command prints for a key, or nothing if none is kept. */
export function lookedUp(
  wrapper: Extract<Wrapper, { kind: "lookup" }>,
  key: string,
  defined: Definitions,
): string | null {
  const value = defined.named.get(
    `${wrapper.before}${key.trim()}${wrapper.after}`,
  );
  return value === undefined ? null : expand(value, defined);
}

/** Whether a document defines anything at all, which most chapters do not. */
export function definesAnything(defined: Definitions): boolean {
  return (
    defined.texts.size > 0 ||
    defined.wrappers.size > 0 ||
    defined.environments.size > 0 ||
    defined.theorems.size > 0
  );
}

/** One numbered statement in the text: a theorem, a hypothesis. */
export interface Statement {
  /** The environment's name. */
  name: string;
  /** What is printed in front of the number. */
  title: string;
  /** The number it carries, or nothing for an unnumbered one. */
  number: string | null;
  /** What its `[...]` says, as source: the statement's own name. */
  note: string | null;
  /** Offset of the `\begin`. */
  from: number;
  /** Offset just past `\begin{name}` and the note. */
  headTo: number;
  /** Offset of the `\end`. */
  bodyTo: number;
  /** Offset just past `\end{name}`. */
  to: number;
}

/**
 * Every statement in the text, with the number LaTeX would give it.
 *
 * Counted the way the declaration says: on its own, or again from one inside
 * each part, chapter or section, with that unit's number in front. Which is
 * the kernel's `[chapter]` and what a document gets from `numberwithin=part`
 * with the usual `\thepart.\arabic{…}`.
 */
export function statements(
  text: string,
  defined: Definitions,
  headings: readonly Heading[],
  numbers: ReadonlyMap<number, string>,
): Statement[] {
  if (defined.theorems.size === 0) return [];

  const found: Statement[] = [];
  const counted = new Map<string, number>();
  let heading = 0;
  let parts = 0;
  // The unit each heading command last opened, and what it is numbered.
  const units = new Map<string, { from: number; number: string }>();

  for (const environment of environments(text, [...defined.theorems.keys()])) {
    while (
      heading < headings.length &&
      headings[heading]!.from < environment.from
    ) {
      const opened = headings[heading]!;
      heading += 1;
      if (opened.starred) continue;
      if (opened.level === 0) parts += 1;
      units.set(opened.command, {
        from: opened.from,
        number:
          opened.level === 0 ? roman(parts) : (numbers.get(opened.from) ?? ""),
      });
    }

    const theorem = defined.theorems.get(environment.name)!;
    const note = bracketed(text, environment.bodyFrom);

    let number: string | null = null;
    if (theorem.numbered) {
      const unit = theorem.within ? units.get(theorem.within) : undefined;
      const key = `${theorem.counter}@${unit?.from ?? -1}`;
      const next = (counted.get(key) ?? 0) + 1;
      counted.set(key, next);
      number = unit?.number ? `${unit.number}.${next}` : String(next);
    }

    found.push({
      name: environment.name,
      title: theorem.title,
      number,
      note: note ? note.value : null,
      from: environment.from,
      headTo: note ? note.end : environment.bodyFrom,
      bodyTo: environment.bodyTo,
      to: environment.to,
    });
  }

  return found;
}

/** A part's number, as `book` prints it. */
function roman(value: number): string {
  const numerals: [number, string][] = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let rest = value;
  let out = "";
  for (const [size, numeral] of numerals) {
    while (rest >= size) {
      out += numeral;
      rest -= size;
    }
  }
  return out;
}
