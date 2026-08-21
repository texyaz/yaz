/**
 * The glossary the packages plugin reads out of a document.
 *
 * Tested from the application's suite rather than the plugin's, because the
 * plugin repos are not in this workspace and have no runner of their own yet.
 * What is checked is the parsing — the part with a decision in it — and not the
 * DOM the view builds from it.
 */

import { describe, expect, it } from "vitest";

import {
  glossaryEntries,
  plain,
} from "../../../../../plugins/latex-packages/src/glossary";

const B = String.fromCharCode(92);

describe("reading the terms a document defines", () => {
  it("reads an entry's name and description", () => {
    const doc = `${B}newglossaryentry{bim}{name={BIM},description={Building Information Modeling}}`;
    expect(glossaryEntries(doc)).toEqual([
      {
        key: "bim",
        name: "BIM",
        description: "Building Information Modeling",
        short: "",
        at: 0,
      },
    ]);
  });

  it("keeps a description that contains commas", () => {
    // The obvious implementation splits the second argument on commas, and a
    // real glossary is full of them — which turns one term into three.
    const doc =
      `${B}newglossaryentry{aia}{name={AIA},` +
      `description={Anforderungen des Auftraggebers an die Modelle, ` +
      `die Daten und die Prozesse}}`;
    const [entry] = glossaryEntries(doc);
    expect(entry?.description).toContain("die Daten und die Prozesse");
  });

  it("keeps a description that contains braces", () => {
    const doc =
      `${B}newglossaryentry{tex}{name={TeX},` +
      `description={Was ${B}LaTeX{} daraus macht}}`;
    expect(glossaryEntries(doc)[0]?.description).toBe("Was daraus macht");
  });

  it("reads an acronym's short and long forms", () => {
    const doc = `${B}newacronym{tlbv}{TLBV}{Thüringer Landesamt für Bau und Verkehr}`;
    expect(glossaryEntries(doc)[0]).toMatchObject({
      key: "tlbv",
      short: "TLBV",
      name: "Thüringer Landesamt für Bau und Verkehr",
    });
  });

  it("skips the optional argument an acronym may carry", () => {
    const doc = `${B}newacronym[plural=BIMs]{bim}{BIM}{Building Information Modeling}`;
    expect(glossaryEntries(doc)[0]).toMatchObject({
      key: "bim",
      short: "BIM",
    });
  });

  it("does not read a commented-out definition", () => {
    // A term the author has switched off is not a term the document has, and
    // a glossary that listed it would be describing a different document.
    const doc = `% ${B}newacronym{old}{OLD}{Nicht mehr}`;
    expect(glossaryEntries(doc)).toEqual([]);
  });

  it("does not mistake a longer command for a definition", () => {
    const doc = `${B}newacronymstyle{long-short}`;
    expect(glossaryEntries(doc)).toEqual([]);
  });

  it("keeps the first of two definitions of one key", () => {
    // Which is what LaTeX keeps. Listing both would say the document has a
    // term twice, which it does not.
    const doc = [
      `${B}newacronym{bim}{BIM}{Erste}`,
      `${B}newacronym{bim}{BIM}{Zweite}`,
    ].join("\n");
    const found = glossaryEntries(doc);
    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe("Erste");
  });

  it("sorts by what the reader looks the term up by", () => {
    // Not by where it stands in the source: somebody looking a term up does
    // not know where it was written.
    const doc = [
      `${B}newacronym{z}{ZED}{Zed}`,
      `${B}newacronym{a}{ABC}{Abc}`,
    ].join("\n");
    expect(glossaryEntries(doc).map((entry) => entry.short)).toEqual([
      "ABC",
      "ZED",
    ]);
  });

  it("says where the definition is, so the tab can go there", () => {
    const doc = `Vorher.\n${B}newacronym{bim}{BIM}{Modeling}`;
    expect(glossaryEntries(doc)[0]?.at).toBe(doc.indexOf(`${B}newacronym`));
  });

  it("finds nothing in a document with no glossary", () => {
    expect(glossaryEntries("Nur Text, kein Glossar.")).toEqual([]);
  });
});

describe("stripping the markup from a term", () => {
  it("leaves the words", () => {
    expect(plain(`{${B}textsc{BIM}}`)).toBe("BIM");
  });

  it("collapses the space a removed command leaves behind", () => {
    expect(plain(`Was ${B}LaTeX{} daraus macht`)).toBe("Was daraus macht");
  });
});
