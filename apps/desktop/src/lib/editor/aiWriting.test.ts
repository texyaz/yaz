/**
 * The AI writing plugin's pure parts: the marks, the word diff, and how the
 * journal pairs what the AI wrote with what the author made of it (ADR-0032).
 *
 * Here rather than in the plugin's repository for the same reason as
 * `zoteroDrop.test.ts`: the plugin has no test runner of its own.
 */

import { describe, expect, it } from "vitest";

import {
  highlightKeys,
  marks,
  similarity,
  wordDiff,
} from "../../../../../plugins/ai/src/marks";
import {
  lessons,
  originalFor,
  wasEdited,
  type Entry,
} from "../../../../../plugins/ai/src/journal";

describe("marks", () => {
  it("finds \\ai and \\proofed with their keys and body", () => {
    const text =
      "A. \\ai[AAAA1111,BBBB2222]{One \\cite{x}.} B. \\proofed[CCCC3333]{Two.}";
    const found = marks(text);
    expect(found.map((m) => [m.kind, m.keys, m.body])).toEqual([
      ["ai", ["AAAA1111", "BBBB2222"], "One \\cite{x}."],
      ["proofed", ["CCCC3333"], "Two."],
    ]);
    expect(text.slice(found[0]!.bodyFrom, found[0]!.bodyTo)).toBe(
      "One \\cite{x}.",
    );
    expect(text.slice(found[0]!.from, found[0]!.to)).toBe(
      "\\ai[AAAA1111,BBBB2222]{One \\cite{x}.}",
    );
  });

  it("skips marks in comments and marks never closed", () => {
    expect(marks("% \\ai[AAAA1111]{gone}\n\\ai[BBBB2222]{open")).toEqual([]);
    expect(marks("50\\% \\ai[AAAA1111]{kept}")).toHaveLength(1);
  });
});

describe("highlightKeys", () => {
  it("reads an array, a JSON string of one, or a plain list", () => {
    expect(highlightKeys(["AAAA1111", "BBBB2222"])).toEqual([
      "AAAA1111",
      "BBBB2222",
    ]);
    expect(highlightKeys('["AAAA1111","BBBB2222"]')).toEqual([
      "AAAA1111",
      "BBBB2222",
    ]);
    expect(highlightKeys("AAAA1111, BBBB2222")).toEqual([
      "AAAA1111",
      "BBBB2222",
    ]);
    expect(highlightKeys("AAAA1111")).toEqual(["AAAA1111"]);
    expect(highlightKeys(undefined)).toEqual([]);
  });
});

describe("wordDiff", () => {
  it("shows which words the author changed, ignoring re-wrapping", () => {
    expect(
      wordDiff(
        "The sector accounts for a significant share.",
        "The sector\n accounts for 27% share.",
      ),
    ).toEqual([
      { kind: "same", text: "The sector accounts for" },
      { kind: "removed", text: "a significant" },
      { kind: "added", text: "27%" },
      { kind: "same", text: "share." },
    ]);
    expect(similarity("a b c d", "a b c d")).toBe(1);
    expect(similarity("a b c d", "w x y z")).toBe(0);
  });
});

describe("the journal", () => {
  const inserted = (
    text: string,
    keys = ["AAAA1111"],
    project = "paper",
  ): Entry => ({
    kind: "inserted",
    at: "2026-11-24T10:00:00Z",
    project,
    keys,
    text,
  });

  it("pairs a mark with the closest insert on the same highlight in the same paper", () => {
    const entries = [
      inserted("Cities grow fast."),
      inserted("Construction causes a quarter of urban freight traffic."),
      inserted(
        "Construction causes a quarter of urban freight traffic.",
        ["AAAA1111"],
        "other",
      ),
      inserted("Unrelated.", ["BBBB2222"]),
    ];
    const mark = {
      keys: ["AAAA1111"],
      body: "Construction causes about a quarter of urban freight.",
    };
    const found = originalFor(entries, mark, "paper");
    expect(found?.text).toBe(
      "Construction causes a quarter of urban freight traffic.",
    );
    expect(wasEdited(found, mark.body)).toBe(true);
    expect(
      wasEdited(
        found,
        "Construction causes a quarter\nof urban freight traffic.",
      ),
    ).toBe(false);
    expect(
      originalFor(entries, { keys: ["CCCC3333"], body: "x" }, "paper"),
    ).toBeNull();
  });

  it("learns from rewrites and rejects, newest first, across papers", () => {
    const entries: Entry[] = [
      {
        kind: "proofed",
        at: "1",
        project: "p1",
        keys: ["A"],
        ai: "a big share",
        human: "27%",
        highlight: null,
        citationKey: null,
      },
      {
        kind: "proofed",
        at: "2",
        project: "p1",
        keys: ["A"],
        ai: "kept as is",
        human: "kept  as is",
        highlight: null,
        citationKey: null,
      },
      {
        kind: "rejected",
        at: "3",
        project: "p2",
        keys: ["B"],
        ai: "overclaim",
        human: "overclaim",
        highlight: "passage",
        citationKey: null,
      },
      {
        kind: "proofed",
        at: "4",
        project: "p2",
        keys: ["C"],
        ai: "utilise",
        human: "use",
        highlight: null,
        citationKey: null,
      },
    ];
    const learned = lessons(entries, 10);
    expect(learned.rewritten.map((r) => r.authorMadeIt)).toEqual([
      "use",
      "27%",
    ]);
    expect(learned.rejected).toEqual([
      { paper: "p2", aiWrote: "overclaim", highlight: "passage" },
    ]);
    expect(learned.acceptedUnchanged).toBe(1);
    expect(learned.decided).toBe(4);
  });
});
