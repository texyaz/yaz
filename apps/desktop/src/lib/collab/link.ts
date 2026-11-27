/**
 * The connection between a page and the session host (ADR-0035).
 *
 * The implementation is the host's own and sits behind an alias, as the
 * account and the start address do: the web build opens a WebSocket to the
 * server the page came from (`src/web/collabLink.ts`), and the desktop build
 * has no host to open one to (`noLink.ts`) until it joins from its own
 * machine. No component asks which one it is.
 */
import { openLink as open } from "@yaz-host/collab-link";

/** One connection. Frames are binary, one message each. */
export interface Link {
  send(frame: Uint8Array): void;
  close(): void;
  onopen: (() => void) | null;
  onframe: ((frame: Uint8Array) => void) | null;
  onclose: (() => void) | null;
}

/** A link to the session of a project, or `null` if this host cannot share. */
export function openLink(root: string): Link | null {
  return open(root);
}
