/**
 * What the page makes of the server's answer about who is signed in.
 *
 * The server filters the picture already; the page checks again because it is
 * the page that hands the address to an `<img>`.
 */
import { describe, expect, it } from "vitest";

import { initials, personFrom } from "./person";

describe("personFrom", () => {
  it("reads name, address and picture", () => {
    expect(
      personFrom({
        name: "Ada Lovelace",
        email: "ada@example.org",
        picture: "https://pictures.example.org/ada.png",
      }),
    ).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.org",
      picture: "https://pictures.example.org/ada.png",
    });
  });

  it("leaves out what is not there rather than inventing it", () => {
    expect(personFrom({ name: "Ada" })).toEqual({ name: "Ada" });
    expect(personFrom({ name: "Ada", email: " ", picture: null })).toEqual({
      name: "Ada",
    });
  });

  it("takes no picture that is not https", () => {
    for (const picture of [
      "http://pictures.example.org/ada.png",
      "data:image/png;base64,AAAA",
      "javascript:alert(1)",
      "/ada.png",
      "not an address",
      42,
    ]) {
      expect(personFrom({ name: "Ada", picture })).toEqual({ name: "Ada" });
    }
  });

  it("is nobody without a name", () => {
    for (const value of [null, undefined, "Ada", 3, {}, { name: " " }]) {
      expect(personFrom(value)).toBeNull();
    }
  });
});

describe("initials", () => {
  it("is the first letters of the first and the last word", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("ada king lovelace")).toBe("AL");
    expect(initials("Ada")).toBe("A");
  });

  it("reads a name that is an address or a user name", () => {
    expect(initials("ada.lovelace")).toBe("AL");
    expect(initials("ada_l")).toBe("AL");
  });

  it("keeps a letter beyond ASCII whole", () => {
    expect(initials("Émile Zola")).toBe("ÉZ");
    expect(initials("ärztin")).toBe("Ä");
  });

  it("is never empty", () => {
    expect(initials("")).toBe("?");
    expect(initials(" - ")).toBe("?");
  });
});
