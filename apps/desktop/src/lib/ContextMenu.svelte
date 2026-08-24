<!--
  A menu at a point on the screen.

  # Why this is not the title bar's dropdown

  That one hangs off a button: it knows where it is because it is positioned
  against the thing that opened it. A right-click menu has no such anchor — it
  belongs to a coordinate — and the two differ in every detail that follows from
  that. This one has to keep itself on screen when the click was near an edge,
  and it has to close on the next click anywhere, including one in a pane it
  knows nothing about.

  It renders the same {@link MenuItem} the menus do, so an entry declared for a
  right-click carries its icon and its separator without a second vocabulary for
  the same idea.
-->
<script lang="ts">
  import { t } from "./i18n";
  import { ICONS } from "./icons";
  import type { MenuItem } from "./MenuBar.svelte";

  interface Props {
    items: MenuItem[];
    /** Where the click was, in client coordinates. */
    x: number;
    y: number;
    onclose: () => void;
  }

  let { items, x, y, onclose }: Props = $props();

  let menu = $state<HTMLDivElement | null>(null);

  /**
   * Nudged back on screen when the click was near an edge.
   *
   * Measured after it is drawn rather than guessed from a fixed width: what is
   * in the menu depends on what was clicked, so its size is not known until it
   * exists. Flipped to the other side of the pointer rather than merely
   * clamped, which is what every desktop menu does — a clamped menu ends up
   * under the cursor with the wrong entry beneath it.
   */
  let size = $state<{ width: number; height: number } | null>(null);

  $effect(() => {
    const element = menu;
    if (element) size = element.getBoundingClientRect();
  });

  const MARGIN = 4;

  const placed = $derived.by(() => {
    // Before it has been measured it goes exactly where the click was, and is
    // not drawn — a menu that appeared at the click point and then jumped is
    // worse than one that appears a frame later in the right place.
    if (!size) return { left: x, top: y };
    return {
      left:
        x + size.width + MARGIN > window.innerWidth
          ? Math.max(MARGIN, x - size.width)
          : x,
      top:
        y + size.height + MARGIN > window.innerHeight
          ? Math.max(MARGIN, y - size.height)
          : y,
    };
  });

  $effect(() => {
    // Pointerdown rather than click: a menu that survived until the click
    // *completed* would still be there under the pointer when the next one
    // began, which is how a right-click menu ends up swallowing a selection.
    const dismiss = () => onclose();
    const onkey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onclose();
    };
    window.addEventListener("pointerdown", dismiss, { capture: true });
    window.addEventListener("keydown", onkey);
    // Scrolling the list underneath would leave the menu pointing at a row that
    // has moved, so it goes rather than follows.
    window.addEventListener("wheel", dismiss, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", dismiss, { capture: true });
      window.removeEventListener("keydown", onkey);
      window.removeEventListener("wheel", dismiss, { capture: true });
    };
  });
</script>

<div
  bind:this={menu}
  class="menu"
  role="menu"
  tabindex="-1"
  style:inset-inline-start="{placed.left}px"
  style:inset-block-start="{placed.top}px"
  style:visibility={size ? "visible" : "hidden"}
  onpointerdown={(event) => event.stopPropagation()}
>
  {#each items as item (item.labelKey)}
    {#if item.separatorBefore}
      <div class="rule" role="separator"></div>
    {/if}
    <button
      type="button"
      class="item"
      class:destructive={item.destructive}
      role="menuitem"
      disabled={item.disabled}
      onclick={() => {
        onclose();
        void item.action?.();
      }}
    >
      <span class="glyph" aria-hidden="true">
        {#if item.icon}
          <svg viewBox="0 0 16 16"><path d={ICONS[item.icon]} /></svg>
        {/if}
      </span>
      <span class="label">{t(item.labelKey)}</span>
    </button>
  {/each}
</div>

<style>
  .menu {
    position: fixed;
    min-inline-size: 11rem;
    padding-block: var(--yaz-space-1);
    background: var(--yaz-bg-overlay);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-md);
    box-shadow: var(--yaz-shadow-overlay);
    z-index: 120;
  }

  .item {
    display: flex;
    align-items: center;
    gap: var(--yaz-space-2);
    inline-size: 100%;
    padding-block: var(--yaz-space-1);
    padding-inline: var(--yaz-space-2);
    text-align: start;
    font: inherit;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-primary);
    background: none;
    border: none;
    cursor: pointer;
  }

  .item:hover:not(:disabled) {
    background: var(--yaz-bg-hover);
  }

  .item:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* The one entry that cannot be undone by doing it again. Coloured rather
     than merely worded, because a menu is aimed at before it is read. */
  .item.destructive {
    color: var(--yaz-error);
  }

  .glyph {
    inline-size: 0.875rem;
    block-size: 0.875rem;
    flex: none;
    display: inline-flex;
    color: var(--yaz-text-muted);
  }

  .item.destructive .glyph {
    color: inherit;
  }

  .glyph svg {
    inline-size: 100%;
    block-size: 100%;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .rule {
    block-size: 1px;
    margin-block: var(--yaz-space-1);
    background: var(--yaz-border);
  }
</style>
