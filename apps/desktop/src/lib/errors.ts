/**
 * Turn whatever a command rejected with into a sentence.
 *
 * A failed command rejects with `{ messageKey, detail }` (ADR-0011): the key is
 * the sentence, in the reader's language, and the detail is what it is about.
 * `String()` of that is `[object Object]`, which is what the status line said
 * for every failure that came from Rust.
 */

import { t } from "./i18n";

export function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null && "messageKey" in error) {
    const { messageKey, detail } = error as {
      messageKey: unknown;
      detail?: unknown;
    };
    const about = typeof detail === "string" ? detail : "";
    if (typeof messageKey === "string") {
      // Catalogue entries name their one placeholder after what it holds, so
      // the detail is offered under each name an entry uses.
      const sentence = t(messageKey, {
        path: about,
        detail: about,
        name: about,
      });
      // `t` hands back the key itself when the catalogue has no such entry;
      // the detail is then the most that can honestly be said.
      if (sentence !== messageKey) return sentence;
      return about || messageKey;
    }
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
