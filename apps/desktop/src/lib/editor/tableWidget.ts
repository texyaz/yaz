/**
 * A table you can change, in the preview.
 *
 * # What this is for
 *
 * Adding a column to a LaTeX table by hand means putting an `&` in exactly the
 * right place in every row. Twenty rows is twenty chances to get it wrong, and
 * getting one wrong is a table that will not compile — with an error that
 * points at the `\end{tabular}` rather than at the row you missed. That is the
 * job worth taking off an author, and it is why this exists.
 *
 * # It edits the buffer, not a model of it
 *
 * There is one document and it holds the raw `.tex` ([ADR-0004]). Every control
 * here works out what the LaTeX should say and dispatches a change to the
 * buffer, exactly as though the author had typed it. Nothing is held in the
 * widget between edits, the change is one step to undo, and what the compiler
 * sees is what the screen showed.
 *
 * The shape of the LaTeX is [`tableEdit.ts`](./tableEdit.ts)'s business. This
 * file is the surface: rails along the top and side, a handle between columns,
 * and the arithmetic that turns a drag in pixels into a width in centimetres.
 *
 * [ADR-0004]: https://texyaz.github.io/yaz/adr/0004-editor-core-codemirror-single-buffer
 */

import { EditorSelection } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, WidgetType, keymap } from "@codemirror/view";

import { t } from "../i18n";
import { inlineHtml } from "./inline";
import type { InlineFormat } from "./formatting";
import {
  insertColumn,
  insertRow,
  readGrid,
  readSpec,
  removeColumn,
  removeRow,
  setColumnWidth,
  setRowHeight,
  writeGrid,
} from "./tableEdit";

/**
 * Where a table's parts are in the document.
 *
 * Offsets and no text. Holding a copy of the body would mean two things that
 * can disagree — and they would, because a widget is kept while it compares
 * equal, so a change the drawing did not notice would leave the copy stale and
 * the next edit would write the stale version back.
 *
 * It is also what keeps this off the keystroke path: comparing two copies of a
 * table body, per table, per keystroke, cost more than everything else this
 * widget does.
 */
export interface TableSource {
  /** The column specification, inside its braces. */
  specFrom: number;
  specTo: number;
  /** The body: every row, between the specification and `\end{tabular}`. */
  bodyFrom: number;
  bodyTo: number;
}

/** Pixels to a centimetre at the usual screen resolution. */
const PX_PER_CM = 96 / 2.54;

/** Narrower than this and a column cannot hold a word. */
const NARROWEST_CM = 0.5;

/** Wider than this and the table is off the paper whatever the paper is. */
const WIDEST_CM = 25;

/**
 * A drawn table, with the handles that change it.
 *
 * The HTML of the table itself is rendered elsewhere and handed in: this adds
 * the rails around it and the behaviour.
 */
export class TableWidget extends WidgetType {
  constructor(
    readonly html: string,
    /** How many columns and rows, so the rails know what to draw. */
    readonly columns: number,
    readonly rows: number,
    /**
     * The cell the caret is in, when the table is locked drawn.
     *
     * `null` when the caret is elsewhere, or when the table would have shown
     * its source anyway. A caret inside a widget is not drawn by the browser,
     * so without this an author editing a locked table has no way of telling
     * where they are.
     */
    readonly active: { row: number; column: number } | null = null,
  ) {
    super();
  }

  /**
   * The cell last typed in, so the menu knows what "this row" means.
   *
   * Not part of {@link eq}: it is where the author is, not what is drawn, and
   * rebuilding the table every time they moved between cells would be a
   * redraw per keystroke.
   */
  private at: { row: number; column: number } | null = null;

