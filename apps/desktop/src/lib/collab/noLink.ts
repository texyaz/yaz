/**
 * The session link for the desktop build: there is none.
 *
 * The desktop application hosts its own sessions only once it can join a
 * collaboration server from its own machine, which is a later step of
 * ADR-0035. The web build aliases `@yaz-host/collab-link` to
 * `src/web/collabLink.ts`; this is what that module resolves to everywhere
 * else, and the desktop bundle never contains a request for it.
 */
import type { Link } from "./link";

/** A project cannot be shared from here. */
export function openLink(_root: string): Link | null {
  return null;
}
