/**
 * Which citation key the cursor is on, for "Show citation in Zotero".
 *
 * Lives here rather than in the plugin's repository for the same reason as
 * `zoteroDrop.test.ts`: the plugin has no test runner of its own.
 */

import { describe, expect, it } from "vitest";

import {
  annotationMarkAt,
  citationKeyAt,
} from "../../../../../plugins/zotero/src/latex";

/** The offset of the `|` marker, and the text without it. */
function cursor(marked: string): [string, number] {
  const at = marked.indexOf("|");
  return [marked.slice(0, at) + marked.slice(at + 1), at];
}

function keyAt(marked: string): string | null {
  const [text, at] = cursor(marked);
  return citationKeyAt(text, at);
}

describe("citationKeyAt", () => {
  it("finds the key the cursor is inside", () => {
    expect(keyAt("as shown \\cite{meis|ter2021} before")).toBe("meister2021");
  });

  it("reads past page and prenote options", () => {
    expect(keyAt("\\parencite[8]{ai|fandopoulou2019}")).toBe(
      "aifandopoulou2019",
    );
    expect(keyAt("\\autocite[see][12]{|key}")).toBe("key");
  });

  it("takes the key under the cursor when there are several", () => {
    expect(keyAt("\\cite{first, sec|ond, third}")).toBe("second");
    expect(keyAt("\\cite{first,second,thi|rd}")).toBe("third");
  });

  it("takes the first key from the command name or its options", () => {
    expect(keyAt("\\text|cite{alpha, beta}")).toBe("alpha");
    expect(keyAt("\\parencite[p|. 8]{alpha, beta}")).toBe("alpha");
  });

  it("knows natbib and biblatex variants", () => {
    expect(keyAt("\\citet*{wa|lter2025}")).toBe("walter2025");
    expect(keyAt("\\footcite{tur|ner2024}")).toBe("turner2024");
  });

  it("is null away from a citation", () => {
    expect(keyAt("plain te|xt \\cite{key}")).toBeNull();
    expect(keyAt("\\ref{fig|:one}")).toBeNull();
    expect(keyAt("\\cite{key} and af|ter")).toBeNull();
  });

  it("picks the citation the cursor is in, not the nearest one", () => {
    expect(keyAt("\\cite{one} text \\cite{tw|o} text \\cite{three}")).toBe(
      "two",
    );
  });
});

describe("annotationMarkAt", () => {
  function markAt(marked: string) {
    const [text, at] = cursor(marked);
    return annotationMarkAt(text, at);
  }

  it("finds the marker the cursor is anywhere inside", () => {
    expect(markAt("\\ai[Z5QQBSIE]{Claims are | true \\cite{k}.}")).toEqual({
      kind: "ai",
      keys: ["Z5QQBSIE"],
      keyAtCursor: null,
    });
    expect(markAt("\\proofed[AAAA1111]{Text \\cite{k|ey}.}")?.kind).toBe(
      "proofed",
    );
  });

  it("knows which of several keys the cursor is on", () => {
    expect(markAt("\\ai[AAAA1111, BBBB|2222]{Text.}")).toEqual({
      kind: "ai",
      keys: ["AAAA1111", "BBBB2222"],
      keyAtCursor: "BBBB2222",
    });
  });

  it("matches braces, and escaped braces are not braces", () => {
    expect(markAt("\\ai[K1234567]{a {nested} \\} b|}")?.keys).toEqual([
      "K1234567",
    ]);
    expect(markAt("\\ai[K1234567]{done} after |")).toBeNull();
  });

  it("is null outside a marker, or for an unclosed one", () => {
    expect(markAt("plain te|xt \\cite{key}")).toBeNull();
    expect(markAt("\\ai[K1234567]{never clo|sed")).toBeNull();
  });

  it("takes the innermost of nested markers", () => {
    expect(
      markAt("\\ai[OUTER111]{a \\proofed[INNER111]{b | c} d}")?.keys,
    ).toEqual(["INNER111"]);
    expect(
      markAt("\\ai[OUTER111]{a \\proofed[INNER111]{b c} d |}")?.keys,
    ).toEqual(["OUTER111"]);
  });
});
