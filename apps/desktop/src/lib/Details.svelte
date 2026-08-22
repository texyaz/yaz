<!--
  What the thing under the cursor actually is.

  # One tab, not one per source

  Clicking a citation shows what the bibliography says about it; clicking a
  glossary term shows its definition; clicking a task shows when it is due.
  Those come from core, from the packages plugin and from a to-do plugin
  respectively — and a tab each would be three tabs to keep track of for one
  question the reader keeps asking: *what is this thing?*

  So the shape is core and the contents are not. A plugin describes its own
  things in terms this can draw and never draws them itself, which is what keeps
  a citation and a task looking like they belong to the same application
  (ADR-0026 draws the same line for tasks).

  # Why it does not open itself

  A pane that appeared every time somebody clicked a citation would be a pane
  fighting the document for room. This is opened from View like any other tab,
  and once open it follows the cursor.
-->
<script lang="ts">
  import { t } from "./i18n";
  import type { Detail } from "@yaz/api";

  interface Props {
    /** What was last clicked, or null when nothing has been. */
    detail: Detail | null;
  }

  let { detail }: Props = $props();

  /** Whether an action is running, so a second click cannot start it twice. */
  let running = $state<string | null>(null);

  async function run(action: { labelKey: string; run: () => unknown }) {
    running = action.labelKey;
    try {
      await action.run();
    } finally {
      running = null;
    }
  }
</script>

<div class="details">
  {#if !detail}
    <p class="empty">{t("details-empty")}</p>
  {:else}
    <div class="head">
      <span class="kind">{t(detail.kindKey)}</span>
      <h2>{detail.title}</h2>
      {#if detail.subtitle}
        <p class="subtitle">{detail.subtitle}</p>
      {/if}
    </div>

    {#if detail.fields && detail.fields.length > 0}
      <dl>
        {#each detail.fields as field, index (index)}
          <dt>{t(field.labelKey)}</dt>
          <dd>{field.value}</dd>
        {/each}
      </dl>
    {/if}

    {#if detail.actions && detail.actions.length > 0}
      <div class="actions">
        {#each detail.actions as action, index (index)}
          <button
            type="button"
            disabled={running !== null}
            onclick={() => void run(action)}
          >
            {t(action.labelKey)}
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .details {
    block-size: 100%;
    overflow-y: auto;
    background: var(--yaz-bg-primary);
  }

  .empty {
    padding: var(--yaz-space-4);
    margin: 0;
    color: var(--yaz-text-muted);
    font-size: 0.9em;
  }

  .head {
    padding: var(--yaz-space-3);
    border-block-end: 1px solid var(--yaz-border);
  }

  /* What sort of thing this is, above its name — so the reader knows whether
     they are looking at a citation or a task before they read the title. */
  .kind {
    display: block;
    font-size: 0.75em;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--yaz-text-muted);
  }

  h2 {
    margin: var(--yaz-space-1) 0 0;
    font-size: var(--yaz-font-size-base);
    color: var(--yaz-text-primary);
  }

  .subtitle {
    margin: var(--yaz-space-1) 0 0;
    color: var(--yaz-text-secondary);
    font-size: 0.9em;
  }

  dl {
    margin: 0;
    padding: var(--yaz-space-2) var(--yaz-space-3);
    display: grid;
    /* The labels share a column so the values line up, which is what makes a
       list of them readable rather than a ragged edge. */
    grid-template-columns: minmax(4rem, max-content) 1fr;
    gap: var(--yaz-space-1) var(--yaz-space-3);
  }

  dt {
    color: var(--yaz-text-muted);
    font-size: 0.9em;
  }

  dd {
    margin: 0;
    color: var(--yaz-text-primary);
    font-size: 0.9em;
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--yaz-space-2);
    padding: var(--yaz-space-3);
    border-block-start: 1px solid var(--yaz-border);
  }

  button {
    font: inherit;
    padding: var(--yaz-space-1) var(--yaz-space-3);
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-secondary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    background: var(--yaz-bg-hover);
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
