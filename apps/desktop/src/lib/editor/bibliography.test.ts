/**
 * Reading a document's bibliography.
 *
 * The case that prompted all of this: a project whose preamble says
 * `\addbibresource{BIMwissT.bib}` had its Zotero entries written to
 * `references.bib`, so the key was on disk, in a file LaTeX never reads, and
 * the citation stayed red.
 */

import { describe, expect, it } from "vitest";

import {
  declaredBibliographies,
  diagnoseBibliography,
  firstSurname,
  readBib,
} from "./bibliography";

const B = String.fromCharCode(92);

describe("which bibliography a document declares", () => {
  it("reads biblatex's addbibresource", () => {
    expect(declaredBibliographies(`${B}addbibresource{BIMwissT.bib}`)).toEqual([
      "BIMwissT.bib",
    ]);
  });

  it("reads BibTeX's bibliography, which omits the extension", () => {
    expect(declaredBibliographies(`${B}bibliography{refs}`)).toEqual([
      "refs.bib",
    ]);
  });

  it("reads several files out of one bibliography command", () => {
    expect(declaredBibliographies(`${B}bibliography{books,papers}`)).toEqual([
      "books.bib",
      "papers.bib",
    ]);
  });

  it("reads several addbibresource calls", () => {
    const doc = [
      `${B}addbibresource{one.bib}`,
      `${B}addbibresource{two.bib}`,
    ].join("\n");
    expect(declaredBibliographies(doc)).toEqual(["one.bib", "two.bib"]);
  });

  it("ignores a declaration that is commented out", () => {
    // A commented-out declaration is one the author switched off, and loading
    // it would mean the preview disagreed with the compiler.
    expect(declaredBibliographies(`% ${B}addbibresource{old.bib}`)).toEqual([]);
  });

  it("does not repeat a file declared twice", () => {
    const doc = `${B}addbibresource{a.bib}\n${B}addbibresource{a.bib}`;
    expect(declaredBibliographies(doc)).toEqual(["a.bib"]);
  });

  it("finds nothing in a document that declares nothing", () => {
    expect(declaredBibliographies(`${B}documentclass{article}`)).toEqual([]);
  });
});

describe("the surname a citation shows", () => {
  it("takes it from a comma-separated name", () => {
    expect(firstSurname("Meister, Ulrich")).toBe("Meister");
  });

  it("takes it from a first-last name", () => {
    expect(firstSurname("Ulrich Meister")).toBe("Meister");
  });

  it("takes only the first of several authors", () => {
    expect(firstSurname("Meister, Ulrich and Schmidt, Anna")).toBe("Meister");
  });

  it("keeps an institutional name whole", () => {
    // `{Deutsches Institut für Normung}` is one author, and taking the last
    // word of it would cite "Normung".
    expect(firstSurname("{Deutsches Institut für Normung}")).toBe(
      "Deutsches Institut für Normung",
    );
  });

  it("says nothing for no author", () => {
    expect(firstSurname("")).toBe("");
  });
});

describe("reading a .bib", () => {
  const BIB = `
@article{meister2021,
  author = {Meister, Ulrich and Schmidt, Anna},
  title = {Building Information Modeling im Hochbau},
  journaltitle = {Bauingenieur},
  year = {2021},
}

@standard{din277,
  author = {{Deutsches Institut für Normung}},
  title = {DIN 277: Grundflächen und Rauminhalte im Hochbau},
  date = {2021-08},
}
`;

  it("finds every entry by its key", () => {
    expect([...readBib(BIB).keys()]).toEqual(["meister2021", "din277"]);
  });

  it("labels an entry the way a citation prints it", () => {
    expect(readBib(BIB).get("meister2021")?.label).toBe("Meister 2021");
  });

  it("takes the year out of a biblatex date", () => {
    expect(readBib(BIB).get("din277")?.label).toBe(
      "Deutsches Institut für Normung 2021",
    );
  });

  it("shows the title on hover", () => {
    expect(readBib(BIB).get("meister2021")?.detail).toContain(
      "Building Information Modeling im Hochbau",
    );
  });

  it("reads a quoted field as well as a braced one", () => {
    const quoted = `@book{x, author = "Meister, Ulrich", year = "1999"}`;
    expect(readBib(quoted).get("x")?.label).toBe("Meister 1999");
  });

  it("reads a bare year", () => {
    const bare = `@book{x, author = {Meister, U}, year = 1999}`;
    expect(readBib(bare).get("x")?.label).toBe("Meister 1999");
  });

  it("survives braces inside a title", () => {
    const nested = `@book{x, title = {A {LaTeX} book}, author = {Knuth, D}, year = {1984}}`;
    expect(readBib(nested).get("x")?.detail).toContain("book");
  });

  it("is not fooled by a string macro", () => {
    // `@string{bau = "Bauingenieur"}` is not a work. Listing it would let a
    // typo'd citation resolve to a source that does not exist.
    const macros = `@string{bau = "Bauingenieur"}\n@book{real, author={A, B}, year={2000}}`;
    expect([...readBib(macros).keys()]).toEqual(["real"]);
  });

  it("falls back to the key when an entry says nothing useful", () => {
    expect(readBib("@misc{lonely,}").get("lonely")?.label).toBe("lonely");
  });

  it("finds nothing in an empty file", () => {
    expect(readBib("").size).toBe(0);
  });
});

describe("diagnosing why a citation will not resolve", () => {
  it("says the document declares nothing when it declares nothing", () => {
    expect(diagnoseBibliography([], ["BIMwissT.bib"])).toEqual({
      kind: "undeclared",
      candidates: ["BIMwissT.bib"],
    });
  });

  it("says which declared file is missing, and what is there instead", () => {
    // The reported case, from the other direction: a document pointed at a
    // file that is not in the project while a different `.bib` sits beside it.
    expect(diagnoseBibliography(["references.bib"], ["BIMwissT.bib"])).toEqual({
      kind: "missing",
      declared: "references.bib",
      candidates: ["BIMwissT.bib"],
    });
  });

  it("does not offer the file that is already declared as a candidate", () => {
    const found = diagnoseBibliography(
      ["a.bib", "missing.bib"],
      ["a.bib", "b.bib"],
    );
    expect(found.kind).toBe("missing");
    expect(found.kind === "missing" && found.candidates).toEqual(["b.bib"]);
  });

  it("matches a declaration against a file in a subdirectory", () => {
    // `\addbibresource{BIMwissT.bib}` and `bib/BIMwissT.bib` are the same file
    // as far as the author is concerned, and reporting it missing would send
    // them looking for a problem they do not have.
    expect(
      diagnoseBibliography(["BIMwissT.bib"], ["bib/BIMwissT.bib"]).kind,
    ).toBe("absent");
  });

  it("says the key is simply absent when everything else is in order", () => {
    expect(diagnoseBibliography(["a.bib"], ["a.bib"])).toEqual({
      kind: "absent",
      declared: "a.bib",
    });
  });
});