  /**
   * By what is drawn, and by nothing else.
   *
   * Deliberately *not* by where the table is. An earlier version compared the
   * document offsets, which is the obvious thing to do when the handles write
   * against those offsets — and it meant that typing one character anywhere
   * rebuilt every table below it, because every one of them had moved. On a
   * document made largely of tables that cost 2 ms of the 16 the keystroke
   * has.
   *
   * So the offsets are not held at all. {@link locate} finds them when a
   * control is actually pressed, from where the widget turned out to be, which
   * is both cheaper and impossible to hold a stale copy of.
   */
  override eq(other: TableWidget): boolean {
    return (
      other.html === this.html &&
      other.columns === this.columns &&
      other.rows === this.rows &&
      other.active?.row === this.active?.row &&
      other.active?.column === this.active?.column
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const frame = document.createElement("div");
    frame.className = "cm-yaz-block cm-yaz-table-host cm-yaz-table-frame";
    // The frame is not editable and the cells inside it are, which is how a
    // widget carries an editable region without CodeMirror trying to read the
    // whole thing back into the document.
    frame.setAttribute("contenteditable", "false");

    const table = document.createElement("div");
    table.className = "cm-yaz-table-body";
    table.innerHTML = this.html;
    this.mark(table);

    frame.append(
      this.cornerMenu(view, frame),
      this.columnRail(view, frame, table, this.columns),
      this.rowRail(view, frame, this.rows),
      table,
    );

    // Both deferred until CodeMirror has put the frame in the document.
    //
    // Deciding which cells are editable means asking where this table *is*,
    // and `posAtDOM` cannot answer for an element that has not been placed
    // yet. Doing it here rather than waiting made every cell look like one
    // with markup in it, so none of them was editable.
    //
    // The focus is the second half: a change to the document rebuilds this
    // widget and throws away the element that had it, so tabbing into a new
    // row would otherwise land the author back in the document.
    const at = wanted;
    wanted = null;
    queueMicrotask(() => {
      this.wireCells(view, frame, table);
      if (at) focusCell(table, at.row, at.column);
    });
    return frame;
  }

  /**
   * Every event inside the table is the table's.
   *
   * The cells are editable in their own right, so CodeMirror must not also try
   * to interpret what happens in them. It used to: a click was routed back to
   * the document, and because the whole `tabular` is one replaced range the
   * selection could not land inside it — CodeMirror moved it to the edge, and
   * what was typed appeared *under* the table instead of in the cell.
   */
  override ignoreEvent(): boolean {
    return true;
  }

  /**
   * Make the cells editable, and Tab walk them.
   *
   * # Why the cell is the editor and not the buffer behind it
   *
   * The whole `tabular` is one replaced range. A caret placed inside it cannot
   * be drawn, and CodeMirror moves the selection to the range's edge — so
   * typing went into the document *after* the table rather than into the cell
   * that was clicked. Marking which cell the caret was in only made that
   * clearer; it did not make it editable.
   *
   * So the cell itself takes the typing, and what it ends up holding is written
   * into the buffer. There is still one document holding the raw `.tex`
   * (ADR-0004) — this is a way of typing into it, the same as the rails are a
   * way of adding a column.
   *
   * # Why some cells are not editable
   *
   * A cell is drawn from its source: `\\textbf{x}` is rendered bold, and what
   * the element holds is `x`. Writing that back would delete the markup. So a
   * cell whose source is plain text is edited here, and one with anything else
   * in it is left to source view — where the author can see what they are
   * changing. Silently eating a `\\cite` would be much worse than not offering
   * the edit.
   */
  private wireCells(
    view: EditorView,
    frame: HTMLElement,
    table: HTMLElement,
  ): void {
    const source = () => this.locate(view, frame);

    const place = (cell: HTMLElement): { row: number; column: number } => {
      const line = cell.closest("tr");
      const rows = [...table.querySelectorAll("tr")];
      return {
        row: line ? rows.indexOf(line) : -1,
        column: line ? [...line.children].indexOf(cell) : -1,
      };
    };

    /** Write a cell back, and answer whether the document changed. */
    const commit = (cell: HTMLElement): boolean => {
      const found = source();
      if (!found) return false;
      const at = place(cell);
      if (at.row < 0 || at.column < 0) return false;

      const text = view.state.doc.toString();
      const span = cellSpan(
        text,
        found.bodyFrom,
        found.bodyTo,
        at.row,
        at.column,
      );
      if (!span) return false;

      const was = text.slice(span.from, span.to);
      // Serialised rather than read as text, so a run made bold in the cell
      // comes back as `\\textbf{...}` rather than losing the command.
      const now = cellSource(cell)?.trim();
      if (now === undefined || now === null) return false;
      if (now === was) return false;
      if (!editableSource(was)) return false;

      view.dispatch({
        changes: { from: span.from, to: span.to, insert: now },
        scrollIntoView: false,
        userEvent: "input.table",
      });
      return true;
    };

    for (const cell of table.querySelectorAll("td, th")) {
      if (!(cell instanceof HTMLElement)) continue;

      const found = source();
      const at = place(cell);
      const was = found
        ? cellSpan(
            view.state.doc.toString(),
            found.bodyFrom,
            found.bodyTo,
            at.row,
            at.column,
          )
        : null;
      const text = was ? view.state.doc.sliceString(was.from, was.to) : "";

      if (!found || !was || !editableSource(text)) {
        // Nothing pretends to be editable that is not.
        cell.classList.add("cm-yaz-cell-source-only");
        cell.title = t("table-cell-in-source");
        continue;
      }

      // The attribute rather than the property: the property is what browsers
      // expose and what jsdom does not have, and the attribute is what both
      // read.
      cell.setAttribute("contenteditable", "true");
      cell.setAttribute("spellcheck", "false");
      // Focusable in its own right, so Tab can put the caret in it.
      cell.tabIndex = -1;
      cell.addEventListener("focus", () => {
        this.at = place(cell);
        // Told to the module, so a formatting command from the ribbon or the
        // keyboard can find the cell without knowing which widget owns it.
        editing = { cell, commit: () => commit(cell) };
      });
      cell.addEventListener("blur", () => {
        commit(cell);
        if (editing?.cell === cell) editing = null;
      });
    }

    table.addEventListener("keydown", (event) => {
      const cell = (event.target as HTMLElement | null)?.closest("td, th");
      if (!(cell instanceof HTMLElement)) return;

      if (event.key === "Escape") {
        event.preventDefault();
        commit(cell);
        cell.blur();
        view.focus();
        return;
      }

      // Return commits and leaves. A newline inside a cell is not a thing
      // LaTeX has, and inserting one would put a `\\` in the middle of a row.
      if (event.key === "Enter") {
        event.preventDefault();
        commit(cell);
        cell.blur();
        return;
      }

      // The formatting shortcuts, handled here because CodeMirror is told to
      // ignore everything inside the widget — so its keymap never sees them.
      if (event.ctrlKey || event.metaKey) {
        const command = SHORTCUTS[event.key.toLowerCase()];
        if (command && formatInCell(command)) {
          event.preventDefault();
          return;
        }
      }

      if (event.key !== "Tab") return;
      event.preventDefault();
      this.step(view, frame, table, cell, place(cell), event.shiftKey, commit);
    });
  }

  /**
   * Move to the next cell, adding a row when there is no next cell.
   *
   * Tab out of the last cell making a new row is what a word processor does,
   * and it is the difference between filling a table in and stopping to reach
   * for a button every few seconds.
   */
  private step(
    view: EditorView,
    frame: HTMLElement,
    table: HTMLElement,
    cell: HTMLElement,
    at: { row: number; column: number },
    backwards: boolean,
    commit: (cell: HTMLElement) => boolean,
  ): void {
    const rows = [...table.querySelectorAll("tr")];
    const width = rows[at.row]?.children.length ?? 0;

    let row = at.row;
    let column = at.column + (backwards ? -1 : 1);
    if (column >= width) {
      row += 1;
      column = 0;
    } else if (column < 0) {
      row -= 1;
      column = Math.max((rows[row]?.children.length ?? 1) - 1, 0);
    }

    if (row < 0) {
      commit(cell);
      return;
    }

    if (row >= rows.length) {
      // Past the last cell: a new row, and the caret in the first cell of it.
      commit(cell);
      wanted = { row, column: 0 };
      this.change(view, frame, (grid) => insertRow(grid, rows.length));
      return;
    }

    // A commit rebuilds the widget, so the element to focus is chosen by
    // position rather than held: the one in hand is about to be replaced.
    if (commit(cell)) {
      wanted = { row, column };
      return;
    }
    focusCell(table, row, column);
  }

  /**
   * Where this table is in the document, right now.
   *
   * From the widget's own element rather than from anything remembered: the
   * element knows where it ended up, and asking at the moment of the edit is
   * what makes a stale answer impossible.
   */
  private locate(view: EditorView, frame: HTMLElement): TableSource | null {
    let at: number;
    try {
      at = view.posAtDOM(frame);
    } catch {
      return null;
    }

    const text = view.state.doc.toString();
    // Backwards first. `posAtDOM` may answer with either edge of the replaced
    // range, and searching only forwards from the far edge walks straight past
    // the table this widget stands for — into the next one, or into nothing.
    const OPEN = "\\begin{tabular";
    const CLOSE = "\\end{tabular";
    let opened = text.lastIndexOf(OPEN, at);
    if (opened === -1 || text.indexOf(CLOSE, opened) < at) {
      opened = text.indexOf(OPEN, at);
    }
    if (opened === -1) return null;
    const closed = text.indexOf(CLOSE, opened);
    if (closed === -1) return null;

    // Past `{tabular}` and any `[t]`, to the specification's braces.
    let cursor = text.indexOf("}", opened);
    if (cursor === -1) return null;
    cursor += 1;
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    if (text[cursor] === "[") {
      const close = text.indexOf("]", cursor);
      if (close === -1) return null;
      cursor = close + 1;
    }
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    if (text[cursor] !== "{") return null;

    const specFrom = cursor + 1;
    let depth = 0;
    for (; cursor < closed; cursor += 1) {
      if (text[cursor] === "{") depth += 1;
      else if (text[cursor] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (cursor >= closed) return null;

    return {
      specFrom,
      specTo: cursor,
      bodyFrom: cursor + 1,
      bodyTo: closed,
    };
  }

  /** Put a border round the cell the caret is in. */
  private mark(table: HTMLElement): void {
    if (!this.active) return;
    const row = table.querySelectorAll("tr")[this.active.row];
    const cell = row?.children[this.active.column];
    if (cell instanceof HTMLElement) {
      cell.classList.add("cm-yaz-cell-active");
    }
  }

  /**
   * The strip above the table.
   *
   * # Why a marker on the boundary rather than a button per column
   *
   * A `+` sitting on a column means "add a column — but which side?", and every
   * word processor answered that question the same way twenty years ago: the
   * control goes on the *line between* two columns, and what it adds goes
   * there. So there is one marker per boundary, including the two outer edges,
   * and no ambiguity to resolve.
   *
   * It appears on hover, because a table with nine permanent handles round it
   * is a table you cannot read.
   */
  private columnRail(
    view: EditorView,
    frame: HTMLElement,
    table: HTMLElement,
    columns: number,
  ): HTMLElement {
    const rail = document.createElement("div");
    rail.className = "cm-yaz-table-rail cm-yaz-table-rail-columns";

    for (let index = 0; index <= columns; index += 1) {
      const at = index;
      const boundary = document.createElement("div");
      boundary.className = "cm-yaz-table-boundary";

      boundary.append(
        this.marker(t("table-column-add"), () =>
          this.change(view, frame, (grid) => insertColumn(grid, at)),
        ),
      );

      // The drag handle only where there is a column on both sides: dragging
      // the outer edge of a table is a different gesture, and one this does not
      // do.
      if (index > 0 && index < columns) {
        const handle = document.createElement("div");
        handle.className = "cm-yaz-table-handle";
        handle.title = t("table-column-width");
        handle.addEventListener("pointerdown", (event) =>
          this.dragWidth(view, frame, event, index - 1, table),
        );
        boundary.append(handle);
      }

      rail.append(boundary);
    }
    return rail;
  }

  /** The strip down the left, on the same rule: one marker per boundary. */
  private rowRail(
    view: EditorView,
    frame: HTMLElement,
    rows: number,
  ): HTMLElement {
    const rail = document.createElement("div");
    rail.className = "cm-yaz-table-rail cm-yaz-table-rail-rows";

    for (let index = 0; index <= rows; index += 1) {
      const at = index;
      const boundary = document.createElement("div");
      boundary.className = "cm-yaz-table-boundary";

      boundary.append(
        this.marker(t("table-row-add"), () =>
          this.change(view, frame, (grid) => insertRow(grid, at)),
        ),
      );

      if (index > 0 && index < rows) {
        const handle = document.createElement("div");
        handle.className = "cm-yaz-table-handle cm-yaz-table-handle-row";
        handle.title = t("table-row-height");
        handle.addEventListener("pointerdown", (event) =>
          this.dragHeight(view, frame, event, index - 1),
        );
        boundary.append(handle);
      }

      rail.append(boundary);
    }
    return rail;
  }

  /** A circled plus, sitting on a boundary. */
  private marker(label: string, act: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-yaz-table-marker";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.textContent = "+";
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      act();
    });
    return button;
  }

  /**
   * The menu in the corner: everything that is not "one more, here".
   *
   * The markers cover adding, which is the common case and wants no reading.
   * What is left — adding relative to *this* row, and every kind of deleting —
   * is a list, because it is a list of things you do rarely and want to be sure
   * about.
   *
   * "Delete cells" is deliberately absent. A `tabular` is a strict grid: there
   * is no cell to remove without shifting a row into a different shape, and a
   * menu entry that quietly reshaped the table would be worse than not offering
   * it. Emptying one is offered instead, which is what the request usually
   * means.
   */
  private cornerMenu(view: EditorView, frame: HTMLElement): HTMLElement {
    const host = document.createElement("div");
    host.className = "cm-yaz-table-corner";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-yaz-table-control";
    button.title = t("table-menu");
    button.setAttribute("aria-label", t("table-menu"));
    button.textContent = "⋮";

    const menu = document.createElement("div");
    menu.className = "cm-yaz-table-menu";
    menu.hidden = true;

    const entry = (labelKey: string, act: () => void) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "cm-yaz-table-menu-item";
      item.textContent = t(labelKey);
      item.addEventListener("mousedown", (event) => event.preventDefault());
      item.addEventListener("click", (event) => {
        event.preventDefault();
        menu.hidden = true;
        act();
      });
      menu.append(item);
    };

    // Where "here" is: the cell last typed in, or the first one.
    const here = () => this.at ?? { row: 0, column: 0 };

    entry("table-row-above", () =>
      this.change(view, frame, (grid) => insertRow(grid, here().row)),
    );
    entry("table-row-below", () =>
      this.change(view, frame, (grid) => insertRow(grid, here().row + 1)),
    );
    entry("table-column-left", () =>
      this.change(view, frame, (grid) => insertColumn(grid, here().column)),
    );
    entry("table-column-right", () =>
      this.change(view, frame, (grid) => insertColumn(grid, here().column + 1)),
    );

    const rule = document.createElement("div");
    rule.className = "cm-yaz-table-menu-rule";
    menu.append(rule);

    entry("table-clear-cell", () => this.clearCell(view, frame));
    entry("table-row-remove", () =>
      this.change(view, frame, (grid) => removeRow(grid, here().row)),
    );
    entry("table-column-remove", () =>
      this.change(view, frame, (grid) => removeColumn(grid, here().column)),
    );
    entry("table-remove", () => this.removeTable(view, frame));

    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      menu.hidden = !menu.hidden;
      if (!menu.hidden) {
        const shut = () => {
          menu.hidden = true;
          window.removeEventListener("click", shut);
        };
        window.addEventListener("click", shut);
      }
    });

    host.append(button, menu);
    return host;
  }

  /** Empty the cell last typed in, leaving the grid the shape it was. */
  private clearCell(view: EditorView, frame: HTMLElement): void {
    const found = this.locate(view, frame);
    const at = this.at;
    if (!found || !at) return;
    const span = cellSpan(
      view.state.doc.toString(),
      found.bodyFrom,
      found.bodyTo,
      at.row,
      at.column,
    );
    if (!span || span.from === span.to) return;
    view.dispatch({
      changes: { from: span.from, to: span.to, insert: "" },
      scrollIntoView: false,
      userEvent: "delete.table",
    });
  }

  /**
   * Take the whole table out.
   *
   * The `tabular` and nothing else — a `table` float around it holds the
   * caption and the label, and deleting those because the grid went is a
   * decision the author did not make.
   */
  private removeTable(view: EditorView, frame: HTMLElement): void {
    let at: number;
    try {
      at = view.posAtDOM(frame);
    } catch {
      return;
    }
    const text = view.state.doc.toString();
    const OPEN = "\\begin{tabular";
    const CLOSE = "\\end{tabular}";
    let opened = text.lastIndexOf(OPEN, at);
    if (opened === -1 || text.indexOf(CLOSE, opened) < at) {
      opened = text.indexOf(OPEN, at);
    }
    if (opened === -1) return;
    const closed = text.indexOf(CLOSE, opened);
    if (closed === -1) return;
    view.dispatch({
      changes: { from: opened, to: closed + CLOSE.length, insert: "" },
      scrollIntoView: false,
      userEvent: "delete.table",
    });
  }

  /**
   * Apply a change to the grid and write the result into the document.
   *
   * The specification and the body are two separate ranges, so this is two
   * changes in one transaction — one step to undo, and no window in which the
   * table has a column in its rows that its specification does not know about.
   */
  private change(
    view: EditorView,
    frame: HTMLElement,
    act: (grid: ReturnType<typeof readGrid>) => ReturnType<typeof readGrid>,
  ): void {
    const found = this.locate(view, frame);
    if (!found) return;
    const { specFrom, specTo, bodyFrom, bodyTo } = found;
    const spec = view.state.doc.sliceString(specFrom, specTo);
    const body = view.state.doc.sliceString(bodyFrom, bodyTo);
    const columns = readSpec(spec).columns.length;
    const next = act(readGrid(spec, body, columns));

    view.dispatch({
      changes: [
        { from: specFrom, to: specTo, insert: next.spec },
        { from: bodyFrom, to: bodyTo, insert: writeGrid(next) },
      ],
      // The caret goes nowhere near the table: putting it inside would reveal
      // the source, which is the opposite of what pressing a button in the
      // drawn table asks for.
      scrollIntoView: false,
    });
  }

  /**
   * Drag a column's edge, and write the width it lands on.
   *
   * The width is taken from where the pointer stops rather than followed
   * continuously: a document change per mouse-move would be a hundred undo
   * steps for one drag.
   */
  private dragWidth(
    view: EditorView,
    frame: HTMLElement,
    event: PointerEvent,
    index: number,
    table: HTMLElement,
  ): void {
    event.preventDefault();
    const cell = table.querySelectorAll("tr")[0]?.children[index];
    if (!(cell instanceof HTMLElement)) return;

    const startX = event.clientX;
    const startWidth = cell.getBoundingClientRect().width;
    const handle = event.currentTarget;
    if (handle instanceof HTMLElement)
      handle.setPointerCapture(event.pointerId);

    // Typed as the DOM types them, and narrowed inside: `addEventListener`
    // takes an `EventListener`, and TypeScript will not accept a handler that
    // has quietly promised itself a `PointerEvent`.
    const preview = (moved: Event) => {
      if (!(moved instanceof PointerEvent)) return;
      // Shown while dragging without touching the document, so the author can
      // see where they are putting the edge.
      cell.style.width = `${Math.max(8, startWidth + moved.clientX - startX)}px`;
    };

    const finish = (moved: Event) => {
      if (!(moved instanceof PointerEvent)) return;
      handle?.removeEventListener("pointermove", preview);
      handle?.removeEventListener("pointerup", finish);
      cell.style.width = "";

      const zoom = this.zoomOf(table);
      const pixels = Math.max(8, startWidth + moved.clientX - startX) / zoom;
      const cm = Math.min(
        WIDEST_CM,
        Math.max(NARROWEST_CM, pixels / PX_PER_CM),
      );
      this.change(view, frame, (grid) =>
        setColumnWidth(grid, index, `${cm.toFixed(1)}cm`),
      );
    };

    handle?.addEventListener("pointermove", preview);
    handle?.addEventListener("pointerup", finish);
  }

  /**
   * Drag a row's edge, and write the extra room it lands on.
   *
   * As `\[2ex]`, which is LaTeX's own way of asking for more space after a
   * row — there is no per-row height in a `tabular`, and inventing one with a
   * strut would be writing something the author did not ask for and would not
   * recognise.
   *
   * Dragged *up* past the row's own height, the extra goes away entirely
   * rather than going negative: negative space in LaTeX is legal and almost
   * never meant.
   */
  private dragHeight(
    view: EditorView,
    frame: HTMLElement,
    event: PointerEvent,
    index: number,
  ): void {
    event.preventDefault();
    const startY = event.clientY;
    const handle = event.currentTarget;
    if (handle instanceof HTMLElement)
      handle.setPointerCapture(event.pointerId);

    const finish = (moved: Event) => {
      if (!(moved instanceof PointerEvent)) return;
      handle?.removeEventListener("pointerup", finish);

      const zoom = this.zoomOf(frame);
      const grown = (moved.clientY - startY) / zoom;
      // An ex is about half a line, which is the unit LaTeX uses for exactly
      // this and the one an author would have typed.
      const ex = Math.round((grown / (PX_PER_CM / 2.54 / 2)) * 2) / 2;
      this.change(view, frame, (grid) =>
        setRowHeight(grid, index, ex > 0 ? `${ex}ex` : ""),
      );
    };

    handle?.addEventListener("pointerup", finish);
  }

  /**
   * How much the page is magnified.
   *
   * A drag is measured on screen and a width is written in centimetres, so the
   * zoom has to come out of the arithmetic — otherwise dragging an edge to the
   * same place at 200% writes half the width.
   */
  private zoomOf(element: HTMLElement): number {
    const editor = element.closest(".editor");
    if (!(editor instanceof HTMLElement)) return 1;
    const value = Number.parseFloat(
      getComputedStyle(editor).getPropertyValue("--yaz-zoom"),
    );
    return Number.isFinite(value) && value > 0 ? value : 1;
  }
}

