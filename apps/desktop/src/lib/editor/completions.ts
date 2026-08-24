/**
 * Completion, wired to the editor.
 *
 * # What this costs on the keystroke path
 *
 * Nothing. There is no state field, no update listener and no document scan on
 * change. CodeMirror asks a source only when the completion machinery is active,
 * which — because the triggers here are syntax rather than word characters —
 * means when somebody typed a backslash or the brace of a command that takes a
 * key ([ADR-0027]).
 *
 * The one function that reads the whole document, {@link labelsIn}, is called on
 * that trigger and its answer is cached against the document's generation, so
 * typing further characters filters rather than rescans.
 *
 * # Where the candidates come from
 *
 * Every one of them is already in the editor's state for another reason: the
 * vocabulary registry the preview uses, the bibliography the shell loaded, the
 * glossary the packages plugin extracts, the project's files. Nothing here goes
 * and fetches anything, which is why it can answer synchronously.
 *
 * [ADR-0027]: https://texyaz.github.io/yaz/adr/0027-completion-while-typing
 */

import { Facet } from "@codemirror/state";
import type { Extension, Text } from "@codemirror/state";
import { autocompletion, startCompletion } from "@codemirror/autocomplete";
import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";

import { t } from "../i18n";
import {
  LABEL_PREFIXES,
  labelsIn,
  LOOKBEHIND,
  rank,
  STANDARD_CLASSES,
  STRUCTURAL_COMMANDS,
  triggerAt,
} from "./completion";
import type { Suggestion, Trigger } from "./completion";
import { glossaryEntries } from "./generated";
import type { Entry } from "./generated";
import { sectionNumbers } from "./semantics";
import { braceCommands, headings, plainText } from "./structure";
import { bibliography } from "./semanticView";
import { environmentsOfKind, knownCommands } from "./vocabulary";

/**
 * Whether this buffer is LaTeX at all.
 *
 * A facet rather than a decision taken when the extension is built: the editor
 * keeps its state across a file switch, so a `.tex` closed and a `.md` opened
 * would otherwise keep offering `\\parencite`. The triggers here are LaTeX's,
 * and there is nothing to offer for a format that does not have them.
 */
export const latexBuffer = Facet.define<boolean, boolean>({
  combine: (values) => values.at(-1) ?? false,
});

/**
 * The project's files, for the commands that name one.
 *
 * A facet rather than a module-level list: which project is open is the shell's
 * business, and a completion source that reached for it would be a second place
 * that knows.
 */
export const projectFiles = Facet.define<readonly string[], readonly string[]>({
  combine: (values) => values.at(-1) ?? [],
});

/** What was last read out of a document. */
interface Cached {
  labels: Suggestion[];
  glossary: Suggestion[];
}

/**
 * What was read, keyed by the document it was read from.
 *
 * By the `Text` object itself, not by a fingerprint of it. CodeMirror's document
 * is immutable, so a change produces a different object and a stale answer is
 * impossible rather than merely unlikely — where a fingerprint of length and
 * line count would have survived renaming `\label{a}` to `\label{b}`, which
 * changes neither and changes exactly what this caches.
 *
 * Weak, so the old versions of a document somebody has been typing into for an
 * hour are collected rather than kept.
 */
const cache = new WeakMap<Text, Cached>();

/** Read the document, or hand back what was read from this version of it. */
function readDocument(doc: Text): Cached {
  const remembered = cache.get(doc);
  if (remembered) return remembered;

  const text = doc.toString();
  // What each heading and caption in the text is called, with the number LaTeX
  // will print in front of it, so a label can say "3.2 Kosten" rather than
  // `sec:kosten`. The numbering comes from the same walk the outline uses.
  const found: Cached = {
    labels: labelsIn(text, namedThings(text)),
    glossary: glossaryEntries(text).map(glossarySuggestion),
  };
  cache.set(doc, found);
  return found;
}

