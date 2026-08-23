/**
 * Finding text, and replacing it.
 *
 * The three switches are where this goes wrong — whole-word at a punctuation
 * edge, a half-typed regular expression, a `$1` in a literal replacement — so
 * those are what is pinned here.
 */

import { describe, expect, it } from "vitest";

import {
  findMatches,
  expandReplacement,
  patternFor,
  PLAIN_SEARCH,
  replaceAll,
  replaceOne,
} from "./search";

const DOC = [
  "Der Bau kostet Geld.",
  "Bauwerk und bau und BAU.",
  "Ein Preis von 200 Euro.",
].join("\n");

/** The options, with the named ones switched on. */
function options(...on: ("matchCase" | "wholeWord" | "regex")[]) {
  return { ...PLAIN_SEARCH, ...Object.fromEntries(on.map((k) => [k, true])) };
}

describe("finding text", () => {
  it("finds every occurrence, whatever the case", () => {
    const found = findMatches(DOC, "bau", PLAIN_SEARCH);
    expect(found.map((m) => m.text)).toEqual(["Bau", "Bau", "bau", "BAU"]);
  });

  it("respects match case", () => {
    expect(
      findMatches(DOC, "bau", options("matchCase")).map((m) => m.text),
    ).toEqual(["bau"]);
  });

  it("respects whole word", () => {
    // `Bauwerk` is out; the three standalone ones stay.
    const found = findMatches(DOC, "bau", options("wholeWord"));
    expect(found).toHaveLength(3);
    expect(found.every((m) => m.text.length === 3)).toBe(true);
  });

  it("takes a query literally unless told otherwise", () => {
    // Without this, searching for `200.` finds `200 ` — the dot is not a
    // wildcard to somebody typing a sentence.
    expect(findMatches(DOC, "200.", PLAIN_SEARCH)).toHaveLength(0);
    expect(findMatches(DOC, "200 ", PLAIN_SEARCH)).toHaveLength(1);
  });

  it("reads a regular expression when asked", () => {
    const found = findMatches(DOC, String.raw`\d+`, options("regex"));
    expect(found.map((m) => m.text)).toEqual(["200"]);
  });

  it("numbers the lines the way an editor does", () => {
    const found = findMatches(DOC, "Preis", PLAIN_SEARCH);
    expect(found[0]?.line).toBe(3);
  });

  it("carries the words either side of the match", () => {
    const found = findMatches(DOC, "kostet", PLAIN_SEARCH);
    expect(found[0]?.before).toBe("Der Bau ");
    expect(found[0]?.after).toBe(" Geld.");
  });

  it("does not spill into the next line", () => {
    // A result row showing the following line as context is a row that lies
    // about where the match is.
    const found = findMatches(DOC, "Geld.", PLAIN_SEARCH);
    expect(found[0]?.after).toBe("");
  });

  it("finds nothing for an empty query", () => {
    expect(findMatches(DOC, "", PLAIN_SEARCH)).toEqual([]);
  });

  it("survives a half-typed regular expression", () => {
    // Every keystroke of `[a-z` is an invalid pattern, and a search box that
    // threw on those would be one nobody could type into.
    expect(() => findMatches(DOC, "[a-z", options("regex"))).not.toThrow();
    expect(findMatches(DOC, "[a-z", options("regex"))).toEqual([]);
  });

  it("does not hang on a pattern that matches nothing", () => {
    // `a*` matches the empty string at every position; without a guard the
    // loop never ends.
    expect(() => findMatches(DOC, "x*", options("regex"), 50)).not.toThrow();
  });

  it("stops at the limit rather than building a list nobody reads", () => {
    expect(findMatches(DOC, "e", PLAIN_SEARCH, 3)).toHaveLength(3);
  });
});

describe("building the pattern", () => {
  it("does not put a word boundary where a word cannot begin", () => {
    // There is no boundary before `(`, so `\b\(` would find nothing at all.
    const pattern = patternFor("(a)", options("wholeWord"));
    expect(pattern).not.toBeNull();
    expect("say (a) here".match(pattern!)).not.toBeNull();
  });

  it("is null for a query that cannot be a pattern", () => {
    expect(patternFor("", PLAIN_SEARCH)).toBeNull();
  });
});

describe("replacing", () => {
  it("replaces one match where it is", () => {
    const [match] = findMatches(DOC, "Geld", PLAIN_SEARCH);
    const change = replaceOne(match!, "Zeit", PLAIN_SEARCH);
    expect(
      DOC.slice(0, change.from) + change.insert + DOC.slice(change.to),
    ).toContain("kostet Zeit");
  });

  it("gives every change back in document order", () => {
    // The editor wants them that way, and applying them out of order moves the
    // offsets of the ones not yet applied.
    const found = findMatches(DOC, "und", PLAIN_SEARCH);
    const changes = replaceAll(found, "oder", PLAIN_SEARCH);
    expect(changes).toHaveLength(2);
    expect(changes[0]!.from).toBeLessThan(changes[1]!.from);
  });

  it("expands a capture group under regex", () => {
    const [match] = findMatches(DOC, String.raw`(\d+) Euro`, options("regex"));
    expect(expandReplacement("EUR $1", match!, options("regex"))).toBe(
      "EUR 200",
    );
  });

  it("leaves a dollar alone when the query was literal", () => {
    // Somebody replacing a price with `$5` means `$5`.
    const [match] = findMatches(DOC, "Geld", PLAIN_SEARCH);
    expect(expandReplacement("$5", match!, PLAIN_SEARCH)).toBe("$5");
  });

  it("writes a literal dollar for a doubled one", () => {
    const [match] = findMatches(DOC, "Geld", PLAIN_SEARCH);
    expect(expandReplacement("$$", match!, options("regex"))).toBe("$");
  });
});
