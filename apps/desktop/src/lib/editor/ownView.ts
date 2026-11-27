/**
 * Drawing what a document defines for itself, and what it leaves to TeX.
 *
 * The reading is [`definitions.ts`](./definitions.ts)'s; this is the part that
 * touches the editor. Everything here follows the one rule the rest of the
 * preview follows: a decoration over the buffer, gone the moment the caret
 * arrives, so the source is always one arrow key away (ADR-0004).
 */

import { Decoration, WidgetType } from "@codemirror/view";

import { definesAnything, expand, lookedUp } from "./definitions";
import type { Definitions, Statement } from "./definitions";
import { drawable, framed, lineHide, replace, touched } from "./pass";
import type { Pass } from "./pass";
import {
  braceCommands,
  environments,
  matchBrace,
  matchBracket,
  plainText,
} from "./structure";
import { Kind, tokensIn, tokensOfFragment, within } from "./tokens";
import { commandsOfKind, environmentsOfKind, renderingOf } from "./vocabulary";
import { showMachinery } from "./viewModes";
import { t } from "../i18n";

/** A piece of text standing where a command was. */
class DefinedText extends WidgetType {
  constructor(
    readonly content: string,
    readonly className: string,
  ) {
    super();
  }

  override eq(other: DefinedText): boolean {
    return other.content === this.content && other.className === this.className;
  }

  override toDOM(): HTMLElement {
    const node = document.createElement("span");
    node.className = this.className;
    node.textContent = this.content;
    return node;
  }
}

/** A card where the compiler will put a picture. */
class DrawingCard extends WidgetType {
  override eq(): boolean {
    return true;
  }

