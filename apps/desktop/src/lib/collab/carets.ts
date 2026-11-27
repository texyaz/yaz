/**
 * The others' carets and selections, as a layer over the editor (ADR-0035).
 *
 * A layer rather than decorations: decorations are a pass the keystroke budget
 * is already spent on (ADR-0015), and a layer is measured against the text
 * where it really is, which is correct inside ranges the rich text view has
 * replaced. `drawSelection()`, already part of the editor, works the same way.
 *
 * A caret in a file that is not in this buffer is not drawn. In a buffer that
 * is several files, a caret is drawn where its file's text is.
 */
import {
  EditorSelection,
  StateEffect,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  RectangleMarker,
  ViewPlugin,
  layer,
  type LayerMarker,
} from "@codemirror/view";
import * as Y from "yjs";
import { fileToBuffer } from "../editor/stitch";
import { mapOf } from "./binding";
import { presenceVariable } from "./colours";
import type { Session } from "./session";

/** Sent when somebody's caret or name changed, so that the layer redraws. */
export const presenceChanged = StateEffect.define<null>();

/** A caret and the flag with the name on it. */
class CaretMarker implements LayerMarker {
  constructor(
    readonly left: number,
    readonly top: number,
    readonly height: number,
    readonly slot: number,
    readonly name: string,
  ) {}

  draw(): HTMLElement {
    const caret = document.createElement("div");
    const flag = document.createElement("span");
    flag.className = "cm-remote-flag";
    caret.append(flag);
    this.place(caret);
    return caret;
  }

  update(caret: HTMLElement, previous: LayerMarker): boolean {
    if (!(previous instanceof CaretMarker)) return false;
    this.place(caret);
    return true;
  }

  eq(other: LayerMarker): boolean {
    return (
      other instanceof CaretMarker &&
      other.left === this.left &&
      other.top === this.top &&
      other.height === this.height &&
      other.slot === this.slot &&
      other.name === this.name
    );
  }

  private place(caret: HTMLElement): void {
    caret.className = "cm-remote-caret";
    caret.style.setProperty(
      "--presence",
      `var(${presenceVariable(this.slot)})`,
    );
    caret.style.left = `${this.left}px`;
    caret.style.top = `${this.top}px`;
    caret.style.height = `${this.height}px`;
    const flag = caret.firstElementChild;
    if (flag) flag.textContent = this.name;
  }
}

/** The absolute offset a relative position stands for in `text`, if it does. */
function indexIn(session: Session, text: Y.Text, json: unknown): number | null {
  if (typeof json !== "object" || json === null) return null;
  try {
    const absolute = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(json),
      session.doc,
    );
    return absolute && absolute.type === text ? absolute.index : null;
  } catch {
    return null;
  }
}

/**
 * Draw the other people's carets.
 *
 * `someone` is what a person with no name is called, in the page's language.
 */
export function remoteCarets(
  session: Session,
  someone: () => string,
): Extension {
  return [
    // Somebody moved, arrived or left: draw again. Told from outside an
    // update, and put off to the end of the current one, because a view cannot
    // be dispatched to while it is being updated.
    ViewPlugin.define((view) => {
      let queued = false;
      let gone = false;
      const stop = session.subscribe(() => {
        if (queued || gone) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          if (!gone) view.dispatch({ effects: presenceChanged.of(null) });
        });
      });
      return {
        destroy() {
          gone = true;
          stop();
        },
      };
    }),
    layer({
      above: true,
      class: "cm-remote-carets",
      update: (update) =>
        update.docChanged ||
        update.viewportChanged ||
        update.geometryChanged ||
        update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(presenceChanged)),
        ),
      markers(view) {
        const map = mapOf(view.state);
        if (map.length === 0) return [];
        const length = view.state.doc.length;
        const scroller = view.scrollDOM.getBoundingClientRect();
        const base = {
          left: scroller.left - view.scrollDOM.scrollLeft,
          top: scroller.top - view.scrollDOM.scrollTop,
        };
        const markers: LayerMarker[] = [];
        for (const peer of session.peers) {
          const text = peer.file === null ? null : session.files.get(peer.file);
          if (peer.file === null || !text) continue;
          const state = session.awareness.getStates().get(peer.clientId) as
            | { cursor?: { anchor?: unknown; head?: unknown } | null }
            | undefined;
          const at = (json: unknown): number | null => {
            const index = indexIn(session, text, json);
            return index === null ? null : fileToBuffer(map, peer.file!, index);
          };
          const head = at(state?.cursor?.head);
          // Not in this buffer, or inside a command it shows as the file named.
          if (head === null) continue;
          const anchor = at(state?.cursor?.anchor) ?? head;
          const range = EditorSelection.range(
            Math.min(anchor, length),
            Math.min(head, length),
          );
          const slot = peer.colour;
          if (!range.empty) {
            markers.push(
              ...RectangleMarker.forRange(
                view,
                `cm-remote-selection cm-presence-${slot + 1}`,
                range,
              ),
            );
          }
          const coords = view.coordsAtPos(range.head, 1);
          if (coords) {
            markers.push(
              new CaretMarker(
                coords.left - base.left,
                coords.top - base.top,
                coords.bottom - coords.top,
                slot,
                peer.user.name || someone(),
              ),
            );
          }
        }
        return markers;
      },
    }),
    presenceTheme,
  ];
}

const slots = Array.from({ length: 8 }, (_, index) => index + 1);

const presenceTheme = EditorView.baseTheme({
  ".cm-remote-caret": {
    position: "absolute",
    width: "0",
    borderInlineStart: "2px solid var(--presence)",
    pointerEvents: "none",
  },
  ".cm-remote-flag": {
    position: "absolute",
    insetBlockEnd: "100%",
    insetInlineStart: "-2px",
    padding: "0 4px",
    borderRadius: "3px 3px 3px 0",
    background: "var(--presence)",
    color: "var(--yaz-text-on-accent)",
    fontFamily: "var(--yaz-font-ui, sans-serif)",
    fontSize: "11px",
    lineHeight: "16px",
    whiteSpace: "nowrap",
  },
  ...Object.fromEntries(
    slots.map((slot) => [
      `.cm-presence-${slot}`,
      {
        background: `color-mix(in srgb, var(--yaz-presence-${slot}) 30%, transparent)`,
      },
    ]),
  ),
});
