/**
 * Rich text as decorations over the LaTeX buffer.
 *
 * # There is one document, and it is the `.tex`
 *
 * [ADR-0004](https://generalpawz.github.io/yaz/adr/0004-editor-core-codemirror-single-buffer)
 * decides this: there is a single CodeMirror buffer holding the raw source, and
 * rich text is *decorations over it* — never a second document model and never a
 * LaTeX↔document converter.
 *
 * The consequence is worth stating because it is the whole point. Editing in
 * rich text edits the `.tex`. There is no import, no export, no round trip and
 * nothing to lose in translation; undo is one stack; Vim works in both views
 * because there is only one document for it to work on; and a construct yaz does
 * not understand simply shows as itself rather than being silently rewritten by
 * a converter that did not recognise it.
 *
 * # Markup is hidden, not removed
 *
 * `\textbf{bold}` renders as **bold** by hiding `\textbf{` and `}` and styling
 * what is between them. The characters are still in the document; they are
 * `Decoration.replace`d with nothing.
 *
 * # …and it comes back when the cursor is inside
 *
 * Concealed markup that stays concealed while you edit inside it is unusable:
 * the caret moves through characters that are not on screen, and deleting feels
 * random. So a construct whose range touches the selection is shown in full.
 * That is the behaviour that makes conceal-style editing workable, and its
 * absence is what makes it maddening.
 *
 * # Two kinds of construct, and why some are drawn instead of styled
 *
 * Most are *styled in place*: the text stays where the author typed it and only
 * the markup around it is hidden. Headings, emphasis and lists work this way,
 * because they are prose and prose has to be typed into.
 *
 * Mathematics and tables cannot be. A rendered formula shares no characters
 * with its source, so it is drawn as a widget standing in for the range — and
 * touching it brings the source back, which is how it is edited. The line
 * between the two is whether the rendered form still contains the author's own
 * characters.
 *
 * # Why a state field rather than a view plugin
 *
 * CodeMirror forbids a view plugin from supplying block decorations or
 * replacements that cover a line break, because those change the document's
 * line structure and the viewport is measured before plugins run. Folding the
 * preamble, hiding a `\begin{itemize}` line and drawing a table all do exactly
 * that, so the decorations live in a state field, which is allowed to.
 */

import {
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
} from "@codemirror/state";
import type {
  Extension,
  StateEffectType,
  Text,
  Transaction,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

import { t } from "../i18n";
import {
  Covered,
  drawable,
  emptyLayout,
  NO_LAYOUT,
  replace,
  touched,
} from "./pass";
import { semanticMarkup, semanticTheme } from "./semanticView";
import type { Meaning } from "./semanticView";
import { labelledMarker } from "./semantics";
import type { Layout, Pass } from "./pass";
import { escapeHtml, inlineHtml } from "./inline";
import { renderMath, renderMathEnvironment } from "./math";
import { renderTable, tooComplexToDraw } from "./tabular";
import { fillMetadata, metadata } from "./typography";
import { generatedIn, hasGenerated } from "./generated";
import { listingTabs } from "./listingLink";
import { readProperties } from "./properties";
import { TableWidget, cellAt, tableTabKeymap } from "./tableWidget";
import type { BreakKind, ListingKind } from "./generated";
import {
  commandsOfKind,
  environmentRenderingOf,
  environmentsOfKind,
  renderingOf,
} from "./vocabulary";
import {
  lockTables,
  setShowLineBreaks,
  showLineBreaks,
  showMachinery,
} from "./viewModes";
import {
  braceCommands,
  commentRanges,
  environments,
  headings,
  itemMarkers,
  mathSpans,
  matchBrace,
  preamble,
} from "./structure";
import type { Environment } from "./structure";

/** Inline commands that render as styled text, mapped to their CSS class. */
/**
 * What each inline command draws as, from the vocabulary rather than a copy.
 *
 * This was a list here, and a list here is a list that goes out of date: a
 * command added to the vocabulary would be *recognised* and then drawn as
 * nothing, because the map that says how to draw it had not been told. It also
 * meant a plugin could contribute an inline command and never see it drawn,
 * which would have made `registerLatexVocabulary` a half-promise.
 *
 * Rebuilt on demand rather than cached, because the vocabulary changes when
 * plugins load and reload.
 */
function inlineClasses(): Map<string, string> {
  const found = new Map<string, string>();
  for (const name of commandsOfKind("inline")) {
    const rendering = renderingOf(name);
    if (rendering?.kind === "inline") found.set(name, rendering.className);
  }
  return found;
}

/** Bullets by nesting depth, as LaTeX itself sets them. */
const BULLETS = ["•", "◦", "▪", "·"];

// Re-exported so a caller reaches for one module to switch any part of the
// view on or off, rather than having to know which file each flag lives in.
export {
  lockTables,
  setLockTables,
  setShowLineBreaks,
  setShowMachinery,
  showLineBreaks,
  showMachinery,
} from "./viewModes";

/** Turn rich text on or off. */
export const setRichText = StateEffect.define<boolean>();

/** Whether rich text is on, as editor state so decorations can read it. */
export const richTextEnabled = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setRichText)) return effect.value;
    }
    return value;
  },
});

/** Show or hide the author's comments. */
export const setShowComments = StateEffect.define<boolean>();

/**
 * Whether the comments in the source are on screen.
 *
 * On, because a comment is something the author wrote and rich text is a view
 * of what they wrote. Off is for reading: a document commented as heavily as a
 * thesis under review has more `%` in it than prose, and none of it is going
 * into the PDF.
 *
 * Hidden is not deleted. The characters stay in the buffer, exactly as the
 * markup around a heading does (ADR-0004).
 */
export const showComments = StateField.define<boolean>({
  create: () => true,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setShowComments)) return effect.value;
    }
    return value;
  },
});

/** Show or hide the LaTeX around the text. */
export const setWrapperCollapsed = StateEffect.define<boolean>();

/**
 * Whether the LaTeX wrapping the text is folded away.
 *
 * Collapsed to begin with. The preamble is machinery — `\usepackage` lines,
 * margins, macro definitions — and `\end{document}` is punctuation for the
 * compiler. A view whose purpose is to show the document as it will read
 * should not open on half a page of configuration.
 */
export const wrapperCollapsed = StateField.define<boolean>({
  create: () => true,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setWrapperCollapsed)) return effect.value;
    }
    return value;
  },
});

/**
 * Rendered content standing in for a range of source.
 *
 * Holds HTML rather than a DOM node so that two widgets for the same formula
 * compare equal, which is what stops CodeMirror re-rendering every formula in
 * the document on every keystroke.
 */
class RenderedWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly className: string,
  ) {
    super();
  }

  override eq(other: RenderedWidget): boolean {
    return other.html === this.html && other.className === this.className;
  }

  override toDOM(view: EditorView): HTMLElement {
    const node = document.createElement("span");
    node.className = this.className;
    node.innerHTML = this.html;
    // Clicking a rendered formula or table is how its source is reached: put
    // the cursor where the construct is, and the decoration steps aside on the
    // next update. Without this the widget swallows the click and the source
    // can only be reached by arrowing in from outside it.
    node.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const position = view.posAtDOM(node);
      view.dispatch({ selection: EditorSelection.cursor(position) });
      view.focus();
    });
    return node;
  }

  /** Handled above; CodeMirror should not act on it as well. */
  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * A generated list, standing in for itself.
 *
 * Not the list. `\tableofcontents` produces its pages during typesetting, and
 * the preview does not typeset — so what is drawn here is a card saying which
 * list belongs at this point in the document, and a way to go and read it.
 *
 * # Why not draw the entries
 *
 * It did, and for four rounds it tried to spread them over sheets of paper. A
 * contents list is the one construct in a document whose length nothing in the
 * buffer decides: it depends on where the compiler breaks its pages, which
 * depends in turn on how long the contents list is. An approximation of that
 * on the paper put the wrong number of pages into the middle of the document,
 * and everything after it started in the wrong place.
 *
 * A tab has no such problem, because a tab is not a sheet of paper. So the
 * list goes in a tab and the paper gets a card — which is also nearer to what
 * the author has in front of them in the source, where this really is one line.
 */
