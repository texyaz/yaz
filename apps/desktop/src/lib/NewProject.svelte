<!--
  Start a project.

  # Why a wizard and not a folder picker

  "New project" could mean "make me an empty folder", and for a while that is
  what opening a folder amounted to: yaz would open it, find no `.tex`, and show
  an empty editor with nothing to compile. The first hour of a LaTeX project is
  spent on a preamble that every project has, and getting it wrong is where
  people give up.

  So this asks the two questions whose answers cannot be guessed — where it goes
  and what kind of document it is — and does the rest.

  # Why two steps

  They are different kinds of question. Where a project lives is a decision
  about a filesystem, made with a folder picker; what kind of document it is is
  a decision about writing, made by reading four descriptions. Putting both on
  one panel meant the descriptions were skimmed, because the eye had already
  found the button.
-->
<script module lang="ts">
  /**
   * The kinds of document offered, in the order they are shown.
   *
   * In the module script rather than the instance one so the shell can name the
   * type when it declares what it will do with the answer. The strings are the
   * ones the Rust side parses; a fifth is a line here and an arm there, plus
   * the two message keys that describe it.
   */
  export const KINDS = ["article", "report", "book", "beamer"] as const;

  export type DocumentKind = (typeof KINDS)[number];

  /**
   * One drawing per kind, on a 16-unit grid.
   *
   * Each is the *shape of the page*, not a symbol for it: an article is one
   * sheet with a heading and paragraphs, a report the same with a chapter rule
   * above them, a book two facing pages, a presentation a landscape frame with
   * a title bar. Somebody choosing between four things they have not read yet
   * picks by silhouette, and four variations of a page icon would tell them
   * nothing at all.
   */
  export const KIND_ICONS: Record<DocumentKind, string> = {
    article:
      "M3 1.5h10v13H3zM5.5 4.5h5M5.5 7h5M5.5 9h5M5.5 11h3",
    report:
      "M3 1.5h10v13H3zM5.5 4h5M5.5 5.8h5.5M5.5 8.5h5M5.5 10.5h5M5.5 12.5h3",
    book: "M8 3.5v10M8 3.5C6.5 2.3 4.6 2 2.5 2.2v10C4.6 12 6.5 12.3 8 13.5M8 3.5c1.5-1.2 3.4-1.5 5.5-1.3v10c-2.1-.2-4 .1-5.5 1.3",
    beamer:
      "M1.5 2.5h13v9h-13zM1.5 5h13M4 13.5h8M3.5 7.5h4M3.5 9.5h6",
  };
</script>

<script lang="ts">
  import { t } from "./i18n";

  interface Props {
    /** Ask the OS for a folder. The shell owns the dialog. */
    onbrowse: () => Promise<string | null>;
    oncreate: (parent: string, name: string, kind: DocumentKind) => void;
    oncancel: () => void;
    /** What went wrong last time, if the creation was refused. */
    failure?: string | null | undefined;
  }

  let { onbrowse, oncreate, oncancel, failure }: Props = $props();

  let step = $state<"where" | "what">("where");
  let parent = $state("");
  let name = $state("");
  let kind = $state<DocumentKind>("article");

  let nameField = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (step === "where") nameField?.focus();
  });

  /**
   * Whether the first step has been answered.
   *
   * The characters a filesystem refuses are checked properly on the other side
   * of the boundary, where the filesystem is. This is only enough to keep the
   * button from being pressable with nothing typed.
   */
  const named = $derived(parent.trim() !== "" && name.trim() !== "");

  /** The folder that will be created, as a path somebody can check. */
  const destination = $derived(
    named ? `${parent.replace(/[/\\]$/, "")}/${name.trim()}` : "",
  );
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="backdrop"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) oncancel();
  }}
  onkeydown={(event) => {
    if (event.key === "Escape") oncancel();
  }}
