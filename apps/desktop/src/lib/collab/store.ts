/**
 * Where the page reads and writes a project's text (ADR-0035).
 *
 * Without a session this is the file commands. In one, a shared file's text
 * is the session's: the page never writes it to the folder, so a write here
 * becomes an edit of the shared text, and the host writes the file. Reading
 * from the session gives what is on screen even before the host has written
 * it. A file the session does not share is the folder's, as ever.
 */
import * as ipc from "../ipc";
import type { Session } from "./session";

let active: Session | null = null;

/** The session reads and writes go through, or none. */
export function useSession(session: Session | null): void {
  active = session;
}

function sharedIn(root: string, path: string): Session | null {
  return active && active.root === root && active.has(path) ? active : null;
}

/** A project file's text. */
export async function readText(root: string, path: string): Promise<string> {
  const shared = sharedIn(root, path)?.text(path);
  return shared ?? ipc.readFile(root, path);
}

/**
 * Write a project file. For a shared one this is an edit of the shared text,
 * and the host is asked to bring the folder up to date before this returns, so
 * that whoever asked can rely on the file as a write would have left it.
 */
export async function writeText(
  root: string,
  path: string,
  contents: string,
): Promise<void> {
  const session = sharedIn(root, path);
  if (!session) return ipc.writeFile(root, path, contents);
  session.replace(path, contents);
  await session.flush();
}
