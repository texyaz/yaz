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
import { autocompletion } from "@codemirror/autocomplete";
import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";

import { t } from "../i18n";
import {
  labelsIn,
  rank,
  STANDARD_CLASSES,
  STRUCTURAL_COMMANDS,
  triggerAt,
} from "./completion";
import type { Suggestion, Trigger } from "./completion";
import { glossaryEntries } from "./generated";
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
  const found: Cached = {
    labels: labelsIn(text),
    glossary: glossaryEntries(text).map((entry) => ({
      // A glossary entry is cited by its key, not by what it prints — `\gls{BIM}`
      // where the entry reads "Building Information Modeling".
      label: entry.key ?? entry.label,
      detail: entry.label,
      info: entry.detail ?? undefined,
    })),
  };
  cache.set(doc, found);
  return found;
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
    case "label":
      return readDocument(state.doc).labels;

    case "citation":
      return [...state.facet(bibliography).values()].map((entry) => ({
        label: entry.key,
        detail: entry.label,
        info: entry.detail,
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
  // Assigned rather than spread: under `exactOptionalPropertyTypes` a property
  // set to `undefined` is not the same as an absent one, and CodeMirror's
  // types ask for absent.
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

  const trigger = triggerAt(context.state.doc.toString(), context.pos);
  if (!trigger) return null;

  // Explicit means the palette shortcut was pressed. Then an empty query is a
  // request to see everything; while typing it is somebody who has not started.
  if (
    trigger.query === "" &&
    trigger.kind === "argument" &&
    !context.explicit
  ) {
    // Offer anyway for arguments: `\ref{` with nothing typed is exactly when
    // the list is most useful, because the keys are not memorable.
  }

  const options = rank(candidatesFor(trigger, context), trigger.query).map(
    asCompletion,
  );
  if (options.length === 0) return null;

  return {
    from: trigger.from,
    options,
    // The list stays open and filters as more is typed, rather than closing and
    // reopening, for as long as what is typed could still be part of a key.
    validFor: /^[\w:.\-/]*$/,
  };
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
      // Off the keystroke path by construction, but this also stops a burst of
      // typing from asking on every character.
      activateOnTypingDelay: 80,
    }),
  ];
}
