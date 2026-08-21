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
  citedWorks,
  declaredBibliographies,
  diagnoseBibliography,
  firstSurname,
  ownsPreamble,
  readBib,
  withBibliography,
} from "./bibliography";
import { attribution } from "./semanticView";

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

/**
 * Writing the declaration, and into which file.
 *
 * The reported regression: the fix went into whichever file was open, so a
 * declaration added while reading a section vanished the moment the author
 * opened something else. `\addbibresource` belongs in the preamble.
 */
describe("declaring a bibliography", () => {
  it("puts the declaration above begin{document}", () => {
    const doc = [
      `${B}documentclass{report}`,
      `${B}begin{document}`,
      "Text.",
      `${B}end{document}`,
    ].join("\n");
    const next = withBibliography(doc, "refs.bib");
    expect(next.indexOf(`${B}addbibresource{refs.bib}`)).toBeGreaterThan(
      next.indexOf(`${B}documentclass`),
    );
    expect(next.indexOf(`${B}addbibresource{refs.bib}`)).toBeLessThan(
      next.indexOf(`${B}begin{document}`),
    );
  });

  it("replaces a declaration that is already there", () => {
    // Rather than adding a second one: biblatex would then load both, and the
    // author asked to point the document at one file.
    const doc = `${B}addbibresource{old.bib}\n${B}begin{document}`;
    const next = withBibliography(doc, "new.bib");
    expect(next).toContain(`${B}addbibresource{new.bib}`);
    expect(next).not.toContain("old.bib");
  });

  it("keeps everything else exactly as it was", () => {
    const doc = `${B}documentclass{report}\n${B}begin{document}\nText.`;
    const next = withBibliography(doc, "refs.bib");
    expect(next).toContain(`${B}documentclass{report}`);
    expect(next).toContain("Text.");
  });

  it("appends to a file with no begin{document} rather than losing it", () => {
    const next = withBibliography(`${B}usepackage{biblatex}`, "refs.bib");
    expect(next).toContain(`${B}usepackage{biblatex}`);
    expect(next).toContain(`${B}addbibresource{refs.bib}`);
  });
});

describe("which file holds the preamble", () => {
  it("recognises the file with begin{document}", () => {
    expect(ownsPreamble(`${B}begin{document}\nText.`)).toBe(true);
  });

  it("recognises a preamble split into its own file", () => {
    // A project that `\input`s its preamble still has the declaration there,
    // and that is the file to edit.
    expect(ownsPreamble(`${B}addbibresource{refs.bib}`)).toBe(true);
  });

  it("does not mistake a section for it", () => {
    // The bug: a section is where the citation is and the wrong place for the
    // declaration, because nothing in it is the preamble.
    const section = `${B}chapter{Vorbemerkungen}\nEin Satz ${B}cite{din277}.`;
    expect(ownsPreamble(section)).toBe(false);
  });
});

/**
 * Drawing a quotation's attribution.
 *
 * `\textquote[\cite[8]{din277}]{…}` is what the Zotero bridge writes for a
 * dragged highlight. Its optional argument is the source, not a setting, so it
 * is drawn after the closing quotation mark rather than hidden with the markup.
 */
describe("what a quotation is attributed to", () => {
  const BOOKS = new Map([
    ["din277", { key: "din277", label: "DIN 2021", detail: "DIN 277" }],
    ["meister", { key: "meister", label: "Meister 2019", detail: "BIM" }],
  ]);

  it("names the work and the page", () => {
    expect(attribution(`${B}cite[8]{din277}`, BOOKS)).toBe("[DIN 2021, 8]");
  });

  it("names the work when there is no page", () => {
    expect(attribution(`${B}cite{din277}`, BOOKS)).toBe("[DIN 2021]");
  });

  it("falls back to the key for a work the bibliography does not know", () => {
    // Which is what the author typed, and better than drawing nothing.
    expect(attribution(`${B}cite{unknown}`, BOOKS)).toBe("[unknown]");
  });

  it("names every work cited together", () => {
    expect(attribution(`${B}cite{din277,meister}`, BOOKS)).toBe(
      "[DIN 2021; Meister 2019]",
    );
  });

  it("reads a package's citation command as well as LaTeX's", () => {
    // `\parencite` is biblatex's and `\cite` is LaTeX's; a quotation may carry
    // either, and which one is not this function's business.
    expect(attribution(`${B}parencite[8]{din277}`, BOOKS)).toBe(
      "[DIN 2021, 8]",
    );
  });

  it("says nothing for an optional argument that is not a citation", () => {
    // `\textquote[][.]{…}` sets the punctuation. Drawing that as an
    // attribution would invent a source the document never named.
    expect(attribution("", BOOKS)).toBeNull();
    expect(attribution(".", BOOKS)).toBeNull();
  });
});

/**
 * The works a document cites.
 *
 * What the Citations tab shows. Works rather than commands: a source cited
 * eleven times is one source, and eleven rows for it would bury the one cited
 * once that does not resolve.
 */
describe("the works a document cites", () => {
  const BOOKS = new Map([
    ["din277", { key: "din277", label: "DIN 2021", detail: "DIN 277" }],
  ]);

  it("finds a citation and resolves it", () => {
    const doc = `Ein Satz ${B}cite{din277}.`;
    const [work] = citedWorks(doc, BOOKS);
    expect(work?.key).toBe("din277");
    expect(work?.entry?.label).toBe("DIN 2021");
  });

  it("gathers every use of one work into a single row", () => {
    const doc = `${B}cite{din277} und ${B}cite{din277} und ${B}cite{din277}`;
    const works = citedWorks(doc, BOOKS);
    expect(works).toHaveLength(1);
    expect(works[0]?.at).toHaveLength(3);
  });

  it("reads a package's command as well as LaTeX's", () => {
    const doc = `${B}parencite{din277} ${B}citep{other}`;
    expect(
      citedWorks(doc, BOOKS)
        .map((work) => work.key)
        .sort(),
    ).toEqual(["din277", "other"]);
  });

  it("splits a citation of several works at once", () => {
    const doc = `${B}cite{din277,other}`;
    expect(citedWorks(doc, BOOKS)).toHaveLength(2);
  });

  it("reads past the page a citation carries", () => {
    expect(citedWorks(`${B}cite[8]{din277}`, BOOKS)[0]?.key).toBe("din277");
  });

  it("puts the unresolved ones first", () => {
    // They are the rows that need doing something about; a resolved citation
    // needs nothing from anybody.
    const doc = `${B}cite{din277} dann ${B}cite{missing}`;
    expect(citedWorks(doc, BOOKS).map((work) => work.key)).toEqual([
      "missing",
      "din277",
    ]);
  });

  it("ignores a citation that is commented out", () => {
    expect(citedWorks(`% ${B}cite{din277}`, BOOKS)).toEqual([]);
  });

  it("does not mistake a quotation's attribution for nothing", () => {
    // `\textquote[\cite[8]{din277}]{…}` cites the work, and a tab that missed
    // it would under-report what the document depends on.
    const doc = `${B}textquote[${B}cite[8]{din277}]{Ein Satz}`;
    expect(citedWorks(doc, BOOKS)[0]?.key).toBe("din277");
  });

  it("finds nothing in a document that cites nothing", () => {
    expect(citedWorks("Nur Text.", BOOKS)).toEqual([]);
  });
});