/**
 * Move the caret from one cell to the next, the way a word processor does.
 *
 * Tab in a table means "next cell" everywhere else, and an author who has just
 * typed a heading expects it to. What it does *not* do is insert a tab
 * character, which is what an editor's Tab does and what LaTeX would ignore.
 *
 * The caret moves in the buffer rather than in a model of the table, because
 * there is no model of the table: the cells are ranges of the document, and
 * "the next cell" is the offset after the next `&` at brace depth zero.
 */
export function nextCell(
  text: string,
  bodyFrom: number,
  bodyTo: number,
  at: number,
  backwards: boolean,
): number | null {
  const boundaries = cellStarts(text, bodyFrom, bodyTo);
  if (boundaries.length === 0) return null;

  if (backwards) {
    // The last boundary strictly before the caret. Strictly, so that Shift-Tab
    // from the start of a cell goes to the previous one rather than staying.
    let found: number | null = null;
    for (const boundary of boundaries) {
      if (boundary < at) found = boundary;
      else break;
    }
    return found;
  }

  for (const boundary of boundaries) {
    if (boundary > at) return boundary;
  }
  return null;
}

/**
 * Where each cell's text begins, in document offsets.
 *
 * A cell begins after the `&` or the `\` that opened it, and after any
 * whitespace — landing the caret on the space in front of a word rather than
 * on the word is what makes Tab feel wrong.
 */