  override toDOM(): HTMLElement {
    const box = document.createElement("div");
    box.className = "cm-yaz-listing";
    const title = document.createElement("div");
    title.className = "cm-yaz-listing-title";
    title.textContent = t("drawing-title");
    const note = document.createElement("p");
    note.className = "cm-yaz-listing-note";
    note.textContent = t("listing-compiled");
    box.append(title, note);
    return framed(box);
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/** What a defined command prints, as words. */
export function printed(source: string, defined: Definitions): string {
  return plainText(expand(source, defined));
}

/**
 * Draw the document's own commands, environments and statements.
 *
 * After the figures and before the single commands, like every pass that
 * claims a whole construct.
 */
export function drawDefined(
  pass: Pass,
  defined: Definitions,
  found: readonly Statement[],
): void {
  if (!definesAnything(defined)) return;

  for (const statement of found) {
    if (drawable(pass, statement.from, statement.headTo)) {
      const note = statement.note ? printed(statement.note, defined) : "";
      const head =
        [statement.title, statement.number].filter(Boolean).join(" ") +
        (note ? ` (${note})` : "") +
        ".";
      replace(
        pass,
        statement.from,
        statement.headTo,
        new DefinedText(head, "cm-yaz-statement"),
      );
    }
    hideLine(pass, statement.bodyTo, statement.to);
  }

  if (defined.environments.size > 0) {
    for (const own of environments(pass.text, [...defined.environments])) {
      if (within(defined.sites, own.from)) continue;
      // Set apart rather than dissolved. An environment the author made is a
      // kind of passage — a note, an example, a remark — and running it into
      // the paragraphs around it would lose the one thing it says.
      const doc = pass.state.doc;
      const first = doc.lineAt(own.from).number;
      const last = doc.lineAt(own.bodyTo).number;
      for (let number = first; number <= last; number += 1) {
        pass.ranges.push(
          Decoration.line({ class: "cm-yaz-own" }).range(doc.line(number).from),
        );
      }
      if (drawable(pass, own.from, own.bodyFrom)) {
        // The name is the document's own word for it, not the interface's.
        replace(
          pass,
          own.from,
          own.bodyFrom,
          new DefinedText(own.name, "cm-yaz-own-name"),
        );
      }
      hideLine(pass, own.bodyTo, own.to);
    }
  }

  if (defined.wrappers.size > 0) {
    for (const use of braceCommands(pass.text, [...defined.wrappers.keys()])) {
      if (within(defined.sites, use.from)) continue;
      const wrapper = defined.wrappers.get(use.command)!;
      const argument = pass.text.slice(use.argFrom, use.argTo);

      if (wrapper.kind === "lookup" || wrapper.kind === "dropped") {
        const value =
          wrapper.kind === "lookup" ? lookedUp(wrapper, argument, defined) : "";
        // No value under that name is an error the build will report too, and
        // the command left standing is how the preview says so.
        if (value === null || !drawable(pass, use.from, use.to)) continue;
        replace(
          pass,
          use.from,
          use.to,
          value
            ? new DefinedText(plainText(value), "cm-yaz-declared")
            : undefined,
        );
        continue;
      }

      if (
        wrapper.kind === "inline" &&
        wrapper.className &&
        use.argTo > use.argFrom
      ) {
        pass.ranges.push(
          Decoration.mark({ class: wrapper.className }).range(
            use.argFrom,
            use.argTo,
          ),
        );
      }
      if (!touched(pass.state, use.from, use.to)) {
        replace(pass, use.from, use.argFrom);
        replace(pass, use.argTo, use.to);
      }
    }
  }

  if (defined.texts.size > 0) {
    for (const token of tokensIn(pass.text)) {
      if (token.kind !== Kind.Command) continue;
      const source = defined.texts.get(token.name);
      if (source === undefined || within(defined.sites, token.at)) continue;
      if (!drawable(pass, token.at, token.after)) continue;
      const words = printed(source, defined);
      replace(
        pass,
        token.at,
        token.after,
        words ? new DefinedText(words, "cm-yaz-declared") : undefined,
      );
    }
  }
}

/** Hide a range, and its line with it where it has the line to itself. */
function hideLine(pass: Pass, from: number, to: number): void {
  if (!drawable(pass, from, to)) return;
  const whole = lineHide(pass.state, from, to);
  replace(pass, whole?.from ?? from, whole?.to ?? to);
}

/**
 * Numbers with their units: `\qty{19}{\percent}` as `19 %`.
 *
 * Drawn whole, as one piece of text, because that is what it is in print — a
 * figure and its unit that must not come apart at the end of a line.
 */
export function quantities(pass: Pass): void {
  const names = new Set(commandsOfKind("quantity"));
  if (names.size === 0) return;

  for (const token of tokensIn(pass.text)) {
    if (token.kind !== Kind.Command || !names.has(token.name)) continue;
    const rendering = renderingOf(token.name);
    if (rendering?.kind !== "quantity") continue;

    let cursor = token.after;
    if (pass.text[cursor] === "[") {
      const close = matchBracket(pass.text, cursor);
      if (close === null) continue;
      cursor = close;
    }
    const groups: string[] = [];
    const wanted = rendering.numbers + (rendering.unit ? 1 : 0);
    while (groups.length < wanted && pass.text[cursor] === "{") {
      const end = matchBrace(pass.text, cursor);
      if (end === null) break;
      groups.push(pass.text.slice(cursor + 1, end - 1));
      cursor = end;
    }
    if (groups.length < wanted) continue;
    if (!drawable(pass, token.at, cursor)) continue;

    const figures = groups
      .slice(0, rendering.numbers)
      .map((figure) => figure.trim())
      .join("–");
    const unit = rendering.unit ? unitText(groups[groups.length - 1]!) : "";
    replace(
      pass,
      token.at,
      cursor,
      new DefinedText(
        [figures, unit].filter(Boolean).join(NO_BREAK_SPACE),
        "cm-yaz-quantity",
      ),
    );
  }
}

const NO_BREAK_SPACE = " ";

/**
 * A unit as it prints: `\kilo\metre\per\hour` as `km/h`.
 *
 * Each command is whatever symbol the vocabulary gives it, so the table of
 * units is the package's and lives with it. One nobody declared is shown by
 * its name, which is at least what was written.
 */
function unitText(source: string): string {
  let out = "";
  let cursor = 0;
  for (const token of tokensOfFragment(source)) {
    out += source.slice(cursor, token.at);
    cursor = token.after;
    if (token.kind !== Kind.Command) {
      out += token.character;
      continue;
    }
    const rendering = renderingOf(token.name);
    out += rendering?.kind === "symbol" ? rendering.text : token.name;
  }
  return (out + source.slice(cursor)).replace(/[\s{}]+/g, "");
}

/**
 * Pictures the compiler draws, as a card where each will be.
 */
export function drawings(pass: Pass): void {
  const names = environmentsOfKind("drawing");
  if (names.length === 0) return;

  for (const drawing of environments(pass.text, names)) {
    if (pass.covered.overlaps(drawing.from, drawing.to)) continue;
    if (!drawable(pass, drawing.from, drawing.to)) continue;
    const doc = pass.state.doc;
    const first = doc.lineAt(drawing.from);
    const last = doc.lineAt(drawing.to);
    const alone = first.from === drawing.from && last.to === drawing.to;
    if (!pass.covered.claim(drawing.from, drawing.to)) continue;
    pass.ranges.push(
      Decoration.replace({ widget: new DrawingCard(), block: alone }).range(
        drawing.from,
        drawing.to,
      ),
    );
  }
}

/** What opens, turns and closes a TeX conditional. */
const CONDITIONAL = /^(if[a-zA-Z@]*|else|fi)$/;

/**
 * TeX's conditionals, where one has a line to itself.
 *
 * `\ifdraft`, `\else` and `\fi` are a program around the text, not text. The
 * preview does not run it — it cannot know which way a test goes without being
 * TeX — so both branches stay on the page and only the machinery between them
 * goes, under the same switch as the rest of the machinery.
 *
 * Only a line that is commands and nothing else. `\ifdraft Entwurf\fi` has a
 * word on it, and hiding the line would take the word.
 */
export function conditionals(pass: Pass): void {
  if (pass.state.field(showMachinery, false) === true) return;

  const doc = pass.state.doc;
  // The preamble is machinery from end to end and has its own fold; opened,
  // it is shown as written.
  const body = pass.text.indexOf("\\begin{document}");
  let lastLine = -1;
  for (const token of tokensIn(pass.text)) {
    if (token.kind !== Kind.Command || !CONDITIONAL.test(token.name)) continue;
    if (token.at < body) continue;
    // `\iff` is mathematics and `\fi` could be anybody's macro: what the
    // vocabulary knows keeps its meaning.
    if (renderingOf(token.name)) continue;
    const line = doc.lineAt(token.at);
    if (line.number === lastLine) continue;
    if (line.text.trimStart().length !== line.to - token.at) continue;
    if (line.text.replace(/\\[a-zA-Z@]+|[{}\s]/g, "") !== "") continue;
    lastLine = line.number;

    const from = line.to - line.text.trimStart().length;
    if (pass.covered.overlaps(from, line.to)) continue;
    if (!drawable(pass, from, line.to)) continue;
    const whole = lineHide(pass.state, from, line.to);
    replace(pass, whole?.from ?? from, whole?.to ?? line.to);
  }
}
