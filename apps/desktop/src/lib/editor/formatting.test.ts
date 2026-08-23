/**
 * Formatting a selection.
 *
 * The toggling is the part worth pinning. A command that only wraps turns
 * `\textbf{word}` into `\textbf{\textbf{word}}` on the second press, and a
 * shortcut you cannot press twice is one you have to look at the document
 * before using.
 */

import { describe, expect, it } from "vitest";

import {
  appliedFormatting,
  clearFormatting,
  setColour,
  setFamily,
  setSize,
  toggleEnvironment,
  toggleHeading,
  toggleInline,
} from "./formatting";
import type { Edit } from "./formatting";

/** Apply an edit and mark the selection with «». */
function apply(text: string, edit: Edit): string {
  let out = text;
  for (const change of [...edit.changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  }
  return `${out.slice(0, edit.from)}«${out.slice(edit.from, edit.to)}»${out.slice(edit.to)}`;
}

/** A document with «» marking the selection. */
function select(marked: string): [string, number, number] {
  const from = marked.indexOf("«");
  const to = marked.indexOf("»") - 1;
  return [marked.replace("«", "").replace("»", ""), from, to];
}

describe("toggleInline", () => {
  it("wraps a selection", () => {
    const [text, from, to] = select("make «this» bold");
    expect(apply(text, toggleInline(text, from, to, "textbf"))).toBe(
      "make \\textbf{«this»} bold",
    );
  });

  it("takes it off again", () => {
    const [text, from, to] = select("make \\textbf{«this»} bold");
    expect(apply(text, toggleInline(text, from, to, "textbf"))).toBe(
      "make «this» bold",
    );
  });

  it("un-bolds from anywhere inside the run", () => {
    // Pressing the shortcut in the middle of bold text means "stop this being
    // bold", not "bold one word inside it".
    const [text, from, to] = select("make \\textbf{a whole «run» of it} bold");
    expect(apply(text, toggleInline(text, from, to, "textbf"))).toBe(
      "make a whole «run» of it bold",
    );
  });

  it("leaves a different command alone", () => {
    // Italic inside bold is a real thing to want.
    const [text, from, to] = select("\\textbf{make «this» italic}");
    expect(apply(text, toggleInline(text, from, to, "textit"))).toBe(
      "\\textbf{make \\textit{«this»} italic}",
    );
  });

  it("puts the cursor between the braces with nothing selected", () => {
    const text = "type here: ";
    const edit = toggleInline(text, text.length, text.length, "textbf");
    expect(apply(text, edit)).toBe("type here: \\textbf{«»}");
  });
});

describe("toggleEnvironment", () => {
  it("quotes whole lines", () => {
    // A quotation is a block. Quoting half a line would produce something that
    // compiles and reads as a mistake.
    const [text, from, to] = select("Before\nA «quoted» passage\nAfter");
    const result = apply(text, toggleEnvironment(text, from, to, "quote"));
    expect(result).toContain(
      "\\begin{quote}\nA «quoted» passage\n\\end{quote}",
    );
    expect(result).toContain("Before\n");
  });

  it("unquotes what is already quoted", () => {
    const [text, from, to] = select(
      "\\begin{quote}\nA «quoted» passage\n\\end{quote}",
    );
    expect(apply(text, toggleEnvironment(text, from, to, "quote"))).toBe(
      "A «quoted» passage",
    );
  });
});

describe("toggleHeading", () => {
  it("makes a line a heading", () => {
    const text = "Introduction";
    expect(apply(text, toggleHeading(text, 4, 1))).toBe(
      "\\section{Introduction«»}",
    );
  });

  it("takes the heading off when the same level is asked for again", () => {
    const text = "\\section{Introduction}";
    expect(apply(text, toggleHeading(text, 12, 1))).toBe("«Introduction»");
  });

  it("changes level rather than nesting", () => {
    // Asking for a subsection while on a section means "make it a subsection",
    // not "put a subsection inside the section's title".
    const text = "\\section{Introduction}";
    expect(apply(text, toggleHeading(text, 12, 2))).toBe(
      "\\subsection{Introduction«»}",
    );
  });

  it("keeps the line's indentation", () => {
    const text = "  Nested heading";
    expect(apply(text, toggleHeading(text, 5, 3))).toBe(
      "  \\subsubsection{Nested heading«»}",
    );
  });
});

describe("clearFormatting", () => {
  it("removes the formatting it knows", () => {
    const [text, from, to] = select("«\\textbf{bold} and \\textit{italic}»");
    expect(apply(text, clearFormatting(text, from, to))).toBe(
      "«bold and italic»",
    );
  });

  it("leaves commands it did not apply", () => {
    // A "clear formatting" button that also removed a citation would be a
    // data-loss button wearing a tidy label.
    const [text, from, to] = select("«\\textbf{bold} \\cite{smith2020}»");
    expect(apply(text, clearFormatting(text, from, to))).toContain(
      "\\cite{smith2020}",
    );
  });

  it("does nothing when there is nothing to clear", () => {
    const [text, from, to] = select("«plain text»");
    expect(clearFormatting(text, from, to).changes).toEqual([]);
  });
});

/** Apply an edit and return the text, with no selection markers. */
function plain(text: string, edit: Edit): string {
  let out = text;
  for (const change of [...edit.changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  }
  return out;
}

describe("setting a font family", () => {
  it("wraps the selection", () => {
    const text = "Ein Wort hier.";
    const edit = setFamily(text, 4, 8, "textsf");
    expect(plain(text, edit)).toBe("Ein \\textsf{Wort} hier.");
  });

  it("takes it off when it is already that family", () => {
    // The same button twice, which is how every formatting control behaves and
    // the only way to say "not sans after all".
    const text = "Ein \\textsf{Wort} hier.";
    const edit = setFamily(text, 12, 16, "textsf");
    expect(plain(text, edit)).toBe("Ein Wort hier.");
  });

  it("swaps one family for another rather than nesting", () => {
    // Nesting would leave the outer one deciding, so the button would appear
    // to do nothing at all.
    const text = "Ein \\textsf{Wort} hier.";
    const edit = setFamily(text, 12, 16, "texttt");
    expect(plain(text, edit)).toBe("Ein \\texttt{Wort} hier.");
  });

  it("keeps the same words selected after a swap", () => {
    const text = "Ein \\textsf{Wort} hier.";
    const edit = setFamily(text, 12, 16, "texttt");
    expect(plain(text, edit).slice(edit.from, edit.to)).toBe("Wort");
  });
});

describe("setting a font size", () => {
  it("wraps the selection in a group of its own", () => {
    // A group, because a size is a declaration: without the braces it would run
    // on to the end of the paragraph.
    const text = "Ein Wort hier.";
    const edit = setSize(text, 4, 8, "large");
    expect(plain(text, edit)).toBe("Ein {\\large Wort} hier.");
  });

  it("takes it off when it is already that size", () => {
    const text = "Ein {\\large Wort} hier.";
    const edit = setSize(text, 12, 16, "large");
    expect(plain(text, edit)).toBe("Ein Wort hier.");
  });

  it("swaps one size for another", () => {
    const text = "Ein {\\large Wort} hier.";
    const edit = setSize(text, 12, 16, "small");
    expect(plain(text, edit)).toBe("Ein {\\small Wort} hier.");
  });

  it("tells large from Large", () => {
    // LaTeX has both and they are different sizes, so a scan that matched
    // case-insensitively would take off the wrong one.
    const text = "Ein {\\Large Wort} hier.";
    expect(appliedFormatting(text, 12, 16).size).toBe("Large");
  });
});

describe("setting a colour", () => {
  it("wraps the selection and says what the preamble needs", () => {
    const text = "Ein Wort hier.";
    const edit = setColour(text, 4, 8, "red");
    expect(plain(text, edit)).toBe("Ein \\textcolor{red}{Wort} hier.");
    // Without this the document gets a command it cannot compile, which is a
    // formatting button that breaks the build.
    expect(edit.requires).toEqual({ package: "xcolor" });
  });

  it("takes it off when it is already that colour", () => {
    const text = "Ein \\textcolor{red}{Wort} hier.";
    const edit = setColour(text, 20, 24, "red");
    expect(plain(text, edit)).toBe("Ein Wort hier.");
  });

  it("swaps one colour for another", () => {
    const text = "Ein \\textcolor{red}{Wort} hier.";
    const edit = setColour(text, 20, 24, "blue");
    expect(plain(text, edit)).toBe("Ein \\textcolor{blue}{Wort} hier.");
  });

  it("reads the colour that is on, not the first in the file", () => {
    // Two colours in one paragraph is ordinary, and a bar showing the wrong
    // one is worse than a bar showing none.
    const text = "\\textcolor{red}{Eins} und \\textcolor{blue}{Zwei}.";
    expect(appliedFormatting(text, 43, 47).colour).toBe("blue");
  });
});

describe("reading what is already applied", () => {
  it("reports every command the selection is inside", () => {
    const text = "\\textbf{\\textit{Wort}}";
    expect(appliedFormatting(text, 16, 20).inline.sort()).toEqual([
      "textbf",
      "textit",
    ]);
  });

  it("reports nothing for plain text", () => {
    expect(appliedFormatting("Ein Wort hier.", 4, 8)).toEqual({
      inline: [],
      family: null,
      size: null,
      colour: null,
    });
  });
});
