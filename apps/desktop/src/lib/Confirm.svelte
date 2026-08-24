<!--
  Ask before doing something that cannot be taken back.

  # Why the name is in the question

  "Are you sure?" is a dialog people learn to dismiss without reading, because
  it never tells them anything they did not already know. Naming the thing —
  "Delete images/Ablauf.png?" — makes it a question worth a second of
  attention, and the second of attention is the entire point of asking.

  # Why the affirmative is not the default

  Focus starts on cancel. Somebody who hit Delete by accident and reflexively
  presses Enter should get out, not through.
-->
<script lang="ts">
  import { t } from "./i18n";

  interface Props {
    titleKey: string;
    /** Values for the title's placeholders — usually the name of the thing. */
    values?: Record<string, string | number> | undefined;
    /** A second line, where the consequence is worth spelling out. */
    detailKey?: string | undefined;
    detailValues?: Record<string, string | number> | undefined;
    /** What the affirmative button says. Never "OK". */
    confirmKey: string;
    /** Whether the affirmative is drawn as a warning. */
    destructive?: boolean | undefined;
    onchoose: (confirmed: boolean) => void;
  }

  let {
    titleKey,
    values,
    detailKey,
    detailValues,
    confirmKey,
    destructive = false,
    onchoose,
  }: Props = $props();

  let cancel = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    cancel?.focus();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="backdrop"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) onchoose(false);
  }}
  onkeydown={(event) => {
    if (event.key === "Escape") onchoose(false);
  }}
>
  <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
    <h2 id="confirm-title">{t(titleKey, values)}</h2>
    {#if detailKey}
      <p class="detail">{t(detailKey, detailValues)}</p>
    {/if}
    <div class="buttons">
      <button type="button" bind:this={cancel} onclick={() => onchoose(false)}>
        {t("dialog-cancel")}
      </button>
      <button
        type="button"
        class="go"
        class:destructive
        onclick={() => onchoose(true)}
      >
        {t(confirmKey)}
      </button>
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
    inline-size: min(24rem, 90vw);
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

  .detail {
    margin-block: var(--yaz-space-2) 0;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-muted);
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: var(--yaz-space-2);
    margin-block-start: var(--yaz-space-4);
  }

  button {
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

  button:hover {
    background: var(--yaz-bg-hover);
  }

  .go {
    border-color: var(--yaz-accent);
  }

  .go.destructive {
    color: var(--yaz-bg-primary);
    background: var(--yaz-error);
    border-color: var(--yaz-error);
  }

  .go.destructive:hover {
    opacity: 0.9;
  }
</style>
