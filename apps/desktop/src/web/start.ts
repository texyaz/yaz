/**
 * What the address asks yaz to open at start-up (ADR-0030).
 *
 * Stands in for `src/lib/start.ts` in the web build, so that another
 * application can link straight to a project.
 */
import { projectIn, withoutProject } from "../lib/address";

/** The folder the address asks to open, if it asks. */
export function requestedProject(): string | null {
  return projectIn(location.search);
}

/**
 * Take the request out of the address, so that a reload, or a project opened
 * from the page afterwards, is not overridden by it. Replaces the entry rather
 * than adding one: Back should leave the page, not return to the request.
 */
export function clearRequestedProject(): void {
  if (projectIn(location.search) === null) return;
  history.replaceState(
    history.state,
    "",
    withoutProject(location.pathname + location.search + location.hash),
  );
}
