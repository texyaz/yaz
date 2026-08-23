/**
 * Editing a table through the preview, end to end.
 *
 * `tableEdit.test.ts` checks the LaTeX these produce. This checks the part
 * that can be wrong even when that is right: that pressing a control puts the
 * new LaTeX **into the document, in the right place**, and that the buffer
 * afterwards is still the `.tex` a compiler would accept.
 */

import { EditorSelection, EditorState } from "@codemirror/state";
import { history, historyKeymap, undo } from "@codemirror/commands";
import { EditorView, keymap } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  PACKAGE_COMMANDS,
  PACKAGE_ENVIRONMENTS,
} from "../../../../../plugins/latex-packages/src/vocabulary";
import { t } from "../i18n";
import { inlineHtml } from "./inline";
import { richText, setLockTables, setRichText } from "./richText";
import {
  cellAt,
  cellSource,
  cellSpan,
  plainCell,
  nextCell,
} from "./tableWidget";
import { setContributions } from "./vocabulary";

const B = String.fromCharCode(92);
const BREAK = `${B}${B}`;

/** A line break, named so it can sit inside a template literal. */
const NEWLINE = String.fromCharCode(10);

beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

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

/** A document with a table in it, drawn. */
const DOC = [
  "Before.",
  `${B}begin{tabular}{|l|c|}`,
  `${B}hline`,
  `Name & Menge ${BREAK}`,
  `Schraube & 20 ${BREAK}`,
  `${B}hline`,
  `${B}end{tabular}`,
  "After.",
].join("\n");

function mount(doc = DOC): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [richText()] }),
    parent: globalThis.document.body,
  });
  views.push(view);
  view.dispatch({ effects: setRichText.of(true) });
  // Out of the table: the caret inside it reveals the source, which is the
  // right behaviour and the wrong place to be standing for these.
  view.dispatch({
    selection: EditorSelection.cursor(0),
    scrollIntoView: false,
  });
  return view;
}

/** Press the nth control of a rail. */
/**
 * Press the marker on a boundary.
 *
 * Boundaries are counted from the near edge: 0 is before the first column or
 * row, and the last is after the last one.
 */
function addAt(view: EditorView, rail: string, boundary: number): void {
  const markers = view.contentDOM.querySelectorAll(
    `.cm-yaz-table-rail-${rail} .cm-yaz-table-marker`,
  );
  const button = markers[boundary];
  expect(button, `no marker at boundary ${boundary} on ${rail}`).toBeTruthy();
  (button as HTMLButtonElement).click();
}

/** Press an entry of the corner menu, by the message key of its label. */
function menu(view: EditorView, labelKey: string): void {
  const opener = view.contentDOM.querySelector(
    ".cm-yaz-table-corner .cm-yaz-table-control",
  );
  expect(opener, "no corner menu").toBeTruthy();
  (opener as HTMLButtonElement).click();

  const items = [
    ...view.contentDOM.querySelectorAll(".cm-yaz-table-menu-item"),
  ];
  const wanted = items.find((item) => item.textContent === t(labelKey));
  expect(wanted, `no menu entry for ${labelKey}`).toBeTruthy();
  (wanted as HTMLButtonElement).click();
}

