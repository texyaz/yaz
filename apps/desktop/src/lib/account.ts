/**
 * Who is signed in, for the desktop build: nobody.
 *
 * The desktop application has no sign-in (ADR-0033 is about the web server),
 * so the account control has nobody to show. The web build aliases
 * `@yaz-host/account` to `src/web/account.ts`, which asks the server; this is
 * what that module resolves to everywhere else, and the desktop bundle never
 * contains a request for it.
 */
import type { Person } from "./person";

/** The person signed in at the server the page came from, if any. */
export async function signedInPerson(): Promise<Person | null> {
  return null;
}
