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

  # Why there is no way to change the list from here

  Linking a paper to a list is done once, under Connections in the ribbon,
  beside linking it to a library. A second way to do it, sitting permanently
  above the list, is a button whose only use is the one time it is not needed
  again — and a click away from a list somebody meant to read.
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

  /** A task and whatever hangs off it. */
  interface Node {
    task: Task;
    children: Node[];
  }

  /** Dated first, then by urgency. Applied at every level of the nesting. */
  function order(nodes: Node[]): Node[] {
    return [...nodes].sort((left, right) => {
      const due =
        Number(right.task.due !== null) - Number(left.task.due !== null);
      if (due !== 0) return due;
      if (left.task.due && right.task.due) {
        return left.task.due.localeCompare(right.task.due);
      }
      // 1 is the most urgent, so the smaller number comes first. A task with
      // no priority sorts as the least urgent rather than as the most.
      return (left.task.priority ?? 5) - (right.task.priority ?? 5);
    });
  }

  /**
   * The list, nested.
   *
   * Every service returns its tasks flat with a parent id on each, so the
   * nesting is done here rather than asked for. A task whose parent is not in
   * the list — filtered out, or already completed — is shown at the top level
   * rather than hidden, because a sub-task nobody can see is one nobody does.
   */
  const tree = $derived.by(() => {
    const nodes = new Map<string, Node>();
    for (const task of tasks) nodes.set(task.id, { task, children: [] });

    const roots: Node[] = [];
    for (const node of nodes.values()) {
      const parent = node.task.parentId
        ? nodes.get(node.task.parentId)
        : undefined;
      if (parent && parent !== node) parent.children.push(node);
      else roots.push(node);
    }
    for (const node of nodes.values()) node.children = order(node.children);
    return order(roots);
  });

  /**
   * Which urgency class a task gets, if any.
   *
   * The scale is the contract's: 1 is the most urgent. Only the three that mean
   * something get a colour — a list where every row is coloured is a list where
   * no colour is read.
   */
  function urgency(task: Task): string {
    const value = task.priority;
    if (value === 1) return "urgent";
    if (value === 2) return "soon";
    if (value === 3) return "later";
    return "";
  }
</script>

{#snippet rows(nodes: Node[], depth: number)}
  {#each nodes as node (node.task.id)}
    <li class={urgency(node.task)} style="--depth: {depth}">
      <!-- A checkbox, because completing is what a task list is for and
           anything else would be a click to find the way to do it. -->
      <input
        type="checkbox"
        checked={node.task.done}
        disabled={busy}
        aria-label={node.task.title}
        onchange={() => oncomplete(node.task)}
      />
      <!-- The row is the way into the details; the checkbox beside it is the
           way to be done with the task. Two things to click, because they are
           two different intentions. -->
      <button type="button" class="body" onclick={() => onselect(node.task)}>
        <span class="title">{node.task.title}</span>
        {#if node.task.due}
          <span class="due">{node.task.due}</span>
        {/if}
      </button>
    </li>
    {@render rows(node.children, depth + 1)}
  {/each}
{/snippet}

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

    {#if tree.length === 0}
      <p class="empty">{t("tasks-empty")}</p>
    {:else}
      <ul>
        {@render rows(tree, 0)}
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
    align-items: baseline;
    gap: var(--yaz-space-2);
    padding: var(--yaz-space-1) var(--yaz-space-3);
    /* Sub-tasks step in rather than being drawn in a list of their own, so the
       whole thing stays one column of rows the eye can run down. */
    padding-inline-start: calc(
      var(--yaz-space-3) + var(--depth, 0) * var(--yaz-space-4)
    );
  }

  li:hover {
    background: var(--yaz-bg-hover);
  }

  /*
    The checkbox, drawn rather than left to the platform.

    A native checkbox is the one control that ignores every theme token and
    paints itself in the operating system's own blue, which on a dark theme is
    the brightest thing in the window.
  */
  li input[type="checkbox"] {
    appearance: none;
    inline-size: 1em;
    block-size: 1em;
    margin: 0;
    /*
      Aligned to the *text*, not to the line box.

      Centring a 1em box in the line box is the obvious thing and it is wrong:
      a line box is taller than the letters in it, and the extra room is mostly
      below the baseline for descenders. So the box came out a couple of pixels
      high and the title read as hanging low.

      What the eye matches is the middle of the lower-case letters. With the box
      sitting on the baseline — which is what `align-items: baseline` gives an
      empty inline-block — its centre is half its height above the baseline, and
      the letters' centre is half the x-height above it. The difference is the
      shift, and for the roughly 0.52em x-height of the interface face that is
      (1em - 0.52em) / 2.
    */
    align-self: baseline;
    transform: translateY(0.24em);
    flex: none;
    background: var(--yaz-bg-secondary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
    cursor: pointer;
    /*
      Inline-grid, not grid, and the difference is the whole point: an element
      with no line box in it takes its baseline from its bottom margin edge only
      when it is inline-level. A block grid has no baseline to align to, and the
      shift below would be measured from somewhere the browser chose.
    */
    display: inline-grid;
    place-content: center;
  }

  li input[type="checkbox"]:hover:not(:disabled) {
    border-color: var(--yaz-accent);
  }

  li input[type="checkbox"]:focus-visible {
    outline: 2px solid var(--yaz-focus-ring);
    outline-offset: 1px;
  }

  li input[type="checkbox"]:disabled {
    opacity: 0.5;
    cursor: default;
  }

  li input[type="checkbox"]::before {
    /* The tick, as a shape rather than a glyph: a character would be set in
       whatever font the row inherited and sit differently in each. */
    content: "";
    inline-size: 0.6em;
    block-size: 0.35em;
    border-inline-start: 2px solid var(--yaz-bg-primary);
    border-block-end: 2px solid var(--yaz-bg-primary);
    transform: rotate(-45deg) translate(0.05em, -0.1em);
    opacity: 0;
  }

  li input[type="checkbox"]:checked {
    background: var(--yaz-accent);
    border-color: var(--yaz-accent);
  }

  li input[type="checkbox"]:checked::before {
    opacity: 1;
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

  /*
    Urgency as colour, on the checkbox's edge and on the title.

    On the edge because that is where the eye already is when it runs down a
    column of checkboxes, and not on the whole row because three urgent tasks
    would then be a wall of red with nothing standing out of it.
  */
  .urgent input[type="checkbox"]:not(:checked) {
    border-color: var(--yaz-error);
  }

  .urgent .title {
    color: var(--yaz-error);
  }

  .soon input[type="checkbox"]:not(:checked) {
    border-color: var(--yaz-warning);
  }

  .soon .title {
    color: var(--yaz-warning);
  }

  .later input[type="checkbox"]:not(:checked) {
    border-color: var(--yaz-info);
  }

  .later .title {
    color: var(--yaz-info);
  }
</style>