/**
 * One glossary entry, as something worth reading in a list.
 *
 * A glossary entry has up to three parts and the key is the least informative
 * of them: it is what `\gls{}` takes, and that is all. So the key is the label
 * — it is what gets inserted and what typing is matched against — and the line
 * beside it carries whichever of the other two actually says something.
 *
 * For `\newacronym{AIA}{AIA}{Auftraggeber-Informationsanforderungen}` the name
 * *is* the key, which is how the list came to read "AIA — AIA". The expansion
 * is the only part that tells anybody anything, so that is what shows.
 */
function glossarySuggestion(entry: Entry): Suggestion {
  const key = entry.key ?? entry.label;
  const name = entry.label;
  const description = entry.detail ?? undefined;

  // The name where it adds something, the description where the name does not.
  const beside = name !== key ? name : description;
  const suggestion: Suggestion = { label: key };
  if (beside !== undefined) suggestion.detail = beside;
  // Only when it is not already what is on the line.
  if (description !== undefined && description !== beside) {
    suggestion.info = description;
  }
  return suggestion;
}

/**
 * What each heading and caption in the text is called, by where it starts.
 *
 * Headings carry the number LaTeX will print, from the same function the
 * outline uses, so the two cannot disagree. Captions carry their words, which
 * is what tells one figure from another.
 *
 * Read on a trigger like everything else here, never on a change.
 */
function namedThings(text: string): Map<number, string> {
  const named = new Map<number, string>();

  const found = headings(text);
  const numbers = sectionNumbers(found);
  for (const heading of found) {
    const number = numbers.get(heading.from);
    const title = plainText(heading.title);
    named.set(heading.from, number ? `${number} ${title}` : title);
  }

  for (const caption of braceCommands(text, ["caption"])) {
    named.set(
      caption.from,
      plainText(text.slice(caption.argFrom, caption.argTo)),
    );
  }

  return named;
}

/**
 * Every command yaz knows, as suggestions.
 *
 * Two sources, because the vocabulary registry is not a list of commands: it
 * answers "how is this drawn", and the preview draws sectioning and
 * environments from the document's structure rather than by name. So
 * `\\section` is not in it, and an author types little else.
 */
