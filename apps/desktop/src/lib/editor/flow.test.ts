/**
 * Where the paper starts, and which blocks get carried onto the next sheet.
 *
 * This is the half that has never been tested. `pagination.test.ts` covers the
 * arithmetic of the paper and the breaks an author asked for; what decided
 * where a page actually ended was measured, and a measured thing could only be
 * tested by driving a real view — which under jsdom measures nothing and agrees
 * with itself.
 *
 * So the deciding was pulled out of the view plugin and given a shape a test
 * can build: a list of blocks with heights. The heights below are the ones a
 * real document produces — a preamble folded into a mark, a title page taller
 * than a sheet, a chapter opening — which is the case that has been reported
 * three times and never had a test.
 */

import { describe, expect, it } from "vitest";

import type { Paper } from "./geometry";
import { gapsFor, paperEnd, paperStart } from "./pagination";
import type { Slab } from "./pagination";

/** A4 at 96 dpi, near enough, with the usual margins. */
const A4: Paper = {
  height: 1122,
  width: 794,
  margin: 94,
  gap: 30,
  turnedHeight: 794,
};

const PITCH = A4.height + A4.gap;
/** How much of a sheet holds text. */
const USABLE = A4.height - 2 * A4.margin;

/** Blocks stacked from `from`, each as tall as it says. */
function stack(
  from: number,
  blocks: readonly { line: number; height: number; gap?: boolean }[],
): Slab[] {
  let top = from;
  return blocks.map((block, index) => {
    const slab: Slab = {
      // Offsets do not have to be real: nothing here reads the document.
      at: index * 100,
      line: block.line,
      top,
      height: block.height,
      gap: block.gap === true,
    };
    top += block.height;
    return slab;
  });
}

describe("where the paper begins", () => {
  it("starts below a folded preamble, not at the top of the file", () => {
    // Reported three times. The preamble collapses into a single mark, and the
    // paper has to begin under it — otherwise the document's machinery is
    // printed across the top of the title page, which no compiler does.
    const slabs = stack(0, [
      { line: 1, height: 32 }, // the folded matter, as one mark
      { line: 384, height: 24 }, // the title page begins
      { line: 385, height: 24 },
    ]);
    expect(paperStart(slabs, new Set([1]))).toBe(32);
  });

  it("starts below an opened preamble however many lines it runs to", () => {
    const slabs = stack(0, [
      { line: 1, height: 20 },
      { line: 2, height: 20 },
      { line: 3, height: 20 },
      { line: 4, height: 24 },
    ]);
    expect(paperStart(slabs, new Set([1, 2, 3]))).toBe(60);
  });

  it("starts at the top of a file that has no preamble at all", () => {
    const slabs = stack(0, [{ line: 1, height: 24 }]);
    expect(paperStart(slabs, new Set())).toBe(0);
  });

  it("says nothing rather than zero when the matter is all it can see", () => {
    // The difference that matters. Zero means "the paper starts at the very
    // top", which is a claim; null means "not from here", which is the truth
    // when the walk has not reached the document yet — and the caller keeps
    // the answer it already had instead of putting the mark on page one.
    const slabs = stack(0, [
      { line: 1, height: 20 },
      { line: 2, height: 20 },
    ]);
    expect(paperStart(slabs, new Set([1, 2]))).toBeNull();
  });

  it("ignores a gap it put there itself when looking for the document", () => {
    const slabs = stack(0, [
      { line: 1, height: 32 },
      { line: 384, height: 200, gap: true },
      { line: 384, height: 24 },
    ]);
    expect(paperStart(slabs, new Set([1]))).toBe(232);
  });
});

describe("where the paper stops", () => {
  it("stops above the closing matter", () => {
    const slabs = stack(0, [
      { line: 10, height: 24 },
      { line: 11, height: 24 },
      { line: 12, height: 32 }, // \end{document}, folded
    ]);
    expect(paperEnd(slabs, new Set([12]))).toBe(48);
  });

  it("says nothing where the end of the file is not in view", () => {
    const slabs = stack(0, [
      { line: 10, height: 24 },
      { line: 11, height: 24 },
    ]);
    expect(paperEnd(slabs, new Set([12]))).toBeNull();
  });
});