describe("the controls on a drawn table", () => {
  it("puts a marker on every boundary, including the outer edges", () => {
    // The Word rule: the control that adds a column sits on the *line between*
    // two of them, so "which side?" is not a question anybody has to answer.
    // Two columns means three boundaries; two rows means three.
    const view = mount();
    expect(
      view.contentDOM.querySelectorAll(
        ".cm-yaz-table-rail-columns .cm-yaz-table-marker",
      ),
    ).toHaveLength(3);
    expect(
      view.contentDOM.querySelectorAll(
        ".cm-yaz-table-rail-rows .cm-yaz-table-marker",
      ),
    ).toHaveLength(3);
  });

  it("offers a drag handle only where there is something on both sides", () => {
    // Dragging the outer edge of a table is a different gesture and one this
    // does not do, so offering a handle there would be a control that lies.
    const view = mount();
    expect(
      view.contentDOM.querySelectorAll(
        ".cm-yaz-table-rail-columns .cm-yaz-table-handle",
      ),
    ).toHaveLength(1);
    expect(
      view.contentDOM.querySelectorAll(".cm-yaz-table-handle-row"),
    ).toHaveLength(1);
  });

  it("adds a column where the boundary is, not just to the picture", () => {
    const view = mount();
    // The middle boundary: between the two columns.
    addAt(view, "columns", 1);

    const text = view.state.doc.toString();
    expect(text).toContain(`${B}begin{tabular}{|l|l|c|}`);
    // Every row gained a cell, which is the part that is tedious by hand.
    expect(text).toContain(`Name & & Menge ${BREAK}`);
    expect(text).toContain(`Schraube & & 20 ${BREAK}`);
    // And nothing outside the table moved.
    expect(text.startsWith("Before.")).toBe(true);
    expect(text.trimEnd().endsWith("After.")).toBe(true);
  });

  it("adds a column before the first one from the near edge", () => {
    const view = mount();
    addAt(view, "columns", 0);
    const row = view.state.doc
      .toString()
      .split(NEWLINE)
      .find((line) => line.includes("Name"));
    // A blank cell in front of it, however the table pads its cells.
    expect(row?.trimStart().startsWith("&")).toBe(true);
    expect(row).toContain("Name");
  });

  it("adds a row where the boundary is", () => {
    const view = mount();
    addAt(view, "rows", 0);

    const text = view.state.doc.toString();
    // From the specification rather than from the first rule: a row added at
    // the top goes *above* the rule that belonged to the row below it.
    const body = text.slice(
      text.indexOf("}", text.indexOf("tabular")) + 1,
      text.indexOf(`${B}end{tabular}`),
    );
    // Three rows now, so three row terminators inside the table.
    expect(body.split(BREAK)).toHaveLength(4);
  });

  it("removes a column from the specification and from every row", () => {
    const view = mount();
    menu(view, "table-column-remove");

    const text = view.state.doc.toString();
    expect(text).toContain(`${B}begin{tabular}{|c|}`);
    expect(text).toContain(`Menge ${BREAK}`);
    expect(text).not.toContain("Name &");
  });

  it("removes a row", () => {
    const view = mount();
    menu(view, "table-row-remove");

    const text = view.state.doc.toString();
    expect(text).not.toContain("Name &");
    expect(text).toContain("Schraube");
  });

  it("takes the whole table out, and nothing around it", () => {
    const view = mount();
    menu(view, "table-remove");

    const text = view.state.doc.toString();
    expect(text).not.toContain("tabular");
    expect(text).toContain("Before.");
    expect(text).toContain("After.");
  });

  it("is one step to undo", () => {
    // Two ranges change — the specification and the body — and an author who
    // pressed one button expects one press of undo to answer it. That only
    // holds because both go in a single transaction.
    const view = new EditorView({
      state: EditorState.create({
        doc: DOC,
        extensions: [richText(), history(), keymap.of(historyKeymap)],
      }),
      parent: globalThis.document.body,
    });
    views.push(view);
    view.dispatch({ effects: setRichText.of(true) });
    view.dispatch({ selection: EditorSelection.cursor(0) });

    addAt(view, "columns", 1);
    expect(view.state.doc.toString()).not.toBe(DOC);

    undo(view);
    expect(view.state.doc.toString()).toBe(DOC);
  });

  it("leaves the document compiling after several changes", () => {
    const view = mount();
    addAt(view, "columns", 1);
    addAt(view, "rows", 0);
    addAt(view, "columns", 3);

    const text = view.state.doc.toString();
    const spec = /\\begin\{tabular\}\{([^}]*)\}/.exec(text)?.[1] ?? "";
    const columns = spec.replace(/[^lcrp]/g, "").length;
    const body = text.slice(
      text.indexOf("}", text.indexOf("tabular")) + 1,
      text.indexOf(`${B}end{tabular}`),
    );
    for (const row of body.split(BREAK)) {
      if (row.replace(/\\hline|\s/g, "") === "") continue;
      // Every row has one fewer `&` than there are columns, which is what a
      // tabular that compiles looks like.
      expect(row.split("&")).toHaveLength(columns);
    }
  });
});

describe("moving from cell to cell", () => {
  const body = ` a & b ${BREAK} c & d ${BREAK} `;
  const from = 0;
  const to = body.length;

  it("goes to the next cell", () => {
    // Landing on the word, not on the space in front of it.
    expect(nextCell(body, from, to, 0, false)).toBe(body.indexOf("a"));
    const atA = body.indexOf("a");
    expect(nextCell(body, from, to, atA, false)).toBe(body.indexOf("b"));
    expect(nextCell(body, from, to, body.indexOf("b"), false)).toBe(
      body.indexOf("c"),
    );
  });

  it("goes back", () => {
    expect(nextCell(body, from, to, body.indexOf("c"), true)).toBe(
      body.indexOf("b"),
    );
    expect(nextCell(body, from, to, body.indexOf("a"), true)).toBe(null);
  });

  it("stops at the end rather than wrapping", () => {
    // Wrapping would take a caret from the last cell back to the first, which
    // no word processor does and which loses the author's place.
    expect(nextCell(body, from, to, body.indexOf("d"), false)).toBe(null);
  });

  it("does not treat an escaped ampersand as a boundary", () => {
    const escaped = ` Tom ${B}& Jerry & 2 ${BREAK} `;
    expect(
      nextCell(escaped, 0, escaped.length, escaped.indexOf("Tom"), false),
    ).toBe(escaped.indexOf("2"));
  });
});

