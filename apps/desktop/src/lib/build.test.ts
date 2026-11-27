import { describe, expect, it } from "vitest";
import { ownBuild, synctexFor } from "./build";
import type { ExistingBuild } from "./ipc";

const found: ExistingBuild = {
  pdfPath: "/work/paper/build/main.pdf",
  pdfRelativePath: "build/main.pdf",
  synctexPath: "/work/paper/build/main.synctex.gz",
  stale: false,
};

describe("ownBuild", () => {
  it("is the PDF the last compile wrote", () => {
    expect(ownBuild(found, "build/main.pdf")).toBe(found);
  });

  it("is not any other PDF", () => {
    expect(ownBuild(found, "figures/main.pdf")).toBeNull();
    expect(ownBuild(found, "build/other.pdf")).toBeNull();
    expect(ownBuild(found, "Build/main.pdf")).toBeNull();
  });

  it("is nothing when there is no build or no SyncTeX file to follow", () => {
    expect(ownBuild(null, "build/main.pdf")).toBeNull();
    expect(
      ownBuild({ ...found, synctexPath: null }, "build/main.pdf"),
    ).toBeNull();
  });
});

describe("synctexFor", () => {
  it("prefers the compile of this session", () => {
    expect(synctexFor({ synctexPath: "/new.synctex.gz" }, found)).toBe(
      "/new.synctex.gz",
    );
  });

  it("falls back to the build the project already had", () => {
    expect(synctexFor(null, found)).toBe(found.synctexPath);
    expect(synctexFor({ synctexPath: null }, found)).toBe(found.synctexPath);
  });

  it("is nothing without either", () => {
    expect(synctexFor(null, null)).toBeNull();
  });
});
