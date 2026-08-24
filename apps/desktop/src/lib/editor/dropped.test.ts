/**
 * Reading a picture off a drag.
 *
 * An image annotation dragged out of Zotero turned out to carry its picture as
 * a `data:` URL inside the HTML rather than as a file — so a drag that plainly
 * contained a picture arrived with no files at all, fell through to "identify
 * this by its words", and ended at the source picker with nothing to show for
 * it. This is the decoding that fixes it, and the reason it is a function
 * rather than three lines inside an event handler.
 */

import { describe, expect, it } from "vitest";

import { decodeDataUrl } from "./dropped";

/** A one-pixel PNG, as a browser would embed it. */
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("decoding a picture embedded in a drag", () => {
  it("reads a base64 data URL", () => {
    const found = decodeDataUrl(`data:image/png;base64,${PIXEL}`);
    expect(found?.type).toBe("image/png");
    expect(found?.bytes.length).toBeGreaterThan(0);
  });

  it("gives back the actual bytes, not the text", () => {
    // The first eight bytes of any PNG. Getting this wrong writes a file that
    // is not an image, which LaTeX reports as a corrupt graphic much later.
    const found = decodeDataUrl(`data:image/png;base64,${PIXEL}`);
    expect([...(found?.bytes.slice(0, 8) ?? [])]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
  });

  it("takes the type from the URL, whatever its case", () => {
    expect(decodeDataUrl(`DATA:IMAGE/PNG;BASE64,${PIXEL}`)?.type).toBe(
      "image/png",
    );
  });

  it("declines a type LaTeX cannot include", () => {
    expect(
      decodeDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="),
    ).toBeNull();
  });

  it("declines anything that is not a picture", () => {
    expect(decodeDataUrl("data:text/plain;base64,aGVsbG8=")).toBeNull();
  });

  it("declines a URL that is not base64", () => {
    // Percent-encoded payloads are possible, are not what anything produces,
    // and decoding one wrongly would write a corrupt file rather than fail.
    expect(decodeDataUrl("data:image/png,not-base64")).toBeNull();
  });

  it("survives a truncated payload", () => {
    expect(() => decodeDataUrl("data:image/png;base64,####")).not.toThrow();
  });

  it("declines something that is not a data URL at all", () => {
    expect(decodeDataUrl("https://example.com/a.png")).toBeNull();
    expect(decodeDataUrl("")).toBeNull();
  });
});
