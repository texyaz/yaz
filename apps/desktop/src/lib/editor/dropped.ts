/**
 * Something dragged onto the editor, offered to whoever understands it.
 *
 * # Why the flavours are kept whole
 *
 * A drag carries the same thing several times over. Dragging a reference out of
 * Zotero puts a formatted string in `text/plain` — "DIN EN ISO 29481-1 IDM
 * Bauwerksinformationsmodelle, Jan. 2025." — and the *machine-readable* version
 * of the same drop in `text/html`, where the citation carries a URI-encoded
 * blob naming the actual library item.
 *
 * Only the second one can become a citation a compiler will resolve. The first
 * is prose that happens to describe a source; turning it back into a citation
 * key means guessing, and a citation tool that guesses is worse than one that
 * declines. So the editor hands over everything the drag carried and keeps no
 * opinion about which flavour matters — that is the plugin's business, and for
 * Zotero it is `yaz-zotero`'s.
 *
 * # Why declining is the normal case
 *
 * Every handler is offered the drop and the first that returns text wins. A
 * plugin that does not recognise what was dropped returns `null` and costs a
 * function call. If nobody claims it the text goes in as text, so a drop always
 * does something — which is the property that makes this safe to add: installing
 * a plugin cannot make dropping worse than it was.
 */

import { Facet } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** A drop, as a handler sees it. */
export interface Dropped {
  /** What the drag carried, keyed by MIME type. */
  flavours: Record<string, string>;
  /** `flavours["text/plain"]`, or the empty string. */
  text: string;
  /** Where it landed, as an offset into the raw source. */
  at: number;
}

/** Turns a drop into text, or declines it. */
export interface DropTaker {
  /**
   * Which MIME types this wants to be offered.
   *
   * A filter rather than a courtesy: dropping a file on the editor should not
   * wake every citation plugin installed.
   */
  flavours: readonly string[];
  handle: (dropped: Dropped) => Promise<string | null> | string | null;
}

/** Who wants to be offered a drop. */
export const dropTakers = Facet.define<
  readonly DropTaker[],
  readonly DropTaker[]
>({
  combine: (values) => values.flat(),
});

/** Everything the drag carried, for the types anyone asked about. */
function flavoursOf(
  transfer: DataTransfer,
  wanted: ReadonlySet<string>,
): Record<string, string> {
  const flavours: Record<string, string> = {};
  // Read synchronously and all at once: a `DataTransfer` is emptied when the
  // drop event returns, so anything not taken here is gone by the time an
  // asynchronous handler asks for it.
  for (const type of wanted) {
    const value = transfer.getData(type);
    if (value) flavours[type] = value;
  }
  return flavours;
}

/** Put `text` in at `at`, with the caret after it. */
function insert(view: EditorView, at: number, text: string): void {
  const where = Math.min(at, view.state.doc.length);
  view.dispatch({
    changes: { from: where, insert: text },
    selection: EditorSelection.cursor(where + text.length),
    scrollIntoView: true,
    userEvent: "input.drop",
  });
  view.focus();
}

/** Offer drops to the plugins that asked for them. */
export function pluginDrops(): Extension {
  return EditorView.domEventHandlers({
    drop(event, view) {
      const transfer = event.dataTransfer;
      if (!transfer) return false;

      const takers = view.state.facet(dropTakers);
      if (takers.length === 0) return false;

      // Only the types somebody asked for, and only the takers whose types are
      // actually present. A drag of a file offers `Files` and nothing else, so
      // this is where that stops being anyone's problem.
      const wanted = new Set(takers.flatMap((taker) => taker.flavours));
      const flavours = flavoursOf(transfer, wanted);
      const interested = takers.filter((taker) =>
        taker.flavours.some((flavour) => flavours[flavour] !== undefined),
      );
      if (interested.length === 0) return false;

      // From here it is ours: the browser must not also insert the text, and
      // CodeMirror must not handle the drop underneath us.
      event.preventDefault();

      const at =
        view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
        view.state.selection.main.head;
      const dropped: Dropped = {
        flavours,
        text: flavours["text/plain"] ?? "",
        at,
      };

      void (async () => {
        for (const taker of interested) {
          let answer: string | null = null;
          try {
            answer = await taker.handle(dropped);
          } catch (error) {
            // A plugin that throws declines; it does not take the drop down
            // with it. The author still gets their text.
            console.warn("[yaz] a drop handler failed", error);
          }
          if (answer !== null && answer !== undefined) {
            insert(view, at, answer);
            return;
          }
        }
        // Nobody claimed it. The text goes in as text, which is what would have
        // happened without any of this.
        if (dropped.text) insert(view, at, dropped.text);
      })();

      return true;
    },
  });
}
