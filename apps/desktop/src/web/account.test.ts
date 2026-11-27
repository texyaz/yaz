/**
 * Asking the server who is signed in must not be an error when nobody is.
 *
 * A server started without sign-in answers 204 and one with it answers a
 * person; the page tells the two apart by that and never by a failure.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { signedInPerson } from "./account";

function answer(status: number, body?: unknown, type = "application/json") {
  const text = body === undefined ? null : JSON.stringify(body);
  const fetched = vi.fn(
    async (_address: string, _init?: RequestInit) =>
      new Response(text, { status, headers: { "content-type": type } }),
  );
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

afterEach(() => vi.unstubAllGlobals());

describe("signedInPerson", () => {
  it("asks /auth/me and returns the person", async () => {
    const fetched = answer(200, {
      name: "Ada Lovelace",
      email: "ada@example.org",
      picture: "https://pictures.example.org/ada.png",
    });

    await expect(signedInPerson()).resolves.toEqual({
      name: "Ada Lovelace",
      email: "ada@example.org",
      picture: "https://pictures.example.org/ada.png",
    });
    expect(fetched.mock.calls[0]![0]).toBe("/auth/me");
  });

  it("is nobody when the server has no sign-in", async () => {
    answer(204);
    await expect(signedInPerson()).resolves.toBeNull();
  });

  it("is nobody when the session has ended", async () => {
    answer(401, "not signed in", "text/plain");
    await expect(signedInPerson()).resolves.toBeNull();
  });

  it("is nobody when the answer is the page itself", async () => {
    // A dev server that does not forward `/auth` hands back index.html.
    answer(200, "<html></html>", "text/html");
    await expect(signedInPerson()).resolves.toBeNull();
  });

  it("is nobody when the server cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    await expect(signedInPerson()).resolves.toBeNull();
  });
});
