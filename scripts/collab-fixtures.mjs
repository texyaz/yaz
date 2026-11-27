#!/usr/bin/env node
/**
 * The Yjs side of the interop fixtures of the session host (ADR-0035).
 *
 * The host is `yrs` in Rust and the page is `yjs` in JavaScript, and the two
 * have to agree byte for byte on what a project's shared document looks like
 * on the wire. This writes what `yjs` and `y-protocols` encode into
 * `crates/yaz-collab/tests/fixtures/from-yjs/`, where a Rust test decodes it
 * and checks it says what `expected.json` says. The other direction is a Rust
 * test that writes `from-yrs/`, and a Vitest test in the desktop app that
 * decodes it.
 *
 *   node scripts/collab-fixtures.mjs          write the fixtures
 *   node scripts/collab-fixtures.mjs --check  fail if the files differ
 *
 * The encoding is deterministic once the client ids are fixed, so a file that
 * differs from what this produces is a change in the library, and worth a
 * look before it reaches a page.
 */

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const directory = join(
  here,
  "..",
  "crates",
  "yaz-collab",
  "tests",
  "fixtures",
  "from-yjs",
);

// The libraries are the desktop app's, so there is one copy of each.
const requireFromApp = createRequire(
  join(here, "..", "apps", "desktop", "package.json"),
);
const Y = requireFromApp("yjs");
const awarenessProtocol = requireFromApp("y-protocols/awareness");

/** Text with an umlaut, an emoji (two UTF-16 units) and a line break. */
const BASE = "Grüße 😀 aus Weimar\nZweite Zeile\n";

/** A project document as the host lays it out. */
function projectDoc(clientID) {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  return doc;
}

export function build() {
  const files = {};
  const expected = {};

  // 1. A whole document: a text entry added whole, and the meta map.
  const doc = projectDoc(1001);
  doc.transact(() => {
    doc.getMap("files").set("main.tex", new Y.Text(BASE));
    doc
      .getMap("files")
      .set("chapters/one.tex", new Y.Text("\\chapter{Eins}\n"));
    doc.getMap("meta").set("schema", 1);
    doc.getMap("meta").set("epoch", "0123456789abcdef0123456789abcdef");
  });
  files["document.bin"] = Y.encodeStateAsUpdate(doc);
  expected["document"] = {
    files: { "main.tex": BASE, "chapters/one.tex": "\\chapter{Eins}\n" },
    meta: { schema: 1, epoch: "0123456789abcdef0123456789abcdef" },
  };

  // 2. An edit on top of it: insert after "Grüße 😀 " (9 units) and delete
  //    "aus " behind it. A Rust replica that has the first update applies this
  //    one and must land on the same text, counting UTF-16 units.
  const before = Y.encodeStateVector(doc);
  const text = doc.getMap("files").get("main.tex");
  doc.transact(() => {
    text.insert(9, "Ünï ");
    text.delete(13, 4);
  });
  files["edit.bin"] = Y.encodeStateAsUpdate(doc, before);
  expected["edit"] = { files: { "main.tex": text.toString() } };

  // 3. A page saying who it is, and where its caret is.
  const awareness = new awarenessProtocol.Awareness(projectDoc(1001));
  const state = {
    user: {
      id: "0f1e2d3c4b5a6978",
      name: "Äsa 😀",
      picture: "https://example.org/a.png",
    },
    file: "main.tex",
    // Relative positions, as the page publishes them.
    cursor: {
      anchor: Y.relativePositionToJSON(
        Y.createRelativePositionFromTypeIndex(text, 3),
      ),
      head: Y.relativePositionToJSON(
        Y.createRelativePositionFromTypeIndex(text, 8),
      ),
    },
  };
  awareness.setLocalState(state);
  files["awareness.bin"] = awarenessProtocol.encodeAwarenessUpdate(
    awareness,
    [1001],
  );
  expected["awareness"] = {
    client: 1001,
    clock: awareness.meta.get(1001).clock,
    state,
  };

  // 4. The same page leaving: its state is `null` and its clock one higher.
  awarenessProtocol.removeAwarenessStates(awareness, [1001], "disconnect");
  files["awareness-removed.bin"] = awarenessProtocol.encodeAwarenessUpdate(
    awareness,
    [1001],
  );
  expected["awareness-removed"] = {
    client: 1001,
    clock: awareness.meta.get(1001).clock,
  };

  // Its timer would keep the process alive.
  awareness.destroy();

  files["expected.json"] = new TextEncoder().encode(
    JSON.stringify(expected, null, 2) + "\n",
  );
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = build();
  if (process.argv.includes("--check")) {
    let differs = false;
    for (const [name, bytes] of Object.entries(files)) {
      const path = join(directory, name);
      if (!existsSync(path) || !Buffer.from(bytes).equals(readFileSync(path))) {
        console.error(`${name} differs from what yjs writes now`);
        differs = true;
      }
    }
    process.exit(differs ? 1 : 0);
  }
  mkdirSync(directory, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(directory, name), bytes);
  }
  console.log(`wrote ${Object.keys(files).length} files to ${directory}`);
}
