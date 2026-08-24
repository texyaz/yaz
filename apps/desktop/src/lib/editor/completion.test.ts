/**
 * What to suggest, and when.
 *
 * The triggers are where this goes wrong: a `{` in the middle of a paragraph
 * claiming to be a citation argument, or `\\` at the end of a table row read as
 * the start of a command name. Both put a list under somebody's cursor while
 * they are writing prose, which is the behaviour people switch completion off
 * to escape.
 */

import { describe, expect, it } from "vitest";

import { labelsIn, rank, triggerAt } from "./completion";

const B = String.fromCharCode(92);

/** A document with ‸ marking where the caret is. */
function at(marked: string): [string, number] {
  const caret = marked.indexOf("‸");
  return [marked.replace("‸", ""), caret];
}

/** The trigger for a marked document. */
function trigger(marked: string) {
  const [text, caret] = at(marked);
  return triggerAt(text, caret);
}

describe("noticing a command being typed", () => {
  it("fires after a backslash", () => {
    const found = trigger(`Ein ${B}sec‸`);
    expect(found?.kind).toBe("command");
    expect(found?.query).toBe("sec");
  });

  it("waits for the first letter", () => {
    // Every command yaz knows, alphabetically, is not a list anybody reads —
    // it is a list they dismiss. One letter cuts it to something worth
    // looking at.
    expect(trigger(`Ein ${B}‸`)).toBeNull();
    expect(trigger(`Ein ${B}s‸`)?.kind).toBe("command");
  });

  it("replaces the name, not the backslash", () => {
    const [text] = at(`Ein ${B}sec‸`);
    const found = trigger(`Ein ${B}sec‸`);
    expect(text.slice(found!.from)).toBe("sec");
  });

  it("does not fire on a line break", () => {
    // `\\` ends a table row. Offering command names there is offering them in
    // the middle of a table somebody is filling in.
    expect(trigger(`Wert & Wert ${B}${B}‸`)).toBeNull();
  });

  it("does not fire in prose", () => {
    expect(trigger("Ein ganz gewöhnlicher Satz‸")).toBeNull();
  });
});

describe("noticing an argument being typed", () => {
  it("knows a citation from a label from a glossary term", () => {
    expect(trigger(`${B}cite{‸`)?.argument).toBe("citation");
    // A reference is asked in two steps; the empty brace is still the first.
    expect(trigger(`${B}ref{‸`)?.argument).toBe("labelKind");
    expect(trigger(`${B}ref{sec:‸`)?.argument).toBe("label");
    expect(trigger(`${B}gls{‸`)?.argument).toBe("glossary");
    expect(trigger(`${B}begin{‸`)?.argument).toBe("environment");
  });

  it("carries what has been typed so far", () => {
    const found = trigger(`${B}ref{fig:ab‸`);
    expect(found?.query).toBe("fig:ab");
    expect(found?.command).toBe("ref");
  });

  it("skips an optional argument to find the command", () => {
    // `\includegraphics[width=0.8\textwidth]{` is the ordinary shape, and the
    // brackets are between the name and the brace.
    const found = trigger(`${B}includegraphics[width=0.8${B}textwidth]{img‸`);
    expect(found?.argument).toBe("image");
    expect(found?.query).toBe("img");
  });

  it("takes the last key of several", () => {
    // `\cite{din277,spielbauer2020}` is one command and two keys; what is being
    // typed is the one after the comma.
    const found = trigger(`${B}cite{din277,spiel‸`);
    expect(found?.query).toBe("spiel");
    const [text] = at(`${B}cite{din277,spiel‸`);
    expect(text.slice(found!.from)).toBe("spiel");
  });

  it("says nothing for a command that takes no key", () => {
    expect(trigger(`${B}textbf{Kost‸`)).toBeNull();
  });

  it("says nothing for a brace that belongs to nothing", () => {
    expect(trigger("Ein Satz {mit Klammern‸")).toBeNull();
  });

  it("does not reach across a closed brace", () => {
    // The caret is after a group that finished. An earlier `{` must not claim
    // it, or typing after `\cite{a}` would keep offering citation keys.
    expect(trigger(`${B}cite{din277} und weiter‸`)).toBeNull();
  });

  it("does not reach across a line", () => {
    expect(trigger(`${B}cite{\nweiter unten‸`)).toBeNull();
  });

  it("gives up rather than guessing inside nested braces", () => {
    expect(trigger(`${B}cite{${B}textbf{a}‸`)).toBeNull();
  });
});

describe("finding the labels a document has", () => {
  const DOC = [
    `${B}section{Kosten}${B}label{sec:kosten}`,
    `${B}begin{figure}${B}label{fig:ablauf}${B}end{figure}`,
    `% ${B}label{sec:alt}`,
    `${B}label{sec:kosten}`,
  ].join("\n");

  it("finds them", () => {
    expect(labelsIn(DOC).map((l) => l.label)).toContain("sec:kosten");
    expect(labelsIn(DOC).map((l) => l.label)).toContain("fig:ablauf");
  });

  it("skips one that is commented out", () => {
    // `% \label{old}` is not a label, and offering it sends somebody to a
    // reference that will not resolve.
    expect(labelsIn(DOC).map((l) => l.label)).not.toContain("sec:alt");
  });

  it("offers each label once, however often it appears", () => {
    const keys = labelsIn(DOC).map((l) => l.label);
    expect(keys.filter((k) => k === "sec:kosten")).toHaveLength(1);
  });

  it("says what a label names, from its prefix", () => {
    const found = labelsIn(DOC).find((l) => l.label === "fig:ablauf");
    expect(found?.detail).toBe("fig");
  });

  it("finds nothing in a document with no labels", () => {
    expect(labelsIn("Ein Satz.")).toEqual([]);
  });
});

describe("ranking what is offered", () => {
  const candidates = [
    { label: "section" },
    { label: "subsection" },
    { label: "setlength" },
    { label: "textbf" },
  ];

  it("puts a prefix match above a match anywhere", () => {
    // Somebody typing three letters means the start of a word.
    const found = rank(candidates, "sec").map((c) => c.label);
    expect(found[0]).toBe("section");
    expect(found).toContain("subsection");
    expect(found.indexOf("section")).toBeLessThan(found.indexOf("subsection"));
  });

  it("drops what does not match at all", () => {
    expect(rank(candidates, "sec").map((c) => c.label)).not.toContain("textbf");
  });

  it("matches whatever the case", () => {
    expect(rank(candidates, "SEC").map((c) => c.label)).toContain("section");
  });

  it("offers everything when nothing has been typed", () => {
    expect(rank(candidates, "")).toHaveLength(4);
  });

  it("stops at the limit rather than building a list nobody reads", () => {
    const many = Array.from({ length: 500 }, (_, index) => ({
      label: `command${index}`,
    }));
    expect(rank(many, "command", 20)).toHaveLength(20);
  });
});
