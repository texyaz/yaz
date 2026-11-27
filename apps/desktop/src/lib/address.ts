/**
 * The project an address asks for (ADR-0030).
 *
 * A yaz served to a browser can be linked to: `/?project=%2Fwork%2Fpaper`
 * opens that folder, as the server sees it, instead of the last one. These are
 * the two halves that are plain text work, apart from the page that does them.
 */

/** The query parameter that names the project. */
const PARAMETER = "project";

/**
 * The folder the query asks to open, or `null` if it does not ask.
 *
 * Whatever is given is handed on as it is: whether it is a folder the server
 * can open is the server's to say, exactly as for a path typed into the
 * picker. An empty or blank value asks for nothing.
 */
export function projectIn(search: string): string | null {
  const asked = new URLSearchParams(search).get(PARAMETER)?.trim();
  return asked ? asked : null;
}

/**
 * The same address without the project parameter, ready for
 * `history.replaceState`: path, the rest of the query and the fragment stay.
 */
export function withoutProject(
  href: string,
  base = "http://yaz.invalid",
): string {
  const address = new URL(href, base);
  address.searchParams.delete(PARAMETER);
  return address.pathname + address.search + address.hash;
}
