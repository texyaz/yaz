/** Reading the project out of an address, and taking it out again. */
import { describe, expect, it } from "vitest";

import { projectIn, withoutProject } from "./address";

describe("projectIn", () => {
  it("reads an encoded absolute path", () => {
    expect(projectIn("?project=%2Fwork%2Fpaper")).toBe("/work/paper");
    expect(projectIn("?a=1&project=%2Fwork%2Fmy%20paper&b=2")).toBe(
      "/work/my paper",
    );
  });

  it("hands on a path as it is, for the server to judge", () => {
    expect(projectIn("?project=..%2Fnowhere")).toBe("../nowhere");
    expect(projectIn("?project=C%3A%5Cwork%5Cpaper")).toBe("C:\\work\\paper");
  });

  it("asks for nothing without a value", () => {
    for (const search of [
      "",
      "?",
      "?project",
      "?project=",
      "?project=%20",
      "?other=/x",
    ]) {
      expect(projectIn(search)).toBeNull();
    }
  });
});

describe("withoutProject", () => {
  it("drops the parameter and keeps the rest", () => {
    expect(withoutProject("/?project=%2Fwork%2Fpaper")).toBe("/");
    expect(withoutProject("/app?a=1&project=%2Fx&b=2#top")).toBe(
      "/app?a=1&b=2#top",
    );
  });

  it("leaves an address without it alone", () => {
    expect(withoutProject("/app?a=1#top")).toBe("/app?a=1#top");
  });
});
