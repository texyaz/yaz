/**
 * An image on the clipboard, becoming a figure.
 *
 * The naming is what matters here: a paste that overwrote last week's figure,
 * or that wrote a Windows separator into a LaTeX path, would be a paste nobody
 * could trust. Neither shows up until it has already happened to a document.
 */

import { describe, expect, it } from "vitest";

import {
  captionOffset,
  figureFor,
  includePath,
  nameFor,
  suffixFor,
  usableImage,
} from "./pastedImage";

const B = String.fromCharCode(92);

describe("deciding whether the clipboard holds a picture", () => {
  it("takes the types a screenshot produces", () => {
    expect(usableImage("image/png")).toBe(true);
    expect(usableImage("image/jpeg")).toBe(true);
  });

  it("declines what LaTeX cannot include", () => {
    // Writing one of these in would produce a document that fails to compile,
    // which is worse than the paste doing nothing.
    expect(usableImage("image/heic")).toBe(false);
    expect(usableImage("image/tiff")).toBe(false);
    expect(usableImage("text/plain")).toBe(false);
  });

  it("gives the extension the type actually is", () => {
    expect(suffixFor("image/jpeg")).toBe("jpg");
    expect(suffixFor("image/png")).toBe("png");
    expect(suffixFor("text/plain")).toBeNull();
  });
});

describe("naming the pasted file", () => {
  it("names it after the document it was pasted into", () => {
    expect(nameFor("chapters/methodik.tex", "png", [])).toBe(
      "images/methodik-1.png",
    );
  });

  it("counts past the names already there", () => {
    // Silently replacing a figure somebody pasted last week is the one
    // outcome that must not be possible.
    const taken = ["images/methodik-1.png", "images/methodik-2.png"];
    expect(nameFor("methodik.tex", "png", taken)).toBe("images/methodik-3.png");
  });

  it("counts past a name that differs only in case", () => {
    // Windows would treat these as the same file, so a case-sensitive check
    // would overwrite on exactly the platform this is being written on.
    expect(nameFor("Methodik.tex", "png", ["images/Methodik-1.png"])).toBe(
      "images/methodik-2.png",
    );
  });

  it("falls back to a name rather than an empty one", () => {
    expect(nameFor(".tex", "png", [])).toBe("images/figure-1.png");
  });

  it("keeps the name to characters a path can hold", () => {
    const name = nameFor("Kapitel 3 — Kosten.tex", "png", []);
    expect(name).toMatch(/^images\/[a-z0-9-]+\.png$/);
  });
});

describe("writing the path into the document", () => {
  it("uses forward slashes whatever the platform used", () => {
    // A backslash is an escape in LaTeX, so a Windows separator produces
    // markup that will not compile on the machine that wrote it.
    expect(includePath("images\\methodik-1.png")).toBe("images/methodik-1.png");
  });
});

describe("the figure that gets inserted", () => {
  const figure = figureFor("images/methodik-1.png");

  it("is a whole figure, not a bare include", () => {
    // A picture in a paper is referred to, and one with no label cannot be.
    expect(figure).toContain(`${B}begin{figure}`);
    expect(figure).toContain(`${B}caption{}`);
    expect(figure).toContain(`${B}label{fig:}`);
  });

  it("includes the file at a width the paper can hold", () => {
    expect(figure).toContain("images/methodik-1.png");
    expect(figure).toContain(`width=0.8${B}textwidth`);
  });

  it("leaves the caret in the caption", () => {
    // The caption is the one part only the author can write, and they will
    // never be better placed to write it than just after pasting.
    const at = captionOffset(figure);
    expect(figure.slice(at, at + 1)).toBe("}");
    expect(figure.slice(0, at).endsWith(`${B}caption{`)).toBe(true);
  });
});
