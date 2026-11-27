import { history, undo, undoDepth } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { stitch } from "../editor/stitch";
import { segments, setSegments, stitched } from "../editor/stitched";
import {
  boundFile,
  collabBinding,
  fromSession,
  setBoundFile,
  changesOfDelta,
  type BindingEvents,
} from "./binding";
import { remoteCarets } from "./carets";
import { FakeHost } from "./fakeHost";
import { Session } from "./session";

beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

const memory = () => {
  const kept = new Map<string, string>();
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
  };
};

const open: { destroy(): void }[] = [];
afterEach(() => {
  while (open.length > 0) open.pop()?.destroy();
});

async function page(host: FakeHost, name: string, file = "a.tex") {
  const session = new Session(
    "/r",
    { name, email: `${name}@example.org` },
    {
      openLink: host.openLink,
      storage: memory(),
    },
  );
  open.push(session);
  await session.whenReady(1000);
  const events = { restitch: vi.fn(), drift: vi.fn() } satisfies BindingEvents;
  const view = new EditorView({
    state: EditorState.create({
      doc: session.text(file) ?? "",
      extensions: [
        history(),
        stitched(() => {}),
        boundFile,
        collabBinding(session, events),
        remoteCarets(session, () => "Someone"),
      ],
    }),
    parent: document.body,
  });
  open.push(view);
  view.dispatch({ effects: setBoundFile.of(file) });
  return { session, view, events };
}

describe("the binding of one file", () => {
  it("brings typing on two pages to one text, in the editors and in the shared text", async () => {
    const host = new FakeHost();
    host.seed("a.tex", "middle\n");
    const one = await page(host, "ada");
    const two = await page(host, "bo");

    // Both type before either has heard of the other.
    one.view.dispatch({ changes: { from: 0, insert: "one: " } });
    two.view.dispatch({ changes: { from: 7, insert: "two: " } });
    await host.idle();

    const text = one.view.state.doc.toString();
    expect(text).toContain("one: ");
    expect(text).toContain("two: ");
    expect(two.view.state.doc.toString()).toBe(text);
    expect(one.session.text("a.tex")).toBe(text);
    expect(host.text("a.tex")).toBe(text);
    expect(one.events.drift).not.toHaveBeenCalled();
    expect(two.events.drift).not.toHaveBeenCalled();
  });

  it("writes a deletion and a replacement behind an emoji to the right place", async () => {
    const host = new FakeHost();
    host.seed("a.tex", "Grüße 😀 aus Weimar\n");
    const one = await page(host, "ada");
    const two = await page(host, "bo");
    // From "aus" to "Weimar": offsets count the emoji as two units.
    one.view.dispatch({ changes: { from: 9, to: 12, insert: "von" } });
    one.view.dispatch({ changes: { from: 0, to: 6 } });
    await host.idle();
    expect(two.view.state.doc.toString()).toBe("😀 von Weimar\n");
    expect(host.text("a.tex")).toBe("😀 von Weimar\n");
  });

  it("keeps a remote change out of the undo history, and undo undoes only one's own typing", async () => {
    const host = new FakeHost();
    host.seed("a.tex", "base\n");
    const one = await page(host, "ada");
    const two = await page(host, "bo");

    // Somebody else's text arrives first: there is nothing of one's own to undo.
    two.view.dispatch({ changes: { from: 0, insert: "theirs " } });
    await host.idle();
    expect(one.view.state.doc.toString()).toBe("theirs base\n");
    expect(undoDepth(one.view.state)).toBe(0);
    expect(undo(one.view)).toBe(false);

    // Then one's own, and more of theirs after it.
    one.view.dispatch({
      changes: { from: one.view.state.doc.length, insert: "mine\n" },
    });
    two.view.dispatch({ changes: { from: 0, insert: "again " } });
    await host.idle();
    expect(one.view.state.doc.toString()).toBe("again theirs base\nmine\n");

    expect(undo(one.view)).toBe(true);
    await host.idle();
    // Only "mine\n" went; what the other typed, before and after it, stayed.
    expect(one.view.state.doc.toString()).toBe("again theirs base\n");
    expect(two.view.state.doc.toString()).toBe("again theirs base\n");
    expect(host.text("a.tex")).toBe("again theirs base\n");
    expect(undoDepth(one.view.state)).toBe(0);
  });

  it("does not hand a change from the session back to the session", async () => {
    const host = new FakeHost();
    host.seed("a.tex", "x\n");
    const one = await page(host, "ada");
    const two = await page(host, "bo");
    const before = host.received.length;
    two.session.replace("a.tex", "x\ny\n");
    await host.idle();
    expect(one.view.state.doc.toString()).toBe("x\ny\n");
    // The page that received it sent nothing in return but its caret.
    const sent = host.received.slice(before);
    expect(sent.filter((tag) => tag === 0)).toHaveLength(1);
  });

  it("does not take a swap of the document for typing", async () => {
    const host = new FakeHost();
    host.seed("a.tex", "first\n");
    host.seed("b.tex", "second\n");
    const one = await page(host, "ada");
    one.view.dispatch({
      changes: { from: 0, to: one.view.state.doc.length, insert: "second\n" },
      effects: setBoundFile.of("b.tex"),
    });
    await host.idle();
    expect(host.text("a.tex")).toBe("first\n");
    expect(host.text("b.tex")).toBe("second\n");
    // And typing now goes to the file that is bound.
    one.view.dispatch({ changes: { from: 0, insert: ">" } });
    await host.idle();
    expect(host.text("b.tex")).toBe(">second\n");
    expect(host.text("a.tex")).toBe("first\n");
  });

  it("asks for the buffer to be rebuilt when the file's entry is replaced", async () => {
    const host = new FakeHost();
    host.seed("a.tex", "old\n");
    const one = await page(host, "ada");
    host.seed("a.tex", "replaced\n");
    await host.idle();
    expect(one.events.restitch).toHaveBeenCalledTimes(1);
  });

  it("lets go, and says so, when the buffer no longer matches the text", async () => {
    const host = new FakeHost();
    host.seed("a.tex", "same\n");
    const one = await page(host, "ada");
    // A change nobody told the shared text about: the two now disagree.
    one.view.dispatch({
      changes: { from: 0, insert: "!" },
      annotations: fromSession.of(true),
    });
    one.view.dispatch({ changes: { from: 0, insert: "?" } });
    expect(one.events.drift).toHaveBeenCalledTimes(1);
    const written = host.text("a.tex");
    one.view.dispatch({ changes: { from: 0, insert: "more" } });
    await host.idle();
    // Nothing further is written from a buffer that does not match.
    expect(host.text("a.tex")).toBe(written);
  });

  it("publishes where the caret is, as a position in the file's text", async () => {
    const host = new FakeHost();
    host.seed("a.tex", "hello world\n");
    const one = await page(host, "ada");
    const two = await page(host, "bo");
    one.view.dispatch({ selection: { anchor: 2, head: 7 } });
    await host.idle();
    const seen = two.session.peers[0]!;
    expect(seen.file).toBe("a.tex");
    const state = two.session.awareness.getStates().get(seen.clientId) as {
      cursor: { anchor: unknown; head: unknown };
    };
    const index = (json: unknown) =>
      Y.createAbsolutePositionFromRelativePosition(
        Y.createRelativePositionFromJSON(json),
        two.session.doc,
      )?.index;
    expect(index(state.cursor.anchor)).toBe(2);
    expect(index(state.cursor.head)).toBe(7);

    // A position follows the text it was in when somebody types before it.
    two.view.dispatch({ changes: { from: 0, insert: ">>> " } });
    await host.idle();
    expect(index(state.cursor.anchor)).toBe(6);
  });

  it("draws other people's carets without disturbing the editor", async () => {
    const host = new FakeHost();
    host.seed("a.tex", "hello world\n");
    const one = await page(host, "ada");
    const two = await page(host, "bo");
    one.view.dispatch({ selection: { anchor: 2, head: 7 } });
    await host.idle();
    two.view.requestMeasure();
    expect(two.view.dom.querySelector(".cm-remote-carets")).not.toBeNull();
    expect(two.events.drift).not.toHaveBeenCalled();
  });
});