/**
 * Keeping a table drawn while the caret is in it.
 *
 * Everywhere else in the view, the caret reveals a construct's source: editing
 * what you cannot read is worse than reading markup. A table is the case where
 * that rule works against itself — what you clicked into *is* the table — so
 * this is opt-in, and off leaves the old behaviour exactly as it was.
 */
describe("locking a table drawn", () => {
  /** A view with the caret inside the table's first cell. */
  function inTheTable(locked: boolean): EditorView {
    const view = new EditorView({
      state: EditorState.create({ doc: DOC, extensions: [richText()] }),
      parent: globalThis.document.body,
    });
    views.push(view);
    view.dispatch({ effects: setRichText.of(true) });
    if (locked) view.dispatch({ effects: setLockTables.of(true) });
    view.dispatch({
      selection: EditorSelection.cursor(DOC.indexOf("Name")),
      scrollIntoView: false,
    });
    return view;
  }

  it("shows the source when it is off, as everything else does", () => {
    const view = inTheTable(false);
    expect(view.contentDOM.querySelector("table")).toBeNull();
    expect(view.contentDOM.textContent).toContain("tabular");
  });

  it("keeps the table when it is on", () => {
    const view = inTheTable(true);
    expect(view.contentDOM.querySelector("table")).not.toBeNull();
    expect(view.contentDOM.textContent).not.toContain(`${B}begin{tabular}`);
  });

  it("marks the cell the caret is in", () => {
    // A caret inside a widget is not drawn by the browser, so without this an
    // author editing a locked table has no way of telling where they are.
    const view = inTheTable(true);
    const active = view.contentDOM.querySelector(".cm-yaz-cell-active");
    expect(active).not.toBeNull();
    expect(active?.textContent).toContain("Name");
  });

  it("moves the mark with the caret", () => {
    const view = inTheTable(true);
    view.dispatch({
      selection: EditorSelection.cursor(DOC.indexOf("Menge")),
      scrollIntoView: false,
    });
    expect(
      view.contentDOM.querySelector(".cm-yaz-cell-active")?.textContent,
    ).toContain("Menge");
  });

  it("marks nothing when the caret is outside", () => {
    const view = inTheTable(true);
    view.dispatch({
      selection: EditorSelection.cursor(0),
      scrollIntoView: false,
    });
    expect(view.contentDOM.querySelector(".cm-yaz-cell-active")).toBeNull();
  });
});

describe("finding the cell an offset is in", () => {
  const body = ` a & b ${BREAK} c & d ${BREAK} `;

  it("counts rows and columns from the start of the body", () => {
    expect(cellAt(body, 0, body.length, body.indexOf("a"))).toEqual({
      row: 0,
      column: 0,
    });
    expect(cellAt(body, 0, body.length, body.indexOf("b"))).toEqual({
      row: 0,
      column: 1,
    });
    expect(cellAt(body, 0, body.length, body.indexOf("d"))).toEqual({
      row: 1,
      column: 1,
    });
  });

  it("does not count an escaped ampersand as a column", () => {
    // A highlight on the wrong cell is worse than none: it says confidently
    // where the caret is not.
    const escaped = ` Tom ${B}& Jerry & 2 ${BREAK} `;
    expect(
      cellAt(escaped, 0, escaped.length, escaped.indexOf("Jerry")),
    ).toEqual({ row: 0, column: 0 });
  });

  it("says nothing for an offset outside the body", () => {
    expect(cellAt(body, 2, 6, 0)).toBeNull();
  });
});

