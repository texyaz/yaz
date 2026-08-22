<!--
  What is left to do on this paper.

  # Why this is core and the tasks are not

  Writing a paper is three jobs and yaz is good at one of them. Zotero manages
  the sources, a to-do application manages what is left to do, and yaz manages
  the writing — so this tab shows a task list and does not keep one
  ([ADR-0026](https://generalpawz.github.io/yaz/adr/0026-task-providers-and-credentials)).

  What a task *is* — a title, whether it is done, when it is due — is core, and
  so is this tab. Where the tasks come from is a plugin. Todoist fills it today;
  a Things or Microsoft To Do plugin would fill the same one tomorrow, and
  nothing here would change. That is the test the design has to pass, and the
  reason this file mentions no service by name.

  # Why the link is per project

  A thesis and a conference paper are different work with different lists. The
  link lives in `yaz.toml`, so it travels with the project rather than being
  re-made on every machine.
-->
<script lang="ts">
  import { t } from "./i18n";
  import type { Task, TaskProject } from "@yaz/api";

  interface Props {
    /** Whether a project is open at all. */
    hasProject: boolean;
    /** The service this project is linked to, named for display. */
    providerName: string | null;
    /** The list this project is linked to, or null when it is not linked. */
    linked: TaskProject | null;
    /** What is on the list. */
    tasks: Task[];
    /** Whether something is in flight. */
    busy: boolean;
    /** Whether every provider is unusable — not signed in, or none installed. */
    ready: boolean;
    /** Choose or create the list this project is linked to. */
    onlink: () => void;
    /** Add a task. */
    onadd: (title: string) => void;
    /** Tick one off. */
    oncomplete: (task: Task) => void;
    /** Re-read the list. */
    onrefresh: () => void;
    /** Describe this task in the Details tab. */
    onselect: (task: Task) => void;
  }

  let {
    hasProject,
    providerName,
    linked,
    tasks,
    busy,
    ready,
    onlink,
    onadd,
    oncomplete,
    onrefresh,
    onselect,
  }: Props = $props();

  let draft = $state("");

  function add() {
    const title = draft.trim();
    if (!title) return;
    // Cleared before the round trip: the task is going in, and a field that
    // stayed full until the network answered would invite a second Return.
    draft = "";
    onadd(title);
  }

  /** Overdue and today first, then the rest in the order the service gave. */
  const ordered = $derived(
    [...tasks].sort((left, right) => {
      const due = Number(right.due !== null) - Number(left.due !== null);
      if (due !== 0) return due;
      if (left.due && right.due) return left.due.localeCompare(right.due);
      return (right.priority ?? 0) - (left.priority ?? 0);
    }),
  );
</script>

<div class="tasks">
  {#if !hasProject}
    <p class="empty">{t("workspace-no-project-open")}</p>
  {:else if !ready}
    <!-- Either nothing is installed that keeps tasks, or the one that is has
         not been signed in. Both are fixed in the same place. -->
    <p class="empty">{t("tasks-no-provider")}</p>
  {:else if !linked}
    <div class="unlinked">
      <p class="empty">{t("tasks-not-linked")}</p>
      <button type="button" class="primary" onclick={onlink} disabled={busy}>
        {t("tasks-link")}
      </button>
    </div>
  {:else}
    <div class="head">
      <div class="linked">
        <span class="list">{linked.name}</span>
        {#if providerName}<span class="service">{providerName}</span>{/if}
      </div>
      <button
        type="button"
        class="quiet"
        onclick={onrefresh}
        disabled={busy}
        title={t("tasks-refresh")}
      >
        {t("tasks-refresh")}
      </button>
      <button type="button" class="quiet" onclick={onlink} disabled={busy}>
        {t("tasks-relink")}
      </button>
    </div>

    <form
      class="add"
      onsubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <input
        type="text"
        bind:value={draft}
        placeholder={t("tasks-add-placeholder")}
        aria-label={t("tasks-add-placeholder")}
        disabled={busy}
      />
      <button type="submit" disabled={busy || draft.trim() === ""}>
        {t("tasks-add")}
      </button>
    </form>

    {#if ordered.length === 0}
      <p class="empty">{t("tasks-empty")}</p>
    {:else}
      <ul>
        {#each ordered as task (task.id)}
          <li>
            <!-- A checkbox, because completing is what a task list is for and
                 anything else would be a click to find the way to do it. -->
            <input
              type="checkbox"
              checked={task.done}
              disabled={busy}
              aria-label={task.title}
              onchange={() => oncomplete(task)}
            />
            <!-- The row is the way into the details; the checkbox beside it
                 is the way to be done with the task. Two things to click,
                 because they are two different intentions. -->
            <button type="button" class="body" onclick={() => onselect(task)}>
              <span class="title">{task.title}</span>
              {#if task.due}
                <span class="due">{task.due}</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .tasks {
    block-size: 100%;
    overflow-y: auto;
    background: var(--yaz-bg-primary);
    display: flex;
    flex-direction: column;
  }

  .empty {
    padding: var(--yaz-space-4);
    margin: 0;
    color: var(--yaz-text-muted);
    font-size: 0.9em;
  }

  .unlinked {
    padding-block-end: var(--yaz-space-3);
    padding-inline: var(--yaz-space-4);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-2);
    padding: var(--yaz-space-2) var(--yaz-space-3);
    border-block-end: 1px solid var(--yaz-border);
  }

  .linked {
    flex: 1;
    min-inline-size: 0;
    display: flex;
    flex-direction: column;
  }

  .list {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Which service, quietly. It matters when you have two installed and never
     otherwise, so it is the smaller of the two lines. */
  .service {
    font-size: 0.8em;
    color: var(--yaz-text-muted);
  }

  .add {
    display: flex;
    gap: var(--yaz-space-2);
    padding: var(--yaz-space-2) var(--yaz-space-3);
  }

  .add input {
    flex: 1;
    min-inline-size: 0;
    font: inherit;
    padding: var(--yaz-space-1) var(--yaz-space-2);
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-secondary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
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

  .primary {
    border-color: var(--yaz-accent);
  }

  .quiet {
    border-color: transparent;
    background: none;
    color: var(--yaz-text-muted);
    font-size: 0.85em;
  }

  ul {
    margin: 0;
    padding: 0 0 var(--yaz-space-2);
    list-style: none;
  }

  li {
    display: flex;
    align-items: flex-start;
    gap: var(--yaz-space-2);
    padding: var(--yaz-space-1) var(--yaz-space-3);
  }

  li:hover {
    background: var(--yaz-bg-hover);
  }

  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-inline-size: 0;
    font: inherit;
    text-align: start;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
  }

  .title {
    color: var(--yaz-text-primary);
  }

  .due {
    font-size: 0.8em;
    color: var(--yaz-text-muted);
  }
</style>
