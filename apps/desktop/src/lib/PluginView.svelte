<!--
  A view a plugin renders, given a tab to render into.

  The plugin is handed a plain `HTMLElement` and nothing else — no Svelte, no
  component, no store. That is the whole point of the contract (ADR-0005): the
  shell's framework is the shell's business, and a plugin written against it
  would break the first time the shell changed its mind.

  The document is pushed rather than pulled. A view built out of the buffer — a
  glossary, an index — has to redraw when the buffer changes, and the
  alternative to telling it is having it poll, which puts a plugin's timer on
  the keystroke path (ADR-0015).
-->
<script lang="ts">
  import type { ViewHandle } from "@yaz/api";

  import type { RegisteredView } from "./plugins/host";

  interface Props {
    view: RegisteredView;
    /**
     * The buffer, watched rather than passed on.
     *
     * The plugin reads the document through `app.editor`, which is the one
     * handle it is allowed to hold. This is here only so that a change to the
     * text is something this component can notice.
     */
    doc: string;
  }

  let { view, doc }: Props = $props();

  let container = $state<HTMLDivElement | null>(null);
  let handle: ViewHandle | null = null;

  // Mounted for as long as there is somewhere to mount into, and torn down
  // when there is not: a handle that outlived its container would be a plugin
  // writing into a detached node for the rest of the session.
  $effect(() => {
    const into = container;
    if (!into) return;
    const mounted = view.mount(into);
    handle = mounted;
    return () => {
      handle = null;
      mounted.destroy();
      into.replaceChildren();
    };
  });

  $effect(() => {
    // Read so the effect depends on it; the plugin gets the text itself.
    void doc;
    handle?.update?.();
  });
</script>

<div class="plugin-view" bind:this={container}></div>

<style>
  .plugin-view {
    block-size: 100%;
    overflow: auto;
    background: var(--yaz-bg-primary);
  }
</style>
