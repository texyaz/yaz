/**
 * The account control: the person when there is one, the stub when not, and
 * the picture only as long as the browser can load it.
 */
import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Person } from "./person";

const signedInPerson = vi.hoisted(() => vi.fn<() => Promise<Person | null>>());
vi.mock("@yaz-host/account", () => ({ signedInPerson }));

import Account from "./Account.svelte";

const ADA: Person = {
  name: "Ada Lovelace",
  email: "ada@example.org",
  picture: "https://pictures.example.org/ada.png",
};

async function mount(person: Person | null) {
  signedInPerson.mockResolvedValue(person);
  const view = render(Account);
  await vi.waitFor(() => expect(signedInPerson).toHaveBeenCalled());
  await tick();
  await tick();
  return view;
}

beforeEach(() => signedInPerson.mockReset());

describe("Account", () => {
  it("is the stub where nobody is signed in", async () => {
    await mount(null);
    const stub = screen.getByRole("button", { name: "Account" });
    expect(stub.getAttribute("aria-expanded")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows the picture, loaded by the browser and with no referrer", async () => {
    const { container } = await mount(ADA);
    const picture = container.querySelector("img");
    expect(picture?.getAttribute("src")).toBe(ADA.picture);
    expect(picture?.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("falls back to initials when the picture does not load", async () => {
    const { container } = await mount(ADA);
    await fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("AL")).toBeTruthy();
  });

  it("draws initials when there is no picture", async () => {
    await mount({ name: "Ada Lovelace" });
    expect(screen.getByText("AL")).toBeTruthy();
  });

  it("opens to the name, the address and the way out", async () => {
    await mount(ADA);
    const button = screen.getByRole("button", {
      name: "Account of Ada Lovelace",
    });
    expect(button.getAttribute("aria-expanded")).toBe("false");

    await fireEvent.click(button);

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("ada@example.org")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Sign out" }).getAttribute("href"),
    ).toBe("/auth/logout");
  });

  it("closes on Escape and gives the focus back", async () => {
    await mount(ADA);
    const button = screen.getByRole("button", {
      name: "Account of Ada Lovelace",
    });
    await fireEvent.click(button);
    await fireEvent.keyDown(screen.getByRole("link", { name: "Sign out" }), {
      key: "Escape",
    });

    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("closes on a click elsewhere", async () => {
    await mount(ADA);
    await fireEvent.click(
      screen.getByRole("button", { name: "Account of Ada Lovelace" }),
    );
    await fireEvent.click(document.body);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
