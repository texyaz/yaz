/**
 * What the preview draws from a document's own definitions, and from what a
 * package declares about quantities, drawings and quotations.
 *
 * A real CodeMirror view, for the reason `richText.test.ts` gives: the
 * question is what the reader sees, and whether the buffer is still the
 * `.tex` (ADR-0004).
 */

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  richText,
  setRichText,
  setShowComments,
  setShowMachinery,
} from "./richText";
import {
  PACKAGE_COMMANDS,
  PACKAGE_ENVIRONMENTS,
} from "../../../../../plugins/latex-packages/src/vocabulary";
import { setContributions } from "./vocabulary";

const B = String.fromCharCode(92);

beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
  setContributions([
    {
      pluginId: "latex-packages",
      commands: PACKAGE_COMMANDS,
      environments: PACKAGE_ENVIRONMENTS,
    },
  ]);
});

const views: EditorView[] = [];

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
});

/** A view over a document with this preamble and this body, preview on. */
function mount(preamble: string, body: string): EditorView {
  // A paragraph first: the caret starts at the top of the text, and whatever
  // it touches shows its source, which is not what these ask about.
  const doc =
    `${B}documentclass{book}\n${preamble}\n${B}begin{document}\n` +
    `Anfang.\n\n${body}\n${B}end{document}\n`;
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [richText()] }),
    parent: document.body,
  });
  views.push(view);
  view.dispatch({ effects: setRichText.of(true) });
  return view;
}

function visible(view: EditorView): string {
  return view.contentDOM.textContent ?? "";
}

describe("the document's own commands", () => {
  it("draws a command as the text it was defined to be", () => {
    const view = mount(
      `${B}newcommand{${B}thesisauthor}{Friedrich Schrödter}`,
      `vorgelegt von ${B}thesisauthor${B}par`,
    );
    expect(visible(view)).toContain("vorgelegt von Friedrich Schrödter");
    expect(visible(view)).not.toContain("thesisauthor");
  });

  it("draws an empty one as nothing", () => {
    const view = mount(
      `${B}newcommand{${B}defencedate}{}`,
      `Tag der Disputation: ${B}defencedate`,
    );
    expect(visible(view)).toContain("Tag der Disputation: ");
    expect(visible(view)).not.toContain("defencedate");
  });

  it("brings the command back when the caret is on it", () => {
    const view = mount(`${B}newcommand{${B}who}{Ada}`, `von ${B}who hier`);
    const at = view.state.doc.toString().lastIndexOf(`${B}who`);
    view.dispatch({ selection: EditorSelection.cursor(at + 2) });
    expect(visible(view)).toContain(`${B}who`);
  });

  it("styles a wrapper's argument as what it wraps", () => {
    const view = mount(
      `${B}NewDocumentCommand{${B}code}{m}{${B}texttt{#1}}`,
      `etwa ${B}code{IfcWall}, und`,
    );
    expect(visible(view)).toContain("etwa IfcWall, und");
    expect(view.contentDOM.querySelector(".cm-yaz-mono")?.textContent).toBe(
      "IfcWall",
    );
  });

  it("draws a number kept by a script as the number", () => {
    const view = mount(
      `${B}NewDocumentCommand{${B}data}{m}{${B}csname d@#1${B}endcsname}\n` +
        `${B}expandafter${B}def${B}csname d@n${B}endcsname{${B}num{1885}}`,
      `dokumentiert ${B}data{n} Vorlagen, ${B}data{missing} nicht`,
    );
    expect(visible(view)).toContain("dokumentiert 1885 Vorlagen");
    // No value under that name: left as written, which is how it says so.
    expect(visible(view)).toContain(`${B}data{missing}`);
  });

  it("fills them into a table, which is drawn from its source", () => {
    const view = mount(
      `${B}newcommand{${B}supervisor}{Prof. Melzner}`,
      `${B}begin{tabular}{ll}\nBetreuer: & ${B}supervisor ${B}${B}\n${B}end{tabular}`,
    );
    expect(visible(view)).toContain("Prof. Melzner");
  });

  it("leaves the buffer exactly as it was", () => {
    const view = mount(`${B}newcommand{${B}who}{Ada}`, `von ${B}who`);
    expect(view.state.doc.toString()).toContain(`von ${B}who`);
  });
});