function cellStarts(text: string, bodyFrom: number, bodyTo: number): number[] {
  const starts: number[] = [];
  let depth = 0;

  const push = (at: number) => {
    let cursor = at;
    while (cursor < bodyTo && /[^\S\n]/.test(text[cursor] ?? "")) cursor += 1;
    starts.push(cursor);
  };

  push(bodyFrom);
  for (let index = bodyFrom; index < bodyTo; index += 1) {
    const character = text[index]!;
    if (character === "{") {
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      continue;
    }
    if (character === "\\") {
      if (text[index + 1] === "\\" && depth === 0) {
        let cursor = index + 2;
        if (text[cursor] === "*") cursor += 1;
        if (text[cursor] === "[") {
          const close = text.indexOf("]", cursor);
          if (close !== -1 && close < bodyTo) cursor = close + 1;
        }
        // Past the line break too, so the caret lands in the row rather than
        // at the end of the one above it.
        while (cursor < bodyTo && /\s/.test(text[cursor] ?? "")) cursor += 1;
        starts.push(cursor);
        index = cursor - 1;
        continue;
      }
      index += 1;
      continue;
    }
    if (character === "&" && depth === 0) push(index + 1);
  }

  // What follows the last `\` is the table's tail — a closing rule and some
  // whitespace — and not a cell. Tab into it would put the caret after the last
  // row, which reads as the table having one more cell than it has.
  return starts
    .filter((at) => at <= bodyTo)
    .filter(
      (at, index, all) =>
        index === 0 || text.slice(at, bodyTo).trim() !== "" || all.length === 1,
    )
    .sort((a, b) => a - b);
}

