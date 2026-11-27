/**
 * `yjs` and `yrs` have to agree on the wire (ADR-0035).
 *
 * The session host is `yrs` and the page is `yjs`. `from-yrs/` is written by
 * a Rust test (`crates/yaz-collab/tests/interop.rs`) and is decoded here; the
 * other direction, `from-yjs/`, is written by `scripts/collab-fixtures.mjs`
 * and decoded in Rust. Both are committed, so a change in either library
 * shows up as a failing test and not as text that drifts between a page and a
 * folder.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

// The tests run from `apps/desktop`; `import.meta.url` is not a file URL under jsdom.
const repository = resolve(process.cwd(), "../..");
const fixture = (set: string, name: string) =>
  new Uint8Array(
    readFileSync(
      `${repository}/crates/yaz-collab/tests/fixtures/${set}/${name}`,
    ),
  );
const expected = JSON.parse(
  new TextDecoder().decode(fixture("from-yrs", "expected.json")),
);

/** A page's document, as the page makes it. */
function pageDoc() {
  const doc = new Y.Doc();
  return { doc, files: doc.getMap<Y.Text>("files"), meta: doc.getMap("meta") };
}

/** One host message: a var-uint tag, then a var-uint-prefixed JSON document. */
function hostMessage(frame: Uint8Array) {
  const decoder = decoding.createDecoder(frame);
  expect(decoding.readVarUint(decoder)).toBe(100);
  return JSON.parse(
    new TextDecoder().decode(decoding.readVarUint8Array(decoder)),
  );
}

describe("a document written by yrs", () => {
  it("reads the same in yjs, counting UTF-16 units", () => {
    const { doc, files, meta } = pageDoc();
    Y.applyUpdate(doc, fixture("from-yrs", "document.bin"));
    for (const [path, text] of Object.entries(expected.document.files)) {
      expect(files.get(path)?.toString()).toBe(text);
    }
    expect(meta.get("schema")).toBe(1);
    expect(meta.get("epoch")).toBe(expected.document.meta.epoch);

    Y.applyUpdate(doc, fixture("from-yrs", "edit.bin"));
    expect(files.get("main.tex")?.toString()).toBe(
      expected.edit.files["main.tex"],
    );
    // The edit is behind an emoji of two units.
    expect(files.get("main.tex")?.toString()).toBe(
      "Grüße 😀 Ünï Weimar\nZweite Zeile\n",
    );
  });

  it("is a Y.Text per file, so that the page can bind it", () => {
    const { doc, files } = pageDoc();
    Y.applyUpdate(doc, fixture("from-yrs", "document.bin"));
    expect(files.get("main.tex")).toBeInstanceOf(Y.Text);
  });
});

describe("the frames of the host", () => {
  it("step 1 and an update are read by y-protocols", () => {
    const { doc, files } = pageDoc();
    Y.applyUpdate(doc, fixture("from-yrs", "document.bin"));

    // Step 1 asks for what the host lacks; y-protocols answers with step 2.
    const step1 = decoding.createDecoder(
      fixture("from-yrs", "frame-step1.bin"),
    );
    expect(decoding.readVarUint(step1)).toBe(0);
    const reply = encoding.createEncoder();
    expect(syncProtocol.readSyncMessage(step1, reply, doc, "host")).toBe(
      syncProtocol.messageYjsSyncStep1,
    );
    expect(encoding.length(reply)).toBeGreaterThan(0);

    const frame = decoding.createDecoder(
      fixture("from-yrs", "frame-update.bin"),
    );
    expect(decoding.readVarUint(frame)).toBe(0);
    syncProtocol.readSyncMessage(frame, encoding.createEncoder(), doc, "host");
    expect(files.get("main.tex")?.toString()).toBe(
      expected.edit.files["main.tex"],
    );
  });

  it("tag 100 carries a JSON document", () => {
    expect(hostMessage(fixture("from-yrs", "host-hello.bin"))).toEqual(
      expected["host-hello"],
    );
    expect(hostMessage(fixture("from-yrs", "host-folder.bin"))).toEqual(
      expected["host-folder"],
    );
  });
});

describe("awareness written by yrs", () => {
  it("reads the same in y-protocols, and its removal removes it", () => {
    const awareness = new awarenessProtocol.Awareness(new Y.Doc());
    const client = expected.awareness.client;
    awarenessProtocol.applyAwarenessUpdate(
      awareness,
      fixture("from-yrs", "awareness.bin"),
      "host",
    );
    expect(awareness.getStates().get(client)).toEqual(expected.awareness.state);
    expect(awareness.meta.get(client)?.clock).toBe(expected.awareness.clock);

    awarenessProtocol.applyAwarenessUpdate(
      awareness,
      fixture("from-yrs", "awareness-removed.bin"),
      "host",
    );
    expect(awareness.getStates().has(client)).toBe(false);
    awareness.destroy();
  });
});

describe("what yjs writes", () => {
  it("is what the committed fixtures say, so the Rust tests read what a page writes", () => {
    // Fails if the library encodes differently than when the fixtures were
    // made; `node scripts/collab-fixtures.mjs` rewrites them.
    execFileSync(process.execPath, [
      `${repository}/scripts/collab-fixtures.mjs`,
      "--check",
    ]);
  });
});
