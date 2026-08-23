/**
 * Where the formatting bar goes.
 *
 * # Why this is a function and not a stylesheet
 *
 * The bar follows the selection, so its position is arithmetic over four
 * rectangles — what is selected, how big the bar is, how big the pane is — and
 * arithmetic that decides what somebody sees is arithmetic worth testing. The
 * same measurement problem as pagination, and the same answer: the deciding is
 * pure, and only the measuring touches the DOM.
 *
 * # Below, then above
 *
 * Under the selection by default, because that is where a word processor puts
 * it and because above is where the text you were just reading is. It flips
 * above only when there is no room below — at the bottom of the pane — and
 * never sits on top of the selection itself, which would hide the thing being
 * formatted.
 */

/** A rectangle, in the pane's own coordinates. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where the bar is drawn, in the pane's own coordinates. */
export interface Placement {
  left: number;
  top: number;
  /** Whether it ended up above the selection rather than below it. */
  above: boolean;
}

/**
 * How far the bar sits from the text.
 *
 * Enough that it does not touch the line, little enough that it still reads as
 * belonging to the selection rather than floating over the document.
 */
const GAP = 8;

/**
 * How close to the pane's edge the bar may come.
 *
 * A bar flush against the edge looks like it has been cut off, and on the
 * scrollbar side it would be.
 */
const MARGIN = 8;

/**
 * Place the bar against a selection.
 *
 * `selection` is the rectangle of what is selected, `pane` the visible area,
 * and `bar` its own measured size. All in the same coordinates; which ones does
 * not matter, as long as they agree.
 */
export function placeBar(
  selection: Box,
  pane: { width: number; height: number },
  bar: { width: number; height: number },
): Placement {
  // Centred on the selection, because the selection is what it acts on — and
  // a bar anchored to one end drifts a long way from a long selection.
  const wanted = (selection.left + selection.right) / 2 - bar.width / 2;
  const furthest = pane.width - bar.width - MARGIN;
  // `Math.max` last, so that a bar wider than the pane sits at the near edge
  // rather than off the far one.
  const left = Math.max(MARGIN, Math.min(wanted, furthest));

  const below = selection.bottom + GAP;
  const fits = below + bar.height + MARGIN <= pane.height;
  if (fits) return { left, top: below, above: false };

  // Above instead — and clamped to the top, because a bar pushed off the top
  // of the pane is a bar with no buttons on it.
  const above = selection.top - GAP - bar.height;
  return { left, top: Math.max(MARGIN, above), above: true };
}
