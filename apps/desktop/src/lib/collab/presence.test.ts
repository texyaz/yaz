import { describe, expect, it } from "vitest";
import { sha256, shortDigest, userFor, userIn } from "./presence";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("sha256", () => {
  it("matches the published test vectors", () => {
    expect(sha256(bytes(""))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256(bytes("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(
      sha256(bytes("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("agrees with the platform on text that is longer than a block", async () => {
    for (const long of [
      "Grüße 😀 ".repeat(40),
      "x".repeat(55),
      "x".repeat(56),
      "x".repeat(64),
    ]) {
      const platform = new Uint8Array(
        await globalThis.crypto.subtle.digest("SHA-256", bytes(long)),
      );
      const expected = Array.from(platform, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      expect(sha256(bytes(long))).toBe(expected);
    }
  });
});

describe("who a page says it is", () => {
  const memory = () => {
    const kept = new Map<string, string>();
    return {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    };
  };

  it("is derived from the e-mail address, which never leaves the page", () => {
    const user = userFor({ name: "Ada", email: "Ada@Example.org" }, memory());
    expect(user.id).toBe(shortDigest("ada@example.org"));
    expect(user.id).toHaveLength(16);
    expect(JSON.stringify(user)).not.toContain("example.org");
    expect(user.name).toBe("Ada");
  });

  it("is the same for two tabs of one person, and differs between people", () => {
    const a = userFor({ name: "Ada", email: "ada@example.org" }, memory());
    const b = userFor({ name: "Ada", email: "ADA@example.org" }, memory());
    const c = userFor({ name: "Bo", email: "bo@example.org" }, memory());
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
  });

  it("falls back to the name when the provider gave no address", () => {
    expect(userFor({ name: "Ada" }, memory()).id).toBe(shortDigest("ada"));
  });

  it("is a random id for somebody not signed in, kept for the tab, with no name", () => {
    const storage = memory();
    const first = userFor(null, storage);
    expect(first.name).toBe("");
    expect(first.id).toMatch(/^[0-9a-f]{16}$/);
    expect(userFor(null, storage).id).toBe(first.id);
    expect(userFor(null, memory()).id).not.toBe(first.id);
  });

  it("is read defensively from what somebody else sent", () => {
    expect(userIn(null)).toBeNull();
    expect(userIn({})).toBeNull();
    expect(userIn({ user: { id: "" } })).toBeNull();
    expect(userIn({ user: { id: "abc", name: 7 } })).toEqual({
      id: "abc",
      name: "",
    });
    expect(
      userIn({ user: { id: "a", name: "Ada", picture: "http://x/a.png" } }),
    ).toEqual({ id: "a", name: "Ada" });
    expect(
      userIn({ user: { id: "a", name: "Ada", picture: "https://x/a.png" } }),
    ).toEqual({ id: "a", name: "Ada", picture: "https://x/a.png" });
  });
});
