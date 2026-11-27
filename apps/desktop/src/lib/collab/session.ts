/**
 * A page's side of a collaboration session (ADR-0035).
 *
 * One `Y.Doc` per project, with `files` (path to `Y.Text`, `\n` line endings)
 * and `meta` (the schema and the session's epoch), kept in step with the
 * session host over a link. The page never writes a shared file: the host does,
 * from its replica, and `flush` asks it to do so now.
 *
 * This is the provider, and it is deliberately not `y-websocket`. The link
 * carries a first message from the host (`hello`) that says whether the
 * session is ready and which epoch it is, and nothing is synced before it; a
 * page that synced under one epoch never syncs under another, because a host
 * that started afresh holds a different history and a merge would double the
 * text. Reconnecting backs off from one second to thirty.
 */
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";
import * as ipc from "../ipc";
import type { Person } from "../person";
import { presenceColours } from "./colours";
import { openLink as defaultOpenLink, type Link } from "./link";
import { userFor, userIn, type Peer, type PresenceUser } from "./presence";

/** Where the session stands, for the title bar and the editor. */
export type SessionState =
  | "starting"
  | "ready"
  | "reconnecting"
  | "unavailable"
  | "restarted"
  | "incompatible";

/** The version of the link's contract this page speaks. */
const LINK_PROTOCOL = 1;
const TAG_SYNC = 0;
const TAG_AWARENESS = 1;
const TAG_HOST = 100;

/** The reason a host gives when it shares nothing: no use trying again. */
const NOT_SHARED = "error-collab-not-shared";

/** A caret, as it is published: Yjs relative positions in a file's text. */
export interface Caret {
  anchor: Y.RelativePosition;
  head: Y.RelativePosition;
}

/** What the page can be told about the folder. */
export type FolderReport = ipc.FolderReport;

/** What a session needs from outside, so that a test can bring its own. */
export interface SessionOptions {
  openLink?: (root: string) => Link | null;
  flush?: (root: string, stateVector: Uint8Array) => Promise<unknown>;
  storage?: Pick<Storage, "getItem" | "setItem">;
}

/** Thrown when a flush is asked of a session that is not in step with its host. */
export class SessionNotReady extends Error {
  constructor() {
    super("the session is not connected to its host");
  }
}

/** The origin of changes that come from the host, so they are not sent back. */
const REMOTE = Symbol("yaz-collab-remote");

export class Session {
  readonly doc = new Y.Doc();
  readonly files = this.doc.getMap<Y.Text>("files");
  readonly meta = this.doc.getMap<unknown>("meta");
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly self: PresenceUser;

  state: SessionState = "starting";
  /** The message key that says why the session is not available. */
  reason: string | null = null;
  /** Whether this page holds changes its host has not been sent. */
  unsent = false;
  /** Called with what happened to the folder behind the session's back. */
  onFolder: ((report: FolderReport) => void) | null = null;
  /** Called when somebody's compile of the project finished. */
  onCompiled: ((succeeded: boolean) => void) | null = null;

  private link: Link | null = null;
  private epoch: string | null = null;
  /** Whether the host has said `ready` on the link that is open. */
  private hosted = false;
  private synced = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;
  private readonly listeners = new Set<() => void>();
  private readonly options: Required<SessionOptions>;

  constructor(
    readonly root: string,
    person: Person | null,
    options: SessionOptions = {},
  ) {
    this.options = {
      openLink: options.openLink ?? defaultOpenLink,
      flush: options.flush ?? ((root, vector) => ipc.collabFlush(root, vector)),
      storage: options.storage ?? sessionStorage,
    };
    this.self = userFor(person, this.options.storage);
    this.awareness.setLocalState({ user: this.self, file: null, cursor: null });
    this.doc.on("update", this.onUpdate);
    this.awareness.on("update", this.onAwareness);
    this.awareness.on("change", () => this.notify());
    // A file entering or leaving the session, not typing in one: the editor
    // hears about that from its own binding.
    this.files.observe(() => this.notify());
    this.connect();
  }

  // --- what the page reads ---------------------------------------------------

  /** The others in the session, each with the colour every page gives them. */
  get peers(): Peer[] {
    const others: {
      clientId: number;
      user: PresenceUser;
      file: string | null;
    }[] = [];
    for (const [clientId, state] of this.awareness.getStates()) {
      if (clientId === this.doc.clientID) continue;
      const user = userIn(state);
      if (!user) continue;
      const file = (state as { file?: unknown }).file;
      others.push({
        clientId,
        user,
        file: typeof file === "string" ? file : null,
      });
    }
    const colours = presenceColours([
      this.self.id,
      ...others.map((peer) => peer.user.id),
    ]);
    return others
      .map((peer) => ({ ...peer, colour: colours.get(peer.user.id) ?? 0 }))
      .sort((a, b) => a.clientId - b.clientId);
  }

