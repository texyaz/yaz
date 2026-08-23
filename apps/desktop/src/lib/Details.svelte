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

  /** The title, while it is being renamed. `null` when it is not. */
  let renaming = $state<string | null>(null);

  /**
   * Save the title and stop editing.
   *
   * On blur as well as on Return, because a field left open is a change the
   * user believes they made.
   */
  async function commitTitle() {
    const next = renaming?.trim();
    renaming = null;
    if (!next || !detail?.rename || next === detail.title) return;
    await detail.rename(next);
  }

  /**
   * The value a day picker can show, or nothing.
   *
   * A picker only understands `yyyy-mm-dd`. "every Monday" is a perfectly good
   * due date and is not one of those, so the picker is left empty rather than
   * being given something it would silently mangle — the text field beside it
   * is still showing the words.
   */
  function asDay(value: string): string {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
  }

  /** Save an edited row, if it actually changed. */
  async function commitEdit(
    edit: { value: string; save: (value: string) => unknown },
    next: string,
  ) {
    if (next === edit.value) return;
    await edit.save(next);
  }

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
      {#if renaming !== null}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="rename"
          type="text"
          autofocus
          bind:value={renaming}
          aria-label={t("details-rename")}
          onblur={() => void commitTitle()}
          onkeydown={(event) => {
            if (event.key === "Enter") void commitTitle();
            if (event.key === "Escape") renaming = null;
          }}
        />
      {:else}
        <!-- Double-click to rename, which is how a name is changed in a file
             list, a browser tab and everywhere else. A single click would make
             the title unreadable the moment you looked at it. -->
        <h2
          class:renameable={Boolean(detail.rename)}
          title={detail.rename ? t("details-rename") : undefined}
          ondblclick={() => {
            if (detail?.rename) renaming = detail.title;
          }}
        >
          {detail.title}
        </h2>
      {/if}
      {#if detail.subtitle}
        <p class="subtitle">{detail.subtitle}</p>
      {/if}
    </div>

    {#if detail.body}
      <!-- The author's own words, with their own line breaks. A description
           folded into one paragraph is a description rewritten. -->
      <p class="body">{detail.body}</p>
    {/if}

    {#if detail.fields && detail.fields.length > 0}
      <dl>
        {#each detail.fields as field, index (index)}
          <dt>{t(field.labelKey)}</dt>
          <dd>{field.value}</dd>
        {/each}
      </dl>
    {/if}

    {#if detail.edits && detail.edits.length > 0}
      <div class="edits">
        {#each detail.edits as edit, index (index)}
          <label>
            <span>{t(edit.labelKey)}</span>
            {#if edit.kind === "paragraph"}
              <textarea
                rows="3"
                value={edit.value}
                placeholder={edit.placeholderKey ? t(edit.placeholderKey) : ""}
                onblur={(event) =>
                  void commitEdit(edit, event.currentTarget.value)}
              ></textarea>
            {:else if edit.kind === "date"}
              <!--
                One field, with a picker on the end of it.

                Two fields side by side asked the reader which one was the real
                answer. This has one: what is typed is the value, and the picker
                writes into it. That keeps "every Monday" expressible — a picker
                cannot say it, and a service that understands it should get the
                chance — while sparing anybody who just wants next Tuesday from
                knowing what date that is.
              -->
              <span class="pair">
                <input
                  type="text"
                  value={edit.value}
                  placeholder={edit.placeholderKey
                    ? t(edit.placeholderKey)
                    : ""}
                  onblur={(event) =>
                    void commitEdit(edit, event.currentTarget.value)}
                />
                <!--
                  The native picker, opened by the button and never shown as a
                  field of its own. `showPicker` is what browsers give for
                  exactly this; where it is missing the input is still reachable
                  by clicking it, so the control degrades to a small date box
                  rather than to nothing.
                -->
                <input
                  class="picker"
                  type="date"
                  value={asDay(edit.value)}
                  tabindex="-1"
                  aria-hidden="true"
                  onchange={(event) =>
                    void commitEdit(edit, event.currentTarget.value)}
                />
                <button
                  type="button"
                  class="calendar"
                  title={t("details-pick-date")}
                  aria-label={t("details-pick-date")}
                  onclick={(event) => {
                    const picker = (
                      event.currentTarget as HTMLElement
                    ).previousElementSibling as HTMLInputElement | null;
                    if (!picker) return;
                    if (typeof picker.showPicker === "function") {
                      picker.showPicker();
                    } else {
                      picker.click();
                    }
                  }}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M2.5 4h11v9.5h-11zM2.5 6.5h11M5.5 2.5v3M10.5 2.5v3" />
                  </svg>
                </button>
              </span>
            {:else}
              <input
                type="text"
                value={edit.value}
                placeholder={edit.placeholderKey ? t(edit.placeholderKey) : ""}
                onblur={(event) =>
                  void commitEdit(edit, event.currentTarget.value)}
              />
            {/if}
          </label>
        {/each}
      </div>
    {/if}

    {#if detail.choices && detail.choices.length > 0}
      <!-- What can be moved, below what can only be read: the tab is a place
           to look at a thing first and change it second. -->
      <div class="choices">
        {#each detail.choices as choice, index (index)}
          <label>
            <span>{t(choice.labelKey)}</span>
            <select
              value={choice.value ?? ""}
              disabled={running !== null}
              onchange={(event) =>
                void run({
                  labelKey: choice.labelKey,
                  run: () =>
                    choice.choose(
                      (event.currentTarget as HTMLSelectElement).value || null,
                    ),
                })}
            >
              {#if choice.noneKey}
                <option value="">{t(choice.noneKey)}</option>
              {/if}
              {#each choice.options as option (option.value)}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </label>
        {/each}
      </div>
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

  .body {
    margin: 0;
    padding: var(--yaz-space-3) var(--yaz-space-3) 0;
    color: var(--yaz-text-secondary);
    font-size: 0.9em;
    /* The author's line breaks, kept. */
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .rename {
    inline-size: 100%;
    font: inherit;
    font-size: var(--yaz-font-size-base);
    margin-block-start: var(--yaz-space-1);
    padding: 0;
    color: var(--yaz-text-primary);
    background: none;
    border: none;
    border-block-end: 1px solid var(--yaz-accent);
  }

  /* Only a hint that it can be: a title that looked like a field would be a
     title nobody read as a title. */
  h2.renameable {
    cursor: text;
  }

  .edits {
    display: flex;
    flex-direction: column;
    gap: var(--yaz-space-2);
    padding: var(--yaz-space-3);
    border-block-start: 1px solid var(--yaz-border);
  }

  .edits label {
    display: flex;
    flex-direction: column;
    gap: var(--yaz-space-1);
    font-size: 0.9em;
    color: var(--yaz-text-muted);
  }

  .edits input,
  .edits textarea {
    font: inherit;
    inline-size: 100%;
    min-inline-size: 0;
    padding: var(--yaz-space-1) var(--yaz-space-2);
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-secondary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
    resize: vertical;
  }

  .edits .pair {
    position: relative;
    display: flex;
    gap: var(--yaz-space-1);
  }

  /*
    The picker itself takes no room.

    It has to stay in the layout for `showPicker` to have somewhere to anchor —
    `display: none` makes the call throw — so it is a zero-width sliver behind
    the button rather than a second field the reader has to interpret.
  */
  .edits .pair .picker {
    position: absolute;
    inset-block-end: 0;
    inset-inline-end: 0;
    inline-size: 1px;
    block-size: 1px;
    padding: 0;
    border: none;
    opacity: 0;
    pointer-events: none;
  }

  .edits .calendar {
    flex: none;
    display: grid;
    place-items: center;
    inline-size: 2em;
    font: inherit;
    color: var(--yaz-text-muted);
    background: var(--yaz-bg-secondary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
    cursor: pointer;
  }

  .edits .calendar:hover {
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-hover);
  }

  .edits .calendar svg {
    inline-size: 1em;
    block-size: 1em;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .choices {
    display: flex;
    flex-direction: column;
    gap: var(--yaz-space-2);
    padding: var(--yaz-space-3);
    border-block-start: 1px solid var(--yaz-border);
  }

  .choices label {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-3);
    font-size: 0.9em;
    color: var(--yaz-text-muted);
  }

  .choices select {
    flex: 1;
    min-inline-size: 0;
    font: inherit;
    padding: var(--yaz-space-1) var(--yaz-space-2);
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-secondary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
  }

  .choices select:disabled {
    opacity: 0.5;
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