/**
 * Tab and Shift-Tab, when the caret is in a table.
 *
 * Returns `false` everywhere else, which is how a CodeMirror keymap says "not
 * mine" — so Tab keeps doing whatever it did before outside a table, including
 * in Vim mode and in a list.
 */
export function tableTabKeymap(): Extension {
  const move = (view: EditorView, backwards: boolean): boolean => {
    const caret = view.state.selection.main;
    if (!caret.empty) return false;

    const text = view.state.doc.toString();
    const table = tableAround(text, caret.head);
    if (!table) return false;

    const target = nextCell(
      text,
      table.bodyFrom,
      table.bodyTo,
      caret.head,
      backwards,
    );
    if (target === null) return false;

    view.dispatch({
      selection: EditorSelection.cursor(target),
      scrollIntoView: true,
    });
    return true;
  };

  return keymap.of([
    { key: "Tab", run: (view) => move(view, false) },
    { key: "Shift-Tab", run: (view) => move(view, true) },
  ]);
}

/**
 * The table the caret is inside, if it is inside one.
 *
 * Found by looking backwards for a `\begin{tabular}` that has not been closed,
 * rather than by scanning every table in the document: this runs on a key
 * press, and the answer is nearly always "no table" after a few hundred
 * characters.
 */
function tableAround(
  text: string,
  at: number,
): { bodyFrom: number; bodyTo: number } | null {
  const opened = text.lastIndexOf("\begin{tabular", 0 + at);
  if (opened === -1) return null;
  const closed = text.indexOf("\\end{tabular", opened);
  if (closed === -1 || closed < at) return null;

  // Past `{tabular}`, any `[t]`, and the column specification.
  let cursor = text.indexOf("}", opened);
  if (cursor === -1) return null;
  cursor += 1;
  while (/\s/.test(text[cursor] ?? "")) cursor += 1;
  if (text[cursor] === "[") {
    const close = text.indexOf("]", cursor);
    if (close === -1) return null;
    cursor = close + 1;
  }
  while (/\s/.test(text[cursor] ?? "")) cursor += 1;
  if (text[cursor] !== "{") return null;
  let depth = 0;
  for (; cursor < closed; cursor += 1) {
    if (text[cursor] === "{") depth += 1;
    else if (text[cursor] === "}") {
      depth -= 1;
      if (depth === 0) {
        cursor += 1;
        break;
      }
    }
  }

  if (at < cursor || at > closed) return null;
  return { bodyFrom: cursor, bodyTo: closed };
}

