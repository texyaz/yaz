import { describe, expect, it } from "vitest";
import { PRESENCE_COLOURS, presenceColours, presenceVariable } from "./colours";

describe("presence colours", () => {
  it("are the same on every page, whatever order the ids are heard in", () => {
    const ids = ["0f1e2d3c4b5a6978", "a1b2c3d4e5f60718", "ffeeddccbbaa9988"];
    const one = presenceColours(ids);
    const two = presenceColours([...ids].reverse());
    expect([...one.entries()].sort()).toEqual([...two.entries()].sort());
    expect(one.size).toBe(3);
  });

  it("stay between zero and the palette", () => {
    const ids = Array.from({ length: 200 }, (_, index) => `id-${index}`);
    for (const slot of presenceColours(ids).values()) {
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(PRESENCE_COLOURS);
    }
  });

  it("give two people who prefer one slot two slots, while there are free ones", () => {
    // Ids found to prefer the same slot of eight: probing has to separate them.
    const found: Record<number, string[]> = {};
    for (let index = 0; index < 400; index += 1) {
      const id = `p${index}`;
      const alone = presenceColours([id]).get(id) as number;
      (found[alone] ??= []).push(id);
    }
    const crowded = Object.values(found).find(
      (ids) => ids.length >= 3,
    ) as string[];
    const ids = crowded.slice(0, 3);
    const slots = presenceColours(ids);
    expect(new Set(slots.values()).size).toBe(3);
  });

  it("give eight people eight different colours", () => {
    const ids = Array.from({ length: 8 }, (_, index) => `person-${index}`);
    expect(new Set(presenceColours(ids).values()).size).toBe(8);
  });

  it("repeat only when there are more people than colours", () => {
    const ids = Array.from({ length: 12 }, (_, index) => `person-${index}`);
    const slots = presenceColours(ids);
    expect(slots.size).toBe(12);
    expect(new Set(slots.values()).size).toBe(8);
  });

  it("are one colour for one id, however often it appears", () => {
    const slots = presenceColours(["same", "same", "other"]);
    expect(slots.size).toBe(2);
  });

  it("name the theme's tokens", () => {
    expect(presenceVariable(0)).toBe("--yaz-presence-1");
    expect(presenceVariable(7)).toBe("--yaz-presence-8");
  });
});
