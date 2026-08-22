/**
 * The LaTeX the palette inserts.
 *
 * What matters is that it compiles and that the caret lands where the writing
 * starts — an insertion that leaves five lines between the author and what
 * they were about to type has not saved them anything.
 */

import { describe, expect, it } from "vitest";

import { INSERTIONS, prepare, prepareAt } from "./insert";

const B = String.fromCharCode(92);

/** One insertion by id, for the tests that are about a particular one. */
function insertion(id: string): string {
  const found = INSERTIONS.find((entry) => entry.id === id);
  expect(found, `no insertion called ${id}`).toBeTruthy();
  return found!.template;
}

describe("what the palette can insert", () => {
  it("offers the things a paper is made of", () => {
    expect(INSERTIONS.map((entry) => entry.id)).toEqual([
      "table",
      "figure",
      "equation",
      "itemize",
      "enumerate",
      "section",
      "subsection",
      "quote",
      "footnote",
    ]);
  });

  it("gives every one a distinct id and a message key", () => {
    const ids = INSERTIONS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of INSERTIONS) {
      expect(entry.labelKey).toMatch(/^insert-/);
    }
  });

  it("closes every environment it opens", () => {
    // An unbalanced environment is a build failure several screens from where
    // it was introduced, which is the whole reason to insert rather than type.
    for (const entry of INSERTIONS) {
      const opened = [
        ...entry.template.matchAll(
          new RegExp(`${B}${B}begin\\{(\\w+)\\}`, "g"),
        ),
      ].map((match) => match[1]);
      const closed = [
        ...entry.template.matchAll(new RegExp(`${B}${B}end\\{(\\w+)\\}`, "g")),
      ].map((match) => match[1]);
      // Reversed, because the innermost is opened last and closed first.
      expect(closed, entry.id).toEqual([...opened].reverse());
    }
  });

  it("balances the braces in every template", () => {
    for (const entry of INSERTIONS) {
      const open = (entry.template.match(/\{/g) ?? []).length;
      const close = (entry.template.match(/\}/g) ?? []).length;
      expect(open, entry.id).toBe(close);
    }
  });

  it("leaves nothing that would print a caret mark", () => {
    for (const entry of INSERTIONS) {
      expect(prepare(entry.template).text).not.toContain("‸");
    }
  });
});

describe("where the caret lands", () => {
  it("goes to the mark", () => {
    const { text, caret } = prepare(`${B}footnote{‸}`);
    expect(text).toBe(`${B}footnote{}`);
    expect(caret).toBe(`${B}footnote{`.length);
  });

  it("goes to the end when there is nothing to fill in", () => {
    const { text, caret } = prepare("plain");
    expect(caret).toBe(text.length);
  });

  it("lands in the first cell of a table", () => {
    // Not on the caption and not at the end: the first thing anybody types
    // into a new table is what goes in the corner.
    const { text, caret } = prepare(insertion("table"));
    expect(text.slice(caret, caret + 3)).toBe(" & ");
  });

  it("lands in the path of a figure", () => {
    const { text, caret } = prepare(insertion("figure"));
    expect(text.slice(caret, caret + 2)).toBe("}\n");
  });
});

describe("inserting into an indented line", () => {
  it("lines the rest up with what is around it", () => {
    const { text } = prepareAt(insertion("itemize"), "    ");
    const lines = text.split("\n");
    // The first line is already where the caret put it; the rest are moved.
    expect(lines[0]).toBe(`${B}begin{itemize}`);
    expect(lines[1]).toBe(`      ${B}item `);
    expect(lines[lines.length - 1]).toBe(`    ${B}end{itemize}`);
  });

  it("moves the caret along with the indent", () => {
    const flat = prepare(insertion("itemize"));
    const indented = prepareAt(insertion("itemize"), "  ");
    // One line break before the caret, so one indent's worth further on.
    expect(indented.caret).toBe(flat.caret + 2);
  });

  it("leaves an unindented insertion exactly as it was", () => {
    expect(prepareAt(insertion("itemize"), "")).toEqual(
      prepare(insertion("itemize")),
    );
  });

  it("does not indent a blank line", () => {
    // Trailing whitespace on an empty line is what a diff notices and nobody
    // else does.
    const { text } = prepareAt(`a${"\n"}${"\n"}b‸`, "  ");
    expect(text.split("\n")[1]).toBe("");
  });
});
