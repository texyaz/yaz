<!--
  Every work the document cites, and whether it will resolve.

  # Why this is core and not the Zotero plugin's

  A `.bib` is a `.bib` whoever wrote it. Zotero fills one today; a Citavi or
  Mendeley plugin would fill the same one tomorrow, and a JabRef user fills it
  by hand. The tab that shows what the document cites belongs to the document,
  so it belongs here — and a reference manager's plugin adds *sources*, not a
  second opinion about what a citation is (ADR-0005).

  # Works, not commands

  A source cited eleven times is one row. Eleven would bury the one cited once
  that does not resolve, which is the row that actually needs attention — and
  the whole reason to look at this list before compiling.
-->
<script lang="ts">
  import { t } from "./i18n";
  import type { CitedWork } from "./editor/bibliography";

  interface Props {
    /** The works, unresolved first. */
    works: CitedWork[];
    /** Which file this is, shown when there is nothing to list. */
    file: string | null;
    /** Whether a bibliography is loaded at all. */
    hasBibliography: boolean;
    /** Go to a use of this work in the source. */
    onnavigate: (at: number) => void;
    /** Explain why a key will not resolve, and offer the fix. */
    onexplain: (key: string) => void;
  }

  let { works, file, hasBibliography, onnavigate, onexplain }: Props = $props();

  const unresolved = $derived(works.filter((work) => work.entry === null));

  /**
   * Which use of each work was last visited.
   *
   * So clicking a work repeatedly walks through its citations rather than
   * returning to the first one every time — a source cited eleven times is
   * eleven places in the document, and going to the first of them ten times
   * over is not a way of finding the other ten.
   *
   * Keyed by citation key rather than by row index, so it survives the list
   * being rebuilt as the author types.
   */
  let visited = $state<Record<string, number>>({});

  /** Go to the next use of a work, rounding to the first after the last. */
  function step(work: CitedWork) {
    const next = ((visited[work.key] ?? -1) + 1) % work.at.length;
    visited = { ...visited, [work.key]: next };
    onnavigate(work.at[next] ?? 0);
  }
</script>

<div class="citations">
  {#if !file}
    <p class="empty">{t("workspace-no-file-open")}</p>
  {:else if works.length === 0}
    <p class="empty">{t("citations-empty")}</p>
  {:else}
    {#if unresolved.length > 0}
      <!-- Said once at the top rather than repeated per row: the count is the
           thing worth knowing before a compile. -->
      <p class="warning">
        {t("citations-unresolved", { count: unresolved.length })}
      </p>
    {/if}
    {#if !hasBibliography}
      <p class="warning">{t("citations-no-bibliography")}</p>
    {/if}

    <ul>
      {#each works as work (work.key)}
        <li class:unresolved={work.entry === null}>
          <button
            type="button"
            class="work"
            onclick={() =>
              work.entry === null ? onexplain(work.key) : step(work)}
          >
            <span class="label">{work.entry?.label ?? work.key}</span>
            <span class="detail">
              {work.entry?.detail ?? t("citations-not-in-bibliography")}
            </span>
          </button>

          <!-- How many times, where it is more than once. A source cited
               eleven times is a different kind of thing from one cited once,
               and the count is how a reader tells at a glance. -->
          {#if work.at.length > 1}
            <span
              class="count"
              title={t("citations-uses", { count: work.at.length })}
            >
              <!-- Which of them the last click went to, once there has been
                   one: a counter that only ever showed the total would not say
                   whether clicking again does anything. -->
              {visited[work.key] === undefined
                ? work.at.length
                : `${(visited[work.key] ?? 0) + 1}/${work.at.length}`}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .citations {
    block-size: 100%;
    overflow-y: auto;
    background: var(--yaz-bg-primary);
  }

  .empty,
  .warning {
    padding: var(--yaz-space-3) var(--yaz-space-4);
    margin: 0;
    color: var(--yaz-text-muted);
    font-size: 0.9em;
  }

  .warning {
    color: var(--yaz-text-secondary);
    background: var(--yaz-bg-secondary);
    border-block-end: 1px solid var(--yaz-border);
  }

  ul {
    margin: 0;
    padding: var(--yaz-space-2) 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-2);
    padding-inline-end: var(--yaz-space-3);
    border-inline-start: 2px solid transparent;
  }

  /* The rows that will not compile, marked the same way the citation itself is
     marked in the text — so the tab and the document agree. */
  li.unresolved {
    border-inline-start-color: var(--yaz-error);
  }

  .work {
    flex: 1;
    min-inline-size: 0;
    text-align: start;
    font: inherit;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding-block: var(--yaz-space-2);
    padding-inline: var(--yaz-space-3);
    background: none;
    border: none;
    color: var(--yaz-text-primary);
    cursor: pointer;
  }

  .work:hover {
    background: var(--yaz-bg-hover);
  }

  .label {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail {
    font-size: 0.9em;
    color: var(--yaz-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    font-size: 0.8em;
    font-variant-numeric: tabular-nums;
    color: var(--yaz-text-muted);
    background: var(--yaz-bg-secondary);
    border-radius: var(--yaz-radius-sm);
    padding: 0.05rem 0.4rem;
  }
</style>
