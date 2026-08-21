/**
 * Pages that are the size of the paper, always.
 *
 * # The mistake this replaces
 *
 * Every earlier version built a page *out of the content*: count the rows a
 * line takes, put so many rows on a sheet, and pad the bottom of a sheet that
 * came up short. Every one of them had the same failure, and no amount of
 * improving the count fixed it — because the count was never the problem. A
 * page made of content can *stretch*. Guess low about one image and the sheet
 * grows to hold it, and a sheet that grows is not a sheet.
 *
 * # The shape of this one
 *
 * **The page is not made of content.** It is a fixed box painted behind the
 * text — a repeating gradient with the paper's height, the gap, and nothing
 * to do with what is written on it. It cannot stretch because there is nothing
 * in it to push.
 *
 * **Content is pushed through it.** A view plugin measures where each block
 * actually sits and, wherever one would cross the bottom margin, inserts a
 * spacer of exactly the height needed to carry it to the top of the next
 * sheet. Nothing is padded and nothing is estimated: the spacer is the
 * difference between two measured numbers.
 *
 * The two halves never argue, because only one of them decides where a page
 * is. The other one just gets out of its way.
 *
 * # Why it settles
 *
 * Inserting a spacer moves everything below it, which changes what needs a
 * spacer. That is a loop, and it closes because every spacer moves content
 * *down* and onto a sheet where it fits — so each pass has strictly less to
 * do than the last, and a block that has been carried to the top of a sheet is
 * never carried again.
 *
 * A block taller than the usable page is the exception: it cannot be made to
 * fit and is left where it is, overflowing, exactly as LaTeX would leave an
 * oversized image sticking off the paper.
 */

import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";

import {
  NO_EXTENT,
  paginated,
  paper,
  paperExtent,
  setExtent,
  sheetAt,
  textBounds,
} from "./geometry";
import type { Extent, Paper } from "./geometry";
import { pageBreaks } from "./generated";
import { layoutOf } from "./richText";
import { environments, headings } from "./structure";
import { environmentsOfKind } from "./vocabulary";

export { paginated, paper } from "./geometry";
export type { Paper } from "./geometry";

/**
 * Where the paper is turned, as ranges of the document.
 *
 * Which environments turn it is not decided here: `landscape` is pdflscape's
 * and `sidewaystable` is rotating's, so both arrive from a plugin
 * ([`vocabulary.ts`](./vocabulary.ts)). A document with neither package simply
 * has no turned regions, which is the right answer for it.
 */
export function turnedRegions(text: string): { from: number; to: number }[] {
  return environments(text, environmentsOfKind("turned")).map((found) => ({
    from: found.from,
    to: found.to,
  }));
}

/**
 * Offsets the document itself says must begin a page.
 *
 * Separate from where a page *runs out*, which is arithmetic about heights.
 * These are instructions an author wrote, and they hold whatever the geometry
 * says: `\clearpage` means begin a page even one line in.
 */
export function forcedBreaks(state: EditorState): Set<number> {
  const text = state.doc.toString();
  const at = new Set<number>();

  const startOfLine = (offset: number): void => {
    if (offset >= 0 && offset <= state.doc.length) {
      at.add(state.doc.lineAt(offset).from);
    }
  };
  const lineAfter = (offset: number): void => {
    const line = state.doc.lineAt(Math.min(offset, state.doc.length));
    if (line.number < state.doc.lines) {
      at.add(state.doc.line(line.number + 1).from);
    }
  };

  // `\clearpage` and friends end the page they are on.
  for (const found of pageBreaks(text)) lineAfter(found.to);

  // `\end{titlepage}` clears the page in LaTeX itself — nothing may follow the
  // title onto its sheet.
  for (const found of environments(text, ["titlepage"])) {
    startOfLine(found.from);
    lineAfter(found.to);
  }

  // A turned sheet begins and ends where the turn does: a sheet cannot be half
  // turned, which is what `pdflscape` itself does.
  for (const region of turnedRegions(text)) {
    startOfLine(region.from);
    lineAfter(region.to);
  }

  // `\chapter` opens a page in every class that has chapters.
  if (/\\documentclass[^{]*\{(report|book|scrreprt|scrbook)\}/.test(text)) {
    for (const heading of headings(text)) {
      if (heading.level === 1) startOfLine(heading.from);
    }
  }

  // The front and back matter are not pages of the document — they are what
  // the file wraps it in — so the paper starts after them.
  for (const range of layoutOf(state).matter) {
    if (range.from >= 1 && range.from <= state.doc.lines) {
      at.add(state.doc.line(range.from).from);
    }
    if (range.to + 1 <= state.doc.lines) {
      at.add(state.doc.line(range.to + 1).from);
    }
  }

  return at;
}

/**
 * Every line that is the file's machinery rather than the document's paper.
 *
 * Asked per block while working out the gaps, so it is a set rather than the
 * ranges it comes from.
 */
function matterLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of layoutOf(state).matter) {
    for (let number = range.from; number <= range.to; number += 1) {
      lines.add(number);
    }
  }
  return lines;
}

