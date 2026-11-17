<!--
  The workspace on a screen too narrow to split.

  # Three panes, side by side, one on screen

  A phone has room for one thing. So the arrangement a desktop builds out of
  splits becomes a fixed row of three — what you navigate by, what you write
  in, what it compiles to — and the screen is a window onto one of them.

  # The swipe is the browser's

  The row is a scroll container with snap points, not a gesture recogniser. A
  finger dragging sideways is a scroll, which the browser already tracks at the
  display's rate, with its own momentum and its own rubber band; anything
  written here would be a worse copy running on the main thread. It also means
  a pane that scrolls sideways itself — a wide table, a zoomed page — keeps its
  drag until it runs out, which is the rule every nested scroller follows.

  # Nothing here is persisted

  The desktop arrangement belongs to the project. This one is the same for
  every project, so there is nothing to save, and turning the phone on its
  side must not rewrite what the desk looks like.
-->
<script lang="ts">
  import type { Snippet } from "svelte";

  import { t } from "../i18n";
  import { ICONS } from "../icons";
  import type { IconName } from "../icons";
  import type { TabId } from "./layout";

  /** The three places the screen can be. */
  export type CompactPane = "side" | "editor" | "pdf";

  const ORDER: CompactPane[] = ["side", "editor", "pdf"];

  interface Props {
    /** Which pane is on screen. */
    pane: CompactPane;
    onpane: (pane: CompactPane) => void;
    /** What the first pane can show, in order. */
    sideTabs: TabId[];
    /** Which of them it is showing. */
    sideTab: TabId;
    onsidetab: (tab: TabId) => void;
    titles: Record<TabId, string>;
    /** Draws a tab. The same snippet the desktop workspace is given. */
    content: Snippet<[TabId]>;
    /** Whether the editor is showing the preview. */
    rich: boolean;
    /** Absent when the open file has no preview to switch to. */
    onrich?: (() => void) | undefined;
    compiling: boolean;
    canCompile: boolean;
    oncompile: () => void;
    /** What went wrong, when something did. One line, above the bar. */
    problem?: string | null | undefined;
    /** The line has been read and can go. */
    ondismiss?: (() => void) | undefined;
  }

  let {
    pane,
    onpane,
    sideTabs,
    sideTab,
    onsidetab,
    titles,
    content,
    rich,
    onrich,
    compiling,
    canCompile,
    oncompile,
    problem = null,
    ondismiss,
  }: Props = $props();

  let deck = $state<HTMLDivElement | null>(null);

  /** The pane the scroll position is on, which is the truth while dragging. */
  function paneAtScroll(): CompactPane {
    if (!deck || deck.clientWidth === 0) return pane;
    const index = Math.round(Math.abs(deck.scrollLeft) / deck.clientWidth);
    return ORDER[Math.min(ORDER.length - 1, Math.max(0, index))] ?? "editor";
  }

  /** Bring a pane on screen. */
  function scrollToPane(target: CompactPane, smooth: boolean) {
    const panel = deck?.children[ORDER.indexOf(target)];
    if (!(panel instanceof HTMLElement)) return;
    // The panel's own offset rather than index × width, which is wrong in a
    // right-to-left layout where the row runs the other way.
    deck?.scrollTo?.({
      left: panel.offsetLeft,
      behavior: smooth ? "smooth" : "instant",
    });
  }

  // Asked for from outside: opening a file brings the editor, compiling brings
  // the PDF. Not when the scroll already is there, or a swipe would be answered
  // with a second scroll to where the finger just put it.
  let placed = false;
  $effect(() => {
    const wanted = pane;
    if (!deck) return;
    if (!placed) {
      // First layout: start on the wanted pane with no animation, so the page
      // does not open on the outline and slide to the document.
      placed = true;
      scrollToPane(wanted, false);
      return;
    }
    if (paneAtScroll() !== wanted) scrollToPane(wanted, true);
  });

  // A rotated phone changes every panel's width, and a scroll offset that was
  // exactly one pane is then somewhere between two.
  $effect(() => {
    if (!deck || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => scrollToPane(pane, false));
    observer.observe(deck);
    return () => observer.disconnect();
  });

  let settle: ReturnType<typeof setTimeout> | undefined;
  function onscroll() {
    // Reported once the drag has come to rest, not on every frame of it: the
    // parent re-renders on a change, and mid-swipe is the wrong moment.
    clearTimeout(settle);
    settle = setTimeout(() => {
      const now = paneAtScroll();
      if (now !== pane) onpane(now);
    }, 80);
  }

  const NAV: { pane: CompactPane; icon: IconName; labelKey: string }[] = [
    { pane: "side", icon: "list", labelKey: "compact-pane-side" },
    { pane: "editor", icon: "pencil", labelKey: "workspace-tab-editor" },
    { pane: "pdf", icon: "page", labelKey: "workspace-tab-pdf" },
  ];
</script>