describe("finding where a cell begins and ends", () => {
  const body = ` a & b ${BREAK} c & d ${BREAK} `;

  it("gives the text of the cell, without its padding", () => {
    // The padding matters: a caret landing in front of the word, or a
    // double-click selecting the spaces around it, is what makes a table feel
    // like something other than a document.
    const span = cellSpan(body, 0, body.length, 0, 0);
    expect(body.slice(span?.from, span?.to)).toBe("a");
  });

  it("finds every cell of every row", () => {
    const found = [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ].map(([row, column]) => {
      const span = cellSpan(body, 0, body.length, row!, column!);
      return body.slice(span?.from, span?.to);
    });
    expect(found).toEqual(["a", "b", "c", "d"]);
  });

  it("is the inverse of finding which cell an offset is in", () => {
    for (const row of [0, 1]) {
      for (const column of [0, 1]) {
        const span = cellSpan(body, 0, body.length, row, column);
        expect(cellAt(body, 0, body.length, span!.from)).toEqual({
          row,
          column,
        });
      }
    }
  });

  it("does not treat an escaped ampersand as a boundary", () => {
    // An escaped ampersand is an ampersand in a cell, not the end of one.
    // Splitting on it would put the caret in the wrong cell, confidently.
    const escaped = ` Fisch ${B}& Chips & zwei ${BREAK} `;
    const span = cellSpan(escaped, 0, escaped.length, 0, 0);
    expect(escaped.slice(span?.from, span?.to)).toBe(`Fisch ${B}& Chips`);
  });

  it("answers null for a cell the table does not have", () => {
    expect(cellSpan(body, 0, body.length, 5, 0)).toBeNull();
  });
});

describe("typing in a table kept drawn", () => {
  /**
   * A view with the table drawn and its cells wired.
   *
   * The wiring waits for CodeMirror to place the widget — it has to ask where
   * the table is, and nothing can answer that for an element that is not in
   * the document yet — so the tests wait with it.
   */
  async function drawn(): Promise<EditorView> {
    const view = new EditorView({
      state: EditorState.create({ doc: DOC, extensions: [richText()] }),
      parent: globalThis.document.body,
    });
    views.push(view);
    view.dispatch({ effects: setRichText.of(true) });
    view.dispatch({ effects: setLockTables.of(true) });
    await Promise.resolve();
    return view;
  }

  /** The rendered cell at a row and column, counting across the whole table. */
  function cellElement(
    view: EditorView,
    row: number,
    column: number,
  ): HTMLElement | undefined {
    const rows = [...view.contentDOM.querySelectorAll("table tr")];
    return rows[row]?.children[column] as HTMLElement | undefined;
  }

  it("makes a plain cell something you can type in", async () => {
    // The whole tabular is one replaced range, so a caret placed in the
    // document behind it cannot be drawn — CodeMirror moves the selection to
    // the edge, and what was typed landed under the table. The cell has to be
    // the editable thing.
    const view = await drawn();
    expect(cellElement(view, 0, 0)?.getAttribute("contenteditable")).toBe(
      "true",
    );
  });

  it("writes what was typed into the buffer when the cell is left", async () => {
    const view = await drawn();
    const cell = cellElement(view, 1, 0);
    expect(cell).toBeDefined();
    const before = view.state.doc.toString();

    cell!.textContent = "Geändert";
    cell!.dispatchEvent(new FocusEvent("blur", { bubbles: false }));

    expect(view.state.doc.toString()).not.toBe(before);
    expect(view.state.doc.toString()).toContain("Geändert");
  });

  it("leaves the buffer alone when nothing was changed", async () => {
    // A blur per click would otherwise be an undo step per click.
    const view = await drawn();
    const before = view.state.doc.toString();
    const cell = cellElement(view, 1, 0);
    cell!.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
    expect(view.state.doc.toString()).toBe(before);
  });

  it("lets a cell with formatting in it be edited", async () => {
    // A bold run is exactly what the bold button in a cell produces, so
    // refusing to edit it afterwards would make the button a one-way door.
    const marked = DOC.replace("Name", `${B}textbf{Name}`);
    const view = new EditorView({
      state: EditorState.create({ doc: marked, extensions: [richText()] }),
      parent: globalThis.document.body,
    });
    views.push(view);
    view.dispatch({ effects: setRichText.of(true) });
    view.dispatch({ effects: setLockTables.of(true) });
    await Promise.resolve();

    const cells = [...view.contentDOM.querySelectorAll("td, th")];
    const bold = cells.find((cell) => cell.querySelector("strong, b"));
    expect(bold).toBeDefined();
    expect((bold as HTMLElement).getAttribute("contenteditable")).toBe("true");
  });

  it("refuses a cell holding something it cannot write back", async () => {
    // A citation draws as `[1]` and mathematics as a rendered formula. Neither
    // can be read back off the element, and committing what the element says
    // would delete the command.
    const marked = DOC.replace("Name", `${B}cite{din277}`);
    const view = new EditorView({
      state: EditorState.create({ doc: marked, extensions: [richText()] }),
      parent: globalThis.document.body,
    });
    views.push(view);
    view.dispatch({ effects: setRichText.of(true) });
    view.dispatch({ effects: setLockTables.of(true) });
    await Promise.resolve();

    const rows = [...view.contentDOM.querySelectorAll("table tr")];
    const cell = rows[0]?.children[0] as HTMLElement | undefined;
    expect(cell).toBeDefined();
    expect(cell?.hasAttribute("contenteditable")).toBe(false);
  });

  it("moves to the next cell on Tab", async () => {
    const view = await drawn();
    const first = cellElement(view, 0, 0);
    first!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    // Nothing changed, so the widget was not rebuilt and the element that has
    // focus is the one beside it.
    expect(globalThis.document.activeElement).toBe(cellElement(view, 0, 1));
  });

  it("adds a row when Tab runs out of cells", async () => {
    // Filling a table in should not mean reaching for a button every few
    // seconds, which is what the rails alone amounted to.
    const view = await drawn();
    const rowsBefore = view.contentDOM.querySelectorAll("table tr").length;

    const last = [...view.contentDOM.querySelectorAll("table tr")].at(-1)!;
    const cell = last.children[last.children.length - 1] as HTMLElement;
    cell.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );

    const rowsAfter = view.contentDOM.querySelectorAll("table tr").length;
    expect(rowsAfter).toBe(rowsBefore + 1);
  });

  it("keeps the table drawn while it is being typed in", async () => {
    const view = await drawn();
    const cell = cellElement(view, 1, 0);
    cell!.textContent = "Anders";
    cell!.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
    expect(view.contentDOM.querySelector("table")).not.toBeNull();
    expect(view.contentDOM.textContent).not.toContain(`${B}begin{tabular}`);
  });
});

