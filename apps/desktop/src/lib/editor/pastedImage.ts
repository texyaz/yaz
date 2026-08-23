/**
 * An image on the clipboard, becoming a figure in the document.
 *
 * # Why this is worth building
 *
 * The Snipping Tool, a screenshot shortcut and every diagram editor put a
 * picture on the clipboard and nowhere else. Getting it into a `.tex` otherwise
 * means: find somewhere to save it, invent a file name, remember the path,
 * type a `figure` environment around an `\includegraphics`, and get the
 * relative path right. That is five steps for something every other editor does
 * with one keystroke.
 *
 * # What it decides, and what it leaves alone
 *
 * The file name is derived from the document rather than asked for, because a
 * dialog per paste is the thing that stops people pasting. The rest of the
 * figure — the caption, the label — is left empty for the author, since only
 * they know what the picture is.
 *
 * The deciding is here and the writing is the shell's: naming a file and
 * building the markup are arithmetic on strings, and arithmetic that decides
 * what ends up in somebody's document is worth being able to ask directly.
 */

/** A backslash, so the template below reads as what it is. */
const B = String.fromCharCode(92);

/**
 * Where pasted pictures go when a project has not said otherwise.
 *
 * `images` rather than `figures` or `img`: it is what the LaTeX templates this
 * was built against use, and a directory that already exists is one nobody has
 * to think about. A project that wants another says so in its own settings.
 */
export const DEFAULT_IMAGES = "images";

/**
 * The image types worth taking off the clipboard.
 *
 * PNG is what a screenshot is. JPEG and WebP turn up from a browser. Anything
 * else — a TIFF from a scanner, an HEIC from a phone — LaTeX cannot include
 * without a conversion step this does not do, so it is declined rather than
 * written into a document that will fail to compile.
 */
const SUFFIXES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Whether a clipboard entry is a picture this can use. */
export function usableImage(type: string): boolean {
  return type in SUFFIXES;
}

/**
 * The picture on a clipboard, if there is one.
 *
 * Both places are looked at, because engines disagree about which they fill:
 * `items` is what a paste from a screenshot tool populates in Chromium, and
 * `files` is what some builds give instead — and WebView2 has been seen to do
 * each. Looking at only one was why a paste could do nothing at all.
 *
 * A type LaTeX cannot include is declined here rather than further down, so
 * that a paste of, say, a copied paragraph falls through to the ordinary text
 * handling untouched.
 */
export function imageOnClipboard(data: DataTransfer | null): File | null {
  if (!data) return null;

  for (const file of data.files ?? []) {
    if (usableImage(file.type)) return file;
  }
  for (const item of data.items ?? []) {
    if (item.kind !== "file" || !usableImage(item.type)) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}

/** The file extension for a clipboard type, or `null` if it is not one. */
export function suffixFor(type: string): string | null {
  return SUFFIXES[type] ?? null;
}

/**
 * The path as the document has to write it.
 *
 * `\includegraphics` resolves relative to the *main* file, and the shell writes
 * everything relative to the project root, so those agree for a document whose
 * entry is at the root — which is every project yaz makes. A chapter in a
 * subdirectory still refers to `images/…` because that is where the compiler
 * looks from, not where the chapter is.
 *
 * Forward slashes always: a backslash in a LaTeX path is an escape, so a
 * Windows separator would produce markup that does not compile on the machine
 * that wrote it.
 */
export function includePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

/**
 * A name for the pasted file that will still mean something next month.
 *
 * Built from the document it was pasted into and a count, so a chapter's
 * pictures sort together in the directory listing and the name says where it
 * came from. `pasted-1.png` in a folder of forty says nothing.
 *
 * `taken` is the names already there; the count steps past them rather than
 * overwriting, because a paste that silently replaced last week's figure would
 * be a paste nobody could trust.
 *
 * `directory` is where the project keeps its pictures, which a template often
 * dictates — some want `images/`, some `figures/`.
 */
export function nameFor(
  documentPath: string,
  suffix: string,
  taken: readonly string[],
  directory: string = DEFAULT_IMAGES,
): string {
  const base = documentPath
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]*$/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const stem = base === "" ? "figure" : base;

  // Trimmed of separators, so a directory typed with a leading slash, a
  // trailing one, or Windows ones still produces one clean path rather than a
  // doubled or a reversed one.
  const home = includePath(directory)
    .trim()
    .replace(/^\/+|\/+$/g, "");
  const into = home === "" ? DEFAULT_IMAGES : home;

  const used = new Set(taken.map((name) => name.toLowerCase()));
  for (let count = 1; ; count += 1) {
    const candidate = `${into}/${stem}-${count}.${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * The figure to insert for a pasted image.
 *
 * A whole `figure` rather than a bare `\includegraphics`, because a picture in
 * a paper is referred to and one without a label cannot be — and because the
 * caption is the thing the author should be prompted to write while they still
 * remember what they pasted.
 */
export function figureFor(relativePath: string): string {
  return [
    `${B}begin{figure}[h]`,
    `  ${B}centering`,
    // A width relative to the measure: an image at its natural size is an
    // image that runs off the paper.
    `  ${B}includegraphics[width=0.8${B}textwidth]{${includePath(relativePath)}}`,
    `  ${B}caption{}`,
    `  ${B}label{fig:}`,
    `${B}end{figure}`,
  ].join("\n");
}

/**
 * Where the caret should land after the figure is inserted.
 *
 * Inside the empty `\caption{}`, because that is the one part of what was just
 * written that only the author can fill in, and they will never be better
 * placed to do it than immediately after pasting.
 */
export function captionOffset(figure: string): number {
  const at = figure.indexOf(`${B}caption{`);
  return at === -1 ? figure.length : at + `${B}caption{`.length;
}
