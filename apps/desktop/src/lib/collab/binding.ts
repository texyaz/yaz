/**
 * The editor's side of a session (ADR-0035): CodeMirror bound to the shared
 * texts, over the same segment map the stitched view judges edits by.
 *
 * Not `y-codemirror.next`, which binds one `Y.Text` to a whole document and so
 * cannot describe a buffer that is several files with gaps (ADR-0020). A
 * single file is the one-segment case here, and the second step of the design
 * only adds more segments.
 *
 * - **Local to session**, per transaction: the changes are attributed to a
 *   file by {@link mapChanges}, the function the `segments` field and the
 *   shell already use, so the two cannot disagree about whose text it is; then
 *   one Yjs transaction applies each file's changes back to front.
 * - **Session to local**, per event: one CodeMirror transaction, marked as
 *   from the session, as remote, and kept out of the undo history, so that
 *   undo stays CodeMirror's and undoes one's own typing.
 * - **Several files in one buffer** (ADR-0020) are the same thing with more
 *   segments. Somebody else's edit names its file, so it is placed by
 *   {@link fileChangesToBuffer} and carries the map it leaves; one that touches
 *   an `\include` command the buffer has expanded cannot be followed, and the
 *   shell is asked to stitch the buffer again.
 * - **Drift is fail-closed.** When a document is put in the buffer, every
 *   stretch of it must be the shared text it claims to be; after each
 *   application every file must still be as much longer than its stretches as
 *   it was. If not, the binding lets go and says so, and nothing further is
 *   written from a buffer that no longer matches.
 */
import {
  Annotation,
  StateEffect,
  StateField,
  Transaction,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import * as Y from "yjs";
import {
  fileChangesToBuffer,
  locate,
  mapChanges,
  type Change,
  type Segment,
} from "../editor/stitch";
import {
  changesOf,
  segments as segmentsField,
  setSegments,
} from "../editor/stitched";
import type { Session } from "./session";

/** Marks a transaction that came from the session, so it is not sent back. */
export const fromSession = Annotation.define<boolean>();

/**
 * Which file the buffer is, or `null` when it is none that is shared.
 *
 * Sent in the same transaction as the document it describes, which is also how
 * the binding tells a swap of the document, whose changes are not edits, from
 * typing.
 */
export const setBoundFile = StateEffect.define<string | null>();

/** The file the buffer is bound to. */
export const boundFile = StateField.define<string | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setBoundFile)) return effect.value;
    }
    return value;
  },
});

/**
 * Which shared file every offset of the buffer is.
 *
 * The stitched map when there is one. A single file is one segment that is the
 * whole buffer; a buffer that is no shared file has none.
 */
export function mapOf(state: EditorState): readonly Segment[] {
  const map = state.field(segmentsField, false) ?? [];
  if (map.length > 0) return map;
  const file = state.field(boundFile, false) ?? null;
  return file === null
    ? []
    : [{ file, from: 0, to: state.doc.length, fileFrom: 0, depth: 0 }];
}

/** What the binding tells the shell. */
export interface BindingEvents {
  /** The shared text changed in a way the buffer cannot follow: rebuild it. */
  restitch(): void;
  /** The buffer and the shared text disagree: stop writing. */
  drift(): void;
  /** Where the segments of the buffer are now, when the binding moved them. */
  segments?(segments: Segment[]): void;
}

/** The origin of the binding's own Yjs transactions, which it does not hear. */
const bindingOrigin = Symbol("yaz-collab-binding");

/** The changes of a delta to one file, in that file's coordinates before it. */
export function changesOfDelta(
  delta: readonly {
    insert?: unknown;
    delete?: number | undefined;
    retain?: number | undefined;
  }[],
): Change[] {
  const changes: Change[] = [];
  let position = 0;
  for (const operation of delta) {
    if (typeof operation.retain === "number") {
      position += operation.retain;
    } else if (typeof operation.delete === "number") {
      changes.push({
        from: position,
        to: position + operation.delete,
        insert: "",
      });
      position += operation.delete;
    } else if (typeof operation.insert === "string") {
      changes.push({ from: position, to: position, insert: operation.insert });
    }
  }
  return changes;
}

