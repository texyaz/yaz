/**
 * The file tree.
 *
 * The shapes here are taken from a real thesis — `sections/Basis/`,
 * `sections/Kapitel/`, an `output/` full of build artefacts, an `images/`, and
 * a `.vscode/` — because the interesting cases are the ones a flat list of
 * four extensions never had to face.
 */

import { describe, expect, it } from "vitest";

import { ALL_VISIBLE, buildTree, initiallyOpen, visibleRows } from "./tree";
import type { Filters, Node, ProjectFile } from "./tree";

/** A file, as the scan hands it over. */
function file(
  relativePath: string,
  kind: ProjectFile["kind"] = "other",
): ProjectFile {
  return { relativePath, kind, isEntry: relativePath === "main.tex" };
}

const project: ProjectFile[] = [
  file("main.tex", "tex"),
  file("BIMwissT.bib", "bib"),
  file("README.md", "other"),
  file("main.lof", "build"),
  file(".vscode/settings.json", "other"),
  file("images/logo.png", "image"),
  file("output/main.pdf", "pdf"),
  file("output/main.aux", "build"),
  file("sections/Vorbemerkungen.tex", "tex"),
  file("sections/Basis/glossary.tex", "tex"),
  file("sections/Kapitel/Arbeitspakete.tex", "tex"),
];

/** Names of the rows, with folders marked. */
function rows(nodes: Node[], open: Set<string>): string[] {
  return visibleRows(nodes, open).map((node) =>
    node.type === "folder" ? `${node.name}/` : node.name,
  );
}

const shown = (filters: Partial<Filters> = {}) =>
  buildTree(project, { ...ALL_VISIBLE, ...filters });

describe("buildTree", () => {
  it("nests folders", () => {
    const tree = shown();
    const sections = tree.find((node) => node.name === "sections");
    expect(sections?.type).toBe("folder");
    if (sections?.type !== "folder") return;
    expect(sections.children.map((child) => child.name)).toEqual([
      "Basis",
      "Kapitel",
      "Vorbemerkungen.tex",
    ]);
  });

  it("puts folders before files", () => {
    // How every file manager does it: folders are where you go next, files are
    // where you stop.
    const names = shown().map((node) => node.name);
    expect(names.indexOf("images")).toBeLessThan(names.indexOf("main.tex"));
  });

  it("hides dotted folders unless asked", () => {
    expect(shown().some((node) => node.name === ".vscode")).toBe(false);
    expect(
      shown({ showHidden: true }).some((node) => node.name === ".vscode"),
    ).toBe(true);
  });

  it("marks what is hidden, so it can be shown quietly", () => {
    const tree = shown({ showHidden: true });
    expect(tree.find((node) => node.name === ".vscode")?.hidden).toBe(true);
    expect(tree.find((node) => node.name === "images")?.hidden).toBe(false);
  });

  it("can leave out what a compile produced", () => {
    const tree = shown({ showBuild: false });
    expect(tree.some((node) => node.name === "main.lof")).toBe(false);
    // The PDF is an artefact and also the thing anyone opens to read the work.
    const output = tree.find((node) => node.name === "output");
    expect(
      output?.type === "folder" && output.children.map((c) => c.name),
    ).toEqual(["main.pdf"]);
  });

  it("drops a folder that filtering emptied", () => {
    // A hidden `output/` should not still show a folder that opens onto
    // nothing.
    const onlySources = buildTree(
      [file("main.tex", "tex"), file("output/main.aux", "build")],
      { ...ALL_VISIBLE, showBuild: false },
    );
    expect(onlySources.map((node) => node.name)).toEqual(["main.tex"]);
  });

  it("can leave out formats it has no use for", () => {
    expect(
      shown({ showOther: false }).some((node) => node.name === "README.md"),
    ).toBe(false);
    expect(shown().some((node) => node.name === "README.md")).toBe(true);
  });

  it("keeps the path the editor opens, not just the name", () => {
    const tree = shown();
    const sections = tree.find((node) => node.name === "sections");
    if (sections?.type !== "folder") throw new Error("expected a folder");
    const basis = sections.children.find((node) => node.name === "Basis");
    if (basis?.type !== "folder") throw new Error("expected a folder");
    expect(basis.children[0]?.path).toBe("sections/Basis/glossary.tex");
  });
});