/**
 * Which cell of a table an offset falls in, as row and column.
 *
 * Counted the same way the cells are split, so that `\&` in a cell and a `&`
 * inside `\multicolumn{2}{c}{a & b}` are not mistaken for boundaries — a
 * highlight on the wrong cell is worse than none, because it says confidently
 * where the caret is not.
 */
export function cellAt(
  text: string,
  bodyFrom: number,
  bodyTo: number,
  at: number,
): { row: number; column: number } | null {
  if (at < bodyFrom || at > bodyTo) return null;

  let row = 0;
  let column = 0;
  let depth = 0;

  for (let index = bodyFrom; index < Math.min(at, bodyTo); index += 1) {
    const character = text[index]!;
    if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    else if (character === "\\") {
      if (text[index + 1] === "\\" && depth === 0) {
        row += 1;
        column = 0;
        index += 1;
        continue;
      }
      index += 1;
    } else if (character === "&" && depth === 0) {
      column += 1;
    }
  }

  return { row, column };
}

/**
 * Which cell to put the caret in once the widget has been rebuilt.
 *
 * Module-level because the widget that sets it is not the widget that reads
 * it — a document change throws the old one away. Only one table is being
 * typed into at a time, so one slot is enough.
 */
let wanted: { row: number; column: number } | null = null;