function commandSuggestions(): Suggestion[] {
  const found = new Map<string, Suggestion>();

  for (const name of STRUCTURAL_COMMANDS) found.set(name, { label: name });
  for (const { name, provider } of knownCommands()) {
    found.set(name, {
      label: name,
      // Which package it comes from, or nothing for the ones LaTeX itself
      // defines — the distinction ADR-0023 draws, where it matters.
      detail: provider ?? undefined,
    });
  }

  return [...found.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** The environments a `\begin{` could open. */
function environmentSuggestions(): Suggestion[] {
  const names = new Set<string>();
  for (const kind of [
    "structural",
    "list",
    "table",
    "math",
    "float",
    "turned",
    "quote",
    "verbatim",
  ] as const) {
    for (const name of environmentsOfKind(kind)) names.add(name);
  }
  // The ones the kernel has that no vocabulary needs to declare, because the
  // preview draws them from the structure rather than from a name.
  for (const name of ["document", "abstract", "titlepage", "center"]) {
    names.add(name);
  }
  return [...names].sort().map((label) => ({ label }));
}

/** Project files an argument could name, filtered to the ones that fit. */
function fileSuggestions(
  files: readonly string[],
  kind: "image" | "file",
): Suggestion[] {
  const wanted =
    kind === "image" ? /\.(png|jpe?g|pdf|eps|webp)$/i : /\.(tex|ltx)$/i;
  return files
    .filter((path) => wanted.test(path))
    .map((path) => ({
      // `\includegraphics` resolves the extension itself, and a path written
      // without one keeps working if the picture is later replaced by a PDF.
      label: kind === "image" ? path.replace(/\.[^./]+$/, "") : path,
      detail: kind === "image" ? path.split(".").pop() : undefined,
    }));
}

/** What to offer for a trigger, from what the editor already holds. */
function candidatesFor(
  trigger: Trigger,
  context: CompletionContext,
): Suggestion[] {
  if (trigger.kind === "command") return commandSuggestions();

  const state = context.state;
  switch (trigger.argument) {
    case "labelKind":
      // The kinds first: "which of the forty labels" is a question nobody can
      // answer from a list, and "a section or a figure" is one everybody can.
      return labelKinds(readDocument(state.doc).labels);

    case "label":
      // Left in the order the document puts them, which for sections is the
      // order they are numbered. Sorting alphabetically would interleave
      // `sec:anhang` between 2 and 3.
      return readDocument(state.doc).labels;

    case "citation":
      return [...state.facet(bibliography).values()].map((entry) => ({
        label: entry.key,
        // What the list reads as. A citation key is a handle, not a name —
        // `spielbauer2020` tells nobody which of four books it is — so the
        // author, year and title go where the eye lands. The key is still what
        // goes into the document.
        display: entry.label,
        detail: entry.detail,
      }));

    case "glossary":
      return readDocument(state.doc).glossary;

    case "environment":
      return environmentSuggestions();

    case "image":
      return fileSuggestions(state.facet(projectFiles), "image");

    case "file":
      return fileSuggestions(state.facet(projectFiles), "file");

    case "class":
      return STANDARD_CLASSES.map((label) => ({ label }));

    case "package":
      // Only what yaz's plugins know about, and it says so. What is *installed*
      // needs the TeX tree, which only the Rust process may read — the language
      // server's job when there is one (ADR-0027).
      return packageSuggestions();

    default:
      return [];
  }
}

/**
 * The kinds of thing this document refers to, as prefixes.
 *
 * The conventional ones, and whatever else the document actually uses: a paper
 * that labels its figures `bild:` gets `bild:` offered, because the convention
 * is a convention and not a rule.
 *
 * Each says how many there are, which is the other half of the question — "12
 * sections" is a different answer from "no sections yet".
 */
function labelKinds(labels: readonly Suggestion[]): Suggestion[] {
  const counts = new Map<string, number>();
  for (const label of labels) {
    const colon = label.label.indexOf(":");
    if (colon <= 0) continue;
    const prefix = label.label.slice(0, colon);
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }

  const found: Suggestion[] = [];
  for (const { prefix, kindKey } of LABEL_PREFIXES) {
    const count = counts.get(prefix);
    // The colon comes with it: choosing "section" leaves the cursor after
    // `sec:` and the labels themselves open straight away.
    found.push({
      label: `${prefix}:`,
      display: t(kindKey),
      reopen: true,
      ...(count === undefined ? {} : { detail: String(count) }),
    });
    counts.delete(prefix);
  }

  // Whatever else the document uses, after the ones everybody knows.
  for (const [prefix, count] of [...counts].sort()) {
    found.push({ label: `${prefix}:`, detail: String(count), reopen: true });
  }
  return found;
}

/** The packages yaz understands, which is not the same as the ones installed. */
function packageSuggestions(): Suggestion[] {
  const providers = new Set<string>();
  for (const { provider } of knownCommands()) {
    if (provider) providers.add(provider);
  }
  return [...providers].sort().map((label) => ({
    label,
    detail: t("completion-package-known"),
  }));
}

/** Turn a suggestion into what CodeMirror draws. */
function asCompletion(suggestion: Suggestion): Completion {
  const completion: Completion = { label: suggestion.label };
  // What is shown, where it differs from what is inserted: a citation reads as
  // "Spielbauer 2020" and inserts `spielbauer2020`. CodeMirror still filters on
  // the label, which is right — somebody typing `spiel` means the key.
  if (suggestion.display !== undefined) {
    completion.displayLabel = suggestion.display;
  }
  // Assigned rather than spread: under `exactOptionalPropertyTypes` a property
  // set to `undefined` is not the same as an absent one, and CodeMirror's
  // types ask for absent.
  if (suggestion.reopen) {
    completion.apply = (view, _completion, from, to) => {
      view.dispatch({
        changes: { from, to, insert: suggestion.label },
        selection: { anchor: from + suggestion.label.length },
        userEvent: "input.complete",
      });
      // The prefix answered "what kind of thing"; the labels answer "which
      // one", and that is the question the author now has. Asking it takes a
      // fresh pass because the trigger has changed underneath.
      startCompletion(view);
    };
  }
  if (suggestion.detail !== undefined) completion.detail = suggestion.detail;
  if (suggestion.info !== undefined) completion.info = suggestion.info;
  if (suggestion.boost !== undefined) completion.boost = suggestion.boost;
  return completion;
}

/**
 * The source itself.
 *
 * Synchronous, and deliberately: everything it needs is in the editor's state.
 * When a source that has to ask Rust arrives — the installed TeX tree — it
 * returns a promise and CodeMirror merges it in late, which is why nothing here
 * needs to change to allow it.
 */
function latexCompletions(context: CompletionContext): CompletionResult | null {
  if (!context.state.facet(latexBuffer)) return null;

  // A window rather than the document. This runs on the keystroke path and its
  // usual answer is "nothing is being typed here" — paying for a copy of a
  // half-megabyte thesis to reach that answer is what made the suggestions feel
  // slow. Everything the trigger inspects is behind the caret and within
  // `LOOKBEHIND` of it, so a window that size gives the same answer.
  const floor = Math.max(0, context.pos - LOOKBEHIND);
  const window = context.state.doc.sliceString(floor, context.pos);

  const found = triggerAt(window, context.pos - floor);
  if (!found) return null;
  // Back into the document's own coordinates.
  const trigger: Trigger = { ...found, from: found.from + floor };

  const options = rank(candidatesFor(trigger, context), trigger.query).map(
    asCompletion,
  );
  if (options.length === 0) return null;

  // Say what order they go in, for as long as nothing has been typed to sort
  // them by. CodeMirror scores each option against the query and breaks ties on
  // the label, so ten sections came out `1, 10, 2, 3` — alphabetical order,
  // which is the wrong order for anything numbered. A descending boost states
  // the document's own order instead.
  //
  // Only while the query is bare, which for a reference means the prefix and
  // its colon. The moment somebody types a letter they mean the letter, and the
  // match should decide — a boost strong enough to fix the default order is
  // also strong enough to override a better match.
  if (bare(trigger)) {
    options.forEach((option, index) => {
      // Positive and inside CodeMirror's ±99, which the rank limit of 50
      // guarantees. Descending, so the first stays first.
      option.boost = options.length - index;
    });
  }

  return {
    from: trigger.from,
    options,
    // The list stays open and filters as more is typed, rather than closing and
    // reopening, for as long as what is typed could still be part of a key.
    // This is what keeps the document scan to once per list rather than once
    // per character.
    //
    // The colon is the exception, and deliberately: it is what turns "which
    // kind of thing" into "which section", and those are different questions
    // with different answers. Letting it through would leave `\ref{sec:` still
    // showing the seven prefixes.
    validFor: trigger.argument === "labelKind" ? /^[\w.\-]*$/ : /^[\w:.\-/]*$/,
  };
}

/**
 * Whether anything has been typed that could sort the list.
 *
 * For a reference the prefix and its colon do not count: `\ref{sec:` has a
 * query of `sec:`, and every candidate begins with it, so it distinguishes
 * nothing and the order is still the default one.
 */
function bare(trigger: Trigger): boolean {
  if (trigger.kind === "argument" && trigger.argument === "label") {
    return trigger.query.endsWith(":");
  }
  return trigger.query === "";
}

/** Completion for a LaTeX buffer. */
export function completions(): Extension {
  return [
    autocompletion({
      override: [latexCompletions],
      // Nothing is selected until the author moves: a completion that
      // auto-selects turns Enter into "accept the first guess", which is how a
      // stray `\se` becomes `\setlength` in somebody's document.
      defaultKeymap: true,
      selectOnOpen: false,
      // Short enough not to be felt, long enough that a burst of fast typing
      // asks once rather than once per character. It was 80ms, which read as a
      // hesitation — the work behind it is a windowed read and a scan that
      // happens once per list, so there is nothing here worth waiting for.
      activateOnTypingDelay: 25,
    }),
  ];
}
