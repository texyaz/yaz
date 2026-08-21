/**
 * How the text is set in the pane.
 *
 * Three, not two. There used to be a page switch and nothing else, which made
 * the choice "a sheet of A4, or the raw width of whatever pane you dragged
 * open" — and the second of those is not a way anybody wants to read prose. A
 * paragraph set across a wide monitor is a paragraph nobody's eye can track
 * back to the start of.
 *
 * So the middle option is the one most writing happens in: a column of a
 * sensible measure, centred, with the pane's width around it. It is what
 * Obsidian does and what a word processor does before you ask it for a page,
 * and unlike the page it needs no paper size — which is why it is offered for
 * every text format and the page view is not.
 */
export type DocumentView = "plain" | "continuous" | "page";

/** The order the View menu offers them in, widest measure first. */
export const DOCUMENT_VIEWS: readonly DocumentView[] = [
  "plain",
  "continuous",
  "page",
];

/**
 * Whether a format can be set on paper.
 *
 * The page view draws a sheet of a size the document declares — `a4paper` in a
 * `\documentclass` — and a Markdown file declares nothing of the kind. Offering
 * it anyway would mean choosing a paper size on the author's behalf and then
 * showing them page breaks that no build of their file will ever produce.
 *
 * The continuous view has no such problem, which is the point of it.
 */
export function canPaginate(format: string | null): boolean {
  return format === "latex";
}

/**
 * The view to fall back to when the chosen one does not apply.
 *
 * Switching to a Markdown file with the page view on leaves the page view
 * chosen — so that switching back to the `.tex` restores it — but what is drawn
 * is the continuous view, which is the nearest thing that means anything for a
 * file with no paper size.
 */
export function viewFor(
  chosen: DocumentView,
  format: string | null,
): DocumentView {
  return chosen === "page" && !canPaginate(format) ? "continuous" : chosen;
}