/** Put the caret at the end of a drawn cell. */
function focusCell(table: HTMLElement, row: number, column: number): void {
  const rows = [...table.querySelectorAll("tr")];
  const cell = rows[row]?.children[column];
  if (!(cell instanceof HTMLElement)) return;
  cell.focus();

  // At the end of what is there, which is where somebody tabbing into a cell
  // to add to it expects to be.
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * Whether a cell's source is one that can be edited where it is drawn.
 *
 * Kept as a name because it is what the tests and the widget both ask; the
 * answer is now {@link editableSource}, which tries the actual round trip
 * rather than guessing from the characters. The guess was too strict — it
 * refused `\\textbf{Kosten}`, which is exactly what a bold button in a cell
 * produces.
 */
export function plainCell(source: string): boolean {
  return editableSource(source);
}

/**
 * A horizontal rule at the start of a cell, which is the row's and not its own.
 *
 * `booktabs` spells them differently from the kernel, and both turn up in the
 * same document.
 */
const RULE = new RegExp(
  "^" +
    String.fromCharCode(92, 92) +
    "(?:hline|toprule|midrule|bottomrule|cline\\{[^}]*\\}" +
    "|cmidrule(?:\\([^)]*\\))?(?:\\{[^}]*\\})?)\\s*",
);

/**
 * Where one cell's text begins and ends, in document offsets.
 *
 * The inverse of {@link cellAt}, and split the same way, so that a `&` inside
 * `\multicolumn{2}{c}{a & b}` is not mistaken for a boundary. `null` when the
 * table has no such cell — a click on a row a redraw has since removed.
 *
 * The ends are trimmed of the spaces that pad a cell, because the caret should
 * land on the word rather than in front of it, and a double-click should select
 * what is written rather than the padding around it.
 */
export function cellSpan(
  text: string,
  bodyFrom: number,
  bodyTo: number,
  row: number,
  column: number,
): { from: number; to: number } | null {
  let atRow = 0;
  let atColumn = 0;
  let depth = 0;
  let start = bodyFrom;

  const finish = (end: number) => {
    let from = start;
    let to = end;
    while (from < to && /\s/.test(text[from] ?? "")) from += 1;
    // A rule belongs to the row, not to the first cell of it. Counting
    // `\hline` as part of the text made the top-left cell of every ruled table
    // look like a cell with markup in it, so it could not be typed in.
    let rule = RULE.exec(text.slice(from, to));
    while (rule) {
      from += rule[0].length;
      rule = RULE.exec(text.slice(from, to));
    }
    while (to > from && /\s/.test(text[to - 1] ?? "")) to -= 1;
    return { from, to };
  };

  for (let index = bodyFrom; index < bodyTo; index += 1) {
    const character = text[index]!;
    if (character === "{") {
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      continue;
    }
    if (character === "\\") {
      if (text[index + 1] === "\\" && depth === 0) {
        if (atRow === row && atColumn === column) return finish(index);
        atRow += 1;
        atColumn = 0;
        index += 1;
        start = index + 1;
        continue;
      }
      // Any other command: its name cannot contain a boundary, and stepping
      // over the escaped character is what stops `\&` counting as one.
      index += 1;
      continue;
    }
    if (character === "&" && depth === 0) {
      if (atRow === row && atColumn === column) return finish(index);
      atColumn += 1;
      start = index + 1;
    }
  }

  // The last cell of the last row, where no boundary follows it.
  if (atRow === row && atColumn === column) return finish(bodyTo);
  return null;
}

/** The formatting keys, as they are bound everywhere else in yaz. */
const SHORTCUTS: Record<string, InlineFormat> = {
  b: "textbf",
  i: "textit",
  u: "underline",
};

/**
 * The inline commands a drawn cell can be turned back into.
 *
 * The inverse of what {@link inlineHtml} draws, for the commands a formatting
 * button applies. Anything outside this list is why a cell can be un-editable:
 * a `\cite` or a `$x^2$` draws as something whose HTML cannot be read back, and
 * committing the element's text would delete it.
 */
const FROM_TAG: Record<string, string> = {
  STRONG: "textbf",
  B: "textbf",
  EM: "textit",
  I: "textit",
  U: "underline",
  CODE: "texttt",
};

/** The element a formatting command is drawn as. */
export const CELL_TAGS: Partial<Record<InlineFormat, string>> = {
  textbf: "strong",
  textit: "em",
  underline: "u",
  texttt: "code",
  textsc: "span",
};

/**
 * Turn a drawn cell back into LaTeX.
 *
 * `null` when it holds something this cannot express — which is the check that
 * stops a commit from deleting markup it did not understand. Being unable to
 * say so is the whole reason the answer is nullable rather than best-effort.
 */
export function cellSource(node: Node): string | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").replace(/\s+/g, " ");
  }
  if (!(node instanceof HTMLElement)) return null;

  let inner = "";
  for (const child of node.childNodes) {
    const part = cellSource(child);
    if (part === null) return null;
    inner += part;
  }

  // The cell itself, or a wrapper with nothing of its own to say.
  if (node.tagName === "TD" || node.tagName === "TH") return inner;

  if (node.tagName === "SPAN") {
    if (node.classList.contains("cm-yaz-smallcaps")) {
      return `\\textsc{${inner}}`;
    }
    // A span the renderer did not put there — a browser's doing while typing.
    return node.attributes.length === 0 ? inner : null;
  }

  if (node.tagName === "BR") return " ";

  const command = FROM_TAG[node.tagName];
  return command ? `\\${command}{${inner}}` : null;
}