/** A gap inserted to carry what follows it onto the next sheet. */
export interface Spacer {
  /** The document offset the gap goes in front of. */
  at: number;
  /** Exactly how tall, in pixels. */
  height: number;
  /** The sheet this closes, counting from one, or zero for the matter. */
  folio: number;
}

/** Replace the gaps. */
export const setSpacers = StateEffect.define<Spacer[]>();

/**
 * The gaps that carry content from one sheet to the next.
 *
 * Held as state rather than worked out while drawing, because working them out
 * needs measurements and drawing must not measure.
 */
export const spacers = StateField.define<Spacer[]>({
  create: () => [],
  update(value, transaction) {
    let next = value;
    for (const effect of transaction.effects) {
      if (effect.is(setSpacers)) next = effect.value;
    }
    // An edit moves every offset after it. Mapped rather than dropped, so the
    // page does not collapse and rebuild itself on every keystroke — the
    // plugin corrects them within the frame.
    if (transaction.docChanged && next === value) {
      return value
        .map((spacer) => ({
          ...spacer,
          at: transaction.changes.mapPos(spacer.at, 1),
        }))
        .filter((spacer) => spacer.at <= transaction.newDoc.length);
    }
    return next;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (found) => drawSpacers(found)),
});

/** The gap at the foot of a sheet, carrying its number. */
class SpacerWidget extends WidgetType {
  constructor(
    readonly height: number,
    readonly folio: number,
  ) {
    super();
  }

  override eq(other: SpacerWidget): boolean {
    // To the pixel: a spacer that compared equal at a different height would
    // leave the sheet below it in the wrong place.
    return other.height === this.height && other.folio === this.folio;
  }

  override toDOM(): HTMLElement {
    const node = document.createElement("div");
    node.className = "cm-yaz-page-gap";
    node.style.blockSize = `${this.height}px`;

    if (this.folio > 0) {
      const number = document.createElement("span");
      number.className = "cm-yaz-folio";
      number.textContent = String(this.folio);
      // Decorative: a screen reader announcing a page number that is not the
      // compiler's page number would be telling the reader something false.
      number.setAttribute("aria-hidden", "true");
      node.append(number);
    } else {
      node.setAttribute("aria-hidden", "true");
    }
    return node;
  }
}

/** The gaps, as decorations. */
function drawSpacers(found: readonly Spacer[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const spacer of [...found].sort((a, b) => a.at - b.at)) {
    if (spacer.height <= 0) continue;
    builder.add(
      spacer.at,
      spacer.at,
      Decoration.widget({
        widget: new SpacerWidget(spacer.height, spacer.folio),
        block: true,
        side: -1,
      }),
    );
  }
  return builder.finish();
}

/**
 * A block of the document, as the view laid it out.
 *
 * # Why this type exists
 *
 * Everything that decides where a page ends is arithmetic over measured
 * heights, and for four rounds none of it was tested. A test would have had to
 * drive a real CodeMirror view, and jsdom gives every element a height of zero
 * — so the test would measure nothing and agree with itself, which is worse
 * than no test at all: it reports green while the thing it claims to check has
 * never run.
 *
 * So measuring and deciding are separated. The view plugin measures and builds
 * these; the functions below decide from them and touch no DOM. The deciding is
 * where all four bugs lived, and it can now be handed the geometry of a real
 * document — a folded preamble, a title page taller than a sheet, a chapter
 * opening — and asked what it would do about it.
 */
export interface Slab {
  /** Document offset the block begins at. */
  at: number;
  /** The line `at` falls on, counting from one. */
  line: number;
  /** The top edge, in the content box's own coordinates. */
  top: number;
  height: number;
  /** Whether this is a gap the paginator itself put there. */
  gap: boolean;
}