/** A page whose buffer is the root file with its includes expanded. */
async function joinedPage(host: FakeHost, name: string, root = "main.tex") {
  const made = await page(host, name, root);
  const built = stitch(root, (path) => made.session.text(path));
  made.view.dispatch({
    changes: { from: 0, to: made.view.state.doc.length, insert: built.text },
    effects: [setSegments.of(built.segments), setBoundFile.of(null)],
  });
  return made;
}

describe("the binding of several files in one buffer", () => {
  const seed = (host: FakeHost) => {
    host.seed("main.tex", "A\n\\include{ch}\nZ\n");
    host.seed("ch.tex", "chapter\n");
  };

  it("writes typing to the file it is in, and shows it to a page that has that file alone", async () => {
    const host = new FakeHost();
    seed(host);
    const joined = await joinedPage(host, "ada");
    const alone = await page(host, "bo", "ch.tex");
    expect(joined.view.state.doc.toString()).toBe("A\nchapter\n\nZ\n");

    // In the chapter, and after it in the root file.
    joined.view.dispatch({ changes: { from: 9, insert: "!" } });
    joined.view.dispatch({
      changes: { from: joined.view.state.doc.length, insert: "end\n" },
    });
    await host.idle();
    expect(host.text("ch.tex")).toBe("chapter!\n");
    expect(host.text("main.tex")).toBe("A\n\\include{ch}\nZ\nend\n");
    expect(alone.view.state.doc.toString()).toBe("chapter!\n");
    expect(joined.events.drift).not.toHaveBeenCalled();
  });

  it("puts somebody else's edit where its file's text is", async () => {
    const host = new FakeHost();
    seed(host);
    const joined = await joinedPage(host, "ada");
    const chapter = await page(host, "bo", "ch.tex");
    const root = await page(host, "cy", "main.tex");

    chapter.view.dispatch({ changes: { from: 0, insert: "The " } });
    root.view.dispatch({ changes: { from: 15, insert: "after " } });
    await host.idle();
    expect(joined.view.state.doc.toString()).toBe(
      "A\nThe chapter\n\nafter Z\n",
    );
    expect(joined.events.restitch).not.toHaveBeenCalled();
    expect(joined.events.drift).not.toHaveBeenCalled();

    // And the map moved with it: typing after it still lands in the right file.
    joined.view.dispatch({ changes: { from: 2, insert: ">" } });
    await host.idle();
    expect(host.text("ch.tex")).toBe(">The chapter\n");
  });

  it("keeps text put at the end of the root file's stretch in the root file", async () => {
    const host = new FakeHost();
    seed(host);
    const joined = await joinedPage(host, "ada");
    const root = await page(host, "cy", "main.tex");

    // Offset 2 of the root file is just before the command, which in the
    // joined buffer is also where the chapter begins.
    root.view.dispatch({ changes: { from: 2, insert: "B\n" } });
    await host.idle();
    expect(joined.view.state.doc.toString()).toBe("A\nB\nchapter\n\nZ\n");
    const map = joined.view.state.field(segments);
    expect(map[0]).toMatchObject({ file: "main.tex", from: 0, to: 4 });
    expect(map[1]).toMatchObject({ file: "ch.tex", from: 4, fileFrom: 0 });

    // Typing at that offset is the chapter's, as it was before.
    joined.view.dispatch({ changes: { from: 4, insert: "C" } });
    await host.idle();
    expect(host.text("ch.tex")).toBe("Cchapter\n");
    expect(host.text("main.tex")).toBe("A\nB\n\\include{ch}\nZ\n");
    expect(joined.events.drift).not.toHaveBeenCalled();
  });

  it("asks to be stitched again when a command it expanded is edited", async () => {
    const host = new FakeHost();
    seed(host);
    const joined = await joinedPage(host, "ada");
    const root = await page(host, "cy", "main.tex");
    const before = joined.view.state.doc.toString();

    // Inside `\include{ch}`.
    root.view.dispatch({ changes: { from: 5, insert: "x" } });
    await host.idle();
    expect(joined.events.restitch).toHaveBeenCalledTimes(1);
    expect(joined.view.state.doc.toString()).toBe(before);
    expect(joined.events.drift).not.toHaveBeenCalled();

    // The shell builds the buffer again from the shared texts, and it goes on.
    const built = stitch("main.tex", (path) => joined.session.text(path));
    joined.view.dispatch({
      changes: {
        from: 0,
        to: joined.view.state.doc.length,
        insert: built.text,
      },
      effects: [setSegments.of(built.segments), setBoundFile.of(null)],
    });
    joined.view.dispatch({ changes: { from: 0, insert: "again " } });
    await host.idle();
    expect(host.text("main.tex")?.startsWith("again A\n")).toBe(true);
    expect(joined.events.drift).not.toHaveBeenCalled();
  });

  it("lets go when the buffer it is handed is not the shared texts", async () => {
    const host = new FakeHost();
    seed(host);
    const made = await page(host, "ada", "main.tex");
    const built = stitch("main.tex", (path) => made.session.text(path));
    made.view.dispatch({
      changes: {
        from: 0,
        to: made.view.state.doc.length,
        insert: built.text.replace("chapter", "chaptre"),
      },
      effects: [setSegments.of(built.segments), setBoundFile.of(null)],
    });
    expect(made.events.drift).toHaveBeenCalledTimes(1);
  });

  it("publishes the caret as a position in the file it is in", async () => {
    const host = new FakeHost();
    seed(host);
    const joined = await joinedPage(host, "ada");
    const other = await page(host, "bo", "ch.tex");
    joined.view.dispatch({ selection: { anchor: 5 } });
    await host.idle();
    const seen = other.session.peers[0]!;
    expect(seen.file).toBe("ch.tex");
    const state = other.session.awareness.getStates().get(seen.clientId) as {
      cursor: { head: unknown };
    };
    expect(
      Y.createAbsolutePositionFromRelativePosition(
        Y.createRelativePositionFromJSON(state.cursor.head),
        other.session.doc,
      )?.index,
    ).toBe(3);
  });
});

describe("a delta of Yjs", () => {
  it("is a list of changes in the coordinates of the old text", () => {
    expect(
      changesOfDelta([
        { retain: 2 },
        { insert: "xy" },
        { delete: 3 },
        { retain: 1 },
      ]),
    ).toEqual([
      { from: 2, to: 2, insert: "xy" },
      { from: 2, to: 5, insert: "" },
    ]);
    expect(changesOfDelta([{ delete: 1 }, { insert: "z" }])).toEqual([
      { from: 0, to: 1, insert: "" },
      { from: 1, to: 1, insert: "z" },
    ]);
  });
});