/**
 * Whether a cell's source is one this can draw and read back again.
 *
 * The round trip is the test, and it is deliberately the *actual* round trip
 * rather than a guess at which commands are safe: if rendering the source and
 * reading it back does not give the source, then committing the cell would
 * change the document in a way nobody asked for.
 */
export function editableSource(source: string): boolean {
  const holder = document.createElement("td");
  holder.innerHTML = inlineHtml(source);
  const back = cellSource(holder);
  return back !== null && back.trim() === source.trim();
}

/**
 * The cell being typed in, if any.
 *
 * Module-level for the same reason {@link wanted} is: the shell has to be able
 * to apply a formatting command without knowing which widget owns the cell, and
 * only one cell is being typed in at a time. Cleared when focus leaves.
 */
let editing: { cell: HTMLElement; commit: () => void } | null = null;

/**
 * Apply a formatting command inside the cell being typed in.
 *
 * Answers whether it did. The shell tries this before its own path: a
 * selection inside a drawn cell is a DOM selection and not a CodeMirror one, so
 * the ordinary formatting — which works on the buffer — had nothing to act on
 * and did nothing at all.
 *
 * The wrapping is done in the cell and the cell is then written back as LaTeX,
 * which is the same route typing takes. What the compiler sees is what the
 * screen showed.
 */
export function formatInCell(command: InlineFormat): boolean {
  const held = editing;
  const tag = CELL_TAGS[command];
  if (!held || !tag) return false;

  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !held.cell.contains(range.commonAncestorContainer))
    return false;
  if (range.collapsed) return false;

  const inside = enclosing(range.commonAncestorContainer, held.cell, command);
  if (inside) unwrap(inside);
  else wrap(range, command, tag);

  held.commit();
  return true;
}

/** The element of this kind the selection sits inside, if any. */
function enclosing(
  node: Node,
  cell: HTMLElement,
  command: InlineFormat,
): HTMLElement | null {
  let at: Node | null = node;
  while (at && at !== cell) {
    if (at instanceof HTMLElement && marks(at) === command) return at;
    at = at.parentNode;
  }
  return null;
}

/** Which command an element stands for, or null. */
function marks(node: HTMLElement): InlineFormat | null {
  if (node.tagName === "SPAN") {
    return node.classList.contains("cm-yaz-smallcaps") ? "textsc" : null;
  }
  const command = FROM_TAG[node.tagName];
  return (command as InlineFormat | undefined) ?? null;
}

/** Take an element away and leave what was in it. */
function unwrap(node: HTMLElement): void {
  const parent = node.parentNode;
  if (!parent) return;
  while (node.firstChild) parent.insertBefore(node.firstChild, node);
  parent.removeChild(node);
}

/** Put the selection inside a new element of this kind. */
function wrap(range: Range, command: InlineFormat, tag: string): void {
  const element = document.createElement(tag);
  if (command === "textsc") element.className = "cm-yaz-smallcaps";
  // `surroundContents` refuses a range that partially covers an element, which
  // is ordinary here — half of a bold run. Extracting and re-inserting works
  // for both, and the browser has already normalised the fragment.
  element.append(range.extractContents());
  range.insertNode(element);

  const selection = window.getSelection();
  const next = document.createRange();
  next.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(next);
}
