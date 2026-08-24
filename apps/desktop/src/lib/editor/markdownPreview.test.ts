/**
 * The Markdown preview, in a real editor.
 *
 * Driven through a mounted view rather than by calling the decorator, because
 * what is being checked is what somebody *sees*: that the hashes are gone from
 * a heading, that a task has a box you can tick, that putting the caret on a
 * line brings its markup back. A unit test over the decoration set would pass
 * with the ranges right and the view showing nothing.
 *
 * Imported from the plugin's own source, the way the vocabulary tests are: the
 * plugin is what ships, so testing a copy would test the copy.
 */

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { markdownPreview } from "../../../../../plugins/formats/src/markdownPreview";

const views: EditorView[] = [];
afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
});

/**
 * A view over `text`, with the caret where ‸ was.
 *
 * With no ‸ the caret goes to the *end*, not the start. The line holding the
 * caret keeps its markup on purpose, so a caret parked at offset 0 would leave
 * the first line — which is the line most of these tests are about — showing
 * its source and nothing drawn.
 *
 * Attached to the document, because a detached view has no layout and so no
 * viewport, and the decorator draws only what is in the viewport.
 */
function mount(marked: string): EditorView {
  const caret = marked.indexOf("‸");
  const doc = marked.replace("‸", "");
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(caret === -1 ? doc.length : caret),
      extensions: [markdownPreview()],
    }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

/** What the editor is actually showing, with the hidden parts left out. */
function shown(view: EditorView): string {
  return view.contentDOM.textContent ?? "";
}

describe("what the preview draws", () => {
  it("sets a heading large and takes its hashes away", () => {
    const view = mount("## Kosten\n\nsomething else");
    expect(shown(view)).not.toContain("##");
    expect(shown(view)).toContain("Kosten");
    expect(view.contentDOM.querySelector(".cm-md-h2")).not.toBeNull();
  });

  it("gives a task a box, and ticks it from the document", () => {
    const view = mount("- [x] Done already\n- [ ] Not yet\n\nx");
    const boxes =
      view.contentDOM.querySelectorAll<HTMLInputElement>("input.cm-md-task");

    expect(boxes).toHaveLength(2);
    expect(boxes[0]?.checked).toBe(true);
    expect(boxes[1]?.checked).toBe(false);
    // The brackets are the box now, so they are not also text.
    expect(shown(view)).not.toContain("[x]");
  });

  it("writes the tick back into the file when the box is clicked", () => {
    // The point of an editable preview: ticking is an edit, not a display
    // state that the file knows nothing about.
    const view = mount("- [ ] Not yet\n\nx");
    const box =
      view.contentDOM.querySelector<HTMLInputElement>("input.cm-md-task");

    box?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(view.state.doc.toString()).toContain("- [x] Not yet");
  });

  it("draws a callout with the sign its kind asks for", () => {
    const view = mount("> [!warning] Careful\n\nx");
    const callout = view.contentDOM.querySelector(".cm-md-callout-warn");

    expect(callout).not.toBeNull();
    expect(shown(view)).toContain("Careful");
    // The declaration is the sign and the title; the brackets are not text.
    expect(shown(view)).not.toContain("[!warning]");
  });

  it("names an untitled callout after its own kind", () => {
    const view = mount("> [!tip]\n\nx");
    expect(shown(view)).toContain("Tip");
  });

  it("treats a callout nobody has heard of as a callout", () => {
    // Obsidian lets you invent one. Refusing it would draw a quote with
    // `[!recipe]` sitting in the text, which is worse than a plain callout.
    const view = mount("> [!recipe] Pancakes\n\nx");
    expect(view.contentDOM.querySelector(".cm-md-callout")).not.toBeNull();
    expect(shown(view)).toContain("Pancakes");
  });

  it("hides the markers around emphasis but keeps the words", () => {
    const view = mount("This is **bold** and *thin*.\n\nx");
    expect(shown(view)).toContain("bold");
    expect(shown(view)).not.toContain("**");
    expect(view.contentDOM.querySelector(".cm-md-strong")).not.toBeNull();
    expect(view.contentDOM.querySelector(".cm-md-em")).not.toBeNull();
  });

  it("shows a link's words rather than its address", () => {
    const view = mount("See [the notes](https://example.invalid/a/b).\n\nx");
    expect(shown(view)).toContain("the notes");
    expect(shown(view)).not.toContain("example.invalid");
  });

  it("shows a wikilink's alias where it has one", () => {
    const view = mount("See [[2026-08-24 Notes|yesterday]].\n\nx");
    expect(shown(view)).toContain("yesterday");
    expect(shown(view)).not.toContain("2026-08-24");
  });

  it("leaves a fenced block as what it says", () => {
    // A `#` inside a code block is a comment in whatever language that is, not
    // a heading, and drawing it 1.5× the size would be a lie about the file.
    const view = mount("```sh\n# not a heading\n```\n\nx");
    expect(shown(view)).toContain("# not a heading");
    expect(view.contentDOM.querySelector(".cm-md-h1")).toBeNull();
  });

  it("puts a bullet where the dash was", () => {
    const view = mount("- one\n- two\n\nx");
    expect(view.contentDOM.querySelectorAll(".cm-md-bullet")).toHaveLength(2);
  });

  it("keeps a numbered list's numbers, which are its content", () => {
    const view = mount("1. one\n2. two\n\nx");
    expect(shown(view)).toContain("1.");
    expect(view.contentDOM.querySelector(".cm-md-bullet")).toBeNull();
  });
});

describe("editing what is drawn", () => {
  it("brings the markup back on the line the caret is on", () => {
    // The behaviour that makes an editable preview usable rather than a fight:
    // you cannot select what you cannot see, so the line being edited shows
    // itself as it really is.
    const view = mount("## Kos‸ten\n\nx");
    expect(shown(view)).toContain("##");
  });

  it("leaves the other lines drawn", () => {
    const view = mount("## First\n\n## Sec‸ond\n\nx");
    const text = shown(view);
    // One line reveals its hashes; the other keeps them hidden.
    expect(text.match(/##/g) ?? []).toHaveLength(1);
  });

  it("never changes the document by drawing it", () => {
    // The preview is a view. If mounting it edited anything, every one of
    // these tests would be testing a different file from the one written.
    const source = [
      "# Title",
      "",
      "> [!note] A note",
      "",
      "- [ ] a task",
      "- **bold** item",
      "",
      "```js",
      "const x = 1;",
      "```",
    ].join("\n");
    const view = mount(source);
    expect(view.state.doc.toString()).toBe(source);
  });
});