class ListingCard extends WidgetType {
  constructor(
    readonly kind: ListingKind,
    /** Whether anything can show this list, which makes the card a way in. */
    readonly linked: boolean,
  ) {
    super();
  }

  override eq(other: ListingCard): boolean {
    return other.kind === this.kind && other.linked === this.linked;
  }

  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("div");
    box.className = "cm-yaz-listing";

    const title = document.createElement("div");
    title.className = "cm-yaz-listing-title";
    title.textContent = t(`listing-${this.kind}`);
    box.append(title);

    if (!this.linked) {
      const note = document.createElement("p");
      note.className = "cm-yaz-listing-note";
      note.textContent = t("listing-compiled");
      box.append(note);
      return box;
    }

    const open = document.createElement("button");
    open.type = "button";
    open.className = "cm-yaz-listing-open";
    open.textContent = t(`listing-open-${this.kind}`);
    open.addEventListener("mousedown", (event) => {
      event.preventDefault();
      // Read at the moment of the click rather than captured: the shell's tabs
      // outlive any one drawing of this card, and a held opener would go stale
      // the first time the card was rebuilt.
      view.state.facet(listingTabs)?.open(this.kind);
    });
    box.append(open);
    return box;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * A command that draws as a piece of text: `\ldots`, `\S`, `\today`.
 *
 * A widget rather than nothing, because these are content. The reader is meant
 * to see an ellipsis where the author wrote `\ldots`, and the caret still
 * reveals the source when it arrives, like every other replacement.
 */
class LiteralWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  override eq(other: LiteralWidget): boolean {
    return other.text === this.text;
  }

  override toDOM(): HTMLElement {
    const node = document.createElement("span");
    node.className = "cm-yaz-literal";
    node.textContent = this.text;
    return node;
  }

  /** It is text: let it be selected and copied like text. */
  override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Space the author asked for: `\vspace{2cm}`, `\quad`, `\bigskip`.
 *
 * Drawn at roughly its size rather than at exactly it. The preview is not
 * typesetting; what matters is that two centimetres reads as more room than
 * two millimetres, and that the page view counts the rows it takes.
 */
class SpaceWidget extends WidgetType {
  constructor(
    readonly axis: "block" | "inline",
    readonly ems: number,
  ) {
    super();
  }

  /** Vertical space is rows on the paper; horizontal space is not. */
  get rows(): number {
    return this.axis === "block" ? Math.round(this.ems) : 0;
  }

  override eq(other: SpaceWidget): boolean {
    return other.axis === this.axis && other.ems === this.ems;
  }

