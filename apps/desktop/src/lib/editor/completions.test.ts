/**
 * Completion, in a real editor.
 *
 * `completion.test.ts` checks what is suggested and when. This checks the part
 * that can be wrong even when that is right: that the source is actually
 * mounted, that it draws on the state rather than on anything it fetches, and —
 * the one ADR-0027 exists for — that it does no work while somebody types.
 */

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PACKAGE_COMMANDS,
  PACKAGE_ENVIRONMENTS,
} from "../../../../../plugins/latex-packages/src/vocabulary";
import { completions, latexBuffer, projectFiles } from "./completions";
import { richText } from "./richText";
import { bibliography } from "./semanticView";
import type { BibEntry } from "./semanticView";
import { setContributions } from "./vocabulary";

const B = String.fromCharCode(92);

beforeEach(() => {
  setContributions([
    {
      pluginId: "com.yaz.latex-packages",
      commands: PACKAGE_COMMANDS,
      environments: PACKAGE_ENVIRONMENTS,
    },
  ]);
});

const views: EditorView[] = [];
afterEach(() => {
  setContributions([]);
  while (views.length > 0) views.pop()?.destroy();
});

/** A `.bib` with two works in it. */
const BIB = new Map<string, BibEntry>([
  ["din277", { key: "din277", label: "DIN 277", detail: "Grundflächen" }],
  [
    "spielbauer2020",
    {
      key: "spielbauer2020",
      label: "Spielbauer 2020",
      detail: "BKI Baukosten",
    },
  ],
]);

/** A view over `doc`, with the caret where ‸ was. */
function mount(marked: string, latex = true): EditorView {
  const doc = marked.replace("‸", "");
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        richText(),
        completions(),
        latexBuffer.of(latex),
        bibliography.of(BIB),
        projectFiles.of([
          "images/ablauf.png",
          "chapters/methodik.tex",
          "notes.md",
        ]),
      ],
    }),
    parent: globalThis.document.body,
  });
  views.push(view);
  view.dispatch({
    selection: EditorSelection.cursor(marked.indexOf("‸")),
    scrollIntoView: false,
  });
  return view;
}

describe("completion in a mounted editor", () => {
  it("is wired: a command trigger offers commands", async () => {
    const view = mount(`Ein ${B}sec‸`);
    // Reached through the editor's own machinery rather than by calling the
    // source directly, so this fails if it is not mounted.
    const result = await startAndRead(view);
    expect(result).toContain("section");
  });
});

/** What the list says beside one of its entries. */
async function detailOf(
  view: EditorView,
  label: string,
): Promise<string | undefined> {
  const found = await optionsOf(view);
  return found.find((one) => one.label === label)?.detail;
}

/** Drive the real completion machinery and read what it produced. */
async function startAndRead(view: EditorView): Promise<string[]> {
  const { startCompletion, currentCompletions } =
    await import("@codemirror/autocomplete");
  // Focused first: CodeMirror's completion machinery does nothing for a view
  // that is not, which is right — a list under an unfocused editor would be a
  // list nobody asked for — and is the difference between this working and
  // silently answering nothing.
  view.focus();
  startCompletion(view);
  // The source is synchronous, but the machinery schedules.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return currentCompletions(view.state).map((option) => option.label);
}

/** The same, but the whole option rather than only what it inserts. */
async function optionsOf(view: EditorView) {
  const { startCompletion, currentCompletions } =
    await import("@codemirror/autocomplete");
  view.focus();
  startCompletion(view);
  await new Promise((resolve) => setTimeout(resolve, 50));
  return currentCompletions(view.state);
}

