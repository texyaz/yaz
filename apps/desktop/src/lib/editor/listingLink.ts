/**
 * Where a generated list is actually shown.
 *
 * # Why a list is not drawn on the paper any more
 *
 * `\tableofcontents` is one word in the source and eight pages in the PDF, and
 * for four rounds the preview tried to be those eight pages: divide the
 * entries by height, give each part a sheet of its own, keep them in step with
 * the paper behind them. It never came out right, and the reason is not that
 * the division was badly done. A contents list is the one thing in a document
 * whose length nothing in the buffer determines — it comes from typesetting,
 * which is the compiler's job and not this one's.
 *
 * So the preview stopped guessing. Where a list would be, it draws a card: the
 * list's name and a line saying the compiler makes it. The card is a way in —
 * click it and the list opens in a tab, where it can be as long as it likes
 * because a tab is not a sheet of paper.
 *
 * # Why this is a facet
 *
 * Which tab holds which list is the shell's business, and for the glossary it
 * is a plugin's: `\printglossaries` is the glossaries package's command, so the
 * tab that answers it lives in `yaz-latex-packages`
 * ([ADR-0023](https://generalpawz.github.io/yaz/adr/0023-core-latex-preview)).
 * The editor asks whether anything can show a kind of list, and says so on the
 * card; it never knows what answered.
 */

import { Facet } from "@codemirror/state";

import type { ListingKind } from "./generated";

/** Somewhere a generated list can be read in full. */
export interface ListingTabs {
  /** Whether anything can show this kind of list. */
  has(kind: ListingKind): boolean;
  /** Show it. */
  open(kind: ListingKind): void;
}

/** See {@link ListingTabs}. Absent, a list's card is not a way in. */
export const listingTabs = Facet.define<ListingTabs, ListingTabs | null>({
  combine: (values) => values[0] ?? null,
});
