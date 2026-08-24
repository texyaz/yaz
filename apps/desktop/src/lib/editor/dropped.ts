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

import { usableImage } from "./pastedImage";
import { EditorView } from "@codemirror/view";

/** A drop, as a handler sees it. */
export interface Dropped {
  /** What the drag carried, keyed by MIME type. */
  flavours: Record<string, string>;
  /**
   * Pictures the drag carried, read before the transfer was emptied.
   *
   * Eagerly, for the same reason the flavours are: a `DataTransfer` is emptied
   * when the drop event returns, so anything an asynchronous handler asks for
   * afterwards is gone.
   */
  images: { type: string; bytes: Uint8Array }[];
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

/**
 * The pseudo-type a drag reports when it carries files.
 *
 * Not a MIME type: `DataTransfer.types` lists `"Files"` for a drag of files,
 * whatever they are, and `getData` on it answers with nothing. A handler names
 * it to say it wants to hear about a drag that is a picture and nothing else.
 */
export const FILES = "Files";

/**
 * The pictures a drag is carrying as files.
 *
 * Zotero puts the image of an image annotation here when the drag comes from
 * the file system side of things.
 */
function imagesOnDrag(transfer: DataTransfer): File[] {
  return [...(transfer.files ?? [])].filter((file) => usableImage(file.type));
}

/**
 * The pictures a drag is carrying *inside its HTML*.
 *
 * The other half of the same problem: a drag can embed a picture as a `data:`
 * URL rather than as a file, and that is what an image annotation dragged out
 * of Zotero turned out to be — so a drag that plainly contained a picture
 * arrived with no files at all, and the whole thing fell through to "identify
 * this by its words", which for a picture is no words. That is why dropping one
 * asked for the source and then produced a citation with nothing to look at.
 *
 * Only `data:` URLs. A `file://` or `zotero://` source names something on the
 * disk that the webview cannot read and that only the Rust side may reach
 * (ADR-0006), so it is left alone rather than half-handled.
 */
function embeddedImages(html: string): { type: string; bytes: Uint8Array }[] {
  if (!html) return [];

  const found: { type: string; bytes: Uint8Array }[] = [];
  // Both quotings, because HTML in a clipboard flavour is written by whatever
  // put it there rather than by a serialiser that agrees with us.
  for (const match of html.matchAll(/<img[^>]*?src=["'](data:[^"']+)["']/gi)) {
    const decoded = decodeDataUrl(match[1] ?? "");
    if (decoded) found.push(decoded);
  }
  return found;
}

/** The bytes behind a base64 `data:` URL, if it is a picture yaz can use. */
export function decodeDataUrl(
  url: string,
): { type: string; bytes: Uint8Array } | null {
  const head = /^data:([^;,]+)(;base64)?,/i.exec(url);
  if (!head) return null;

  const type = (head[1] ?? "").toLowerCase();
  if (!usableImage(type)) return null;
  // Only base64. A percent-encoded `data:` URL holding a PNG is possible, is
  // not a thing anything actually produces, and decoding one wrongly would
  // write a corrupt file rather than fail.
  if (!head[2]) return null;

  try {
    const binary = atob(url.slice(head[0].length));
    const bytes = new Uint8Array(binary.length);
    for (let at = 0; at < binary.length; at += 1) {
      bytes[at] = binary.charCodeAt(at);
    }
    return { type, bytes };
  } catch {
    // A truncated or malformed payload. Nothing to insert is the right answer.
    return null;
  }
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
      // actually present.
      const wanted = new Set(takers.flatMap((taker) => taker.flavours));
      const flavours = flavoursOf(transfer, wanted);

      // Read now, because a `DataTransfer` is emptied the moment this handler
      // returns — and reading a file is asynchronous, so the files themselves
      // have to be held rather than the transfer.
      const carried = imagesOnDrag(transfer);
      const embedded = embeddedImages(flavours["text/html"] ?? "");
      const hasImages = carried.length > 0 || embedded.length > 0;

      const interested = takers.filter(
        (taker) =>
          taker.flavours.some((flavour) => flavours[flavour] !== undefined) ||
          // A drag can be a picture and nothing else — an image annotation out
          // of Zotero is one — and a handler that asked for files should hear
          // about it even though no text flavour arrived.
          (hasImages && taker.flavours.includes(FILES)),
      );
      if (interested.length === 0) return false;

      // From here it is ours: the browser must not also insert the text, and
      // CodeMirror must not handle the drop underneath us.
      event.preventDefault();

      const at =
        view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
        view.state.selection.main.head;
      void (async () => {
        const images = [
          ...(await Promise.all(
            carried.map(async (file) => ({
              type: file.type,
              bytes: new Uint8Array(await file.arrayBuffer()),
            })),
          )),
          ...embedded,
        ];
        const dropped: Dropped = {
          flavours,
          text: flavours["text/plain"] ?? "",
          at,
          images,
        };

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
