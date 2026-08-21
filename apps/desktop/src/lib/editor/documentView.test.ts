/**
 * Which way of setting the text applies to which file.
 *
 * Small, but it is the rule that decides what a Markdown file looks like, and
 * getting it wrong means either showing page breaks for a document that has no
 * pages or silently forgetting a setting when the author switches files.
 */

import { describe, expect, it } from "vitest";

import { canPaginate, DOCUMENT_VIEWS, viewFor } from "./documentView";

describe("which files can be set on paper", () => {
  it("allows a .tex, which declares its own paper size", () => {
    expect(canPaginate("latex")).toBe(true);
  });

  it("refuses everything else", () => {
    // Not a judgement about Markdown. A page view needs a page size, and only
    // a `\documentclass` states one — anything else would mean choosing paper
    // on the author's behalf and then showing them breaks no build produces.
    for (const format of ["markdown", "yaml", "bibtex", null]) {
      expect(canPaginate(format)).toBe(false);
    }
  });
});

describe("falling back when a view does not apply", () => {
  it("draws the column instead of the page for a file with no paper", () => {
    expect(viewFor("page", "markdown")).toBe("continuous");
  });

  it("leaves the page alone for a .tex", () => {
    expect(viewFor("page", "latex")).toBe("page");
  });

  it("never rewrites the other two", () => {
    // The column and the plain view need nothing from the format, so there is
    // never a reason to substitute for them.
    for (const format of ["latex", "markdown", null]) {
      expect(viewFor("continuous", format)).toBe("continuous");
      expect(viewFor("plain", format)).toBe("plain");
    }
  });
});

describe("the order the views are offered in", () => {
  it("holds each exactly once, so cycling reaches all three", () => {
    expect([...DOCUMENT_VIEWS].sort()).toEqual(["continuous", "page", "plain"]);
  });
});
