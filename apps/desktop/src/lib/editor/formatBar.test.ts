/**
 * Where the formatting bar goes.
 *
 * jsdom measures nothing, so the deciding half is kept pure and tested here —
 * the same split pagination needed, for the same reason.
 */

import { describe, expect, it } from "vitest";

import { placeBar } from "./formatBar";

const PANE = { width: 800, height: 600 };
const BAR = { width: 240, height: 32 };

describe("placing the formatting bar", () => {
  it("sits under the selection, centred on it", () => {
    const place = placeBar(
      { left: 300, top: 100, right: 420, bottom: 120 },
      PANE,
      BAR,
    );
    expect(place.above).toBe(false);
    expect(place.top).toBeGreaterThan(120);
    // Centred: the midpoint of the selection is 360, so the bar starts half its
    // width to the left of that.
    expect(place.left).toBe(360 - BAR.width / 2);
  });

  it("flips above when there is no room below", () => {
    // At the bottom of the pane, a bar below the selection would be off screen
    // — which is a formatting bar you cannot reach.
    const place = placeBar(
      { left: 300, top: 560, right: 420, bottom: 580 },
      PANE,
      BAR,
    );
    expect(place.above).toBe(true);
    expect(place.top).toBeLessThan(560);
    expect(place.top + BAR.height).toBeLessThanOrEqual(560);
  });

  it("never covers the selection it belongs to", () => {
    for (const bottom of [40, 200, 400, 560, 596]) {
      const selection = { left: 300, top: bottom - 20, right: 420, bottom };
      const place = placeBar(selection, PANE, BAR);
      const overlaps =
        place.top < selection.bottom && place.top + BAR.height > selection.top;
      expect(overlaps).toBe(false);
    }
  });

  it("stays inside the pane at either edge", () => {
    const atLeft = placeBar(
      { left: 0, top: 100, right: 20, bottom: 120 },
      PANE,
      BAR,
    );
    expect(atLeft.left).toBeGreaterThanOrEqual(0);

    const atRight = placeBar(
      { left: 780, top: 100, right: 800, bottom: 120 },
      PANE,
      BAR,
    );
    expect(atRight.left + BAR.width).toBeLessThanOrEqual(PANE.width);
  });

  it("sits at the near edge when it is wider than the pane", () => {
    // A narrow pane with the file list and three tabs open is ordinary, and a
    // bar clamped to the *far* edge would have its first buttons off screen —
    // the ones that are used most.
    const place = placeBar(
      { left: 40, top: 100, right: 120, bottom: 120 },
      { width: 200, height: 600 },
      BAR,
    );
    expect(place.left).toBeGreaterThanOrEqual(0);
    expect(place.left).toBeLessThan(BAR.width);
  });

  it("stays on screen when the selection is taller than the pane", () => {
    // Selecting several screens of text leaves a rectangle whose top is off the
    // pane, and the bar must not follow it there.
    const place = placeBar(
      { left: 100, top: -400, right: 500, bottom: 900 },
      PANE,
      BAR,
    );
    expect(place.top).toBeGreaterThanOrEqual(0);
    expect(place.top + BAR.height).toBeLessThanOrEqual(PANE.height);
  });
});