/**
 * Where the paper begins: the top of the first block that is the document.
 *
 * What a `.tex` wraps its document in is not a page of the document. Printing
 * the preamble's mark across the top of the title page is something no compiler
 * does and something an author reading their own title page should not have to
 * look at, so the paper starts below it and the machinery sits on a strip of
 * its own.
 *
 * Taken from the *first block of the document* rather than from the bottom of
 * the last block of the matter, which is what it used to do. The two agree
 * whenever the walk can see the whole preamble; they differ when it cannot — a
 * viewport that does not reach the top of the file, a fold the walk did not
 * recognise — and there the old rule answered zero, which means "the paper
 * starts at the very top" and is exactly how the machinery ended up printed
 * across the title page. This rule cannot answer zero for a document that has a
 * preamble: it either finds the first line of the document or it finds nothing
 * and says so.
 *
 * `null` is "no answer from here" — keep whatever was already known — and is
 * deliberately not the same as zero.
 */
export function paperStart(
  slabs: readonly Slab[],
  matter: ReadonlySet<number>,
): number | null {
  for (const slab of slabs) {
    if (slab.gap || matter.has(slab.line)) continue;
    return slab.top;
  }
  return null;
}

/**
 * Where the paper stops: the top of the closing matter.
 *
 * The mirror of {@link paperStart}, so the last line of the file and the mark
 * that folds it sit on a strip below the last sheet rather than on it.
 */
export function paperEnd(
  slabs: readonly Slab[],
  matter: ReadonlySet<number>,
): number | null {
  let closing: number | null = null;
  for (let index = slabs.length - 1; index >= 0; index -= 1) {
    const slab = slabs[index]!;
    if (slab.gap) continue;
    if (!matter.has(slab.line)) return closing;
    closing = slab.top;
  }
  return closing;
}

/** What the gaps are worked out against. */
export interface Flow {
  sheet: Paper;
  /** Where the paper begins, from {@link paperStart}. */
  offset: number;
  /** Offsets the document says must begin a page. */
  forced: ReadonlySet<number>;
  /** Lines that are the file's machinery rather than the document. */
  matter: ReadonlySet<number>;
}

/**
 * The gaps the blocks call for, in the order they appear.
 *
 * One rule, applied to every block: work out where the block would sit if the
 * gap in front of it were taken away, ask which sheet that is and whether it
 * fits, and where it does not, insert exactly the difference between there and
 * the top of the next sheet. Nothing is padded and nothing is estimated — a
 * spacer is the difference between two measured numbers.
 *
 * It settles because every spacer moves content *down* onto a sheet where it
 * fits, so each pass has strictly less to do than the last, and a block carried
 * to the top of a sheet is never carried again.
 */
export function gapsFor(slabs: readonly Slab[], flow: Flow): Spacer[] {
  const { sheet, offset, forced, matter } = flow;
  const usable = sheet.height - 2 * sheet.margin;
  const gaps: Spacer[] = [];

  /*
   * How far this pass has already moved everything below it.
   *
   * Two things go into it. A gap already in the document is *removed* — the
   * question about a block is always where it would be without the gap in
   * front of it, otherwise a gap is counted twice and the block below is
   * pushed a page further on every pass, for ever. A gap this pass decides on
   * is *added*, because every block after it really will be that much lower.
   *
   * The second half is what was missing. Without it each block was judged
   * against the un-gapped layout, so the first four lines of a title page all
   * looked as though they were above the paper and all four asked to be moved
   * — four stacked gaps for one that was needed, corrected a frame later. Now
   * the pass computes the settled answer in one go.
   */
  let adjust = 0;

  for (const slab of slabs) {
    if (slab.gap) {
      adjust -= slab.height;
      continue;
    }

    const top = slab.top + adjust;

    // The matter is not on the paper at all — the paper begins below it — so it
    // is never carried anywhere.
    if (matter.has(slab.line)) continue;

    const index = sheetAt(sheet, top, offset);
    const bounds = textBounds(sheet, index, offset);
    const mustStart = forced.has(slab.at);
    const atTop = Math.abs(top - bounds.from) <= CLOSE_ENOUGH;
    const overruns = top + slab.height > bounds.to + CLOSE_ENOUGH;
    /*
     * Above the sheet's text rather than on it.
     *
     * Two things land here, and both were reported as bugs. The first block of
     * the document sits wherever the front matter left it, which is above the
     * first sheet's top margin — so without this the title page began in the
     * strip beside the machinery instead of on the paper. And a block in the
     * space *between* two sheets is in neither of them, which is what "text
     * leaks between the pages" was.
     *
     * A sheet has a top edge as well as a bottom one, and until now only the
     * bottom one was enforced.
     */
    const tooHigh = top < bounds.from - CLOSE_ENOUGH;

    if (mustStart ? atTop : !tooHigh && !overruns) continue;
    // Taller than any sheet: it can never be made to fit, so carrying it would
    // only put a blank page in front of it every time. LaTeX does the same with
    // an oversized image — it lets it stick off the paper. A block that is too
    // high is a different matter: it is not being carried anywhere, it is being
    // put on the sheet it is already on.
    if (!mustStart && !tooHigh && slab.height > usable) continue;

    // Down onto the sheet it is already over, or on to the next one.
    const target = tooHigh ? index : index + 1;
    const height = textBounds(sheet, target, offset).from - top;
    if (height > CLOSE_ENOUGH) {
      // A number is drawn at the foot of a gap, which is the foot of the page
      // it closes. A gap that only pushes a block down onto the sheet it is
      // already over closes nothing, so it carries no number.
      gaps.push({ at: slab.at, height, folio: tooHigh ? 0 : target });
      adjust += height;
    }
  }

  return gaps;
}