describe("deciding whether a cell can be edited where it is drawn", () => {
  it("takes plain words", () => {
    expect(plainCell("Kosten")).toBe(true);
    expect(plainCell("2020 in Euro")).toBe(true);
  });

  it("takes the formatting a cell can be given", () => {
    // These round-trip: rendering them and reading the element back gives the
    // source again, which is the only safe test there is.
    expect(plainCell(`${B}textbf{Kosten}`)).toBe(true);
    expect(plainCell(`${B}textit{Kosten}`)).toBe(true);
    expect(plainCell(`${B}underline{Kosten}`)).toBe(true);
  });

  it("refuses anything it could not write back", () => {
    // Each of these draws as something the element cannot be read back into,
    // so committing the cell would delete the command.
    expect(plainCell(`${B}cite{din277}`)).toBe(false);
    expect(plainCell("$x^2$")).toBe(false);
    expect(plainCell(`${B}gls{bim}`)).toBe(false);
  });
});

describe("reading a drawn cell back as LaTeX", () => {
  /** Render a cell's source the way the widget does, then read it back. */
  function roundTrip(source: string): string | null {
    const cell = globalThis.document.createElement("td");
    cell.innerHTML = inlineHtml(source);
    return cellSource(cell);
  }

  it("gives plain words back unchanged", () => {
    expect(roundTrip("Kosten je Quadratmeter")).toBe("Kosten je Quadratmeter");
  });

  it("gives the command back, not the words inside it", () => {
    // This is the whole reason the commit goes through a serialiser: reading
    // the element as text would write `Kosten` over `\textbf{Kosten}` and
    // silently delete the formatting.
    expect(roundTrip(`${B}textbf{Kosten}`)).toBe(`${B}textbf{Kosten}`);
    expect(roundTrip(`${B}textit{Kosten}`)).toBe(`${B}textit{Kosten}`);
    expect(roundTrip(`${B}underline{Kosten}`)).toBe(`${B}underline{Kosten}`);
    expect(roundTrip(`${B}texttt{Kosten}`)).toBe(`${B}texttt{Kosten}`);
    expect(roundTrip(`${B}textsc{Kosten}`)).toBe(`${B}textsc{Kosten}`);
  });

  it("keeps the words around a command", () => {
    expect(roundTrip(`Sehr ${B}textbf{hohe} Kosten`)).toBe(
      `Sehr ${B}textbf{hohe} Kosten`,
    );
  });

  it("does not give back a command it never drew", () => {
    // A command the renderer does not know keeps its argument and loses its
    // name, so what comes back is the words and not the citation. The
    // serialiser cannot tell that this happened — which is why the guard is
    // the round trip *comparison* and not the serialiser alone.
    expect(roundTrip(`${B}cite{din277}`)).not.toBe(`${B}cite{din277}`);
    expect(plainCell(`${B}cite{din277}`)).toBe(false);
  });

  it("answers null for markup it cannot read at all", () => {
    // Mathematics is rendered into elements with attributes of their own, and
    // guessing at those would be a best-effort serialiser quietly rewriting
    // somebody's formula.
    expect(roundTrip("$x^2$")).toBeNull();
  });
});
