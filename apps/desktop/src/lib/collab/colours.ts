/**
 * Who is drawn in which colour (ADR-0035).
 *
 * A pure function of the ids that are present, so that every page computes the
 * same answer without anybody having to agree: the ids are sorted, each takes
 * the slot its hash prefers, and one that finds it taken goes on to the next
 * free slot in the same order. Two tabs of one person have one id and so one
 * colour. With more people than slots the colours repeat.
 */

/** The number of colours the theme defines, `--yaz-presence-1` to `-8`. */
export const PRESENCE_COLOURS = 8;

/** FNV-1a over the UTF-16 units of a string: small, and the same everywhere. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/** A slot from 0 to `palette - 1` for each id. */
export function presenceColours(
  ids: readonly string[],
  palette: number = PRESENCE_COLOURS,
): Map<string, number> {
  const sorted = [...new Set(ids)].sort();
  const taken = new Set<number>();
  const slots = new Map<string, number>();
  for (const id of sorted) {
    const preferred = hash(id) % palette;
    let slot = preferred;
    if (taken.size < palette) {
      while (taken.has(slot)) slot = (slot + 1) % palette;
    }
    taken.add(slot);
    slots.set(id, slot);
  }
  return slots;
}

/** The CSS custom property that holds a slot's colour. */
export function presenceVariable(slot: number): string {
  return `--yaz-presence-${slot + 1}`;
}
