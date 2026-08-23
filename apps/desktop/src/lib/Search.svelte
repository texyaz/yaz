<!--
  Where the search bar's results go.

  # Why the results are a tab and not a dropdown

  A list under the search box is a list you read three rows of. Searching a
  thesis for a term you are about to rename turns up forty places across nine
  files, and deciding what to do about them is reading work — which needs a
  pane that stays open while you go and look at one.

  It is the same shape as the other generated lists: the thing that produces the
  content is elsewhere, and this draws it
  ([ADR-0025](https://generalpawz.github.io/yaz/adr/0025-generated-lists-are-tabs)).

  # Grouped by file, in document order

  Because that is how somebody works through them: a file at a time, top to
  bottom. Sorting by relevance would be inventing a ranking nobody asked for.
-->
<script lang="ts">
  import { t } from "./i18n";
  import type { Match } from "./editor/search";

  /** Every match in one file. */
  export interface FileMatches {
    /** Path relative to the project, or the file's name when there is none. */
    file: string;
    /** Whether this is the file currently open, which is drawn as such. */
    open: boolean;
    matches: Match[];
  }

  interface Props {
    /** What was searched for, so the pane can say so when nothing was found. */
    query: string;
    /** The results, already grouped and in document order. */
    results: FileMatches[];
    /** Whether the search is still running over the project's other files. */
    busy: boolean;
    /** Whether the list was cut short, so the pane can say so. */
    capped: boolean;
    /** Go to a match. */
    onnavigate: (file: string, match: Match) => void;
  }

  let { query, results, busy, capped, onnavigate }: Props = $props();

  const total = $derived(
    results.reduce((count, group) => count + group.matches.length, 0),
  );

  /** Which files are folded shut. Open by default: a result you cannot see is
      a result that did not help. */
  let shut = $state(new Set<string>());

  function toggle(file: string) {
    const next = new Set(shut);
    if (next.has(file)) next.delete(file);
    else next.add(file);
    shut = next;
  }
</script>

<div class="search">
  {#if query === ""}
    <p class="empty">{t("search-empty")}</p>
  {:else if total === 0 && !busy}
    <p class="empty">{t("search-none", { query })}</p>
  {:else}
    <p class="summary">
      {t("search-found", { count: total, files: results.length })}
      {#if busy}<span class="working">{t("search-working")}</span>{/if}
      {#if capped}<span class="working">{t("search-capped")}</span>{/if}
    </p>

    {#each results as group (group.file)}
      <section>
        <button
          type="button"
          class="file"
          aria-expanded={!shut.has(group.file)}
          onclick={() => toggle(group.file)}
        >
          <span class="fold" aria-hidden="true"
            >{shut.has(group.file) ? "▸" : "▾"}</span
          >
          <span class="name" class:current={group.open}>{group.file}</span>
          <span class="tally">{group.matches.length}</span>
        </button>

        {#if !shut.has(group.file)}
          <ul>
            {#each group.matches as match (`${match.from}:${match.to}`)}
              <li>
                <button
                  type="button"
                  class="hit"
                  onclick={() => onnavigate(group.file, match)}
                >
                  <span class="line">{match.line}</span>
                  <span class="text">
                    <!-- The words either side come with the match, so drawing a
                         row costs nothing and does not re-read the file. -->
                    <span class="context">{match.before}</span><mark
                      >{match.text}</mark
                    ><span class="context">{match.after}</span>
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/each}
  {/if}
</div>

<style>
  .search {
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

  .summary {
    margin: 0;
    padding: var(--yaz-space-2) var(--yaz-space-3);
    font-size: 0.85em;
    color: var(--yaz-text-muted);
    border-block-end: 1px solid var(--yaz-border);
  }

  .working {
    margin-inline-start: var(--yaz-space-2);
    font-style: italic;
  }

  button {
    font: inherit;
    inline-size: 100%;
    text-align: start;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--yaz-text-primary);
  }

  .file {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-2);
    padding: var(--yaz-space-1) var(--yaz-space-3);
    background: var(--yaz-bg-secondary);
  }

  .file:hover {
    background: var(--yaz-bg-hover);
  }

  .fold {
    color: var(--yaz-text-muted);
  }

  .name {
    flex: 1;
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The file you are looking at, marked — its results are the ones you can act
     on without leaving where you are. */
  .name.current {
    font-weight: 600;
  }

  .tally {
    font-size: 0.8em;
    color: var(--yaz-text-muted);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .hit {
    display: flex;
    gap: var(--yaz-space-2);
    padding: var(--yaz-space-1) var(--yaz-space-3);
    font-size: 0.85em;
  }

  .hit:hover {
    background: var(--yaz-bg-hover);
  }

  .line {
    min-inline-size: 2.5em;
    text-align: end;
    color: var(--yaz-text-muted);
    font-variant-numeric: tabular-nums;
  }

  /* One line per result, cut off rather than wrapped: forty results that each
     take three lines is a pane you scroll instead of scan. */
  .text {
    flex: 1;
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .context {
    color: var(--yaz-text-secondary);
  }

  mark {
    background: var(--yaz-accent);
    color: var(--yaz-bg-primary);
    border-radius: 2px;
  }
</style>
