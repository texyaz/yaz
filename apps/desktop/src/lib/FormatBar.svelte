<!--
  The formatting bar that appears where text is selected.

  # Why it appears at the selection

  Selecting a phrase and then travelling to the top of the window to embolden it
  is the journey a word processor removed thirty years ago, and yaz asks enough
  of a newcomer already. The bar comes to the text.

  It is not the only way: the same commands are in the Start tab of the ribbon
  and on the keyboard. Someone who learnt Word will reach for the ribbon,
  someone who learnt anything else will reach for the selection, and neither
  should have to discover the other.

  # Everything here writes LaTeX

  There is no styling model behind these buttons. Bold *is* `\textbf`, and the
  bar reads what the source already says to decide which buttons are lit
  (ADR-0004: one buffer, holding the document). That is why the font list has
  three entries and the size list has ten — those are what LaTeX has, and
  offering a typeface name the compiler cannot honour would be a control that
  lies.

  # Why colour is different from the rest

  `\textcolor` comes from `xcolor`, which is a package rather than the kernel.
  The edit says so and the shell adds the line, because a formatting button
  whose result does not compile is worse than no button.
-->
<script lang="ts">
  import { t } from "./i18n";
  import {
    FONT_FAMILIES,
    FONT_SIZES,
    TEXT_COLOURS,
  } from "./editor/formatting";
  import type {
    AppliedFormatting,
    FontFamily,
    FontSize,
    InlineFormat,
    TextColour,
  } from "./editor/formatting";

  interface Props {
    /** What the selection already is, so the controls can show it. */
    applied: AppliedFormatting;
    /** Where the bar sits in its container, in pixels. */
    left: number;
    top: number;
    /** Turn an inline command on or off. */
    oninline: (command: InlineFormat) => void;
    /** Set the family, or `null` to take it off. */
    onfamily: (family: FontFamily | null) => void;
    /** Set the size, or `null` to take it off. */
    onsize: (size: FontSize | null) => void;
    /** Set the colour, or `null` to take it off. */
    oncolour: (colour: TextColour | null) => void;
    /** Take all the formatting off. */
    onclear: () => void;
    /**
     * The bar itself, so whoever places it can measure it.
     *
     * Bound out rather than measured from outside: the element is this
     * component's, and finding it by class name would break the moment the
     * markup gained a wrapper.
     */
    element?: HTMLElement | undefined;
  }

  let {
    applied,
    left,
    top,
    oninline,
    onfamily,
    onsize,
    oncolour,
    onclear,
    element = $bindable(),
  }: Props = $props();

  /** Whether the swatches are showing. */
  let picking = $state(false);

  /**
   * The buttons that are simply on or off.
   *
   * `emph` is deliberately not here even though it is the command a LaTeX
   * author should usually reach for: two buttons that both look like italic is
   * a choice nobody wants to make mid-sentence. `\textit` is what the button
   * writes, and `\emph` is still understood when it is read.
   */
  const TOGGLES: { command: InlineFormat; labelKey: string; mark: string }[] = [
    { command: "textbf", labelKey: "format-bold", mark: "B" },
    { command: "textit", labelKey: "format-italic", mark: "I" },
    { command: "underline", labelKey: "format-underline", mark: "U" },
    { command: "textsc", labelKey: "format-small-caps", mark: "Aa" },
    { command: "texttt", labelKey: "format-monospace", mark: "M" },
  ];
</script>

<!--
  It carries a `tabindex` because a toolbar has to be reachable by keyboard: the
  selection it acts on can be made with the keyboard, and a bar only the mouse
  can use is a bar half the people who need it cannot.

  `onmousedown|preventDefault` throughout: a click in the bar must not take the
  selection away, and losing the selection is exactly what focusing a button
  does. Without it every button would format nothing.
-->
<div
  bind:this={element}
  class="bar"
  style:left="{left}px"
  style:top="{top}px"
  role="toolbar"
  aria-label={t("format-bar")}
  tabindex="0"
  onmousedown={(event) => event.preventDefault()}
