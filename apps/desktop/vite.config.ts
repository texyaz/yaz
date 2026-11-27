import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** Where `pnpm web:serve` runs the yaz web server while developing. */
const webServer = process.env.YAZ_WEB_SERVER ?? "http://127.0.0.1:4173";

/**
 * The Tauri modules, replaced for a yaz served to a browser (ADR-0030).
 *
 * An alias rather than a runtime check: the desktop build never contains a
 * line of this, and no component has to ask which one it is running in.
 */
const webShims = {
  "@tauri-apps/api/core": fileURLToPath(
    new URL("./src/web/core.ts", import.meta.url),
  ),
  "@tauri-apps/api/event": fileURLToPath(
    new URL("./src/web/event.ts", import.meta.url),
  ),
  "@tauri-apps/api/window": fileURLToPath(
    new URL("./src/web/window.ts", import.meta.url),
  ),
  "@tauri-apps/plugin-dialog": fileURLToPath(
    new URL("./src/web/dialog.ts", import.meta.url),
  ),
  // Who is signed in (ADR-0033). The desktop build resolves this to
  // `src/lib/account.ts`, which has nobody, and sends no request.
  "@yaz-host/account": fileURLToPath(
    new URL("./src/web/account.ts", import.meta.url),
  ),
};

/** What the desktop build and the tests resolve `@yaz-host/account` to. */
const hostAccount = fileURLToPath(
  new URL("./src/lib/account.ts", import.meta.url),
);

export default defineConfig(({ mode }) => ({
  plugins: [svelte()],

  resolve: {
    /*
     * What the application lends to a plugin it bundles.
     *
     * Each plugin is its own repository now (ADR-0021), so its dependencies
     * are declared and installed in its own tree — which is right, and which
     * is why they cannot be found from here when the application compiles the
     * plugin's *source* into itself.
     *
     * The two are reconciled by saying so explicitly rather than by hoisting.
     * A plugin reaching for something not on this list fails to build here,
     * which is the same answer it would get from a user who installed it, and
     * the list is short enough to read.
     */
    alias: {
      "@yaz-host/account": hostAccount,
      ...(mode === "web" ? webShims : {}),
      "@yaz/api": fileURLToPath(
        new URL("../../packages/api/src/index.ts", import.meta.url),
      ),
      // The editor packages, resolved from this application's `node_modules`
      // because a bundled plugin's directory has none of its own.
      "@codemirror/legacy-modes": fileURLToPath(
        new URL("./node_modules/@codemirror/legacy-modes", import.meta.url),
      ),
      "@codemirror/language": fileURLToPath(
        new URL("./node_modules/@codemirror/language", import.meta.url),
      ),
      // Lent for the same reason, and needed the moment a plugin draws rather
      // than only tokenises: the Markdown preview is decorations over the
      // buffer, and decorations are `@codemirror/view`.
      "@codemirror/state": fileURLToPath(
        new URL("./node_modules/@codemirror/state", import.meta.url),
      ),
      "@codemirror/view": fileURLToPath(
        new URL("./node_modules/@codemirror/view", import.meta.url),
      ),
      // Lent to the Learn plugin, which renders the DOM to a canvas. Loaded
      // by a dynamic import inside it, so it costs nothing until a capture is
      // actually taken.
      "modern-screenshot": fileURLToPath(
        new URL("./node_modules/modern-screenshot", import.meta.url),
      ),
    },
    // One copy of the editor's state and view, or a plugin's language and the
    // editor's would be talking to different instances of CodeMirror.
    dedupe: ["@codemirror/state", "@codemirror/view", "@codemirror/language"],
  },

  // Tauri drives this dev server; the port is fixed because tauri.conf.json
  // points at it. Failing loudly beats silently moving to 5174 and leaving the
  // window blank.
  server: {
    port: 5173,
    strictPort: true,
    // Only in web mode: the page's commands go to the yaz web server.
    ...(mode === "web"
      ? { proxy: { "/api": webServer, "/auth": webServer } }
      : {}),
    fs: {
      // themes/ and locales/ live at the repo root because both Rust and
      // TypeScript consume them (ADR-0017), so Vite must be allowed to read
      // outside the app directory.
      allow: [repoRoot],
    },
  },

  build: {
    // A separate directory, so a web build can never be what Tauri embeds.
    outDir: mode === "web" ? "dist-web" : "dist",
    emptyOutDir: true,
    // The webview is always current, so there is no legacy browser to serve.
    target: "esnext",
    sourcemap: true,
    // Never inline a font as a `data:` URI.
    //
    // The content security policy in tauri.conf.json is `default-src 'self'`
    // with no `font-src`, so a `data:` font is refused by the webview. Vite
    // inlines any asset under 4 kB by default, and three of KaTeX's twenty font
    // files are under it — the ones that draw large brackets and integral
    // signs. The result would be a formula that renders with the wrong
    // delimiters and no error anywhere.
    assetsInlineLimit: (file) =>
      /\.(woff2?|ttf|eot)$/i.test(file) ? false : undefined,
  },

  // Tauri surfaces these; without them the frontend cannot tell dev from
  // release, which ADR-0013 requires it to know.
  envPrefix: ["VITE_", "TAURI_"],

  clearScreen: false,
}));
