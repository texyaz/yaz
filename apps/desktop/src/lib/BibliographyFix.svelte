<!--
  What to do about a citation whose key nothing defines.

  Shown when an unresolved citation is clicked, and only then. Diagnosing this
  means reading the project directory, and doing that on a timer — or worse, on
  every keystroke — would put the filesystem on the typing path for the sake of
  a message most documents never need (ADR-0015).

  # Why it offers rather than fixes

  Every option here edits the author's preamble or writes a file, and which one
  is right depends on something only they know: whether the `.bib` sitting in
  the folder is the one this document should load, or a leftover from a paper
  they copied the project from. So the diagnosis is stated plainly, the options
  are listed with what each will do, and nothing happens until one is chosen.
-->
<script lang="ts">
  import { t } from "./i18n";
  import type { BibProblem } from "./editor/bibliography";

  interface Props {
    /** The citation key that could not be resolved. */
    citationKey: string;
    /** What is wrong, as far as the source and the directory can say. */
    problem: BibProblem;
    /** Point the document at an existing file. */
    onuse: (name: string) => void;
    /** Create the file, and declare it if it is not declared. */
    oncreate: (name: string) => void;
    onclose: () => void;
  }

  let { citationKey, problem, onuse, oncreate, onclose }: Props = $props();

  /**
   * A name to offer creating, for a document that declares nothing.
   *
   * `references.bib` is the conventional name and the one the Zotero bridge
   * used to assume. It is only a default here — the author is being asked.
   */
  const DEFAULT_NAME = "references.bib";

  const heading = $derived(
    problem.kind === "undeclared"
      ? t("bib-fix-undeclared")
      : problem.kind === "missing"
        ? t("bib-fix-missing", { file: problem.declared })
        : t("bib-fix-absent", { file: problem.declared }),
  );

  /** Files the document could be pointed at instead. */
  const candidates = $derived(
    problem.kind === "absent" ? [] : problem.candidates,
  );
</script>

<div
  class="backdrop"
  role="button"
  tabindex="-1"
  onclick={onclose}
  onkeydown={(event) => {
    if (event.key === "Escape") onclose();
  }}
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="dialog"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label={t("bib-fix-title")}
    onclick={(event) => event.stopPropagation()}
  >
    <h2>{t("bib-fix-title")}</h2>
    <p class="key">{t("bib-fix-key", { key: citationKey })}</p>
    <p class="what">{heading}</p>

    <ul>
      {#each candidates as name (name)}
        <li>
          <button type="button" class="option" onclick={() => onuse(name)}>
            <span class="label">{t("bib-fix-use", { file: name })}</span>
            <span class="detail">{t("bib-fix-use-detail")}</span>
          </button>
        </li>
      {/each}

      {#if problem.kind === "missing"}
        <li>
          <button
            type="button"
            class="option"
            onclick={() => oncreate(problem.declared)}
          >
            <span class="label"
              >{t("bib-fix-create", { file: problem.declared })}</span
            >
            <span class="detail">{t("bib-fix-create-declared-detail")}</span>
          </button>
        </li>
      {/if}

      {#if problem.kind === "undeclared"}
        <li>
          <button
            type="button"
            class="option"
            onclick={() => oncreate(DEFAULT_NAME)}
          >
            <span class="label"
              >{t("bib-fix-create", { file: DEFAULT_NAME })}</span
            >
            <span class="detail">{t("bib-fix-create-detail")}</span>
          </button>
        </li>
      {/if}

      {#if problem.kind === "absent"}
        <!-- Nothing to fix about the wiring: the file is declared, it is
             there, and the key is not in it. Saying so is the whole answer. -->
        <li class="note">{t("bib-fix-absent-detail")}</li>
      {/if}
    </ul>

    <div class="actions">
      <button type="button" onclick={onclose}>{t("bib-fix-cancel")}</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: var(--yaz-scrim);
    border: none;
    padding: 0;
    z-index: 130;
  }

  .dialog {
    inline-size: min(34rem, calc(100vw - 2rem));
    background: var(--yaz-bg-overlay);
    color: var(--yaz-text-primary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-lg);
    box-shadow: var(--yaz-shadow-overlay);
    padding: var(--yaz-space-5);
    text-align: start;
  }

  h2 {
    margin: 0 0 var(--yaz-space-2);
    font-size: var(--yaz-font-size-lg);
    color: var(--yaz-text-primary);
  }

  .key {
    margin: 0;
    font-family: var(--yaz-font-mono);
    font-size: 0.9em;
    color: var(--yaz-text-secondary);
  }

  .what {
    margin: var(--yaz-space-2) 0 var(--yaz-space-4);
    color: var(--yaz-text-secondary);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--yaz-space-2);
  }

  .option {
    inline-size: 100%;
    text-align: start;
    font: inherit;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: var(--yaz-space-3);
    background: var(--yaz-bg-secondary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-md);
    color: var(--yaz-text-primary);
    cursor: pointer;
  }

  .option:hover {
    border-color: var(--yaz-accent);
    background: var(--yaz-bg-hover);
  }

  .label {
    font-weight: 600;
  }

  .detail {
    font-size: 0.9em;
    color: var(--yaz-text-muted);
  }

  .note {
    padding: var(--yaz-space-3);
    color: var(--yaz-text-muted);
    font-size: 0.9em;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    margin-block-start: var(--yaz-space-4);
  }

  .actions button {
    font: inherit;
    padding: var(--yaz-space-2) var(--yaz-space-4);
    background: var(--yaz-bg-secondary);
    color: var(--yaz-text-primary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-md);
    cursor: pointer;
  }

  .actions button:hover {
    background: var(--yaz-bg-hover);
  }
</style>