>
  {#each TOGGLES as toggle (toggle.command)}
    <button
      type="button"
      class="mark {toggle.command}"
      class:on={applied.inline.includes(toggle.command)}
      aria-pressed={applied.inline.includes(toggle.command)}
      title={t(toggle.labelKey)}
      aria-label={t(toggle.labelKey)}
      onclick={() => oninline(toggle.command)}
    >
      {toggle.mark}
    </button>
  {/each}

  <span class="rule"></span>

  <select
    class="family"
    title={t("format-family")}
    aria-label={t("format-family")}
    value={applied.family ?? ""}
    onchange={(event) =>
      onfamily(
        ((event.currentTarget as HTMLSelectElement).value || null) as
          | FontFamily
          | null,
      )}
  >
    <option value="">{t("format-family-default")}</option>
    {#each FONT_FAMILIES as family (family)}
      <option value={family}>{t(`format-family-${family}`)}</option>
    {/each}
  </select>

  <select
    class="size"
    title={t("format-size")}
    aria-label={t("format-size")}
    value={applied.size ?? ""}
    onchange={(event) =>
      onsize(
        ((event.currentTarget as HTMLSelectElement).value || null) as
          | FontSize
          | null,
      )}
  >
    <option value="">{t("format-size-default")}</option>
    {#each FONT_SIZES as size (size)}
      <option value={size}>{t(`format-size-${size}`)}</option>
    {/each}
  </select>

  <span class="rule"></span>

  <div class="colour">
    <button
      type="button"
      class="swatch-button"
      class:on={applied.colour !== null}
      title={t("format-colour")}
      aria-label={t("format-colour")}
      aria-expanded={picking}
      onclick={() => (picking = !picking)}
    >
      <span class="letter">A</span>
      <!-- The bar under the A is the colour that is on, which is how every
           word processor shows this and the only part of the button that
           changes. -->
      <span
        class="underline"
        style:background={applied.colour ?? "currentColor"}
      ></span>
    </button>

    {#if picking}
      <div class="swatches" role="menu">
        {#each TEXT_COLOURS as colour (colour)}
          <button
            type="button"
            role="menuitem"
            class="swatch"
            class:on={applied.colour === colour}
            style:background={colour}
            title={t(`format-colour-${colour}`)}
            aria-label={t(`format-colour-${colour}`)}
            onclick={() => {
              picking = false;
              oncolour(colour);
            }}
          ></button>
        {/each}
        <button
          type="button"
          role="menuitem"
          class="none"
          title={t("format-colour-none")}
          onclick={() => {
            picking = false;
            oncolour(null);
          }}
        >
          {t("format-colour-none")}
        </button>
      </div>
    {/if}
  </div>

  <button
    type="button"
    class="clear"
    title={t("format-clear")}
    aria-label={t("format-clear")}
    onclick={onclear}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 13h10M5 3h7l-4 7z" />
    </svg>
  </button>
</div>

<style>
  .bar {
    position: absolute;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: var(--yaz-space-1);
    padding: var(--yaz-space-1);
    background: var(--yaz-bg-secondary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-md, var(--yaz-radius-sm));
    box-shadow: 0 2px 8px rgb(0 0 0 / 25%);
    /* The document scrolls under it; the bar is repositioned rather than
       carried, so it must not itself be a scroll target. */
    overscroll-behavior: contain;
  }

  button {
    font: inherit;
    display: grid;
    place-items: center;
    min-inline-size: 1.9em;
    block-size: 1.9em;
    padding: 0 var(--yaz-space-1);
    color: var(--yaz-text-primary);
    background: none;
    border: 1px solid transparent;
    border-radius: var(--yaz-radius-sm);
    cursor: pointer;
  }

  button:hover {
    background: var(--yaz-bg-hover);
  }

  /* On, rather than merely hovered: the selection already has this. */
  button.on {
    background: var(--yaz-bg-hover);
    border-color: var(--yaz-accent);
  }

  /*
    Each button set the way it acts.

    A bold button that is not itself bold is a button whose label has to be
    read; one that is, is recognised.
  */
  .textbf {
    font-weight: 700;
  }

  .textit {
    font-style: italic;
  }

  .underline {
    text-decoration: underline;
  }

  .textsc {
    font-variant-caps: small-caps;
  }

  .texttt {
    font-family: var(--yaz-font-mono);
  }

  .rule {
    inline-size: 1px;
    block-size: 1.4em;
    background: var(--yaz-border);
  }

  select {
    font: inherit;
    font-size: 0.85em;
    max-inline-size: 7em;
    padding: 0 var(--yaz-space-1);
    color: var(--yaz-text-primary);
    background: var(--yaz-bg-primary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
  }

  .colour {
    position: relative;
  }

  .swatch-button {
    display: grid;
    grid-template-rows: 1fr auto;
    gap: 1px;
    place-items: center;
  }

  .swatch-button .letter {
    line-height: 1;
    font-size: 0.85em;
  }

  .swatch-button .underline {
    inline-size: 1.1em;
    block-size: 3px;
    border-radius: 1px;
  }

  .swatches {
    position: absolute;
    inset-block-start: calc(100% + var(--yaz-space-1));
    inset-inline-start: 0;
    z-index: 1;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--yaz-space-1);
    padding: var(--yaz-space-2);
    background: var(--yaz-bg-secondary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-sm);
    box-shadow: 0 2px 8px rgb(0 0 0 / 25%);
  }

  /*
    The one place a literal colour is right.

    ADR-0010 forbids literal colours because the interface must follow the
    theme. These are not interface colours: they are the document's, named by
    `xcolor`, and `red` here has to be the red that will print.
  */
  .swatch {
    inline-size: 1.2em;
    block-size: 1.2em;
    min-inline-size: 0;
    padding: 0;
    border: 1px solid var(--yaz-border);
  }

  .swatch.on {
    outline: 2px solid var(--yaz-accent);
    outline-offset: 1px;
  }

  .none {
    grid-column: 1 / -1;
    inline-size: 100%;
    font-size: 0.8em;
    color: var(--yaz-text-muted);
  }

  .clear svg {
    inline-size: 1.1em;
    block-size: 1.1em;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