  override toDOM(): HTMLElement {
    const node = document.createElement("span");
    node.className =
      this.axis === "block" ? "cm-yaz-space-block" : "cm-yaz-space-inline";
    if (this.axis === "block") {
      node.style.blockSize = `${this.ems}em`;
    } else {
      node.style.inlineSize = `${this.ems}em`;
    }
    node.setAttribute("aria-hidden", "true");
    return node;
  }
}

/**
 * Commands that rule a table rather than fill one.
 *
 * Needed only to tell "there is another row here" from "the table closes
 * here", which is the difference between a rail with the right number of
 * controls and one with a control for a row nobody wrote.
 */
const ROW_RULES = new Set([
  "hline",
  "toprule",
  "midrule",
  "bottomrule",
  "cline",
  "cmidrule",
  "specialrule",
  "addlinespace",
  "hdashline",
]);

/** How many columns a specification declares. */
function countColumns(spec: string): number {
  let count = 0;
  for (let index = 0; index < spec.length; index += 1) {
    const character = spec[index]!;
    if (character === "{") {
      // A width or a modifier: `p{3cm}`, `>{\raggedright}`.
      let depth = 0;
      for (; index < spec.length; index += 1) {
        if (spec[index] === "{") depth += 1;
        else if (spec[index] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      continue;
    }
    if (/[a-zA-Z*]/.test(character)) count += 1;
  }
  return count;
}

/**
 * How many rows a body has, by counting its `\` at brace depth zero.
 *
 * Counted rather than parsed: this runs on every keystroke and the rails only
 * need to know how many segments to draw. Reading the whole grid here to
 * arrive at the same number was measurably slower for no better answer.
 */
function countRows(text: string, from: number, to: number): number {
  let rows = 0;
  let depth = 0;
  let written = false;

  for (let index = from; index < to; index += 1) {
    const character = text[index]!;
    if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    else if (character === "\\") {
      if (text[index + 1] === "\\" && depth === 0) {
        rows += 1;
        written = false;
        index += 1;
        continue;
      }
      // A rule is not a row. A rule after the last row closes the table;
      // counting it as content gave every table one row more than it has,
      // and a rail with a control for a row nobody wrote.
      const name = /^[a-zA-Z]+/.exec(text.slice(index + 1, index + 20))?.[0];
      if (name && ROW_RULES.has(name)) {
        index += name.length;
        continue;
      }
      index += 1;
      written = true;
    } else if (!/\s/.test(character)) {
      written = true;
    }
  }
  // A last row written without a terminator still counts.
  return written ? rows + 1 : rows;
}

/**
 * Where a page ends, as a rule across the measure.
 *
 * Not where LaTeX will end the page — that is typesetting, and guessing at it
 * would put two different sets of page breaks in front of the same author
 * (ADR-0004's reason for not paginating). This is only the break the author
 * asked for, drawn as the thing it is instead of as a word.
 */
class PageBreakWidget extends WidgetType {
  constructor(readonly kind: BreakKind) {
    super();
  }

  override eq(other: PageBreakWidget): boolean {
    return other.kind === this.kind;
  }

  override toDOM(view: EditorView): HTMLElement {
    const rule = document.createElement("div");
    rule.className = "cm-yaz-pagebreak";
    const label = document.createElement("span");
    label.className = "cm-yaz-pagebreak-label";
    label.textContent = t(`pagebreak-${this.kind}`);
    rule.append(label);
    rule.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({
        selection: EditorSelection.cursor(view.posAtDOM(rule)),
      });
      view.focus();
    });
    return rule;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * The number in front of a heading.
 *
 * Counted from the document rather than read from a build, so it is right
 * whenever the counters have not been meddled with and is the same number
 * every `\ref` to that heading shows. Drawn in the heading's own size and
 * weight, because it is part of the heading and not an annotation on it.
 */
class NumberWidget extends WidgetType {
  constructor(readonly number: string) {
    super();
  }

  override eq(other: NumberWidget): boolean {
    return other.number === this.number;
  }

  override toDOM(): HTMLElement {
    const node = document.createElement("span");
    node.className = "cm-yaz-heading-number";
    node.textContent = `${this.number}${NO_BREAK_SPACE}${NO_BREAK_SPACE}`;
    return node;
  }
}

/** Between a heading's number and its words, so they never come apart. */
const NO_BREAK_SPACE = "\u00a0";

/**
 * The ornament that marks where the text begins and where it ends.
 *
 * A fleuron rather than a labelled button. What is folded away is not content
 * — it is the LaTeX that wraps the content — so the mark should read as
 * typography and not as a control: quiet, centred, the same weight as a page
 * ornament in a printed book. It says it is clickable when the pointer is over
 * it, which is when that is worth knowing.
 *
 * The two glyphs are a pair, U+2767 and U+2766, one the mirror of the other,
 * which is what makes them read as opening and closing rather than as two
 * decorations. Each carries U+FE0E so the platform draws the letterform and
 * not an emoji.
 */
class BoundaryWidget extends WidgetType {
  constructor(
    readonly place: "start" | "end",
    readonly collapsed: boolean,
  ) {
    super();
  }

  override eq(other: BoundaryWidget): boolean {
    return other.place === this.place && other.collapsed === this.collapsed;
  }

  override toDOM(view: EditorView): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cm-yaz-boundary cm-yaz-boundary-${this.place}`;
    button.setAttribute("aria-expanded", String(!this.collapsed));
    button.setAttribute(
      "aria-label",
      this.place === "start" ? t("editor-text-start") : t("editor-text-end"),
    );
    // Written out rather than as one `t(condition ? a : b)`, so that the
    // message-key check can see both keys at the call site (ADR-0011).
    button.title = this.collapsed
      ? t("editor-wrapper-show")
      : t("editor-wrapper-hide");

    const glyph = document.createElement("span");
    glyph.className = "cm-yaz-boundary-glyph";
    // Decorative: the label above already says what this is.
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = this.place === "start" ? "❧︎" : "❦︎";

    button.append(glyph);
    // Without this the editor takes focus and moves the selection before the
    // click lands, scrolling the view for no reason.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      view.dispatch({ effects: setWrapperCollapsed.of(!this.collapsed) });
      view.focus();
    });
    return button;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Build the decorations for the whole document.
 *
 * Deliberately over the whole document rather than the visible ranges. A
 * construct can begin above the viewport and end inside it, and scanning only
 * what is visible splits it — the closing brace gets hidden while the opening
 * one, off-screen, does not, so scrolling changes what the text looks like.
 *
 * This is linear in document length and runs on edits — about 2 ms for a
 * paper-sized file and 11 ms for a hundred-page manuscript, against the 16 ms
 * ADR-0015 gives the whole keystroke. `keystroke.test.ts` holds that line. The
 * buffer is one paper, and when that stops being true the Lezer grammar
 * arriving in phase 4 gives an incremental tree to hang this off instead.
 * Typesetting is cached by source (see `./math`), so a keystroke re-renders
 * the formula it is inside and no
 * others.
 *
 * Order matters: the widest constructs claim their ranges first, and a
 * replacement landing inside one already claimed is dropped.
 */
function build(state: EditorState): Rendered {
  if (!state.field(richTextEnabled, false)) {
    return { decorations: Decoration.none, layout: NO_LAYOUT };
  }

  const pass: Pass = {
    state,
    text: state.doc.toString(),
    ranges: [],
    covered: new Covered(),
    layout: emptyLayout(),
  };

  boundaries(pass);
  comments(pass);
  structure(pass);
  tables(pass);
  mathematics(pass);
  // Before the lists, which need to know when one sets its own markers, and
  // before the headings, which show the label they carry.
  const meaning = semanticMarkup(pass);
  // Last of the wide ones, and deliberately. This claims *single commands*,
  // and single commands live inside the wide things: `\hline` inside a table,
  // `\centering` inside a figure. Claiming the small one first left the table
  // and the float unable to claim themselves, so each fell back to showing its
  // source — a table that stopped being a table because of a rule inside it.
  generated(pass);
  lists(pass, meaning);
  quotes(pass);
  inlineMarkup(pass, meaning);

  // Sorting is CodeMirror's, which knows how line, mark and replace decorations
  // order against each other at the same position.
  return {
    decorations: Decoration.set(pass.ranges, true),
    layout: pass.layout,
  };
}

/** What one pass produced: what to draw, and what shape it comes out. */
export interface Rendered {
  decorations: DecorationSet;
  /** See {@link Layout}. The page view reads this; nothing else needs it. */
  layout: Layout;
}

/**
 * How far into a file `\begin{document}` is looked for.
 *
 * Bounded because this runs on the keystroke path, and searching a whole
 * hundred-page manuscript for something that is by definition near the top
 * would be work spent to find nothing. A preamble longer than this is not a
 * preamble.
 */
const PREAMBLE_LIMIT = 65536;

/** What the wrapper covers: the preamble, and the `\end{document}` line. */
interface Wrapper {
  /** Everything up to and including the `\begin{document}` line. */
  start: { from: number; to: number };
  /** The `\end{document}` line, with the line break that precedes it. */
  end: { from: number; to: number } | null;
}

/**
 * The ranges the boundary marks stand in for.
 *
 * `null` when there is no `\begin{document}` at all, which is what an
 * `\input`-ed chapter looks like: it is all text, so there is no boundary to
 * draw. A `\begin{document}` with no `\end` is a document being written, and
 * gets its opening mark without a closing one.
 */
function wrapper(doc: Text): Wrapper | null {
  const found = preamble(
    doc.sliceString(0, Math.min(doc.length, PREAMBLE_LIMIT)),
  );
  if (!found) return null;

  // Out to the end of the line, so folding does not leave the remains of the
  // `\begin{document}` line hanging above the text — and on through
  // `\maketitle`, which is machinery rather than writing: it produces the
  // title block from what the preamble already declared, and leaving it
  // stranded on its own above the first paragraph would show the seam this
  // mark exists to hide.
  const start = {
    from: found.from,
    to: titleBlockEnd(doc, doc.lineAt(found.to).number),
  };

  // Searched from the end and bounded, for the same reason the preamble is
  // searched from the start and bounded: this runs on every keystroke, and
  // `doc.toString()` on a hundred-page manuscript allocates the whole
  // manuscript to find something that is on the last line.
  const tail = Math.max(0, doc.length - CLOSING_LIMIT);
  const closingInTail = doc.sliceString(tail).lastIndexOf(END_DOCUMENT);
  const closing = closingInTail === -1 ? -1 : tail + closingInTail;
  if (closing === -1 || closing < start.to) return { start, end: null };

  const line = doc.lineAt(closing);
  // Only when it is the whole line. `text. \end{document}` on one line has the
  // author's own words on it.
  if (line.text.trim() !== END_DOCUMENT) return { start, end: null };
  // Swallow the line break before it, or an empty line is left behind.
  return {
    start,
    end: { from: Math.max(line.from - 1, start.to), to: line.to },
  };
}

/** What closes a document. */
const END_DOCUMENT = "\\end{document}";

/**
 * Commands that belong to the title block rather than to the text.
 *
 * Deliberately short. Anything absorbed here disappears behind the mark, so
 * this may only hold commands that produce no writing of their own —
 * `\tableofcontents` is not among them, because a contents page is something
 * the reader looks at.
 */
const TITLE_BLOCK = /^\\(maketitle|thispagestyle\{[^}]*\})$/;

/**
 * How far the opening fold reaches, given the `\begin{document}` line.
 *
 * Absorbs blank lines and title-block commands, but only if a title-block
 * command is actually reached — otherwise a document that simply starts with a
 * blank line would have it eaten, and the first paragraph would sit tight
 * against the mark.
 */
function titleBlockEnd(doc: Text, beginLine: number): number {
  let end = doc.line(beginLine).to;
  for (let number = beginLine + 1; number <= doc.lines; number += 1) {
    const line = doc.line(number);
    const text = line.text.trim();
    if (text === "") continue;
    if (!TITLE_BLOCK.test(text)) break;
    end = line.to;
  }
  return end;
}

/**
 * How far back from the end `\end{document}` is looked for.
 *
 * Small, because it is on the last line of every real document. What follows
 * it, if anything, is a stray comment.
 */
const CLOSING_LIMIT = 4096;

/** The LaTeX around the text, folded behind a mark at each end. */
function boundaries(pass: Pass): void {
  const found = wrapper(pass.state.doc);
  if (!found) return;

  if (!pass.state.field(wrapperCollapsed, false)) {
    // Expanded, the marks sit where they would be when collapsed — above the
    // preamble and below the last line — so clicking one again puts things
    // back where they were, rather than somewhere else.
    pass.ranges.push(
      Decoration.widget({
        widget: new BoundaryWidget("start", false),
        block: true,
        side: -1,
      }).range(found.start.from),
    );
    // The opened matter is banded, so the mark reads as the head of a region
    // rather than as a rule with configuration loose underneath it. One row
    // closed, a band of rows open — the same thing either way.
    band(pass, found.start.from, found.start.to, "front");
    if (found.end) {
      pass.ranges.push(
        Decoration.widget({
          widget: new BoundaryWidget("end", false),
          block: true,
          side: 1,
        }).range(pass.state.doc.length),
      );
      band(pass, found.end.from, found.end.to, "back");
    }
    return;
  }

  const doc = pass.state.doc;
  if (
    replace(
      pass,
      found.start.from,
      found.start.to,
      new BoundaryWidget("start", true),
    )
  ) {
    // Folded or open, it is the same region and gets the same short sheet.
    const line = doc.lineAt(found.start.from).number;
    pass.layout.matter.push({ from: line, to: line });
  }
  if (
    found.end &&
    replace(pass, found.end.from, found.end.to, new BoundaryWidget("end", true))
  ) {
    const line = doc.lineAt(found.end.to).number;
    pass.layout.matter.push({ from: line, to: line });
  }
}

/**
 * The document's generated parts: its lists, its page breaks, its scaffolding.
 *
 * Guarded by a cheap look first, because most documents have none of this and
 * would otherwise pay for a walk of themselves on every keystroke.
 */
function generated(pass: Pass): void {
  if (!hasGenerated(pass.text)) return;
  const found = generatedIn(pass.text, readProperties(pass.text).language);

  for (const listing of found.listings) {
    if (touched(pass.state, listing.from, listing.to)) {
      pass.covered.claim(listing.from, listing.to);
      continue;
    }
    listed(pass, listing.from, listing.to, listing.kind);
  }

  for (const pageBreak of found.breaks) {
    if (touched(pass.state, pageBreak.from, pageBreak.to)) {
      pass.covered.claim(pageBreak.from, pageBreak.to);
      continue;
    }
    replace(
      pass,
      pageBreak.from,
      pageBreak.to,
      new PageBreakWidget(pageBreak.kind),
    );
  }

  for (const literal of found.literals) {
    // Replaced rather than hidden. `\ldots` *is* an ellipsis the author wrote
    // and `\today` is a date the reader will see printed — taking them away
    // would be losing text, not hiding markup.
    if (touched(pass.state, literal.from, literal.to)) {
      pass.covered.claim(literal.from, literal.to);
      continue;
    }
    replace(pass, literal.from, literal.to, new LiteralWidget(literal.text));
  }

  for (const space of found.spaces) {
    if (touched(pass.state, space.from, space.to)) {
      pass.covered.claim(space.from, space.to);
      continue;
    }
    replace(pass, space.from, space.to, new SpaceWidget(space.axis, space.ems));
  }

  // View → Document machinery. Off means hidden, which is the default, and on
  // means shown as written — the switch exists so an author can see what their
  // preamble is doing without leaving the preview.
  if (pass.state.field(showMachinery, false) !== true) {
    for (const command of found.machinery) {
      // Hidden rather than drawn, and revealed by the caret like everything
      // else — so it is one arrow key away rather than a mode switch away.
      if (touched(pass.state, command.from, command.to)) {
        pass.covered.claim(command.from, command.to);
        continue;
      }
      replace(pass, command.from, command.to);
    }
  }
}

/**
 * Draw a generated list as a card standing in for it.
 *
 * A block replacement of the whole line, because that is what the command is:
 * `\tableofcontents` on a line of its own is a paragraph-level instruction,
 * and a card sitting inside a line of text would read as part of a sentence.
 *
 * Whether the card is a way in depends on whether anything can show the list —
 * the outline answers for the contents, and a plugin answers for the glossary
 * ([`listingLink.ts`](./listingLink.ts)). Where nothing does, the card says
 * the compiler makes this and leaves it at that, which is true and is more
 * than the bare command said.
 */
function listed(pass: Pass, from: number, to: number, kind: ListingKind): void {
  const tabs = pass.state.facet(listingTabs);
  const card = new ListingCard(kind, tabs?.has(kind) === true);
  const line = pass.state.doc.lineAt(from);

  // A line holding nothing but the command becomes the card. A command with
  // text around it is replaced in place, so the author's words stay put.
  const alone = line.from === from && line.to === to;
  if (!alone) {
    replace(pass, from, to, card);
    return;
  }
  if (!pass.covered.claim(line.from, line.to)) return;
  pass.ranges.push(
    Decoration.replace({ widget: card, block: true }).range(line.from, line.to),
  );
}

/**
 * Mark every line of the opened front or back matter.
 *
 * A line decoration per line rather than one range: CodeMirror styles lines,
 * and a preamble is a handful of them. The band is what makes the region read
 * as one thing when it is open — in the page view it runs the full width of
 * the paper, which is where the difference between the document and the
 * machinery around it is worth drawing.
 */
function band(
  pass: Pass,
  from: number,
  to: number,
  place: "front" | "back",
): void {
  const doc = pass.state.doc;
  const last = doc.lineAt(Math.min(to, doc.length)).number;
  // The closing range starts at the line break *before* it, so that collapsing
  // takes the blank line with it. That offset still belongs to the line above,
  // which is the author's last paragraph — start below it.
  const opening = doc.lineAt(from);
  const first =
    from >= opening.to
      ? Math.min(opening.number + 1, doc.lines)
      : opening.number;
  for (let number = first; number <= last; number += 1) {
    pass.ranges.push(
      Decoration.line({
        class: `cm-yaz-matter cm-yaz-matter-${place}`,
      }).range(doc.line(number).from),
    );
  }
  // Told to the page view, which gives it a short sheet of its own. It is what
  // the file wraps the document in rather than a page of the document, and a
  // preamble occupying the first sheet of A4 would open the paper on a page
  // that is not in it.
  pass.layout.matter.push({ from: first, to: last });
}

/**
 * The author's comments, when they are not wanted on screen.
 *
 * A comment that is a whole line takes its line break with it, so switching
 * them off closes the gap rather than leaving a blank line where each one was
 * — which would be a document full of holes.
 *
 * Claimed before anything else looks at the text, so a construct that was
 * commented out is never half-drawn.
 */
function comments(pass: Pass): void {
  if (pass.state.field(showComments, false) !== false) return;

  for (const comment of commentRanges(pass.text)) {
    if (!drawable(pass, comment.from, comment.to)) continue;
    const whole = lineHide(pass.state, comment.from, comment.to);
    replace(pass, whole?.from ?? comment.from, whole?.to ?? comment.to);
  }
}

/**
 * Environments that are arrangement, with their `\begin` and `\end` hidden.
 *
 * The same treatment a list gets, for the same reason: what is inside them is
 * the document, and `\begin{titlepage}` is an instruction to the typesetter.
 */
function structure(pass: Pass): void {
  for (const found of environments(
    pass.text,
    environmentsOfKind("structural"),
  )) {
    for (const [from, to] of [
      [found.from, found.bodyFrom],
      [found.bodyTo, found.to],
    ]) {
      if (!drawable(pass, from!, to!)) continue;
      // The line break goes too, or a blank line is left where the command was.
      const whole = lineHide(pass.state, from!, to!);
      replace(pass, whole?.from ?? from!, whole?.to ?? to!);
    }
  }
}

/** Tables, drawn from their source. */
function tables(pass: Pass): void {
  // Once, not once per table. Read inside the loop this was five walks of the
  // document per table, which is quadratic in a document made largely of
  // tables — and the keystroke tripwire caught it at 29x the cost for 6x the
  // document.
  const declared = metadata(pass.text);

  for (const table of environments(pass.text, environmentsOfKind("table"))) {
    // How many `{...}` arguments come before the column specification is a
    // property of the environment — `tabularx` takes a width first — and the
    // vocabulary is where that is written down.
    const rendering = environmentRenderingOf(table.name);
    const read = columnSpec(
      pass.text,
      table.bodyFrom,
      rendering?.kind === "table" ? rendering.columnArguments : 0,
    );
    if (!read) continue;

    // Filled before it is drawn: a table is rendered from its source, so
    // `\theauthor` in a cell would otherwise reach the screen as those letters.
    // The title page of a real thesis sets the author and the reviewer this way.
    const body = fillMetadata(
      pass.text.slice(read.bodyFrom, table.bodyTo),
      declared,
    );
    // A construct this parser would draw wrongly is shown as source instead.
    // The author can see that source is source; they cannot see that a drawn
    // table has quietly lost a row.
    if (tooComplexToDraw(body)) continue;

    const html = renderTable(read.spec, body);
    if (html === null) continue;

    // View → Keep tables drawn. Off, the usual rule applies and the caret
    // reveals the source. On, the table stays — because for a table the usual
    // rule works against itself: what you clicked into *is* the table, and
    // showing the source takes it away at the moment you wanted it.
    const locked = pass.state.field(lockTables, false) === true;
    const inside = touched(pass.state, table.from, table.to);
    if (inside && !locked) {
      // Claimed even while revealed, so nothing else decorates the source the
      // author is currently editing.
      pass.covered.claim(table.from, table.to);
      continue;
    }

    // Which cell the caret is in, so the widget can mark it. A caret inside a
    // widget is not drawn by the browser, and a table you can edit without
    // seeing where you are would be worse than one that showed its source.
    const active =
      inside && locked
        ? cellAt(
            pass.text,
            read.bodyFrom,
            table.bodyTo,
            pass.state.selection.main.head,
          )
        : null;

    replace(
      pass,
      table.from,
      table.to,
      // How many rows and columns it has is worked out by the widget when it is
      // built, not here. This runs on every keystroke and building the widget
      // does not — reading the grid here cost 3 ms of the 16 on a document
      // made largely of tables, for a number nothing needs until it is drawn.
      // What is drawn and how many cells there are — no offsets. The widget
      // finds where it ended up when a control is pressed, which is what stops
      // a keystroke above a table rebuilding it just because it moved.
      new TableWidget(
        html,
        countColumns(read.spec),
        countRows(pass.text, read.bodyFrom, table.bodyTo),
        active,
      ),
    );
  }
}

/** Mathematics, typeset by KaTeX: environments first, then `$…$` and friends. */
function mathematics(pass: Pass): void {
  const draw = (from: number, to: number, html: string, display: boolean) => {
    if (touched(pass.state, from, to)) {
      pass.covered.claim(from, to);
      return;
    }
    replace(
      pass,
      from,
      to,
      new RenderedWidget(
        html,
        display ? "cm-yaz-block cm-yaz-math-display" : "cm-yaz-math",
      ),
    );
  };

  for (const environment of environments(
    pass.text,
    environmentsOfKind("math"),
  )) {
    if (pass.covered.overlaps(environment.from, environment.to)) continue;
    const html = renderMathEnvironment(
      environment.name,
      pass.text.slice(environment.bodyFrom, environment.bodyTo),
      pass.text.slice(environment.from, environment.to),
    );
    // Mathematics KaTeX will not take is left as source, undecorated. A formula
    // is invalid for most of the keystrokes it takes to write one, and an error
    // message where the formula should be would be worse than the source that
    // is already there.
    if (html === null) continue;
    draw(environment.from, environment.to, html, true);
  }

  for (const span of mathSpans(pass.text)) {
    if (pass.covered.overlaps(span.from, span.to)) continue;
    const html = renderMath(
      pass.text.slice(span.bodyFrom, span.bodyTo),
      span.display,
    );
    if (html === null) continue;
    draw(span.from, span.to, html, span.display);
  }
}

/**
 * Lists: a bullet or number in place of `\item`, and the environment lines
 * hidden.
 *
 * Styled in place rather than drawn as a widget, because a list is prose. Its
 * text has to be typed into, and text inside a widget cannot be.
 *
 * # Nesting is worked out by sweeping, not by searching
 *
 * Every item and every line has to know which list it is innermost in. Asking
 * that by searching all the lists, for each of them, is cubic — measured at
 * 170 ms per keystroke on a hundred-page manuscript, against ADR-0015's 16 ms
 * budget for the whole keystroke. Both sequences are already in document
 * order, so one pass with a stack answers it for all of them.
 */
function lists(pass: Pass, meaning: Meaning): void {
  const found = environments(pass.text, environmentsOfKind("list"));
  if (found.length === 0) return;

  const depths = nestingDepths(found);
  const markers = itemMarkers(pass.text);
  const markerOwners = innermost(
    found,
    markers.map((marker) => marker.from),
  );

  for (const list of found) {
    for (const [from, to] of [
      [list.from, list.bodyFrom],
      [list.bodyTo, list.to],
    ]) {
      if (touched(pass.state, from!, to!)) continue;
      // Hiding the line break as well is what stops a blank line being left
      // where the environment was.
      const whole = lineHide(pass.state, from!, to!);
      replace(pass, whole?.from ?? from!, whole?.to ?? to!);
    }
  }

  indent(pass, found, depths);

  const counts = new Map<Environment, number>();
  markers.forEach((marker, index) => {
    const list = markerOwners[index];
    if (!list) return;

    const depth = depths.get(list) ?? 0;
    const position = counts.get(list) ?? 0;
    counts.set(list, position + 1);

    // A list that sets its own marker gets it: `label=lph*)` is the author
    // saying what the list should read as, and drawing a bullet instead would
    // be the editor overruling the document.
    const own = meaning.listMarkers.get(list.from);
    const label =
      marker.labelFrom !== null && marker.labelTo !== null
        ? inlineHtml(pass.text.slice(marker.labelFrom, marker.labelTo))
        : escapeHtml(
            (own && labelledMarker(own.label, own.start + position)) ??
              itemLabel(list.name, depth, position),
          );

    if (touched(pass.state, marker.from, marker.to)) {
      pass.covered.claim(marker.from, marker.to);
      return;
    }
    replace(
      pass,
      marker.from,
      marker.to,
      new RenderedWidget(label, "cm-yaz-item-marker"),
    );
  });
}

/** How many lists enclose each one, which sets both its marker and its indent. */
function nestingDepths(found: Environment[]): Map<Environment, number> {
  const depths = new Map<Environment, number>();
  const open: Environment[] = [];
  for (const list of found) {
    while (open.length > 0 && open[open.length - 1]!.to <= list.from)
      open.pop();
    depths.set(list, open.length);
    open.push(list);
  }
  return depths;
}

/**
 * The innermost environment containing each offset.
 *
 * Both arguments must be in document order, which they are: environments come
 * back sorted, and the scanners walk the text forwards. Environments nest
 * properly — they are paired by a stack in the first place — so a stack is
 * enough to answer for every offset in one pass.
 */
function innermost(
  found: Environment[],
  offsets: number[],
): (Environment | null)[] {
  const owners: (Environment | null)[] = [];
  const open: Environment[] = [];
  let next = 0;

  for (const offset of offsets) {
    while (next < found.length && found[next]!.from <= offset) {
      open.push(found[next]!);
      next += 1;
    }
    while (open.length > 0 && open[open.length - 1]!.to <= offset) open.pop();

    const top = open[open.length - 1];
    owners.push(
      top && offset >= top.bodyFrom && offset < top.bodyTo ? top : null,
    );
  }

  return owners;
}

/** Indent the lines each list owns, so nesting is visible as nesting. */
function indent(
  pass: Pass,
  found: Environment[],
  depths: Map<Environment, number>,
): void {
  const numbers = new Set<number>();
  for (const list of found) {
    const first = pass.state.doc.lineAt(list.bodyFrom).number + 1;
    const last = pass.state.doc.lineAt(list.bodyTo).number - 1;
    for (let number = first; number <= last; number += 1) numbers.add(number);
  }

  const lines = [...numbers]
    .sort((a, b) => a - b)
    .map((number) => pass.state.doc.line(number));
  const owners = innermost(
    found,
    lines.map((line) => line.from),
  );

  lines.forEach((line, index) => {
    const list = owners[index];
    if (!list) return;
    if (pass.covered.overlaps(line.from, line.to)) return;
    const depth = Math.min((depths.get(list) ?? 0) + 1, 4);
    pass.ranges.push(
      Decoration.line({ class: `cm-yaz-list cm-yaz-list-${depth}` }).range(
        line.from,
      ),
    );
  });
}

/**
 * Quotations: the environment lines hidden, the words set apart.
 *
 * Indented and in the prose face rather than drawn as a widget, because the
 * text inside is the author's and has to stay editable — the same reason lists
 * are styled in place.
 */
function quotes(pass: Pass): void {
  for (const quote of environments(pass.text, environmentsOfKind("quote"))) {
    for (const [from, to] of [
      [quote.from, quote.bodyFrom],
      [quote.bodyTo, quote.to],
    ]) {
      if (touched(pass.state, from!, to!)) continue;
      const whole = lineHide(pass.state, from!, to!);
      replace(pass, whole?.from ?? from!, whole?.to ?? to!);
    }

    const first = pass.state.doc.lineAt(quote.bodyFrom).number + 1;
    const last = pass.state.doc.lineAt(quote.bodyTo).number - 1;
    for (let number = first; number <= last; number += 1) {
      const line = pass.state.doc.line(number);
      if (pass.covered.overlaps(line.from, line.to)) continue;
      pass.ranges.push(
        Decoration.line({ class: "cm-yaz-quote" }).range(line.from),
      );
    }
  }
}

/**
 * Headings and inline commands.
 *
 * The styling mark is applied whatever else is happening — a mark over replaced
 * text simply does not show, and refusing to style a heading because it
 * contains a formula would be worse than either. Only the ranges that *hide*
 * markup have to respect what is already claimed.
 */
function inlineMarkup(pass: Pass, meaning: Meaning): void {
  for (const heading of headings(pass.text)) {
    const level = Math.min(heading.level, 6);
    const label = meaning.labelled.get(heading.from);
    const number = meaning.numbers.get(heading.from);

    if (heading.titleTo > heading.titleFrom) {
      pass.ranges.push(
        Decoration.mark({
          class: `cm-yaz-heading cm-yaz-h${level}`,
          // The label is folded into the heading rather than shown beside it,
          // so this is the only place it is still legible — which is what a
          // hover is for, and what someone writing a `\ref` needs.
          ...(label
            ? { attributes: { title: t("heading-label", { label }) } }
            : {}),
        }).range(heading.titleFrom, heading.titleTo),
      );
    }
    if (!touched(pass.state, heading.from, heading.to)) {
      // Hide `\section{` and the closing brace, leaving the words — and put the
      // number LaTeX would print in front of it, which is what a reader of the
      // finished document sees and what every `\ref` to it will say.
      replace(
        pass,
        heading.from,
        heading.titleFrom,
        number ? new NumberWidget(number) : undefined,
      );
      replace(pass, heading.titleTo, heading.to);
    }
  }

  const classes = inlineClasses();
  for (const command of braceCommands(pass.text, [...classes.keys()])) {
    const className = classes.get(command.command);
    // `undefined` rather than falsy: `	extnormal` draws as *no* class, and
    // that is still drawing it — the markup around it has to go.
    if (className === undefined) continue;
    // Zero-length arguments would produce an empty mark, which CodeMirror
    // rejects, and `\emph{}` in a draft is not unusual.
    if (command.argTo > command.argFrom) {
      pass.ranges.push(
        Decoration.mark({ class: className }).range(
          command.argFrom,
          command.argTo,
        ),
      );
    }
    if (!touched(pass.state, command.from, command.to)) {
      replace(pass, command.from, command.argFrom);
      replace(pass, command.argTo, command.to);
    }
  }
}

/** Where a construct is the whole line, the range that hides the line with it. */
function lineHide(
  state: EditorState,
  from: number,
  to: number,
): { from: number; to: number } | null {
  const line = state.doc.lineAt(from);
  if (line.number !== state.doc.lineAt(to).number) return null;
  // Only when the command is the whole line. `\begin{itemize} \item a` on one
  // line has text on it to keep.
  if (line.text.trim() !== state.doc.sliceString(from, to).trim()) return null;

  // Swallow a line break with it, or an empty line is left behind. The one
  // before is preferred: taking the one after would pull the first item up.
  if (line.from > 0) return { from: line.from - 1, to: line.to };
  if (line.to < state.doc.length) return { from: line.from, to: line.to + 1 };
  return { from: line.from, to: line.to };
}

/** The marker for an item, given its list's kind, depth and position. */
function itemLabel(kind: string, depth: number, index: number): string {
  if (kind === "enumerate") {
    if (depth === 1) return `(${String.fromCharCode(97 + (index % 26))})`;
    if (depth >= 2) return `${roman(index + 1)}.`;
    return `${index + 1}.`;
  }
  return BULLETS[Math.min(depth, BULLETS.length - 1)]!;
}

/** Lower-case roman numerals, for the third level of a nested enumeration. */
function roman(value: number): string {
  const digits: [number, string][] = [
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let left = value;
  let out = "";
  for (const [amount, numeral] of digits) {
    while (left >= amount) {
      out += numeral;
      left -= amount;
    }
  }
  return out;
}

/** Read a table's column specification, starting just past `\begin{tabular}`. */
function columnSpec(
  text: string,
  at: number,
  widthArguments: number,
): {
  spec: string;
  /** Where the specification's own text starts and ends, inside its braces. */
  specFrom: number;
  specTo: number;
  bodyFrom: number;
} | null {
  let cursor = at;
  let specFrom = 0;
  let specTo = 0;
  const group = (): string | null => {
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    if (text[cursor] !== "{") return null;
    const end = matchBrace(text, cursor);
    if (end === null) return null;
    const inner = text.slice(cursor + 1, end - 1);
    specFrom = cursor + 1;
    specTo = end - 1;
    cursor = end;
    return inner;
  };

  for (let taken = 0; taken < widthArguments; taken += 1) {
    if (group() === null) return null;
  }
  // The optional vertical-position argument, `[t]` or `[b]`.
  while (/\s/.test(text[cursor] ?? "")) cursor += 1;
  if (text[cursor] === "[") {
    const close = text.indexOf("]", cursor);
    if (close === -1) return null;
    cursor = close + 1;
  }
  const spec = group();
  if (spec === null) return null;
  return { spec, specFrom, specTo, bodyFrom: cursor };
}

/**
 * The decorations, as editor state.
 *
 * A state field rather than a view plugin because only a state field may supply
 * block decorations and replacements that cover a line break — see the note at
 * the top of this file.
 */
const rendered = StateField.define<Rendered>({
  create: (state) => build(state),
  update(value, transaction) {
    // Selection changes matter as much as edits: moving the caret into a
    // construct is what reveals its markup.
    const toggled = transaction.effects.some(
      (effect) =>
        effect.is(setRichText) ||
        effect.is(setWrapperCollapsed) ||
        effect.is(setShowComments) ||
        effect.is(setShowLineBreaks),
    );
    // Where a generated list can be read changes what its card says, and a
    // card that still offered a tab the shell had dropped would be a dead end.
    const retabbed =
      transaction.startState.facet(listingTabs) !==
      transaction.state.facet(listingTabs);
    if (
      transaction.docChanged ||
      toggled ||
      retabbed ||
      !transaction.state.selection.eq(transaction.startState.selection)
    ) {
      return build(transaction.state);
    }
    return value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
});

/**
 * What the pass drew, for the page view to count.
 *
 * Read with a default, because the page view also runs over a plain text file
 * that has no rich text at all — and a file with no rich text has nothing
 * folded and nothing standing taller than its own line, which is exactly what
 * an empty layout says.
 */
export function layoutOf(state: EditorState): Layout {
  return state.field(rendered, false)?.layout ?? NO_LAYOUT;
}

/** A field's value after a transaction, without building the new state. */
function after<T>(
  transaction: Transaction,
  field: StateField<T>,
  effect: StateEffectType<T>,
  fallback: T,
): T {
  let value = transaction.startState.field(field, false) ?? fallback;
  for (const candidate of transaction.effects) {
    if (candidate.is(effect)) value = candidate.value;
  }
  return value;
}

/**
 * Keep the cursor out of the folded LaTeX.
 *
 * A cursor inside a replacement is invisible, and typing at it edits text the
 * author cannot see — `\usepackage` lines, or `\end{document}`. It is
 * reachable in ordinary use: opening a file puts the cursor at offset zero,
 * which is inside the opening fold.
 *
 * So an empty selection landing in a fold is moved to the nearest position
 * outside it. A non-empty one is left alone: selecting everything and typing
 * means replacing everything, and that includes the wrapper.
 */
const cursorStaysOutOfTheFold = EditorState.transactionFilter.of(
  (transaction) => {
    if (!after(transaction, richTextEnabled, setRichText, false))
      return transaction;
    if (!after(transaction, wrapperCollapsed, setWrapperCollapsed, true)) {
      return transaction;
    }

    const selection = transaction.newSelection;
    if (!selection.ranges.some((range) => range.empty)) return transaction;

    const found = wrapper(transaction.newDoc);
    if (!found) return transaction;

    // Each fold names where a cursor caught inside it should go. The target is
    // always outside the range that catches, or the moved cursor would be
    // caught again and the filter would never settle.
    const traps: { from: number; to: number; target: number }[] = [];
    if (found.start.to + 1 <= transaction.newDoc.length) {
      traps.push({
        from: found.start.from,
        to: found.start.to,
        target: found.start.to + 1,
      });
    }
    if (found.end) {
      traps.push({
        from: found.end.from + 1,
        to: found.end.to,
        target: found.end.from,
      });
    }

    const trapping = (position: number) =>
      traps.find((trap) => position >= trap.from && position <= trap.to);

    if (
      !selection.ranges.some((range) => range.empty && trapping(range.from))
    ) {
      return transaction;
    }

    const moved = selection.ranges.map((range) => {
      const trap = range.empty ? trapping(range.from) : undefined;
      return trap ? EditorSelection.cursor(trap.target) : range;
    });
    return [
      transaction,
      {
        selection: EditorSelection.create(moved, selection.mainIndex),
      },
    ];
  },
);

/** The rich-text extension: state, decorations and their styling. */
export function richText(): Extension {
  // Order matters: `decorations` reads the two flags as it is created.
  return [
    richTextEnabled,
    wrapperCollapsed,
    showComments,
    showLineBreaks,
    showMachinery,
    lockTables,
    rendered,
    // Before the other keymaps, so Tab in a table means "next cell" rather
    // than an indent. It refuses everywhere else, so nothing else changes.
    tableTabKeymap(),
    cursorStaysOutOfTheFold,
    theme,
    semanticTheme,
  ];
}

/**
 * How the styled text looks.
 *
 * Sizes are relative so the whole thing scales with the editor's font size, and
 * colours come from the token contract — a literal here would be a lint failure
 * and would stop a user theme restyling the rich view
 * ([ADR-0010](https://generalpawz.github.io/yaz/adr/0010-theming)).
 */
const theme = EditorView.baseTheme({
  // A generated list, set as the reference it is: quiet rules, no page numbers,
  // and every line a way of getting there.
  ".cm-yaz-listing": {
    display: "block",
    inlineSize: "100%",
    textAlign: "start",
    border: "1px solid var(--yaz-border)",
    borderRadius: "var(--yaz-radius-md)",
    background: "var(--yaz-bg-secondary)",
    padding: "var(--yaz-space-3) var(--yaz-space-4)",
    margin: "var(--yaz-space-3) 0",
    fontFamily: "var(--yaz-font-sans)",
  },
  // A list carried onto the next sheet says so, quietly, where the heading
  // would have been. Without it a reader meets a page of entries with no
  // indication of what they are a list of.
  // A command that stands for a character, set as the character. Nothing
  // distinguishes it from the text around it, because it *is* the text.
  // Boxes, shifts and notes: the inline treatment with a different look.
  ".cm-yaz-framed": {
    border: "1px solid var(--yaz-border)",
    padding: "0 0.25em",
    borderRadius: "2px",
  },
  ".cm-yaz-nowrap": {
    whiteSpace: "nowrap",
  },
  ".cm-yaz-superscript": {
    verticalAlign: "super",
    fontSize: "0.75em",
  },
  ".cm-yaz-subscript": {
    verticalAlign: "sub",
    fontSize: "0.75em",
  },
  ".cm-yaz-footnote": {
    fontSize: "0.85em",
    color: "var(--yaz-text-muted)",
  },
  ".cm-yaz-literal": {
    whiteSpace: "pre-wrap",
  },
  ".cm-yaz-space-inline": {
    display: "inline-block",
  },
  ".cm-yaz-space-block": {
    display: "block",
    inlineSize: "100%",
  },
  /*
   * A sheet of a divided listing has no filler after it, because it is not
   * lines — it is one widget standing where a page would be. So it carries its
   * own foot: the bottom margin of the paper, the shadow, and the gap that
   * separates it from the sheet below.
   */
  /*
   * The rails that change a table's shape.
   *
   * Out of the way until the pointer is over the table: an author reading a
   * document should see a table, and an author working on one should have the
   * handles within reach. Absolutely positioned so that they take no room —
   * a rail in the flow would move the table every time it appeared.
   */
  /*
   * The cell the caret is in, while the table is locked drawn.
   *
   * A caret inside a widget is not drawn by the browser, so this is the only
   * thing telling the author where they are. An outline rather than a fill:
   * the cell still has to be readable.
   */
  ".cm-yaz-cell-active": {
    outline: "2px solid var(--yaz-accent)",
    outlineOffset: "-2px",
  },
  ".cm-yaz-table-frame": {
    position: "relative",
  },
  ".cm-yaz-table-rail": {
    position: "absolute",
    display: "flex",
    opacity: "0",
    transition: "opacity 120ms ease",
    pointerEvents: "none",
  },
  ".cm-yaz-table-frame:hover .cm-yaz-table-rail, .cm-yaz-table-frame:focus-within .cm-yaz-table-rail":
    {
      opacity: "1",
      pointerEvents: "auto",
    },
  ".cm-yaz-table-rail-columns": {
    insetBlockStart: "-1.4em",
    insetInlineStart: "0",
    inlineSize: "100%",
    flexDirection: "row",
  },
  ".cm-yaz-table-rail-rows": {
    insetBlockStart: "0",
    insetInlineEnd: "calc(100% + 0.3em)",
    blockSize: "100%",
    flexDirection: "column",
  },
  ".cm-yaz-table-segment": {
    position: "relative",
    flex: "1 1 0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.15em",
  },
  ".cm-yaz-table-control": {
    font: "inherit",
    fontSize: "0.75em",
    lineHeight: "1",
    color: "var(--yaz-text-muted)",
    background: "var(--yaz-bg-secondary)",
    border: "1px solid var(--yaz-border)",
    borderRadius: "var(--yaz-radius-sm)",
    padding: "0 0.3em",
    cursor: "pointer",
  },
  ".cm-yaz-table-control:hover": {
    color: "var(--yaz-text-primary)",
    background: "var(--yaz-bg-hover)",
  },
  /* The boundary this column shares with the next. */
  ".cm-yaz-table-handle": {
    position: "absolute",
    insetInlineEnd: "-0.15em",
    insetBlock: "0",
    inlineSize: "0.3em",
    cursor: "col-resize",
  },
  ".cm-yaz-table-handle:hover": {
    background: "var(--yaz-accent)",
  },
  /* The boundary a row shares with the one below it. */
  ".cm-yaz-table-handle-row": {
    insetInline: "0",
    insetBlockEnd: "-0.15em",
    insetBlockStart: "auto",
    blockSize: "0.3em",
    inlineSize: "auto",
    cursor: "row-resize",
  },
  ".cm-yaz-listing-title": {
    fontSize: "0.8em",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--yaz-text-muted)",
    marginBlockEnd: "var(--yaz-space-2)",
  },
  // What the card says when nothing can show the list: the compiler makes it.
  ".cm-yaz-listing-note": {
    margin: "0",
    fontSize: "0.9em",
    color: "var(--yaz-text-muted)",
    fontStyle: "italic",
  },
  // The way in. Set as text rather than as a button, because what it stands
  // for is a piece of the document rather than an action on it.
  ".cm-yaz-listing-open": {
    font: "inherit",
    fontSize: "0.9em",
    color: "var(--yaz-accent)",
    background: "none",
    border: "none",
    padding: "0",
    cursor: "pointer",
    textAlign: "start",
  },
  ".cm-yaz-listing-open:hover": {
    textDecoration: "underline",
  },
  // The break the author asked for, drawn as a break.
  ".cm-yaz-pagebreak": {
    display: "flex",
    inlineSize: "100%",
    alignItems: "center",
    gap: "var(--yaz-space-2)",
    margin: "var(--yaz-space-3) 0",
    color: "var(--yaz-text-muted)",
    fontFamily: "var(--yaz-font-sans)",
    fontSize: "0.72em",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    cursor: "pointer",
    userSelect: "none",
  },
  ".cm-yaz-pagebreak::before, .cm-yaz-pagebreak::after": {
    content: '""',
    flex: "1",
    borderTop: "1px dashed var(--yaz-border)",
  },
  ".cm-yaz-heading": {
    fontWeight: "700",
  },
  // Part of the heading, so it inherits the heading's size and colour rather
  // than being set apart as an annotation.
  ".cm-yaz-heading-number": {
    fontWeight: "inherit",
    color: "inherit",
  },
  // One colour token per level, each defaulting to the body colour — so a
  // theme that says nothing gets headings that are merely larger, and one that
  // wants to colour the document's structure can.
  //
  // `\part` and `\chapter` are rare in a paper but enormous when used.
  ".cm-yaz-h0": {
    fontSize: "1.9em",
    lineHeight: "1.3",
    color: "var(--yaz-heading-0)",
  },
  ".cm-yaz-h1": {
    fontSize: "1.65em",
    lineHeight: "1.3",
    color: "var(--yaz-heading-1)",
  },
  ".cm-yaz-h2": {
    fontSize: "1.4em",
    lineHeight: "1.35",
    color: "var(--yaz-heading-2)",
  },
  ".cm-yaz-h3": {
    fontSize: "1.2em",
    lineHeight: "1.4",
    color: "var(--yaz-heading-3)",
  },
  ".cm-yaz-h4": { fontSize: "1.08em", color: "var(--yaz-heading-4)" },
  ".cm-yaz-h5": {
    fontSize: "1em",
    fontStyle: "italic",
    color: "var(--yaz-heading-5)",
  },
  ".cm-yaz-h6": {
    fontSize: "1em",
    fontStyle: "italic",
    color: "var(--yaz-heading-6)",
  },
  ".cm-yaz-strong": { fontWeight: "700", color: "var(--yaz-text-primary)" },
  ".cm-yaz-emphasis": { fontStyle: "italic" },
  ".cm-yaz-mono": { fontFamily: "var(--yaz-font-mono)" },
  ".cm-yaz-underline": { textDecoration: "underline" },
  ".cm-yaz-smallcaps": { fontVariant: "small-caps" },

  // Anything set on its own line rather than inside a sentence.
  ".cm-yaz-block": {
    display: "block",
    inlineSize: "100%",
    textAlign: "center",
    paddingBlock: "var(--yaz-space-2)",
  },
  ".cm-yaz-math": { cursor: "pointer" },
  ".cm-yaz-math-display": { cursor: "pointer" },
  ".cm-yaz-table-host": { cursor: "pointer", overflowX: "auto" },

  ".cm-yaz-table": {
    display: "inline-table",
    borderCollapse: "collapse",
    fontFamily: "var(--yaz-font-prose)",
    textAlign: "start",
  },
  ".cm-yaz-td": {
    padding: "var(--yaz-space-1) var(--yaz-space-3)",
    verticalAlign: "top",
  },
  ".cm-yaz-align-left": { textAlign: "start" },
  ".cm-yaz-align-center": { textAlign: "center" },
  ".cm-yaz-align-right": { textAlign: "end" },
  ".cm-yaz-td-rule-start": { borderInlineStart: "1px solid var(--yaz-border)" },
  ".cm-yaz-td-rule-end": { borderInlineEnd: "1px solid var(--yaz-border)" },
  ".cm-yaz-tr-rule-above > *": {
    borderBlockStart: "1px solid var(--yaz-border-strong)",
  },
  ".cm-yaz-tr-rule-below > *": {
    borderBlockEnd: "1px solid var(--yaz-border-strong)",
  },
  ".cm-yaz-table th": { fontWeight: "700", color: "var(--yaz-text-primary)" },

  ".cm-yaz-item-marker": {
    color: "var(--yaz-text-muted)",
    // A fixed box keeps every item's text starting in the same column, which is
    // what makes a list read as a list.
    display: "inline-block",
    minInlineSize: "1.6em",
  },
  // A quotation is set in from both edges and marked down the side, which is
  // how print does it and what makes it read as someone else's words.
  ".cm-yaz-quote": {
    paddingInlineStart: "1.5rem",
    paddingInlineEnd: "1.5rem",
    borderInlineStart: "2px solid var(--yaz-border)",
    color: "var(--yaz-text-secondary)",
    fontStyle: "italic",
  },

  ".cm-yaz-list": { paddingInlineStart: "1.5rem" },
  ".cm-yaz-list-2": { paddingInlineStart: "3rem" },
  ".cm-yaz-list-3": { paddingInlineStart: "4.5rem" },
  ".cm-yaz-list-4": { paddingInlineStart: "6rem" },

  // A page ornament, not a control: centred, quiet, and the same width as the
  // text it bounds. The rules either side are what make one glyph read as a
  // boundary rather than as a stray character in the document.
  ".cm-yaz-boundary": {
    display: "flex",
    alignItems: "center",
    gap: "var(--yaz-space-4)",
    inlineSize: "100%",
    font: "inherit",
    color: "var(--yaz-text-muted)",
    background: "none",
    border: "none",
    padding: "var(--yaz-space-2) 0",
    cursor: "pointer",
    opacity: "0.45",
    transition: "opacity 120ms ease, color 120ms ease",
  },
  ".cm-yaz-boundary::before, .cm-yaz-boundary::after": {
    content: '""',
    flex: "1",
    blockSize: "1px",
    background: "currentColor",
  },
  ".cm-yaz-boundary:hover, .cm-yaz-boundary:focus-visible": {
    opacity: "1",
    color: "var(--yaz-text-secondary)",
  },
  // The band itself. Quiet by default and unmistakable in the page view,
  // where it runs the full width of the paper.
  ".cm-yaz-matter": {
    background: "var(--yaz-bg-secondary)",
  },
  ".cm-yaz-boundary-glyph": {
    fontSize: "1.15em",
    lineHeight: "1",
    // Some platforms would otherwise draw these as emoji.
    fontVariantEmoji: "text",
  },
});
