<!--
  A single-line text prompt.

  Exists so that writing your own commit message is possible without the message
  box being on the path of every save. Ctrl+S records a version with a generated
  message; this is for when you have something to say about it.

  Submitting empty is meaningful rather than a mistake — it means "you describe
  it" — which is why there is no validation preventing it and why the hint says
  so.
-->
<script lang="ts">
  import { untrack } from "svelte";

  import { t } from "./i18n";

  interface Props {
    titleKey: string;
    placeholderKey?: string | undefined;
    hintKey?: string | undefined;
    /**
     * Whether what is typed should be hidden.
     *
     * For a token or a password: a field that shows a secret is a secret read
     * over somebody's shoulder or left legible in a screen recording.
     */
    secret?: boolean | undefined;
    /**
     * What the field starts with.
     *
     * For renaming, where the answer is nearly always a small edit of what is
     * already there. The stem is selected rather than the whole thing, so
     * typing replaces the name and leaves `.tex` alone — which is what somebody
     * renaming a file means about nine times in ten.
     */
    initial?: string | undefined;
    /** Resolved with the text, or null if dismissed. */
    onsubmit: (value: string | null) => void;
  }

  let {
    titleKey,
    placeholderKey,
    hintKey,
    secret = false,
    initial,
    onsubmit,
  }: Props = $props();

  // The starting text, read once. It is where the field begins, not something
  // that keeps steering it — an `initial` that reassigned `value` would undo
  // whatever had been typed since.
  let value = $state(untrack(() => initial) ?? "");
  let input = $state<HTMLInputElement | null>(null);

  $effect(() => {
    const field = input;
    if (!field) return;
    field.focus();
    // Untracked, and that is the whole of it: this effect reads `value`, and
    // `value` changes on every keystroke. Tracked, it re-ran after each
    // character and put the selection back over what had just been typed — so
    // the field could never hold more than one letter, and naming a new file
    // was impossible.
    untrack(() => {
      // The stem, not the extension: `Ablauf` out of `Ablauf.png`. Selecting
      // everything means the first keystroke costs somebody their file type.
      const stop = value.lastIndexOf(".");
      field.setSelectionRange(0, stop > 0 ? stop : value.length);
    });
  });

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      onsubmit(value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onsubmit(null);
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="backdrop"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) onsubmit(null);
  }}
>
  <div class="prompt" role="dialog" aria-modal="true" aria-label={t(titleKey)}>
    <h2>{t(titleKey)}</h2>
    <input
      bind:this={input}
      bind:value
      {onkeydown}
      type={secret ? "password" : "text"}
      placeholder={placeholderKey ? t(placeholderKey) : undefined}
      aria-label={t(titleKey)}
    />
    {#if hintKey}
      <p class="hint">{t(hintKey)}</p>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--yaz-scrim);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-block-start: 16vh;
    z-index: 130;
  }

  .prompt {
    inline-size: min(34rem, 92vw);
    padding: var(--yaz-space-4);
    background: var(--yaz-bg-overlay);
    color: var(--yaz-text-primary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-lg);
    box-shadow: var(--yaz-shadow-overlay);
  }

  h2 {
    margin: 0 0 var(--yaz-space-2);
    font-size: var(--yaz-font-size-base);
    font-weight: 600;
  }

  input {
    inline-size: 100%;
    font: inherit;
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-tertiary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
    padding: var(--yaz-space-2);
  }

  input:focus-visible {
    outline: 2px solid var(--yaz-focus-ring);
    outline-offset: 1px;
  }

  .hint {
    margin: var(--yaz-space-2) 0 0;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-muted);
  }
</style>
