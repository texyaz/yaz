/**
 * Paragraphs flow in the preview whatever line the source breaks them on.
 *
 * A real CodeMirror view, for the reason `richText.test.ts` gives.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { richText, setRichText, setShowLineBreaks } from "./richText";
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
  // `\\enquote` is csquotes', which the packages plugin describes.
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

function mount(body: string): EditorView {
  const doc =
    `${B}documentclass{book}\n${B}begin{document}\n` +
    `Anfang.\n\n${body}\n${B}end{document}\n`;
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [richText()] }),
    parent: document.body,
  });
  views.push(view);
  view.dispatch({ effects: setRichText.of(true) });
  return view;
}

/** What is drawn, one drawn line to a line. */
function lines(view: EditorView): string {
  return [...view.contentDOM.querySelectorAll(".cm-line")]
    .map((line) => line.textContent ?? "")
    .join("\n");
}

describe("a paragraph written one sentence to a line", () => {
  it("is drawn as one paragraph", () => {
    const view = mount("Erster Satz.\nZweiter Satz.\nDritter Satz.");
    expect(lines(view)).toContain("Erster Satz. Zweiter Satz. Dritter Satz.");
  });

  it("leaves the source as it was", () => {
    const view = mount("Erster Satz.\nZweiter Satz.");
    expect(view.state.doc.toString()).toContain("Erster Satz.\nZweiter Satz.");
  });

  it("keeps an empty line as the end of the paragraph", () => {
    const view = mount("Erster Satz.\nZweiter Satz.\n\nNeuer Absatz.");
    expect(lines(view)).toContain(
      "Erster Satz. Zweiter Satz.\n\nNeuer Absatz.",
    );
  });

  it("does not leave a gap for an indented continuation", () => {
    const view = mount("Erster Satz.  \n    Zweiter Satz.");
    expect(lines(view)).toContain("Erster Satz. Zweiter Satz.");
  });

  it("stays joined while the caret is in it", () => {
    const view = mount("Erster Satz.\nZweiter Satz.");
    const at = view.state.doc.toString().indexOf("Zweiter");
    view.dispatch({ selection: { anchor: at + 2 } });
    expect(lines(view)).toContain("Erster Satz. Zweiter Satz.");
  });

  it("is shown as written when line breaks are asked for", () => {
    const view = mount("Erster Satz.\nZweiter Satz.");
    view.dispatch({ effects: setShowLineBreaks.of(true) });
    expect(lines(view)).toContain("Erster Satz.\nZweiter Satz.");
  });
});

describe("what is not prose keeps its lines", () => {
  it("does not pull a heading into the paragraph", () => {
    const view = mount(`Davor.\n${B}section{Titel}\nDanach.\nWeiter.`);
    const drawn = lines(view);
    expect(drawn).toContain("Davor.\n");
    expect(drawn).toContain("\nDanach. Weiter.");
  });

  it("starts each list item on its own line", () => {
    const view = mount(
      `${B}begin{itemize}\n${B}item Eins\nnoch eins\n${B}item Zwei\n${B}end{itemize}`,
    );
    const drawn = lines(view);
    expect(drawn).toContain("Eins noch eins\n");
    expect(drawn).not.toContain("noch eins Zwei");
  });

  it("stops at an explicit break", () => {
    const view = mount(`Zeile eins${B}${B}\nZeile zwei`);
    expect(view.contentDOM.querySelectorAll(".cm-yaz-join").length).toBe(0);
  });

  it("leaves verbatim text alone", () => {
    const view = mount(
      `${B}begin{verbatim}\nerste zeile\nzweite zeile\n${B}end{verbatim}`,
    );
    expect(view.contentDOM.querySelectorAll(".cm-yaz-join").length).toBe(0);
  });

  it("leaves the preamble alone", () => {
    const doc = `% eins\nzwei\ndrei\n${B}begin{document}\nText.\n${B}end{document}\n`;
    const view = new EditorView({
      state: EditorState.create({ doc, extensions: [richText()] }),
      parent: document.body,
    });
    views.push(view);
    view.dispatch({
      effects: setRichText.of(true),
      selection: { anchor: doc.length },
    });
    expect(view.contentDOM.querySelectorAll(".cm-yaz-join").length).toBe(0);
  });
});

describe("selecting is not editing", () => {
  it("does not bring the source back under a selection", () => {
    const view = mount(`Ein ${B}emph{wichtiger} Satz.\nNoch einer.`);
    const text = view.state.doc.toString();
    view.dispatch({
      selection: {
        anchor: text.indexOf("Ein"),
        head: text.indexOf("Noch") + 4,
      },
    });
    expect(lines(view)).toContain("Ein wichtiger Satz. Noch einer.");
  });

  it("still brings it back for a caret", () => {
    const view = mount(`Ein ${B}emph{wichtiger} Satz.`);
    const at = view.state.doc.toString().indexOf("wichtiger") + 2;
    view.dispatch({ selection: { anchor: at } });
    expect(lines(view)).toContain(`${B}emph{wichtiger}`);
  });
});

describe("a quotation mark stays with its word", () => {
  it("ties the opening mark to the first word and the closing to the last", () => {
    const view = mount(`Er sagt ${B}enquote{Bauen wird teurer} dazu.`);
    const kept = [...view.contentDOM.querySelectorAll(".cm-yaz-keep")].map(
      (node) => node.textContent,
    );
    expect(kept).toEqual(["“Bauen", "teurer”"]);
  });

  it("ties both marks to a single word", () => {
    const view = mount(`Das Wort ${B}enquote{Normenflut} fällt.`);
    const kept = [...view.contentDOM.querySelectorAll(".cm-yaz-keep")]
      .map((node) => node.textContent)
      .join("");
    expect(kept).toBe("“Normenflut”");
  });
});