>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
    <h2 id="new-project-title">{t("new-project-title")}</h2>

    {#if step === "where"}
      <p class="lede">{t("new-project-where-lede")}</p>

      <label class="field">
        <span>{t("new-project-name")}</span>
        <input
          bind:this={nameField}
          bind:value={name}
          type="text"
          placeholder={t("new-project-name-placeholder")}
          onkeydown={(event) => {
            if (event.key === "Enter" && named) step = "what";
          }}
        />
      </label>

      <label class="field">
        <span>{t("new-project-parent")}</span>
        <div class="browse">
          <input bind:value={parent} type="text" readonly placeholder={t("new-project-parent-placeholder")} />
          <button
            type="button"
            onclick={async () => {
              const picked = await onbrowse();
              if (picked) parent = picked;
            }}
          >
            {t("new-project-browse")}
          </button>
        </div>
      </label>

      {#if named}
        <!-- The path in full, because "a folder called Thesis" and "a folder
             called Thesis inside Documents/2026" are different answers and only
             one of them is checkable. -->
        <p class="destination">{t("new-project-destination", { path: destination })}</p>
      {/if}
    {:else}
      <p class="lede">{t("new-project-what-lede")}</p>

      <div class="kinds" role="radiogroup" aria-label={t("new-project-what-lede")}>
        {#each KINDS as option (option)}
          <button
            type="button"
            class="kind"
            class:chosen={kind === option}
            role="radio"
            aria-checked={kind === option}
            onclick={() => (kind = option)}
          >
            <span class="kind-icon" aria-hidden="true">
              <svg viewBox="0 0 16 16"><path d={KIND_ICONS[option]} /></svg>
            </span>
            <span class="kind-text">
              <span class="kind-name">{t(`new-project-kind-${option}`)}</span>
              <span class="kind-detail">{t(`new-project-kind-${option}-detail`)}</span>
            </span>
          </button>
        {/each}
      </div>

      <p class="destination">{t("new-project-makes")}</p>
    {/if}

    {#if failure}
      <p class="failure" role="alert">{failure}</p>
    {/if}

    <div class="buttons">
      <button type="button" onclick={() => (step === "what" ? (step = "where") : oncancel())}>
        {t(step === "what" ? "new-project-back" : "dialog-cancel")}
      </button>
      {#if step === "where"}
        <button type="button" class="go" disabled={!named} onclick={() => (step = "what")}>
          {t("new-project-next")}
        </button>
      {:else}
        <button
          type="button"
          class="go"
          onclick={() => oncreate(parent, name.trim(), kind)}
        >
          {t("new-project-create")}
        </button>
      {/if}
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
    z-index: 130;
  }

  .dialog {
    inline-size: min(30rem, 92vw);
    padding: var(--yaz-space-4);
    background: var(--yaz-bg-primary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-md);
    box-shadow: var(--yaz-shadow-overlay);
  }

  h2 {
    margin: 0;
    font-size: var(--yaz-font-size-md);
    color: var(--yaz-text-primary);
  }

  .lede {
    margin-block: var(--yaz-space-1) var(--yaz-space-4);
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-muted);
  }

  .field {
    display: block;
    margin-block-end: var(--yaz-space-3);
  }

  .field > span {
    display: block;
    margin-block-end: var(--yaz-space-1);
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-secondary);
  }

  input {
    inline-size: 100%;
    padding-block: var(--yaz-space-1);
    padding-inline: var(--yaz-space-2);
    font: inherit;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-secondary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
  }

  input:focus {
    outline: 2px solid var(--yaz-accent);
    outline-offset: -1px;
  }

  input[readonly] {
    color: var(--yaz-text-muted);
  }

  .browse {
    display: flex;
    gap: var(--yaz-space-2);
  }

  .kinds {
    display: grid;
    gap: var(--yaz-space-2);
  }

  .kind {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-3);
    inline-size: 100%;
    padding: var(--yaz-space-2);
    text-align: start;
    font: inherit;
    background: var(--yaz-bg-secondary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
    cursor: pointer;
  }

  .kind:hover {
    background: var(--yaz-bg-hover);
  }

  .kind.chosen {
    border-color: var(--yaz-accent);
    background: var(--yaz-bg-active);
  }

  .kind-icon {
    inline-size: 1.75rem;
    block-size: 1.75rem;
    flex: none;
    display: inline-flex;
    color: var(--yaz-text-muted);
  }

  /* The chosen one's drawing takes the accent too, so the row reads as one
     thing selected rather than a tinted border with a grey picture in it. */
  .kind.chosen .kind-icon {
    color: var(--yaz-accent);
  }

  .kind-icon svg {
    inline-size: 100%;
    block-size: 100%;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.1;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .kind-text {
    min-inline-size: 0;
  }

  .kind-name {
    display: block;
    font-size: var(--yaz-font-size-sm);
    font-weight: 600;
    color: var(--yaz-text-primary);
  }

  .kind-detail {
    display: block;
    margin-block-start: 2px;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-muted);
  }

  .destination {
    margin-block: var(--yaz-space-3) 0;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-muted);
    overflow-wrap: anywhere;
  }

  .failure {
    margin-block: var(--yaz-space-3) 0;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-error);
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: var(--yaz-space-2);
    margin-block-start: var(--yaz-space-4);
  }

  .buttons button {
    padding-block: var(--yaz-space-1);
    padding-inline: var(--yaz-space-3);
    font: inherit;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-secondary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
    cursor: pointer;
  }

  .browse button {
    flex: none;
    padding-block: var(--yaz-space-1);
    padding-inline: var(--yaz-space-3);
    font: inherit;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-secondary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
    cursor: pointer;
  }

  .buttons button:hover:not(:disabled),
  .browse button:hover {
    background: var(--yaz-bg-hover);
  }

  .buttons button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .go {
    border-color: var(--yaz-accent);
  }
</style>