describe("what it offers", () => {
  it("offers the kinds of thing first, then the labels", async () => {
    const kinds = mount(
      [`${B}section{Kosten}${B}label{sec:kosten}`, `Siehe ${B}ref{‸`].join(
        "\n",
      ),
    );
    // Not the labels yet: "which of the forty keys" is a question nobody can
    // answer from a list, and "a section or a figure" is one everybody can.
    const offered = await startAndRead(kinds);
    expect(offered).toContain("sec:");
    expect(offered).not.toContain("sec:kosten");

    const labels = mount(
      [`${B}section{Kosten}${B}label{sec:kosten}`, `Siehe ${B}ref{sec:‸`].join(
        "\n",
      ),
    );
    expect(await startAndRead(labels)).toContain("sec:kosten");
  });

  it("reads a label as its heading, numbered, in document order", async () => {
    // `sec:kosten` is a handle. "2 Kosten" is what tells somebody it is the
    // section they meant.
    const view = mount(
      [
        `${B}section{Einleitung}`,
        `${B}section{Kosten}${B}label{sec:kosten}`,
        `Siehe ${B}ref{sec:‸`,
      ].join("\n"),
    );
    const found = await optionsOf(view);
    const kosten = found.find((one) => one.label === "sec:kosten");
    // The heading is what the row reads as, number first — where LaTeX puts it
    // and where somebody scanning a numbered list looks. The key moves to the
    // quiet column, and is still what gets inserted and matched against.
    expect(kosten?.displayLabel).toBe("2 Kosten");
    expect(kosten?.detail).toBe("sec:kosten");
  });

  it("keeps the labels in the order the document numbers them", async () => {
    // Ten sections, so alphabetical order and numeric order disagree: sorting
    // the text would put "10" before "2".
    const lines: string[] = [];
    for (let n = 1; n <= 10; n += 1) {
      lines.push(`${B}section{Teil ${n}}${B}label{sec:t${n}}`);
    }
    lines.push(`Siehe ${B}ref{sec:‸`);

    const view = mount(lines.join("\n"));
    const found = await optionsOf(view);
    expect(found.map((one) => one.displayLabel)).toEqual([
      "1 Teil 1",
      "2 Teil 2",
      "3 Teil 3",
      "4 Teil 4",
      "5 Teil 5",
      "6 Teil 6",
      "7 Teil 7",
      "8 Teil 8",
      "9 Teil 9",
      "10 Teil 10",
    ]);
  });

  it("expands an acronym rather than repeating it", async () => {
    // `\newacronym{AIA}{AIA}{...}` makes the short form the key, so a list
    // built from the key and the name reads "AIA — AIA". The expansion is the
    // only part of the entry that tells anybody anything.
    const view = mount(
      [
        `${B}newacronym{AIA}{AIA}{Auftraggeber-Informationsanforderungen}`,
        `Die ${B}gls{‸`,
      ].join("\n"),
    );
    expect(await detailOf(view, "AIA")).toBe(
      "Auftraggeber-Informationsanforderungen",
    );
  });

  it("shows a glossary entry's name, with its description behind it", async () => {
    const view = mount(
      [
        `${B}newglossaryentry{BIM}{name={Building Information Modeling},`,
        `  description={Ein Verfahren zur Planung}}`,
        `Das ${B}gls{‸`,
      ].join("\n"),
    );
    const found = await optionsOf(view);
    const bim = found.find((one) => one.label === "BIM");
    expect(bim?.detail).toBe("Building Information Modeling");
    expect(bim?.info).toBe("Ein Verfahren zur Planung");
  });

  it("shows a work rather than its key, and still inserts the key", async () => {
    const view = mount(`Wie in ${B}cite{‸`);
    const found = await optionsOf(view);
    const spielbauer = found.find((one) => one.label === "spielbauer2020");
    // The key is what goes in the document and what typing is matched
    // against. It is not what anybody can read, so it is not what is shown.
    expect(spielbauer?.displayLabel).toBe("Spielbauer 2020");
    expect(spielbauer?.detail).toBe("BKI Baukosten");
  });

  it("offers the citation keys the shell loaded", async () => {
    const view = mount(`Wie in ${B}cite{‸`);
    const found = await startAndRead(view);
    expect(found).toContain("din277");
    expect(found).toContain("spielbauer2020");
  });

  it("offers environments after begin", async () => {
    const view = mount(`${B}begin{tab‸`);
    expect(await startAndRead(view)).toContain("tabular");
  });

  it("offers the project's pictures, without their extension", async () => {
    // `\includegraphics` resolves the extension itself, and a path written
    // without one keeps working if the picture is later replaced by a PDF.
    const view = mount(`${B}includegraphics{‸`);
    const found = await startAndRead(view);
    expect(found).toContain("images/ablauf");
    expect(found).not.toContain("notes.md");
  });

  it("offers the project's tex files, and not its pictures", async () => {
    const view = mount(`${B}input{‸`);
    const found = await startAndRead(view);
    expect(found).toContain("chapters/methodik.tex");
    expect(found).not.toContain("images/ablauf");
  });

  it("offers nothing in a buffer that is not LaTeX", async () => {
    // A file switch keeps the view, so this has to follow the facet rather
    // than whatever the buffer was when the editor was built.
    const view = mount(`Ein ${B}sec‸`, false);
    expect(await startAndRead(view)).toEqual([]);
  });

  it("offers nothing in prose", async () => {
    const view = mount("Ein ganz gewöhnlicher Satz‸");
    expect(await startAndRead(view)).toEqual([]);
  });
});

describe("the keystroke path", () => {
  it("does not read the document when the text changes", () => {
    // ADR-0027's first budget, and the one that will actually bite: the
    // decoration pass already walks the buffer once per keystroke, and a second
    // walk costs more than everything else in it put together. Completion reads
    // on a *trigger*, never on a change.
    const view = mount("Ein Satz.‸");
    const doc = view.state.doc;
    const read = vi.spyOn(doc.constructor.prototype, "toString");

    read.mockClear();
    for (const character of "weiterer Text") {
      view.dispatch({
        changes: {
          from: view.state.selection.main.head,
          insert: character,
        },
        selection: EditorSelection.cursor(view.state.selection.main.head + 1),
      });
    }

    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
  });
});