/**
 * Where each file's changes go in its shared text: back to front, so that an
 * earlier change does not move a later one.
 */
function applyToText(text: Y.Text, changes: readonly Change[]): void {
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    if (change.to > change.from)
      text.delete(change.from, change.to - change.from);
    if (change.insert) text.insert(change.from, change.insert);
  }
}

/** A caret in a file's text, as a Yjs relative position. */
export function caretOf(text: Y.Text, anchor: number, head: number) {
  return {
    anchor: Y.relativePositionToJSON(
      Y.createRelativePositionFromTypeIndex(text, anchor),
    ),
    head: Y.relativePositionToJSON(
      Y.createRelativePositionFromTypeIndex(text, head),
    ),
  };
}

class Binding {
  private detached = false;
  /**
   * Set from asking for the buffer to be built again until it has been: what
   * the session says in between is already in the text the new buffer is
   * built from, and the old map cannot place it.
   */
  private stale = false;
  /**
   * How much of each file the buffer does not show: the `\include` commands
   * it replaced by the files they name. Nothing typed in the buffer and
   * nothing the binding can follow changes it, which is what makes it the
   * measure of drift.
   */
  private hidden = new Map<string, number>();

  constructor(
    private readonly view: EditorView,
    private readonly session: Session,
    private readonly on: BindingEvents,
  ) {
    session.files.observeDeep(this.onSession);
    this.rebase(view.state);
  }

  update(update: ViewUpdate): void {
    if (this.detached) return;
    let sent = false;
    for (const transaction of update.transactions) {
      if (transaction.annotation(fromSession)) continue;
      const swapped = transaction.effects.some(
        (effect) => effect.is(setBoundFile) || effect.is(setSegments),
      );
      if (swapped) {
        // The document or its map was replaced by what the shell built from
        // the shared texts; none of it is an edit.
        this.rebase(transaction.state);
        continue;
      }
      if (transaction.docChanged) {
        this.toSession(transaction);
        sent = true;
      }
    }
    if (this.detached) return;
    if (sent) this.check();
    if (update.docChanged && update.state.field(segmentsField).length > 0) {
      this.on.segments?.(update.state.field(segmentsField));
    }
    if (update.selectionSet || update.docChanged || update.focusChanged) {
      this.publishCaret();
    }
  }

  destroy(): void {
    this.session.files.unobserveDeep(this.onSession);
    this.session.setCaret(null, null);
  }

  // --- local to session ------------------------------------------------------

  private toSession(transaction: Transaction): void {
    const map = mapOf(transaction.startState);
    // Typing into a buffer that is no shared text, or one that is being built
    // again, has nowhere to go.
    if (map.length === 0 || this.stale) return this.drifted();
    const mapped = mapChanges(map, changesOf(transaction));
    if (!("byFile" in mapped)) return this.drifted();
    for (const path of mapped.byFile.keys()) {
      if (!this.session.files.has(path)) return this.drifted();
    }

    this.session.doc.transact(() => {
      for (const [path, changes] of mapped.byFile) {
        applyToText(this.session.files.get(path)!, changes);
      }
    }, bindingOrigin);
  }

  // --- session to local ------------------------------------------------------