/**
 * How close two heights have to be to count as the same.
 *
 * Sub-pixel differences arrive constantly from rounding and font loading, and
 * rewriting the spacers for those would be a transaction a frame forever.
 */
const CLOSE_ENOUGH = 0.5;

/** Work out where the gaps go, from where the blocks actually are. */
const paginator = ViewPlugin.fromClass(
  class {
    constructor(private readonly view: EditorView) {
      this.schedule();
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.geometryChanged ||
        update.viewportChanged ||
        update.startState.facet(paper) !== update.state.facet(paper) ||
        update.startState.facet(paginated) !== update.state.facet(paginated)
      ) {
        this.schedule();
      }
    }

    private schedule(): void {
      this.view.requestMeasure({
        read: (view) => this.read(view),
        write: (found, view) => {
          if (found) view.dispatch({ effects: found });
        },
      });
    }

    /**
     * The blocks on screen, normalised.
     *
     * Every block, not every *line*: a line is not the only thing that takes
     * room on the paper. The front matter folded into a mark is a block widget,
     * and so is a figure. Walking lines meant those were never carried onto a
     * fresh sheet — they ran off the bottom of one and into the space below it.
     *
     * Only what is on screen. The rest of a hundred-page document has never
     * been laid out and has no honest height; what is off screen keeps the gaps
     * it already had and gets them corrected as it arrives, before it is drawn.
     */
    private slabsOf(view: EditorView): Slab[] {
      const doc = view.state.doc;
      return view.viewportLineBlocks.map((block) => ({
        at: block.from,
        line: doc.lineAt(block.from).number,
        top: block.top,
        height: block.height,
        gap: block.widget instanceof SpacerWidget,
      }));
    }

    /** What to change, or `null` when nothing has. */
    private read(view: EditorView): StateEffect<unknown>[] | null {
      const sheet = view.state.facet(paper);
      const on = view.state.facet(paginated);
      const effects: StateEffect<unknown>[] = [];

      if (!on || !sheet) {
        const had = view.state.field(paperExtent, false) ?? NO_EXTENT;
        if (had.offset !== 0 || had.extent !== 0) {
          effects.push(setExtent.of(NO_EXTENT));
        }
        if ((view.state.field(spacers, false) ?? []).length > 0) {
          effects.push(setSpacers.of([]));
        }
        return effects.length > 0 ? effects : null;
      }

      const slabs = this.slabsOf(view);
      const matter = matterLines(view.state);

      // Where the paper starts and stops, before anything is measured against
      // it: the front matter is above the first sheet, not on it.
      const had = view.state.field(paperExtent, false) ?? NO_EXTENT;
      const extent = this.extentOf(view, sheet, slabs, matter, had);
      if (
        Math.abs(extent.offset - had.offset) > CLOSE_ENOUGH ||
        Math.abs(extent.extent - had.extent) > CLOSE_ENOUGH
      ) {
        effects.push(setExtent.of(extent));
      }

      // The gaps for what is on screen, over the ones already known for what is
      // not: a block off screen has no honest height, and dropping its gap
      // would collapse the page it is standing on.
      const kept = new Map<number, Spacer>();
      for (const spacer of view.state.field(spacers, false) ?? []) {
        kept.set(spacer.at, spacer);
      }
      for (const slab of slabs) {
        if (!slab.gap) kept.delete(slab.at);
      }
      for (const gap of gapsFor(slabs, {
        sheet,
        offset: extent.offset,
        forced: forcedBreaks(view.state),
        matter,
      })) {
        kept.set(gap.at, gap);
      }
      const wanted = [...kept.values()].sort((a, b) => a.at - b.at);

      if (this.differs(wanted, view.state.field(spacers, false) ?? [])) {
        effects.push(setSpacers.of(wanted));
      }

      return effects.length > 0 ? effects : null;
    }

    /** Whether the gaps we want differ from the ones that are there. */
    private differs(wanted: Spacer[], have: readonly Spacer[]): boolean {
      if (wanted.length !== have.length) return true;
      return wanted.some((spacer, index) => {
        const other = have[index]!;
        return (
          spacer.at !== other.at ||
          spacer.folio !== other.folio ||
          Math.abs(spacer.height - other.height) > CLOSE_ENOUGH
        );
      });
    }

    /**
     * Where the paper starts, and how far it runs.
     *
     * Each end is answered only while it is on screen; elsewhere the last
     * answer stands, which is right — the preamble does not change height while
     * it is out of sight, and guessing zero for it is what put the machinery on
     * the title page.
     */
    private extentOf(
      view: EditorView,
      sheet: Paper,
      slabs: readonly Slab[],
      matter: ReadonlySet<number>,
      before: Extent,
    ): Extent {
      const pitch = sheet.height + sheet.gap;
      const offset =
        view.viewport.from === 0
          ? (paperStart(slabs, matter) ?? before.offset)
          : before.offset;

      let tail = 0;
      if (view.viewport.to >= view.state.doc.length) {
        const closing = paperEnd(slabs, matter);
        if (closing !== null) tail = Math.max(0, view.contentHeight - closing);
      }

      const runs = Math.max(0, view.contentHeight - offset - tail);
      return { offset, extent: Math.max(1, Math.ceil(runs / pitch)) * pitch };
    }
  },
);

