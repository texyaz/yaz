/**
 * Which PDF is the project's own build.
 *
 * Two places need to know. A project opened with a build already in it shows
 * that PDF without compiling, and a PDF opened from the file list is the
 * compiled document — one a click can be followed back from — when it is that
 * same file. Anything else the author opens is a PDF yaz knows nothing about,
 * and a click in it has no source to go to.
 */

import type { CompileResult, ExistingBuild } from "./ipc";

/**
 * The build output, if `relativePath` is it.
 *
 * It has to have its SyncTeX database beside it: a PDF without one is shown,
 * but there is nothing in it to follow, so it stays "not the compiled output"
 * rather than offering clicks that cannot go anywhere.
 */
export function ownBuild(
  found: ExistingBuild | null,
  relativePath: string,
): ExistingBuild | null {
  if (!found?.synctexPath) return null;
  return found.pdfRelativePath === relativePath ? found : null;
}

/**
 * The SyncTeX database a click in the compiled PDF is looked up in.
 *
 * The compile of this session when there has been one, otherwise the one the
 * project already had.
 */
export function synctexFor(
  result: Pick<CompileResult, "synctexPath"> | null,
  build: Pick<ExistingBuild, "synctexPath"> | null,
): string | null {
  return result?.synctexPath ?? build?.synctexPath ?? null;
}
