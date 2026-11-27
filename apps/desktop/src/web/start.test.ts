/** The web page's start-up request: read once, then gone from the address. */
import { afterEach, describe, expect, it } from "vitest";

import { clearRequestedProject, requestedProject } from "./start";

afterEach(() => history.replaceState(null, "", "/"));

describe("the project the address asks for", () => {
  it("is read from the address", () => {
    history.replaceState(null, "", "/?project=%2Fwork%2Fpaper");
    expect(requestedProject()).toBe("/work/paper");
  });

  it("is nothing for a plain address", () => {
    expect(requestedProject()).toBeNull();
  });

  it("is removed from the address, with the rest kept, without a new history entry", () => {
    history.replaceState({ n: 1 }, "", "/?a=1&project=%2Fwork%2Fpaper#top");
    const before = history.length;

    clearRequestedProject();

    expect(location.pathname + location.search + location.hash).toBe(
      "/?a=1#top",
    );
    expect(requestedProject()).toBeNull();
    expect(history.length).toBe(before);
    expect(history.state).toEqual({ n: 1 });
  });

  it("leaves an address that asks for nothing untouched", () => {
    history.replaceState(null, "", "/?a=1");
    clearRequestedProject();
    expect(location.search).toBe("?a=1");
  });
});