/**
 * The paper itself, painted behind the text.
 *
 * A repeating gradient rather than an element per sheet, which is the whole
 * point: it is drawn from the page size and the gap and knows nothing about
 * the content, so there is no way for the content to stretch it. Every sheet is
 * the same height as every other sheet because they are the same gradient.
 *
 * The measurements arrive as custom properties on the content box rather than
 * being baked in here, so that changing the paper or the magnification repaints
 * without rebuilding anything.
 */
const paperAttributes = EditorView.contentAttributes.compute(
  [paper, paginated, paperExtent],
  (state) => {
    const sheet = state.facet(paper);
    if (!state.facet(paginated) || !sheet) return {};
    const reach = state.field(paperExtent, false) ?? NO_EXTENT;
    return {
      class: "cm-yaz-paper",
      style:
        `--yaz-sheet-height:${sheet.height}px;` +
        `--yaz-sheet-pitch:${sheet.height + sheet.gap}px;` +
        `--yaz-sheet-gap:${sheet.gap}px;` +
        `--yaz-sheet-margin:${sheet.margin}px;` +
        // Where the paper begins and how far it runs, so the matter at either
        // end of the file sits on a strip beside it rather than on a page.
        `--yaz-paper-from:${reach.offset}px;` +
        `--yaz-paper-extent:${reach.extent > 0 ? `${reach.extent}px` : "100%"}`,
    };
  },
);

const theme = EditorView.baseTheme({
  ".cm-content.cm-yaz-paper": {
    backgroundImage:
      "repeating-linear-gradient(to bottom," +
      "var(--yaz-bg-primary) 0 var(--yaz-sheet-height)," +
      "transparent var(--yaz-sheet-height) var(--yaz-sheet-pitch))",
    // Painted once, over a stated extent, rather than repeated for ever: what
    // is above the paper and what is below it are the file's machinery — the
    // preamble and the closing line — and those are not pages of the document.
    backgroundRepeat: "no-repeat",
    backgroundSize: "100% var(--yaz-paper-extent)",
    backgroundPosition: "0 var(--yaz-paper-from)",
  },
  ".cm-yaz-page-gap": {
    position: "relative",
    inlineSize: "100%",
  },
  /*
   * The folio, at the foot of the paper.
   *
   * Not the number the compiler will print — this measures the screen and
   * LaTeX typesets — so it is set quietly, because a number that is not the
   * printed one should not be read as if it were.
   */
  ".cm-yaz-folio": {
    position: "absolute",
    insetBlockEnd:
      "calc(var(--yaz-sheet-gap, 1rem) + var(--yaz-sheet-margin, 1rem) / 3)",
    insetInline: "0",
    textAlign: "center",
    fontSize: "0.85em",
    color: "var(--yaz-text-muted)",
    userSelect: "none",
  },
});

/** Everything the page view adds. */
export function pagination(): Extension {
  return [spacers, paginator, paperAttributes, theme];
}