{#snippet glyph(name: IconName)}
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d={ICONS[name]} /></svg>
{/snippet}

<div class="compact">
  <div class="deck" bind:this={deck} {onscroll}>
    <section class="panel" aria-label={t("compact-pane-side")} inert={pane !== "side"}>
      <div class="side-tabs" role="tablist">
        {#each sideTabs as tab (tab)}
          <button
            type="button"
            role="tab"
            class="side-tab"
            class:active={tab === sideTab}
            aria-selected={tab === sideTab}
            onclick={() => onsidetab(tab)}
          >
            {titles[tab] ?? tab}
          </button>
        {/each}
      </div>
      <div class="content">{@render content(sideTab)}</div>
    </section>

    <section
      class="panel"
      aria-label={t("workspace-tab-editor")}
      inert={pane !== "editor"}
    >
      <div class="content">{@render content("editor")}</div>
    </section>

    <section class="panel" aria-label={t("workspace-tab-pdf")} inert={pane !== "pdf"}>
      <div class="content">{@render content("pdf")}</div>
    </section>
  </div>

  {#if problem}
    <!-- A button, because the line costs a row of a short screen and stays
         until something replaces it: a tap is how it is put away. -->
    <button type="button" class="problem" title={problem} onclick={() => ondismiss?.()}>
      <output>{problem}</output>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d={ICONS.close} /></svg>
    </button>
  {/if}

  <nav class="bar" aria-label={t("compact-bar")}>
    {#each NAV as entry (entry.pane)}
      <button
        type="button"
        class="go"
        class:active={pane === entry.pane}
        aria-current={pane === entry.pane ? "page" : undefined}
        onclick={() => onpane(entry.pane)}
      >
        {@render glyph(entry.icon)}
        <span>{t(entry.labelKey)}</span>
      </button>
    {/each}

    <span class="rule" aria-hidden="true"></span>

    <button
      type="button"
      class="go"
      class:on={rich}
      aria-pressed={rich}
      disabled={!onrich}
      onclick={() => onrich?.()}
    >
      {@render glyph(rich ? "text" : "code")}
      <span>{t(rich ? "compact-view-preview" : "compact-view-source")}</span>
    </button>

    <button
      type="button"
      class="go"
      disabled={!canCompile || compiling}
      onclick={oncompile}
    >
      {@render glyph("play")}
      <span>{t(compiling ? "compile-running" : "compile-start")}</span>
    </button>
  </nav>
</div>

<style>
  .compact {
    display: flex;
    flex-direction: column;
    min-block-size: 0;
    min-inline-size: 0;
  }

  .deck {
    flex: 1;
    display: flex;
    min-block-size: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x mandatory;
    /* The end of the row is the end: no pulling the whole page sideways, and
       no browser "back" from a swipe that ran out of panes. */
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }

  .deck::-webkit-scrollbar {
    display: none;
  }

  .panel {
    flex: 0 0 100%;
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
    min-block-size: 0;
    scroll-snap-align: start;
    /* One pane per swipe, however hard it was flung. */
    scroll-snap-stop: always;
    background: var(--yaz-bg-primary);
  }

  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-block-size: 0;
    overflow: auto;
  }

  .content > :global(*) {
    flex: 1;
    min-block-size: 0;
  }

  .side-tabs {
    flex: none;
    display: flex;
    gap: var(--yaz-space-1);
    padding: 0 var(--yaz-space-2);
    overflow-x: auto;
    scrollbar-width: none;
    background: var(--yaz-bg-secondary);
    border-block-end: 1px solid var(--yaz-border);
  }

  .side-tab {
    font: inherit;
    font-size: var(--yaz-font-size-sm);
    color: var(--yaz-text-secondary);
    background: none;
    border: none;
    border-block-end: 2px solid transparent;
    padding: var(--yaz-space-3) var(--yaz-space-3);
    white-space: nowrap;
    cursor: pointer;
  }

  .side-tab.active {
    color: var(--yaz-accent);
    border-block-end-color: var(--yaz-accent);
  }

  .problem {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--yaz-space-2);
    padding: var(--yaz-space-2) var(--yaz-space-3);
    font: inherit;
    font-size: var(--yaz-font-size-sm);
    text-align: start;
    color: var(--yaz-error);
    background: var(--yaz-bg-secondary);
    border: none;
    border-block-start: 1px solid var(--yaz-border);
    cursor: pointer;
  }

  .problem output {
    flex: 1;
    min-inline-size: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .problem svg {
    flex: none;
    inline-size: 0.75rem;
    block-size: 0.75rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
  }

  .bar {
    flex: none;
    display: flex;
    align-items: stretch;
    background: var(--yaz-bg-secondary);
    border-block-start: 1px solid var(--yaz-border);
    /* Clear of the home indicator on a phone with no chin. */
    padding-block-end: env(safe-area-inset-bottom, 0);
  }

  .go {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    /* A fingertip, not a pointer: nothing here is smaller than 44 px. */
    min-block-size: 2.75rem;
    min-inline-size: 0;
    padding: var(--yaz-space-1) 0;
    font: inherit;
    font-size: 0.6875rem;
    color: var(--yaz-text-muted);
    background: none;
    border: none;
    cursor: pointer;
  }

  .go span {
    max-inline-size: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .go svg {
    inline-size: 1.125rem;
    block-size: 1.125rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .go.active,
  .go.on {
    color: var(--yaz-accent);
  }

  .go:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .rule {
    flex: none;
    inline-size: 1px;
    margin-block: var(--yaz-space-2);
    background: var(--yaz-border);
  }
</style>
