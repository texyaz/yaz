import { beforeEach, describe, expect, it, vi } from "vitest";

import { rememberProject, rememberedProject } from "./session";

beforeEach(() => sessionStorage.clear());

describe("the project a reloaded tab comes back to", () => {
  it("is the one that was open", () => {
    rememberProject("/home/me/thesis");
    expect(rememberedProject()).toBe("/home/me/thesis");
  });

  it("is nothing once the project was closed", () => {
    rememberProject("/home/me/thesis");
    rememberProject(null);
    expect(rememberedProject()).toBeNull();
  });

  it("is nothing, quietly, when storage is refused", () => {
    const refused = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("denied");
      });
    expect(() => rememberProject("/home/me/thesis")).not.toThrow();
    expect(rememberedProject()).toBeNull();
    refused.mockRestore();
  });
});
