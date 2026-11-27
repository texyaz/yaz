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
 * - **Drift is fail-closed.** After each application the buffer's length must
 *   equal the shared text's. If it does not, the binding lets go and says so,
 *   and nothing further is written from a buffer that no longer matches.
 */
import {
  Annotation,
  StateEffect,
  StateField,
  Transaction,
  type ChangeSpec,
  type Extension,
} from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import * as Y from "yjs";
import { mapChanges, type Change, type Segment } from "../editor/stitch";
import { changesOf, segments as segmentsField } from "../editor/stitched";
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

/** The changes of a delta, as CodeMirror's specs in the old document's coordinates. */
export function specsOfDelta(
  delta: readonly {
    insert?: unknown;
    delete?: number | undefined;
    retain?: number | undefined;
  }[],
): ChangeSpec[] {
  const specs: ChangeSpec[] = [];
  let position = 0;
  for (const operation of delta) {
    if (typeof operation.retain === "number") {
      position += operation.retain;
    } else if (typeof operation.delete === "number") {
      specs.push({ from: position, to: position + operation.delete });
      position += operation.delete;
    } else if (typeof operation.insert === "string") {
      specs.push({ from: position, insert: operation.insert });
    }
  }
  return specs;
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
  private bound: string | null = null;
  private text: Y.Text | null = null;
  private detached = false;

  constructor(
    private readonly view: EditorView,
    private readonly session: Session,
    private readonly on: BindingEvents,
  ) {
    session.files.observe(this.onFiles);
    this.attach(view.state.field(boundFile));
  }

  update(update: ViewUpdate): void {
    if (this.detached) return;
    for (const transaction of update.transactions) {
      const swapped = transaction.effects.some((effect) =>
        effect.is(setBoundFile),
      );
      if (swapped) {
        // The document was replaced by the bound file's text; none of it is
        // an edit.
        this.attach(transaction.state.field(boundFile));
        continue;
      }
      if (transaction.docChanged && !transaction.annotation(fromSession)) {
        this.toSession(transaction, transaction.startState.field(boundFile));
      }
    }
    if (update.selectionSet || update.docChanged || update.focusChanged) {
      this.publishCaret();
    }
  }

  destroy(): void {
    this.session.files.unobserve(this.onFiles);
    this.text?.unobserve(this.onText);
    this.session.setCaret(null, null);
  }

  // --- local to session ------------------------------------------------------

  private toSession(transaction: Transaction, file: string | null): void {
    if (file === null) return;
    const text = this.session.files.get(file);
    if (!text) return this.drifted();

    // Single file: one segment that is the whole buffer. A stitched buffer's
    // own map is the same function's input.
    const map = transaction.startState.field(segmentsField);
    const known: readonly Segment[] =
      map.length > 0
        ? map
        : [
            {
              file,
              from: 0,
              to: transaction.startState.doc.length,
              fileFrom: 0,
              depth: 0,
            },
          ];
    const mapped = mapChanges(known, changesOf(transaction));
    if (!("byFile" in mapped)) return this.drifted();

    this.session.doc.transact(() => {
      for (const [path, changes] of mapped.byFile) {
        const target = this.session.files.get(path);
        if (target) applyToText(target, changes);
      }
    }, bindingOrigin);
    this.check();
  }

  // --- session to local ------------------------------------------------------

  private attach(file: string | null): void {
    this.text?.unobserve(this.onText);
    this.bound = file;
    this.text = file === null ? null : (this.session.files.get(file) ?? null);
    this.text?.observe(this.onText);
    if (file !== null && this.text === null) this.drifted();
    this.publishCaret();
  }

  private readonly onText = (
    event: Y.YTextEvent,
    transaction: Y.Transaction,
  ): void => {
    if (transaction.origin === bindingOrigin || this.detached) return;
    const changes = specsOfDelta(event.delta);
    if (changes.length === 0) return;
    this.view.dispatch({
      changes,
      annotations: [
        fromSession.of(true),
        Transaction.remote.of(true),
        Transaction.addToHistory.of(false),
      ],
    });
    this.check();
  };

  /** An entry for the bound file replaced or removed: the buffer is not its text. */
  private readonly onFiles = (event: Y.YMapEvent<Y.Text>): void => {
    if (this.bound === null || !event.keysChanged.has(this.bound)) return;
    if (this.session.files.get(this.bound) === this.text) return;
    this.on.restitch();
  };

  // --- keeping honest --------------------------------------------------------

  private check(): void {
    if (this.text && this.view.state.doc.length !== this.text.length) {
      this.drifted();
    }
  }

  private drifted(): void {
    if (this.detached) return;
    this.detached = true;
    this.text?.unobserve(this.onText);
    this.on.drift();
  }

  private publishCaret(): void {
    if (this.detached || this.bound === null || !this.text) return;
    const range = this.view.state.selection.main;
    const length = this.text.length;
    this.session.setCaret(
      this.bound,
      caretOf(
        this.text,
        Math.min(range.anchor, length),
        Math.min(range.head, length),
      ),
    );
  }
}

/** Bind the editor to a session. Put it in a compartment; reconfigure to unbind. */
export function collabBinding(session: Session, on: BindingEvents): Extension {
  return ViewPlugin.define((view) => new Binding(view, session, on));
}
