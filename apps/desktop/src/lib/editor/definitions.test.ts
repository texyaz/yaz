/**
 * What is read out of a document's own definitions.
 *
 * Pure: a string in, what it defines out. What the editor then draws from it
 * is `ownView.test.ts`.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { definitions, expand, lookedUp, statements } from "./definitions";
import { sectionNumbers } from "./semantics";
import { headings } from "./structure";
import { setContributions } from "./vocabulary";

const B = String.fromCharCode(92);

beforeAll(() => {
  // thmtools' declaration is a package's, so it is declared the way a plugin
  // declares it.
  setContributions([
    {
      pluginId: "test",
      commands: {
        declaretheorem: { kind: "theorem" },
        texttt: { kind: "inline", className: "cm-yaz-mono" },
      },
    },
  ]);
});

describe("commands a document defines", () => {
  it("reads a command without arguments as the text it stands for", () => {
    const defined = definitions(
      `${B}newcommand{${B}thesistitle}{Regelprüfung aus Bausteinen}\n` +
        `${B}NewDocumentCommand{${B}uni}{}{Bauhaus-Universität}\n` +
        `${B}def${B}place{Weimar}\n`,
    );
    expect(defined.texts.get("thesistitle")).toBe(
      "Regelprüfung aus Bausteinen",
    );
    expect(defined.texts.get("uni")).toBe("Bauhaus-Universität");
    expect(defined.texts.get("place")).toBe("Weimar");
  });

  it("keeps an empty definition, which prints nothing", () => {
    const defined = definitions(`${B}newcommand{${B}defencedate}{}`);
    expect(defined.texts.get("defencedate")).toBe("");
  });

  it("leaves what LaTeX defines meaning what LaTeX says", () => {
    const defined = definitions(`${B}renewcommand{${B}emph}{changed}`);
    expect(defined.texts.has("emph")).toBe(false);
  });

  it("reads a wrapper as the command it wraps", () => {
    const defined = definitions(
      `${B}NewDocumentCommand{${B}code}{m}{${B}texttt{${B}detokenize{#1}}}\n` +
        `${B}newcommand{${B}term}[1]{#1}\n` +
        `${B}newcommand{${B}hide}[1]{}\n`,
    );
    expect(defined.wrappers.get("code")).toEqual({
      kind: "inline",
      className: "cm-yaz-mono",
    });
    expect(defined.wrappers.get("term")).toEqual({ kind: "plain" });
    expect(defined.wrappers.get("hide")).toEqual({ kind: "dropped" });
  });

  it("does not read a command with an optional argument", () => {
    const defined = definitions(
      `${B}newcommand{${B}note}[2][default]{#1: #2}\n` +
        `${B}NewDocumentCommand{${B}other}{O{x} m}{#2}\n`,
    );
    expect(defined.wrappers.size).toBe(0);
    expect(defined.texts.size).toBe(0);
  });

  it("finds a value kept under a name built from the argument", () => {
    const text =
      `${B}NewDocumentCommand{${B}data}{m}{${B}ifcsname d@#1${B}endcsname` +
      `${B}csname d@#1${B}endcsname${B}fi}\n` +
      `${B}expandafter${B}def${B}csname d@corpus.documents${B}endcsname{1885}\n`;
    const defined = definitions(text);
    const wrapper = defined.wrappers.get("data");
    expect(wrapper).toEqual({ kind: "lookup", before: "d@", after: "" });
    if (wrapper?.kind !== "lookup") throw new Error("not a lookup");
    expect(lookedUp(wrapper, "corpus.documents", defined)).toBe("1885");
    expect(lookedUp(wrapper, "corpus.missing", defined)).toBeNull();
  });

  it("fills one definition into another", () => {
    const defined = definitions(
      `${B}newcommand{${B}open}[1]{[#1]}\n` +
        `${B}newcommand{${B}birthplace}{${B}open{Geburtsort}}\n`,
    );
    expect(expand(`aus ${B}birthplace`, defined)).toBe("aus Geburtsort");
  });

  it("gives up on a definition that refers to itself", () => {
    const defined = definitions(`${B}newcommand{${B}loop}{${B}loop}`);
    expect(expand(`${B}loop`, defined)).toBe(`${B}loop`);
  });

  it("records where the definitions are, so they are not drawn as uses", () => {
    const text = `${B}newcommand{${B}x}{y}`;
    expect(definitions(text).sites).toEqual([{ from: 0, to: text.length }]);
  });
});

describe("environments a document defines", () => {
  it("reads both ways of making one", () => {
    const defined = definitions(
      `${B}newenvironment{remark}{${B}itshape}{}\n` +
        `${B}NewDocumentEnvironment{plan}{+b}{#1}{}\n`,
    );
    expect([...defined.environments]).toEqual(["remark", "plan"]);
  });

  it("reads the kernel's theorem, with what it is numbered within", () => {
    const defined = definitions(
      `${B}newtheorem{lemma}{Lemma}[chapter]\n` +
        `${B}newtheorem{claim}[lemma]{Claim}\n` +
        `${B}newtheorem*{remark}{Remark}\n`,
    );
    expect(defined.theorems.get("lemma")).toEqual({
      title: "Lemma",
      within: "chapter",
      counter: "lemma",
      numbered: true,
    });
    expect(defined.theorems.get("claim")?.counter).toBe("lemma");
    expect(defined.theorems.get("remark")?.numbered).toBe(false);
  });

  it("reads a theorem declared with options", () => {
    const defined = definitions(
      `${B}declaretheorem[style=claim,name=Hypothese,numberwithin=part]{hypothesis}\n` +
        `${B}declaretheorem{corollary}\n`,
    );
    expect(defined.theorems.get("hypothesis")).toEqual({
      title: "Hypothese",
      within: "part",
      counter: "hypothesis",
      numbered: true,
    });
    expect(defined.theorems.get("corollary")?.title).toBe("Corollary");
  });
});

describe("numbering statements", () => {
  function numbered(text: string): (string | null)[] {
    const structure = headings(text);
    return statements(
      text,
      definitions(text),
      structure,
      sectionNumbers(structure),
    ).map((statement) => statement.number);
  }

  const one = `${B}begin{h}${B}end{h}\n`;

  it("counts on its own when it is numbered within nothing", () => {
    expect(numbered(`${B}newtheorem{h}{H}\n${one}${one}`)).toEqual(["1", "2"]);
  });

  it("starts again in each part, with the part's number in front", () => {
    expect(
      numbered(
        `${B}declaretheorem[numberwithin=part]{h}\n` +
          `${B}part{A}\n${one}${one}${B}part{B}\n${one}`,
      ),
    ).toEqual(["I.1", "I.2", "II.1"]);
  });

  it("starts again in each chapter", () => {
    expect(
      numbered(
        `${B}newtheorem{h}{H}[chapter]\n` +
          `${B}chapter{A}\n${one}${B}chapter{B}\n${one}${one}`,
      ),
    ).toEqual(["1.1", "2.1", "2.2"]);
  });

  it("carries the statement's own name", () => {
    const text = `${B}newtheorem{h}{H}\n${B}begin{h}[Wachstum]\nText.\n${B}end{h}`;
    const [statement] = statements(text, definitions(text), [], new Map());
    expect(statement?.note).toBe("Wachstum");
  });
});