  /** The colour slot of an identity, by the rule every page applies. */
  colourOf(id: string): number {
    const ids = [this.self.id, ...this.peers.map((peer) => peer.user.id), id];
    return presenceColours(ids).get(id) ?? 0;
  }

  has(path: string): boolean {
    return this.files.has(path);
  }

  /** A shared file's text, or `null` when it is not in the session. */
  text(path: string): string | null {
    return this.files.get(path)?.toString() ?? null;
  }

  /** Where somebody's caret is: the file, and the offset in its text. */
  caretOf(clientId: number): { file: string; index: number } | null {
    const state = this.awareness.getStates().get(clientId) as
      { file?: unknown; cursor?: { head?: unknown } | null } | undefined;
    const file = state?.file;
    const head = state?.cursor?.head;
    const text = typeof file === "string" ? this.files.get(file) : undefined;
    if (typeof file !== "string" || !text) return null;
    if (typeof head !== "object" || head === null) return null;
    try {
      const absolute = Y.createAbsolutePositionFromRelativePosition(
        Y.createRelativePositionFromJSON(head),
        this.doc,
      );
      return absolute && absolute.type === text
        ? { file, index: absolute.index }
        : null;
    } catch {
      return null;
    }
  }

  /** Be told when the state, the peers or the files change. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Resolves true once `path` is a shared file, false if it is not within `ms`.
   * A file made a moment ago is the host's to find and take in.
   */
  whenShared(path: string, ms: number): Promise<boolean> {
    if (this.has(path)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (value: boolean) => {
        clearTimeout(timeout);
        stop();
        resolve(value);
      };
      const timeout = setTimeout(() => done(false), ms);
      const stop = this.subscribe(() => {
        if (this.has(path)) done(true);
      });
    });
  }

  /** Resolves true once the session is in step with its host, false if it cannot be. */
  whenReady(ms: number): Promise<boolean> {
    if (this.state === "ready") return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (value: boolean) => {
        clearTimeout(timeout);
        stop();
        resolve(value);
      };
      const timeout = setTimeout(() => done(false), ms);
      const stop = this.subscribe(() => {
        if (this.state === "ready") done(true);
        else if (this.isTerminal()) done(false);
      });
    });
  }

  // --- what the page does ----------------------------------------------------

  /**
   * Replace a shared file's text, as a person typing would: by the smallest
   * edit, so that everybody else's caret in the text that did not change stays
   * where it is. Returns false for a file that is not in the session.
   */
  replace(path: string, next: string): boolean {
    const text = this.files.get(path);
    if (!text) return false;
    const edit = minimalEdit(text.toString(), next);
    if (!edit) return true;
    this.doc.transact(() => {
      if (edit.remove > 0) text.delete(edit.index, edit.remove);
      if (edit.insert) text.insert(edit.index, edit.insert);
    }, "store");
    return true;
  }

  /** Say which file the caret is in and where, or that there is none. */
  setCaret(file: string | null, caret: Caret | null): void {
    const current = this.awareness.getLocalState() ?? {};
    const same =
      (current as { file?: unknown }).file === file &&
      JSON.stringify((current as { cursor?: unknown }).cursor ?? null) ===
        JSON.stringify(caret);
    if (same) return;
    this.awareness.setLocalState({
      ...current,
      user: this.self,
      file,
      cursor: caret,
    });
  }

  /**
   * Have the host bring the folder up to date with everything this page has
   * seen. Refused when the page is not in step with its host: nothing is to be
   * compiled or recorded against a folder the typing has not reached.
   */
  async flush(): Promise<void> {
    if (this.state !== "ready" || !this.synced) throw new SessionNotReady();
    await this.options.flush(this.root, Y.encodeStateVector(this.doc));
  }

  destroy(): void {
    if (this.destroyed) return;
    // Leave the room: others should not see a caret that stays.
    awarenessProtocol.removeAwarenessStates(
      this.awareness,
      [this.doc.clientID],
      "destroy",
    );
    this.destroyed = true;
    clearTimeout(this.timer);
    this.link?.close();
    this.link = null;
    this.listeners.clear();
    this.awareness.destroy();
    this.doc.destroy();
  }

  // --- the link --------------------------------------------------------------

  private isTerminal(): boolean {
    return (
      (this.state === "unavailable" && this.reason === NOT_SHARED) ||
      this.state === "restarted" ||
      this.state === "incompatible"
    );
  }

  private setState(state: SessionState, reason: string | null = null): void {
    this.state = state;
    this.reason = reason;
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private connect(): void {
    if (this.destroyed) return;
    const link = this.options.openLink(this.root);
    if (!link) {
      this.setState("unavailable", NOT_SHARED);
      return;
    }
    this.link = link;
    this.hosted = false;
    this.synced = false;
    link.onframe = (frame) => this.receive(link, frame);
    link.onclose = () => this.closed(link);
  }

  private closed(link: Link): void {
    if (this.link !== link) return;
    this.link = null;
    this.hosted = false;
    this.synced = false;
    if (this.destroyed || this.isTerminal()) return;
    if (this.state !== "unavailable") this.setState("reconnecting");
    const delay = Math.min(30_000, 1000 * 2 ** this.attempt);
    this.attempt += 1;
    this.timer = setTimeout(() => this.connect(), delay);
  }

  private send(frame: Uint8Array): void {
    if (this.link && this.hosted) this.link.send(frame);
  }

  private receive(link: Link, frame: Uint8Array): void {
    if (this.link !== link || this.destroyed) return;
    const decoder = decoding.createDecoder(frame);
    const tag = decoding.readVarUint(decoder);
    if (tag === TAG_HOST) {
      this.fromHost(link, decoding.readVarUint8Array(decoder));
      return;
    }
    // Nothing is synced before `hello` has said the session is ready.
    if (!this.hosted) return;
    if (tag === TAG_SYNC) {
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, TAG_SYNC);
      const kind = syncProtocol.readSyncMessage(
        decoder,
        reply,
        this.doc,
        REMOTE,
      );
      if (encoding.length(reply) > 1) this.send(encoding.toUint8Array(reply));
      if (kind === syncProtocol.messageYjsSyncStep2 && !this.synced) {
        this.synced = true;
        this.unsent = false;
        this.setState("ready");
      }
    } else if (tag === TAG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        decoding.readVarUint8Array(decoder),
        REMOTE,
      );
    }
  }

  private fromHost(link: Link, bytes: Uint8Array): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return;
    }
    switch (message.t) {
      case "hello":
        this.hello(link, message);
        break;
      case "folder":
        this.onFolder?.(message as unknown as FolderReport);
        break;
      case "compiled":
        this.onCompiled?.(message.succeeded === true);
        break;
      default:
        // `upstream` is for the interface of a later step.
        break;
    }
  }

  private hello(link: Link, message: Record<string, unknown>): void {
    if (message.protocol !== LINK_PROTOCOL) {
      // A host that speaks another version: the page is the one to reload.
      this.setState("incompatible");
      link.close();
      return;
    }
    if (message.state === "unavailable") {
      const reason = typeof message.reason === "string" ? message.reason : null;
      this.setState("unavailable", reason);
      link.close();
      return;
    }
    if (message.state !== "ready") {
      this.setState("starting");
      return;
    }
    const epoch = typeof message.epoch === "string" ? message.epoch : "";
    if (this.epoch !== null && this.epoch !== epoch) {
      // The host started afresh. Merging this page's history into it would
      // put the text there twice, so it does not sync: with nothing unsent
      // the shell opens a new session, otherwise the text stays on screen.
      this.setState("restarted");
      link.close();
      return;
    }
    this.epoch = epoch;
    this.hosted = true;
    this.attempt = 0;

    const step1 = encoding.createEncoder();
    encoding.writeVarUint(step1, TAG_SYNC);
    syncProtocol.writeSyncStep1(step1, this.doc);
    this.send(encoding.toUint8Array(step1));
    this.sendAwareness([this.doc.clientID]);
  }

  // --- what this page sends --------------------------------------------------

  private readonly onUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === REMOTE) return;
    if (this.link && this.hosted) {
      const frame = encoding.createEncoder();
      encoding.writeVarUint(frame, TAG_SYNC);
      syncProtocol.writeUpdate(frame, update);
      this.send(encoding.toUint8Array(frame));
    } else {
      // Kept in the document, and sent as part of the sync when the link is
      // back; until then the page has to say that it holds unsent text.
      this.unsent = true;
      this.notify();
    }
  };

  private readonly onAwareness = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (origin === REMOTE) return;
    this.sendAwareness([
      ...changes.added,
      ...changes.updated,
      ...changes.removed,
    ]);
  };

  private sendAwareness(clients: number[]): void {
    if (clients.length === 0) return;
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, TAG_AWARENESS);
    encoding.writeVarUint8Array(
      frame,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients),
    );
    this.send(encoding.toUint8Array(frame));
  }
}

/** Open the session of a project. */
export function openSession(
  root: string,
  person: Person | null,
  options?: SessionOptions,
): Session {
  return new Session(root, person, options);
}

/** The smallest single replacement that turns `old` into `next`, in UTF-16 units. */
export function minimalEdit(
  old: string,
  next: string,
): { index: number; remove: number; insert: string } | null {
  if (old === next) return null;
  // On code points, not units: Yjs replaces half of a surrogate pair it is
  // asked to split.
  const before = Array.from(old);
  const after = Array.from(next);
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const units = (points: string[]) => points.join("").length;
  return {
    index: units(before.slice(0, prefix)),
    remove: units(before.slice(prefix, before.length - suffix)),
    insert: after.slice(prefix, after.length - suffix).join(""),
  };
}