describe("the document's own environments", () => {
  it("sets one apart under its name, with the markup gone", () => {
    const view = mount(
      `${B}NewDocumentEnvironment{plan}{+b}{#1}{}`,
      `Davor.\n\n${B}begin{plan}\nWas das Kapitel enthalten wird.\n${B}end{plan}\n\nDanach.`,
    );
    const seen = visible(view);
    expect(seen).not.toContain(`${B}begin{plan}`);
    expect(seen).not.toContain(`${B}end{plan}`);
    expect(seen).toContain("Was das Kapitel enthalten wird.");
    expect(view.contentDOM.querySelector(".cm-yaz-own-name")?.textContent).toBe(
      "plan",
    );
    expect(view.contentDOM.querySelectorAll(".cm-yaz-own").length).toBe(2);
  });

  it("heads a statement with its title, number and name", () => {
    const view = mount(
      `${B}declaretheorem[name=Hypothese,numberwithin=part]{hypothesis}`,
      `${B}part{Korpus}\n${B}part{Sprache}\n` +
        `${B}begin{hypothesis}[Wachstum]\n${B}label{hyp:growth}\n` +
        `Das Normenwerk ist gewachsen.\n${B}end{hypothesis}\n\n` +
        `Siehe ${B}cref{hyp:growth} und ${B}ref{hyp:growth}.`,
    );
    const seen = visible(view);
    expect(seen).toContain("Hypothese II.1 (Wachstum).");
    expect(seen).not.toContain("begin{hypothesis}");
    expect(seen).not.toContain("end{hypothesis}");
    // A reference to it says what the document calls it, and its number.
    expect(seen).toContain("Siehe Hypothese II.1 und II.1.");
  });

  it("hides the declaration itself, wherever it is written", () => {
    const view = mount("", `${B}newtheorem{lemma}{Lemma}[chapter]\nText.`);
    expect(visible(view)).not.toContain("newtheorem");
    expect(visible(view)).not.toContain("[chapter]");
  });
});

describe("conditionals", () => {
  const body =
    `Weimar\n${B}if${B}relax${B}detokenize${B}expandafter{${B}date}${B}relax${B}else\n` +
    `Tag der Disputation\n${B}fi\nEnde`;

  it("hides a line that is nothing but the test, and keeps both branches", () => {
    const seen = visible(mount(`${B}newcommand{${B}date}{}`, body));
    expect(seen).not.toContain(`${B}if`);
    expect(seen).not.toContain(`${B}else`);
    expect(seen).not.toContain(`${B}fi`);
    expect(seen).toContain("Tag der Disputation");
  });

  it("keeps a line that has words on it", () => {
    const seen = visible(mount("", `${B}ifdraft Entwurf${B}fi`));
    expect(seen).toContain("Entwurf");
  });

  it("shows them with the rest of the machinery", () => {
    const view = mount(`${B}newcommand{${B}date}{}`, body);
    view.dispatch({ effects: setShowMachinery.of(true) });
    expect(visible(view)).toContain(`${B}fi`);
  });
});

describe("what the packages declare", () => {
  it("draws a quantity as the figure and its unit", () => {
    const seen = visible(
      mount(
        "",
        `ein Zuwachs von ${B}qty{19}{${B}percent}, ${B}qty{90}{${B}centi${B}metre} breit, ` +
          `für ${B}qtyrange{37}{75}{${B}percent} und ${B}num{943} Regeln`,
      ),
    );
    expect(seen).toContain("ein Zuwachs von 19 %");
    expect(seen).toContain("90 cm breit");
    expect(seen).toContain("für 37–75 % und 943 Regeln");
  });

  it("quotes the passage of a foreign quotation, not its language", () => {
    const seen = visible(
      mount(
        `${B}usepackage[ngerman]{babel}`,
        `im Englischen mit ${B}foreignquote{english}{shall}.`,
      ),
    );
    expect(seen).not.toContain("english");
    expect(seen).toMatch(/mit .shall.\./);
  });

  it("stands a card where the compiler will draw a picture", () => {
    const view = mount(
      "",
      `${B}begin{figure}\n  ${B}centering\n  ${B}begin{tikzpicture}\n` +
        `  ${B}draw (0,0) -- (1,1);\n  ${B}end{tikzpicture}\n` +
        `  ${B}caption{Dokumente nach Herausgeber.}\n${B}end{figure}`,
    );
    const seen = visible(view);
    expect(seen).not.toContain("tikzpicture");
    expect(seen).not.toContain(`${B}draw`);
    expect(seen).not.toContain("begin{figure}");
    expect(seen).toContain("Dokumente nach Herausgeber.");
    expect(seen).not.toContain(`${B}caption`);
  });

  it("hides a float's opening when a hidden comment follows it", () => {
    // What a joined document puts there: the first line of an `\\input` file.
    const view = mount(
      "",
      `${B}begin{figure}\n  ${B}centering\n  % Generated. Do not edit.\n` +
        `${B}begin{tikzpicture}\n${B}end{tikzpicture}\n` +
        `  ${B}caption{Titel.}\n${B}end{figure}`,
    );
    view.dispatch({ effects: setShowComments.of(false) });
    expect(visible(view)).not.toContain("begin{figure}");
  });

  it("stands a card for the list of theorems and the sorted glossary", () => {
    const view = mount(
      "",
      `${B}listoftheorems[ignoreall,show={hypothesis}]\n` +
        `${B}printnoidxglossary[type=${B}acronymtype,title={Abkürzungen}]\nText.`,
    );
    expect(visible(view)).not.toContain("listoftheorems");
    expect(visible(view)).not.toContain("printnoidxglossary");
    expect(view.contentDOM.querySelectorAll(".cm-yaz-listing").length).toBe(2);
  });
});

describe("a size set in a float", () => {
  it("is hidden and applies to the rest of the float", () => {
    const view = mount(
      "",
      `${B}begin{table}\n  ${B}caption{Zahlen.}\n  ${B}small\n` +
        `  ${B}begin{tabular}{ll}\n  a & b ${B}${B}\n  ${B}end{tabular}\n${B}end{table}`,
    );
    expect(visible(view)).not.toContain(`${B}small`);
  });
});
