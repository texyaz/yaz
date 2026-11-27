/**
 * Replacing the whole document while the preview is on.
 *
 * This is what joining a multi-file document does, and what it did was throw:
 * the rule that keeps the cursor out of the folded preamble read its target
 * from the new document and applied it to the old one. With the preview on —
 * which is how a phone starts — the join never reached the screen.
 */
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { richText, setRichText } from "./richText";

const B = String.fromCharCode(92);

function document(preambleLines: number, body: string): string {
  const preamble = Array.from(
    { length: preambleLines },
    (_, index) => `${B}usepackage{package${index}}`,
  ).join("\n");
  return `${B}documentclass{book}\n${preamble}\n${B}begin{document}\n${body}\n${B}end{document}\n`;
}

describe("swapping the document under the preview", () => {
  it("accepts a document whose preamble is longer than the whole old text", () => {
    const small = document(1, "Short.");
    const large = document(400, "The joined text of every chapter.");
    // The case that threw: the cursor's new home is past the end of the old
    // document.
    expect(large.indexOf(`${B}begin{document}`)).toBeGreaterThan(small.length);

    let state = EditorState.create({ doc: small, extensions: [richText()] });
    state = state.update({ effects: setRichText.of(true) }).state;

    const swapped = state.update({
      changes: { from: 0, to: state.doc.length, insert: large },
      selection: { anchor: 0 },
    }).state;

    expect(swapped.doc.toString()).toBe(large);
    // And the cursor is where the rule meant to put it: in the new document,
    // past the fold, not at a position carried over from the old one.
    const cursor = swapped.selection.main.head;
    expect(cursor).toBeGreaterThan(0);
    expect(cursor).toBeLessThanOrEqual(large.length);
  });
});
