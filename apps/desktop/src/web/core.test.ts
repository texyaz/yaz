/**
 * The web build's `invoke` has one job that is easy to get subtly wrong: a
 * failed command must reject with the *same value* Tauri rejects with, because
 * every caller reads `messageKey` off it to find the sentence to show.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { invoke } from "./core";

function answer(status: number, body: unknown, type = "application/json") {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(text, { status, headers: { "content-type": type } }),
    ),
  );
  return globalThis.fetch as ReturnType<typeof vi.fn>;
}

afterEach(() => vi.unstubAllGlobals());

describe("invoke over HTTP", () => {
  it("posts the arguments to the command's own path, marked as yaz's", async () => {
    const fetched = answer(200, { root: "/thesis" });

    await expect(invoke("open_project", { root: "/thesis" })).resolves.toEqual({
      root: "/thesis",
    });

    const [url, request] = fetched.mock.calls[0]!;
    expect(url).toBe("/api/invoke/open_project");
    expect(request.method).toBe("POST");
    expect(request.headers["x-yaz-web"]).toBe("1");
    expect(JSON.parse(request.body)).toEqual({ root: "/thesis" });
  });

  it("rejects with the command's error value, not a wrapper around it", async () => {
    const error = { messageKey: "error-fs-not-found", detail: "/nowhere" };
    answer(422, error);

    await expect(invoke("open_project", { root: "/nowhere" })).rejects.toEqual(
      error,
    );
  });

  it("rejects with the status when the server itself refused", async () => {
    answer(403, "missing x-yaz-web header", "text/plain");

    await expect(invoke("open_project")).rejects.toBe(
      "403 missing x-yaz-web header",
    );
  });
});
