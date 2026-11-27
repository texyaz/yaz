import { describe, expect, it } from "vitest";

import { describeError } from "./errors";

describe("describing a failure", () => {
  it("never says [object Object] for a command's error", () => {
    const said = describeError({
      messageKey: "error-fs-not-found",
      detail: "/thesis/missing.tex",
    });
    expect(said).not.toContain("[object");
    expect(said).toContain("/thesis/missing.tex");
  });

  it("falls back to the detail when the catalogue has no such sentence", () => {
    expect(
      describeError({
        messageKey: "error-not-in-catalogue",
        detail: "what broke",
      }),
    ).toBe("what broke");
  });

  it("passes a plain string and an Error through", () => {
    expect(describeError("403 refused")).toBe("403 refused");
    expect(describeError(new Error("offline"))).toBe("offline");
  });
});
