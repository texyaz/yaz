import { afterEach, describe, expect, it, vi } from "vitest";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";
import { FakeHost } from "./fakeHost";
import { Session, SessionNotReady, minimalEdit } from "./session";

const memory = () => {
  const kept = new Map<string, string>();
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
  };
};

function pageOf(host: FakeHost, flushed: Uint8Array[] = []) {
  return new Session(
    "/work/paper",
    { name: "Ada", email: "ada@example.org" },
    {
      openLink: host.openLink,
      flush: async (_root, vector) => void flushed.push(vector),
      storage: memory(),
    },
  );
}

afterEach(() => vi.useRealTimers());

describe("the provider", () => {
  it("syncs only after the host has said it is ready", async () => {
    const host = new FakeHost();
    host.seed("a.tex", "hello\n");
    const page = pageOf(host);
    expect(page.state).toBe("starting");
    expect(await page.whenReady(1000)).toBe(true);
    expect(page.text("a.tex")).toBe("hello\n");
    expect(page.has("b.tex")).toBe(false);
    // Its first frame to the host was its step 1, after the hello.
    expect(host.received[0]).toBe(0);
    page.destroy();
  });

  it("does not take in a frame that comes before hello", async () => {
    const host = new FakeHost();
    host.state = "starting";
    let deliver: ((frame: Uint8Array) => void) | null = null;
    const page = new Session("/r", null, {
      openLink: () => {
        const link = host.openLink();
        deliver = (frame) => link.onframe?.(frame);
        return link;
      },
      storage: memory(),
    });
    // The host is not allowed to send a sync message ahead of `hello` with
    // `ready`, and a page does not listen to one that does.
    const stranger = new Y.Doc();
    stranger.getMap<Y.Text>("files").set("early.tex", new Y.Text("no"));
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, 0);
    syncProtocol.writeUpdate(frame, Y.encodeStateAsUpdate(stranger));
    deliver!(encoding.toUint8Array(frame));
    expect(page.has("early.tex")).toBe(false);
    page.destroy();
  });

  it("a hello that is not ready holds the sync back and is repeated", async () => {
    const host = new FakeHost();
    host.state = "starting";
    const page = pageOf(host);
    await host.idle();
    expect(page.state).toBe("starting");
    expect(host.received).toEqual([]);
    page.destroy();
  });

  it("refuses a protocol it does not know and does not reconnect", async () => {
    const host = new FakeHost();
    host.protocol = 2;
    const page = pageOf(host);
    expect(await page.whenReady(200)).toBe(false);
    expect(page.state).toBe("incompatible");
    await host.idle();
    expect(host.connections.size).toBe(0);
    page.destroy();
  });

  it("says why a host that shares nothing is unavailable, and stops", async () => {
    const host = new FakeHost();
    host.state = "unavailable";
    host.reason = "error-collab-not-shared";
    const page = pageOf(host);
    expect(await page.whenReady(200)).toBe(false);
    expect(page.state).toBe("unavailable");
    expect(page.reason).toBe("error-collab-not-shared");
    page.destroy();
  });

  it("is unavailable when this build has no link at all", () => {
    const page = new Session("/r", null, {
      openLink: () => null,
      storage: memory(),
    });
    expect(page.state).toBe("unavailable");
    page.destroy();
  });

  it("does not sync into a host that has started afresh", async () => {
    const host = new FakeHost();
    host.seed("a.tex", "one\n");
    const page = pageOf(host);
    await page.whenReady(1000);
    host.restart("epoch-two");
    host.seed("a.tex", "one\n");
    // The page holds a document the new host knows nothing of. Syncing would
    // merge two histories of the same file and double its text.
    await vi.waitFor(() => expect(page.state).toBe("reconnecting"));
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(1100);
    vi.useRealTimers();
    await vi.waitFor(() => expect(page.state).toBe("restarted"));
    expect(page.text("a.tex")).toBe("one\n");
    await host.idle();
    expect(host.connections.size).toBe(0);
    page.destroy();
  });

  it("reconnects with a growing delay and syncs what it typed meanwhile", async () => {
    const host = new FakeHost();
    host.seed("a.tex", "base\n");
    const page = pageOf(host);
    await page.whenReady(1000);

    vi.useFakeTimers();
    const [connection] = [...host.connections];
    connection!.link.onclose?.();
    host.connections.clear();
    expect(page.state).toBe("reconnecting");

    page.replace("a.tex", "base\ntyped offline\n");
    expect(page.unsent).toBe(true);

    await vi.advanceTimersByTimeAsync(999);
    expect(host.connections.size).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(host.connections.size).toBe(1);
    vi.useRealTimers();

    await vi.waitFor(() => expect(page.state).toBe("ready"));
    expect(page.unsent).toBe(false);
    expect(host.text("a.tex")).toBe("base\ntyped offline\n");
    page.destroy();
  });

  it("backs off from one second to thirty", async () => {
    const host = new FakeHost();
    host.state = "unavailable";
    host.reason = "error-collab-unavailable";
    let attempts = 0;
    vi.useFakeTimers();
    const page = new Session("/r", null, {
      openLink: () => {
        attempts += 1;
        return host.openLink();
      },
      storage: memory(),
    });
    // The first try is at once; then 1, 2, 4, 8, 16 s, and 30 s from there on.
    const at = async (seconds: number, expected: number) => {
      await vi.advanceTimersByTimeAsync(seconds * 1000 - (Date.now() - start));
      expect(attempts, `after ${seconds} s`).toBe(expected);
    };
    const start = Date.now();
    await at(0, 1);
    await at(0.9, 1);
    await at(1.1, 2);
    await at(3.1, 3);
    await at(7.1, 4);
    await at(15.1, 5);
    await at(31.1, 6);
    await at(60.9, 6);
    await at(61.1, 7);
    await at(91.1, 8);
    page.destroy();
  });

  it("refuses to flush a page that is not in step with its host", async () => {
    const host = new FakeHost();
    host.state = "starting";
    const page = pageOf(host);
    await expect(page.flush()).rejects.toBeInstanceOf(SessionNotReady);
    page.destroy();
  });

  it("flushes with the state vector of what it holds", async () => {
    const host = new FakeHost();
    host.seed("a.tex", "x\n");
    const flushed: Uint8Array[] = [];
    const page = pageOf(host, flushed);
    await page.whenReady(1000);
    page.replace("a.tex", "x\ny\n");
    await page.flush();
    expect(flushed).toHaveLength(1);
    expect(Array.from(flushed[0]!)).toEqual(
      Array.from(Y.encodeStateVector(page.doc)),
    );
    page.destroy();
  });

  it("changes one page's text on another by the smallest edit", async () => {
    const host = new FakeHost();
    host.seed("a.tex", "Grüße 😀 aus Weimar\n");
    const one = pageOf(host);
    const two = pageOf(host);
    await one.whenReady(1000);
    await two.whenReady(1000);
    let edits = 0;
    two.files.get("a.tex")!.observe((event) => {
      edits += event.delta.length;
    });
    one.replace("a.tex", "Grüße 😀 aus der Stadt Weimar\n");
    await host.idle();
    expect(two.text("a.tex")).toBe("Grüße 😀 aus der Stadt Weimar\n");
    // A retain and an insert, not the whole text again.
    expect(edits).toBeLessThanOrEqual(2);
    one.destroy();
    two.destroy();
  });

  it("tells who else is in the room, in colours every page agrees on", async () => {
    const host = new FakeHost();
    host.seed("a.tex", "x\n");
    const one = new Session(
      "/r",
      { name: "Ada", email: "ada@example.org" },
      {
        openLink: host.openLink,
        storage: memory(),
      },
    );
    const two = new Session(
      "/r",
      { name: "Bo", email: "bo@example.org" },
      {
        openLink: host.openLink,
        storage: memory(),
      },
    );
    await one.whenReady(1000);
    await two.whenReady(1000);
    one.setCaret("a.tex", null);
    await host.idle();
    const seenByTwo = two.peers;
    expect(seenByTwo.map((peer) => peer.user.name)).toEqual(["Ada"]);
    expect(seenByTwo[0]?.file).toBe("a.tex");
    expect(one.peers[0]?.user.name).toBe("Bo");
    // The same colour for Ada on both pages' reckoning.
    expect(two.colourOf(one.self.id)).toBe(seenByTwo[0]?.colour);
    expect(one.colourOf(two.self.id)).not.toBe(one.colourOf(one.self.id));

    one.destroy();
    await host.idle();
    expect(two.peers).toEqual([]);
    two.destroy();
  });

  it("passes on what the host says about the folder", async () => {
    const host = new FakeHost();
    const page = pageOf(host);
    await page.whenReady(1000);
    const heard: unknown[] = [];
    page.onFolder = (report) => heard.push(report);
    host.tell({
      t: "folder",
      imported: ["a.tex"],
      kept: [],
      removed: [],
      refused: [],
    });
    await host.idle();
    expect(heard).toHaveLength(1);
    page.destroy();
  });
});

describe("the smallest edit", () => {
  const apply = (old: string, next: string) => {
    const edit = minimalEdit(old, next);
    if (!edit) return old;
    return (
      old.slice(0, edit.index) +
      edit.insert +
      old.slice(edit.index + edit.remove)
    );
  };

  it("turns one text into the other, in UTF-16 units", () => {
    for (const [old, next] of [
      ["", "x"],
      ["x", ""],
      ["abc", "abc"],
      ["aa", "aaa"],
      ["Grüße 😀 aus Weimar", "Grüße 😀 aus der Stadt Weimar"],
      ["a😀b", "a😁b"],
      ["😀", "😁😀"],
      ["x😀", "x😁"],
    ] as const) {
      expect(apply(old, next)).toBe(next);
    }
  });

  it("never splits a pair of units that make one character", () => {
    const edit = minimalEdit("a\u{1F600}b", "a\u{1F601}b");
    expect(edit).toEqual({ index: 1, remove: 2, insert: "\u{1F601}" });
  });
});
