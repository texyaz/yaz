/**
 * Frontend test configuration.
 *
 * This exists because `pnpm test` for the frontend was a script that echoed a
 * sentence, and CI ran it and reported success. What slipped through was an
 * editor that rebuilt CodeMirror on every keystroke — the document could only
 * be written one character per mouse click — which is about as visible as a bug
 * gets and still shipped, because nothing exercised the component.
 */
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    // Components import the public API by name, exactly as a plugin does.
    alias: {
      "@yaz/api": new URL("../../packages/api/src/index.ts", import.meta.url)
        .pathname,
      // The same loan the application makes at build time, for the same
      // reason: a bundled plugin's own directory has no `node_modules`, and a
      // test that exercises the plugin's source has to resolve what the
      // application would resolve for it. Kept in step with `vite.config.ts`
      // by hand — the two lists are short, and a test that cannot import what
      // the build can is a test that fails immediately rather than quietly.
      // The ES module, named exactly, not the package directory. Aliasing the
      // directory resolves `main` — which is the CommonJS build — while every
      // ordinary import gets `module`, and the two are different copies. What
      // that looks like is CodeMirror rejecting its own extensions, because an
      // `instanceof` across two copies of a library is always false.
      "@codemirror/state": new URL(
        "./node_modules/@codemirror/state/dist/index.js",
        import.meta.url,
      ).pathname,
      "@codemirror/view": new URL(
        "./node_modules/@codemirror/view/dist/index.js",
        import.meta.url,
      ).pathname,
    },
    // Svelte components under test need the browser build, or lifecycle and
    // effects do not run.
    conditions: ["browser"],
    // One copy of each, or the alias above resolves a second instance and
    // every `instanceof` check inside CodeMirror starts failing — an extension
    // built against one copy is not an extension as far as the other is
    // concerned. `vite.config.ts` dedupes the same three for the same reason.
    dedupe: ["@codemirror/state", "@codemirror/view", "@codemirror/language"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts"],
    /*
     * Raised from the 5 s default, and not because any test is slow.
     *
     * Vitest charges a file's module transform and import to whichever test
     * runs first in it. The editor's graph is CodeMirror, the Vim keymap,
     * KaTeX and a dozen decoration passes, which takes several seconds to
     * transform cold — so with the files running in parallel the *first* test
     * in each of them would fail on a machine that was busy, while the same
     * file passed on its own. That is a timer measuring the wrong thing.
     *
     * What the keystroke budget actually costs is measured deliberately, by
     * `keystroke.test.ts`, against a ratio rather than a clock.
     */
    testTimeout: 30000,
  },
});
