/**
 * What a reloaded tab should come back to.
 *
 * A phone's browser throws a background tab away to save memory and reloads it
 * when it is looked at again, so without this, answering one message costs the
 * open project. Session storage is exactly the right lifetime: it survives a
 * reload and a discarded tab, and it ends with the tab — or, on the desktop,
 * with the application — so a fresh start is still an empty one.
 */

const KEY = "yaz.session.project";

/** Note which project is open, or that none is. */
export function rememberProject(root: string | null): void {
  try {
    if (root === null) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, root);
  } catch {
    // Storage refused (private browsing, a locked-down profile): the reload
    // starts empty, which is what it did before.
  }
}

/** The project this tab had open before it was reloaded, if it had one. */
export function rememberedProject(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
