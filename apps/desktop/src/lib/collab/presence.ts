/**
 * Who a page says it is, and who it sees (ADR-0035).
 *
 * The awareness state a page publishes is
 * `{ user: { id, name, picture? }, file, cursor: { anchor, head } }`, the
 * positions as Yjs relative positions in that file's text. What a person
 * claims here is self-declared: among people who share a server it is a label
 * and not a boundary.
 */
import type { Person } from "../person";

/** The identity a page publishes. */
export interface PresenceUser {
  id: string;
  /** Empty for somebody who is not signed in; receivers draw "Someone". */
  name: string;
  picture?: string;
}

/** Somebody else in the session, as the title bar draws them. */
export interface CollabPerson {
  name: string;
  initials: string;
  /** The colour slot, from 1 to 8. */
  colour: number;
  /** Where their caret is, for the tooltip. */
  file: string | null;
  /** An `https` address the browser loads itself. */
  picture?: string | undefined;
}

/** The session, as the title bar shows it where the save toggle was. */
export interface CollabBar {
  state:
    | "starting"
    | "ready"
    | "reconnecting"
    | "unavailable"
    | "restarted"
    | "incompatible";
  /** Whether this page holds changes its host has not been sent. */
  unsent: boolean;
  people: CollabPerson[];
}

/** Somebody else in the session, as the interface draws them. */
export interface Peer {
  clientId: number;
  user: PresenceUser;
  /** The file their caret is in, if they have one. */
  file: string | null;
  /** The colour slot, 0-based. */
  colour: number;
}

/** The first sixteen hex digits of the SHA-256 of a text. */
export function shortDigest(text: string): string {
  return sha256(new TextEncoder().encode(text)).slice(0, 16);
}

/**
 * The identity to publish: derived from the sign-in so that two tabs of one
 * person are one colour, and the e-mail address itself never leaves the page.
 * Without sign-in, a random id that lasts as long as the tab.
 */
export function userFor(
  person: Person | null,
  storage: Pick<Storage, "getItem" | "setItem"> = sessionStorage,
): PresenceUser {
  if (person) {
    const user: PresenceUser = {
      id: shortDigest((person.email ?? person.name).toLowerCase()),
      name: person.name,
    };
    if (person.picture) user.picture = person.picture;
    return user;
  }
  const key = "yaz-presence-id";
  let id = storage.getItem(key);
  if (!id) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
    storage.setItem(key, id);
  }
  return { id, name: "" };
}

/** Read what a remote page published, defensively: it is whatever it sent. */
export function userIn(state: unknown): PresenceUser | null {
  if (typeof state !== "object" || state === null) return null;
  const { user } = state as { user?: unknown };
  if (typeof user !== "object" || user === null) return null;
  const { id, name, picture } = user as Record<string, unknown>;
  if (typeof id !== "string" || id === "") return null;
  const read: PresenceUser = { id, name: typeof name === "string" ? name : "" };
  // Only an https address is ever loaded, as for the account control.
  if (typeof picture === "string" && picture.startsWith("https://")) {
    read.picture = picture;
  }
  return read;
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * SHA-256, in plain code. `crypto.subtle` exists only in a secure context, and
 * a yaz server reached over plain `http` on a private address is not one; an
 * id needs a stable digest of a short text, not a hardware-backed one.
 */
export function sha256(message: Uint8Array): string {
  const length = message.length;
  const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
  padded.set(message);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((length * 8) / 2 ** 32));
  view.setUint32(padded.length - 4, (length * 8) >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotate = (value: number, bits: number) =>
    (value >>> bits) | (value << (32 - bits));
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15] ?? 0;
      const b = w[i - 2] ?? 0;
      const s0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3);
      const s1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = Array.from(h) as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + choice + (K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((value, i) => {
      h[i] = ((h[i] ?? 0) + value) >>> 0;
    });
  }
  return Array.from(h, (word) => word.toString(16).padStart(8, "0")).join("");
}
