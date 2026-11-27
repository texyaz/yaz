/**
 * A session host for tests: a `Y.Doc` and a relay, speaking the link's frames.
 *
 * It does what the Rust host does on the wire and nothing else: `hello` first,
 * its own step 1, step 2 for a page's step 1, updates and awareness forwarded
 * to every other page. No folder, no timers.
 */
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";
import type { Link } from "./link";

interface Connection {
  link: Link;
  /** The awareness clients this page has spoken for. */
  clients: Set<number>;
}

export class FakeHost {
  doc = new Y.Doc();
  awareness = new awarenessProtocol.Awareness(this.doc);
  epoch = "epoch-one";
  protocol = 1;
  state: "ready" | "starting" | "unavailable" = "ready";
  reason: string | undefined = undefined;
  readonly connections = new Set<Connection>();
  /** Every frame a page sent, by its first byte. */
  readonly received: number[] = [];
  private pending = 0;

  constructor() {
    this.awareness.setLocalState(null);
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      const frame = encoding.createEncoder();
      encoding.writeVarUint(frame, 0);
      syncProtocol.writeUpdate(frame, update);
      this.broadcast(encoding.toUint8Array(frame), origin as Connection | null);
    });
  }

  /** Put text in a file as the host does when it takes a file in. */
  seed(path: string, text: string): void {
    this.doc.getMap<Y.Text>("files").set(path, new Y.Text(text));
  }

  text(path: string): string | undefined {
    return this.doc.getMap<Y.Text>("files").get(path)?.toString();
  }

  /** The function a session is given as its way to open a link. */
  readonly openLink = (): Link => {
    const link: Link = {
      send: (frame) => this.receive(connection, frame),
      close: () => this.drop(connection),
      onopen: null,
      onframe: null,
      onclose: null,
    };
    const connection: Connection = { link, clients: new Set() };
    this.connections.add(connection);
    // After the page has hung its handlers on the link.
    this.later(() => {
      this.deliver(connection, this.helloFrame());
      if (this.state !== "ready") return;
      const step1 = encoding.createEncoder();
      encoding.writeVarUint(step1, 0);
      syncProtocol.writeSyncStep1(step1, this.doc);
      this.deliver(connection, encoding.toUint8Array(step1));
      const states = [...this.awareness.getStates().keys()];
      if (states.length > 0) this.deliverAwareness(connection, states);
    });
    return link;
  };

  helloFrame(): Uint8Array {
    const json = JSON.stringify({
      t: "hello",
      protocol: this.protocol,
      epoch: this.epoch,
      state: this.state,
      ...(this.reason ? { reason: this.reason } : {}),
    });
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, 100);
    encoding.writeVarUint8Array(frame, new TextEncoder().encode(json));
    return encoding.toUint8Array(frame);
  }

  /** Say something to every page, as tag 100. */
  tell(message: object): void {
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, 100);
    encoding.writeVarUint8Array(
      frame,
      new TextEncoder().encode(JSON.stringify(message)),
    );
    this.broadcast(encoding.toUint8Array(frame), null);
  }

  /** The host starts afresh: a new document, a new epoch, every link closed. */
  restart(epoch: string): void {
    this.doc = new Y.Doc();
    this.epoch = epoch;
    for (const connection of [...this.connections]) this.drop(connection, true);
  }

  /** Let everything that was queued be delivered. */
  async idle(): Promise<void> {
    while (this.pending > 0)
      await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // --- what a page sends ----------------------------------------------------

  private receive(connection: Connection, frame: Uint8Array): void {
    this.received.push(frame[0] ?? -1);
    const decoder = decoding.createDecoder(frame);
    const tag = decoding.readVarUint(decoder);
    if (tag === 0) {
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, 0);
      syncProtocol.readSyncMessage(decoder, reply, this.doc, connection);
      if (encoding.length(reply) > 1) {
        this.deliver(connection, encoding.toUint8Array(reply));
      }
    } else if (tag === 1) {
      const update = decoding.readVarUint8Array(decoder);
      const changes: number[] = [];
      const listener = (found: {
        added: number[];
        updated: number[];
        removed: number[];
      }) => changes.push(...found.added, ...found.updated, ...found.removed);
      this.awareness.on("update", listener);
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        update,
        connection,
      );
      this.awareness.off("update", listener);
      for (const client of changes) connection.clients.add(client);
      if (changes.length > 0) this.broadcastAwareness(changes, connection);
    }
  }

  private drop(connection: Connection, restarting = false): void {
    if (!this.connections.delete(connection)) return;
    if (!restarting && connection.clients.size > 0) {
      const gone = [...connection.clients];
      awarenessProtocol.removeAwarenessStates(this.awareness, gone, "closed");
      this.broadcastAwareness(gone, null);
    }
    this.later(() => connection.link.onclose?.());
  }

  // --- what it sends -----------------------------------------------------------

  private broadcast(frame: Uint8Array, except: Connection | null): void {
    for (const connection of this.connections) {
      if (connection !== except) this.deliver(connection, frame);
    }
  }

  private broadcastAwareness(
    clients: number[],
    except: Connection | null,
  ): void {
    for (const connection of this.connections) {
      if (connection !== except) this.deliverAwareness(connection, clients);
    }
  }

  private deliverAwareness(connection: Connection, clients: number[]): void {
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, 1);
    encoding.writeVarUint8Array(
      frame,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients),
    );
    this.deliver(connection, encoding.toUint8Array(frame));
  }

  private deliver(connection: Connection, frame: Uint8Array): void {
    this.later(() => {
      if (this.connections.has(connection)) connection.link.onframe?.(frame);
    });
  }

  private later(run: () => void): void {
    this.pending += 1;
    queueMicrotask(() => {
      this.pending -= 1;
      run();
    });
  }
}