describe("carrying a block onto the next sheet", () => {
  const flow = (over: Partial<Parameters<typeof gapsFor>[1]> = {}) => ({
    sheet: A4,
    offset: 0,
    forced: new Set<number>(),
    matter: new Set<number>(),
    ...over,
  });

  it("leaves a block that fits where it is", () => {
    const slabs = stack(A4.margin, [{ line: 1, height: 24 }]);
    expect(gapsFor(slabs, flow())).toEqual([]);
  });

  it("carries a block that would cross the bottom margin", () => {
    // One line short of the bottom, then a line that would not fit.
    const bottom = A4.height - A4.margin;
    const slabs = [
      { at: 100, line: 1, top: bottom - 10, height: 24, gap: false },
    ];
    const [gap] = gapsFor(slabs, flow());
    expect(gap).toBeDefined();
    // To the top of the second sheet's text, exactly.
    expect(gap!.height).toBe(PITCH + A4.margin - (bottom - 10));
    expect(gap!.folio).toBe(1);
  });

  it("leaves a block taller than any sheet where it is", () => {
    // It can never be made to fit, so carrying it would put a blank page in
    // front of it every single pass — which is what LaTeX does too: it lets an
    // oversized image stick off the paper.
    const slabs = stack(A4.margin, [{ line: 1, height: USABLE + 200 }]);
    expect(gapsFor(slabs, flow())).toEqual([]);
  });

  it("opens a page where the document asked for one", () => {
    const slabs = stack(A4.margin, [
      { line: 1, height: 24 },
      { line: 2, height: 24 },
    ]);
    const gaps = gapsFor(slabs, flow({ forced: new Set([100]) }));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.folio).toBe(1);
  });

  it("does not open a second page for something already at the top of one", () => {
    // The blank pages either side of the glossary. A forced break on a block
    // that is already at the top of a sheet has nothing to do, and doing it
    // anyway inserts an empty page.
    const slabs = [
      { at: 100, line: 1, top: PITCH + A4.margin, height: 24, gap: false },
    ];
    expect(gapsFor(slabs, flow({ forced: new Set([100]) }))).toEqual([]);
  });

  it("pulls a block out of the space between two sheets", () => {
    // "Text leaks in the space between pages." A sheet has a top edge as well
    // as a bottom one, and only the bottom one used to be enforced — so a
    // block that landed in the gap sat there, on neither page.
    const between = A4.height + 8; // past the first sheet, before the second
    const slabs = [{ at: 100, line: 5, top: between, height: 24, gap: false }];
    const [gap] = gapsFor(slabs, flow());
    expect(gap).toBeDefined();
    expect(gap!.height).toBe(PITCH + A4.margin - between);
  });

  it("asks for one gap where one is enough, not one per line", () => {
    // Every line of a title page sits above the first sheet until the first of
    // them is moved. Judging each against the un-gapped layout asked for four
    // gaps where one was needed, and the extra three were four blank pages
    // that went away a frame later.
    const slabs = stack(0, [
      { line: 1, height: 40 },
      { line: 2, height: 30 },
      { line: 3, height: 30 },
      { line: 4, height: 30 },
    ]);
    const gaps = gapsFor(slabs, flow({ offset: 40, matter: new Set([1]) }));
    expect(gaps).toHaveLength(1);
  });

  it("never carries the matter, wherever it sits", () => {
    // The preamble is not on the paper, so it cannot run off the bottom of it.
    const slabs = [
      { at: 0, line: 1, top: A4.height - 10, height: 400, gap: false },
    ];
    expect(gapsFor(slabs, flow({ matter: new Set([1]) }))).toEqual([]);
  });

  it("measures from where a block would be without the gap in front of it", () => {
    // Otherwise a gap already inserted is counted twice and the block below is
    // pushed a page further on every pass, which never settles.
    const bottom = A4.height - A4.margin;
    const carried = PITCH + A4.margin - (bottom - 10);
    const slabs = [
      { at: 100, line: 1, top: bottom - 10, height: carried, gap: true },
      { at: 100, line: 1, top: bottom - 10 + carried, height: 24, gap: false },
    ];
    const gaps = gapsFor(slabs, flow());
    expect(gaps).toHaveLength(1);
    // The same gap it already has, so nothing is dispatched and it settles.
    expect(gaps[0]!.height).toBeCloseTo(carried, 5);
  });

  it("settles: a carried block asks for nothing the second time round", () => {
    const bottom = A4.height - A4.margin;
    let slabs: Slab[] = [
      { at: 100, line: 1, top: bottom - 10, height: 24, gap: false },
    ];
    const first = gapsFor(slabs, flow());
    expect(first).toHaveLength(1);

    // Apply the gap, the way the view would, and ask again.
    slabs = [
      {
        at: 100,
        line: 1,
        top: bottom - 10,
        height: first[0]!.height,
        gap: true,
      },
      {
        at: 100,
        line: 1,
        top: bottom - 10 + first[0]!.height,
        height: 24,
        gap: false,
      },
    ];
    const second = gapsFor(slabs, flow());
    expect(second).toHaveLength(1);
    expect(second[0]!.height).toBeCloseTo(first[0]!.height, 5);
  });

  it("carries the first block of the document onto the first sheet", () => {
    // Not onto the second. The block sits above the paper because the matter
    // pushed it there, and `sheetAt` floors at zero — so without this the title
    // page would begin on page two and everything after it would follow.
    const slabs = [{ at: 100, line: 384, top: 20, height: 24, gap: false }];
    const gaps = gapsFor(slabs, flow({ offset: 200 }));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.folio).toBe(0);
    expect(gaps[0]!.height).toBe(200 + A4.margin - 20);
  });

  it("counts sheets from where the paper starts, not from the top of the file", () => {
    const offset = 320;
    const bottom = offset + A4.height - A4.margin;
    const slabs = [
      { at: 100, line: 400, top: bottom - 10, height: 24, gap: false },
    ];
    const [gap] = gapsFor(slabs, flow({ offset }));
    expect(gap!.folio).toBe(1);
    expect(gap!.height).toBe(offset + PITCH + A4.margin - (bottom - 10));
  });
});