  private readonly onSession = (
    events: Y.YEvent<Y.AbstractType<unknown>>[],
    transaction: Y.Transaction,
  ): void => {
    if (transaction.origin === bindingOrigin || this.detached || this.stale) {
      return;
    }
    const map = mapOf(this.view.state);
    if (map.length === 0) return;
    const shown = new Set(map.map((segment) => segment.file));

    // An entry replaced or removed: the buffer holds text of a file that is
    // no longer the one the session has under that name.
    for (const event of events) {
      if (event.target !== this.session.files) continue;
      if (!(event instanceof Y.YMapEvent)) continue;
      for (const key of event.keysChanged) {
        if (shown.has(key)) return this.restitch();
      }
    }

    const byFile = new Map<string, Change[]>();
    for (const event of events) {
      if (!(event instanceof Y.YTextEvent)) continue;
      const file = event.path[0];
      if (typeof file !== "string" || !shown.has(file)) continue;
      const changes = changesOfDelta(event.delta);
      if (changes.length > 0) byFile.set(file, changes);
    }
    if (byFile.size === 0) return;

    const placed = fileChangesToBuffer(map, byFile);
    // In a command the buffer replaced by the file it names.
    if (!placed) return this.restitch();

    const stitchedMap = this.view.state.field(segmentsField).length > 0;
    this.view.dispatch({
      changes: placed.changes,
      // With the map the change leaves: the file is known here, and the map
      // moving itself would have to guess it at a seam.
      effects: stitchedMap ? [setSegments.of(placed.segments)] : [],
      annotations: [
        fromSession.of(true),
        Transaction.remote.of(true),
        Transaction.addToHistory.of(false),
      ],
    });
    this.check();
  };

  private restitch(): void {
    this.stale = true;
    this.on.restitch();
  }

  // --- keeping honest --------------------------------------------------------

  /** Take the buffer as it is now for the shared texts, after checking it is. */
  private rebase(state: EditorState): void {
    this.stale = false;
    this.hidden = new Map();
    const map = mapOf(state);
    const texts = new Map<string, string>();
    const shown = new Map<string, number>();
    for (const segment of map) {
      let text = texts.get(segment.file);
      if (text === undefined) {
        const shared = this.session.files.get(segment.file);
        if (!shared) return this.drifted();
        text = shared.toString();
        texts.set(segment.file, text);
      }
      const length = segment.to - segment.from;
      if (
        text.slice(segment.fileFrom, segment.fileFrom + length) !==
        state.sliceDoc(segment.from, segment.to)
      ) {
        return this.drifted();
      }
      shown.set(segment.file, (shown.get(segment.file) ?? 0) + length);
    }
    for (const [file, length] of shown) {
      this.hidden.set(file, texts.get(file)!.length - length);
    }
    this.publishCaret();
  }

  private check(): void {
    const state = this.view.state;
    const map = mapOf(state);
    const shown = new Map<string, number>();
    let end = 0;
    for (const segment of map) {
      if (segment.from !== end) return this.drifted();
      end = segment.to;
      shown.set(
        segment.file,
        (shown.get(segment.file) ?? 0) + (segment.to - segment.from),
      );
    }
    if (map.length > 0 && end !== state.doc.length) return this.drifted();
    for (const [file, length] of shown) {
      const text = this.session.files.get(file);
      if (!text || text.length - length !== this.hidden.get(file)) {
        return this.drifted();
      }
    }
  }

  private drifted(): void {
    if (this.detached) return;
    this.detached = true;
    this.on.drift();
  }

  private publishCaret(): void {
    if (this.detached || this.stale) return;
    const state = this.view.state;
    const map = mapOf(state);
    const range = state.selection.main;
    const head = locate(map, range.head);
    const text = head ? this.session.files.get(head.file) : undefined;
    if (!head || !text) return;
    // A caret is in one file. A selection that began in another is published
    // as the caret alone.
    const anchor = locate(map, range.anchor);
    const from =
      anchor && anchor.file === head.file ? anchor.offset : head.offset;
    this.session.setCaret(
      head.file,
      caretOf(
        text,
        Math.min(from, text.length),
        Math.min(head.offset, text.length),
      ),
    );
  }
}

/** Bind the editor to a session. Put it in a compartment; reconfigure to unbind. */
export function collabBinding(session: Session, on: BindingEvents): Extension {
  return ViewPlugin.define((view) => new Binding(view, session, on));
}
