/**
 * What the address asks yaz to open at start-up, for the desktop build:
 * nothing.
 *
 * The desktop application has no address a person edits or follows. The web
 * build aliases `@yaz-host/start` to `src/web/start.ts`; this is what it
 * resolves to everywhere else, so no component asks which build it is in.
 */

/** The folder the address asks to open, if it asks. */
export function requestedProject(): string | null {
  return null;
}

/** Take the request out of the address once it has been dealt with. */
export function clearRequestedProject(): void {}