describe("visibleRows", () => {
  it("shows nothing beneath a closed folder", () => {
    // Sorted the way a person reads a list rather than the way bytes compare:
    // `README.md` sits with the r's, not above every lowercase name.
    const tree = shown();
    expect(rows(tree, new Set())).toEqual([
      "images/",
      "output/",
      "sections/",
      "BIMwissT.bib",
      "main.lof",
      "main.tex",
      "README.md",
    ]);
  });

  it("shows what an open folder holds", () => {
    const tree = shown();
    expect(rows(tree, new Set(["sections"]))).toContain("Vorbemerkungen.tex");
    expect(rows(tree, new Set(["sections"]))).not.toContain("glossary.tex");
    expect(rows(tree, new Set(["sections", "sections/Basis"]))).toContain(
      "glossary.tex",
    );
  });
});

describe("initiallyOpen", () => {
  it("opens the way to the entry document and no further", () => {
    // Opening everything buries the file that matters in a project with two
    // hundred images; opening nothing means three clicks before you can start.
    const open = initiallyOpen([
      file("main.tex", "tex"),
      {
        relativePath: "sections/Kapitel/deep.tex",
        kind: "tex",
        isEntry: false,
      },
    ]);
    expect([...open]).toEqual([]);
  });

  it("opens every folder on the way down to it", () => {
    const open = initiallyOpen([
      { relativePath: "src/thesis/main.tex", kind: "tex", isEntry: true },
    ]);
    expect([...open].sort()).toEqual(["src", "src/thesis"]);
  });

  it("copes with a project that has no entry", () => {
    expect([...initiallyOpen([file("notes.md")])]).toEqual([]);
  });
});

describe("folders that hold nothing", () => {
  it("shows a folder the scan reported but nothing names", () => {
    // The case that made this necessary: "New folder" created one, the project
    // refreshed, and it was gone — never deleted, just never visible, because
    // the tree was built from file paths and no file named it.
    const tree = buildTree([file("main.tex")], ALL_VISIBLE, ["images"]);
    const images = tree.find((node) => node.name === "images");

    expect(images?.type).toBe("folder");
    expect(images?.type === "folder" && images.children).toEqual([]);
  });

  it("still drops one left empty by the filters", () => {
    // The opposite case, and it stays as it was: somebody who switched build
    // artefacts off should not be shown a `build` that opens onto nothing.
    const tree = buildTree(
      [file("main.tex"), file("build/main.aux", "build")],
      { ...ALL_VISIBLE, showBuild: false },
      [],
    );
    expect(tree.map((node) => node.name)).toEqual(["main.tex"]);
  });

  it("hides the build folder itself when its contents are hidden", () => {
    // Reported by the scan, so the empty-folder rule would otherwise keep it —
    // and a `build` folder that survives the switch that hides build output is
    // the switch not working.
    const tree = buildTree(
      [file("main.tex")],
      { ...ALL_VISIBLE, showBuild: false },
      ["build", "images"],
    );
    expect(tree.map((node) => node.name)).toEqual(["images", "main.tex"]);
  });

  it("keeps a dotted folder out unless dotted folders are shown", () => {
    const hidden = buildTree([file("main.tex")], ALL_VISIBLE, [".texpadtmp"]);
    expect(hidden.map((node) => node.name)).toEqual(["main.tex"]);

    const shown = buildTree(
      [file("main.tex")],
      { ...ALL_VISIBLE, showHidden: true },
      [".texpadtmp"],
    );
    expect(shown.map((node) => node.name)).toEqual([".texpadtmp", "main.tex"]);
  });

  it("nests an empty folder inside the one that holds it", () => {
    const tree = buildTree([file("main.tex")], ALL_VISIBLE, [
      "chapters",
      "chapters/drafts",
    ]);
    const chapters = tree.find((node) => node.name === "chapters");

    expect(chapters?.type === "folder" && chapters.children[0]?.name).toBe(
      "drafts",
    );
  });
});