describe("the document that has been reported three times", () => {
  /*
   * BimWissT, as the view lays it out: a preamble of 383 lines folded into one
   * mark, then a title page, then the contents and the glossary — which are
   * cards now rather than pages of their own.
   */
  const MARK = 36;
  const matter = new Set([1]);

  it("puts the paper under the mark and the title page on sheet one", () => {
    const slabs = stack(0, [
      { line: 1, height: MARK },
      ...Array.from({ length: 20 }, (_, index) => ({
        line: 384 + index,
        height: 30,
      })),
    ]);

    const offset = paperStart(slabs, matter);
    expect(offset).toBe(MARK);

    const gaps = gapsFor(slabs, {
      sheet: A4,
      offset: offset!,
      forced: new Set<number>(),
      matter,
    });
    // The first line of the title page is above the paper's text area, so it is
    // carried down onto the first sheet — and nothing else needs anything,
    // because twenty lines of thirty pixels fit on a sheet with room to spare.
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.folio).toBe(0);
  });

  it("does not put a blank sheet in front of the title page", () => {
    // The blank page after the title page, from the other direction: a block
    // carried onto sheet zero must not be carried onto sheet one.
    const slabs = stack(0, [
      { line: 1, height: MARK },
      { line: 384, height: 30 },
    ]);
    const gaps = gapsFor(slabs, {
      sheet: A4,
      offset: MARK,
      forced: new Set<number>(),
      matter,
    });
    expect(gaps.every((gap) => gap.folio === 0)).toBe(true);
  });
});
