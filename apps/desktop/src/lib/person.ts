/**
 * The person a yaz web server says is signed in (ADR-0033).
 *
 * Only what the account control draws: a name, an address to show under it
 * and, if the provider has one, where the browser can fetch a picture.
 */

/** What `GET /auth/me` answers for a signed-in request. */
export interface Person {
  name: string;
  email?: string;
  /** An `https://` address the browser loads itself. */
  picture?: string;
}

/**
 * The person in an `/auth/me` answer, or `null` if it is not one.
 *
 * Read defensively although the server wrote it: the control draws whatever
 * this returns, and a picture address is only ever used if it is `https:`, so
 * that a page served from a server that is somehow wrong cannot be made to
 * load anything else.
 */
export function personFrom(value: unknown): Person | null {
  if (typeof value !== "object" || value === null) return null;
  const { name, email, picture } = value as Record<string, unknown>;
  if (typeof name !== "string" || name.trim() === "") return null;
  const person: Person = { name: name.trim() };
  if (typeof email === "string" && email.trim() !== "") {
    person.email = email.trim();
  }
  if (typeof picture === "string" && isHttps(picture)) person.picture = picture;
  return person;
}

function isHttps(address: string): boolean {
  try {
    return new URL(address).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Up to two letters to stand in for a picture: the first of the first and of
 * the last word of the name, in capitals. `?` for a name with no letter in it,
 * so that the control is never an empty circle.
 */
export function initials(name: string): string {
  const words = name
    .split(/[\s,._-]+/u)
    .map((word) => Array.from(word).find((c) => /\p{L}|\p{N}/u.test(c)))
    .filter((first): first is string => first !== undefined);
  const first = words[0];
  if (first === undefined) return "?";
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return (first + (last ?? "")).toLocaleUpperCase();
}
