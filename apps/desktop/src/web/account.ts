/**
 * Who is signed in at the yaz web server (ADR-0033).
 *
 * Stands in for `src/lib/account.ts` in the web build. The server answers
 * `GET /auth/me` with the person as JSON, with 204 when it was started
 * without sign-in (so a plain server is not an error in the console), and
 * with 401 for a session that has ended. In none of the last two is there
 * anybody to show; the next request to the server leads to the provider.
 */
import { personFrom, type Person } from "../lib/person";

/** The person signed in at the server the page came from, if any. */
export async function signedInPerson(): Promise<Person | null> {
  try {
    const response = await fetch("/auth/me", {
      headers: { accept: "application/json" },
    });
    // 204 is "nobody to ask"; anything but a JSON answer (a dev server that
    // does not proxy `/auth`, say, and hands back the page) is no person.
    if (
      response.status !== 200 ||
      !response.headers.get("content-type")?.startsWith("application/json")
    ) {
      return null;
    }
    return personFrom(await response.json());
  } catch {
    return null;
  }
}
