/**
 * The plugin runtime.
 *
 * # What "runtime" means here, and what it does not
 *
 * This builds the `App` object from `@yaz/api` and hands it to plugins. Core
 * plugins are bundled at build time rather than loaded from disk — installing
 * community plugins from a GitHub release is separate work — but the *boundary*
 * is real, and that is the part that matters now: the Zotero plugin imports
 * `@yaz/api` and nothing else, and everything privileged it does goes through a
 * Tauri command that the capability broker refuses first.
 *
 * That is the forcing function in [ADR-0005]. A core plugin with a private back
 * door would tell us nothing about whether the public API is good enough. This
 * one had to have `listAnnotations` and `ui.pick` added as public API precisely
 * because it could not reach around them.
 *
 * # Plugins are not isolated from each other
 *
 * They share one JavaScript realm, so a plugin can read another's state and name
 * its id ([ADR-0006]). Capabilities bound what the plugin layer as a whole can
 * do, not what one plugin can do relative to another. `SECURITY.md` and the Rust
 * `plugin_host` module say the same; it is repeated here because this is the
 * file where someone would otherwise assume otherwise.
 *
 * [ADR-0005]: https://generalpawz.github.io/yaz/adr/0005-extensibility-tiers
 * [ADR-0006]: https://generalpawz.github.io/yaz/adr/0006-plugin-runtime-and-capabilities
 */

import type {
  App,
  Command,
  Detail,
  EditorApi,
  DropHandler,
  ListingKind,
  PickerItem,
  TaskProvider,
  PickerOptions,
  Plugin,
  ProjectApi,
  ViewHandle,
} from "@yaz/api";

import { listen } from "@tauri-apps/api/event";

import { locale, t } from "../i18n";
import * as ipc from "../ipc";
import type { Row } from "../Picker.svelte";

/** A picker the runtime is waiting on, rendered by the application shell. */
export interface PickerRequest {
  titleKey: string;
  placeholderKey?: string | undefined;
  emptyKey?: string | undefined;
  /** What the filter starts with, for a picker opened about something. */
  query?: string | undefined;
  load: (query: string) => Promise<Row[]>;
  resolve: (value: unknown) => void;
}

/** A notice the shell should display. */
export interface Notice {
  id: number;
  text: string;
}

/** A command a plugin registered, as the shell lists it. */
export interface RegisteredCommand {
  pluginId: string;
  id: string;
  /**
   * The message key, kept alongside the resolved name.
   *
   * The menu renders from the key rather than the string so that the i18n check
   * can see it, and so a locale change re-renders the label rather than baking
   * in whatever was active when the plugin loaded.
   */
  nameKey: string;
  name: string;
  callback: () => void | Promise<void>;
  isAvailable?: (() => boolean) | undefined;
}

/** What the shell must supply for the runtime to build an `App`. */
export interface HostContext {
  /** The open project, or null. */
  project(): { root: string; entry: string } | null;
  /** The focused editor, or null. */
  editor(): EditorApi | null;
  /** Compile the open project. */
  compile(): Promise<ipc.CompileResult>;
  /** Show a picker and resolve with the chosen value. */
  requestPicker(request: PickerRequest): void;
  /** Show a transient message. */
  showNotice(text: string): void;
  /** Re-read the task list, after a provider changed something. */
  refreshTasks(): void;
  /** Show something in the Details tab, or clear it with `null`. */
  showDetail(detail: Detail | null): void;
}

/** A text format a plugin contributed, and who contributed it. */
/** A tool a plugin offered, and the code behind it. */
export interface RegisteredTool {
  pluginId: string;
  /** Unqualified. Rust namespaces it by plugin before an agent sees it. */
  name: string;
  descriptionKey: string;
  /** Resolved against the active locale, because that is what Rust is sent. */
  description: string;
  schema?: Record<string, unknown> | undefined;
  run(argumentsGiven: Record<string, unknown>): Promise<unknown> | unknown;
}

/** An agent's call, as it arrives from the server. */
interface Invocation {
  /** Rust's handle on the waiting agent. Sent back with the answer. */
  id: string;
  pluginId: string;
  tool: string;
  arguments?: Record<string, unknown>;
}

export interface RegisteredFormat {
  pluginId: string;
  id: string;
  extensions: string[];
  nameKey: string;
  /** Loads the language, the first time a file of this format is opened. */
  load: () => Promise<unknown>;
}

/**
 * A view a plugin can render, as the shell lists it.
 *
 * Held rather than opened. Registering makes a view available as a tab; which
 * tabs are on screen is the user's arrangement, and a plugin that could put
 * itself there would be deciding something that is not its to decide.
 */
export interface RegisteredView {
  pluginId: string;
  /** Namespaced, so two plugins may both offer a "glossary". */
  tab: string;
  titleKey: string;
  /** The generated list this view is the home of, where it is one. */
  listing: ListingKind | null;
  mount: (container: HTMLElement) => ViewHandle;
}

/** A task list a plugin offered, and who offered it. */
export interface RegisteredTaskProvider {
  pluginId: string;
  provider: TaskProvider;
}

/** A settings panel a plugin contributed, and who contributed it. */
export interface RegisteredSettings {
  pluginId: string;
  titleKey: string;
  render: (container: HTMLElement) => void;
}

/** A drop handler a plugin registered, and who registered it. */
export interface RegisteredDropHandler {
  pluginId: string;
  flavours: readonly string[];
  handle: DropHandler["handle"];
}

/** A LaTeX vocabulary a plugin contributed, and who contributed it. */
export interface RegisteredVocabulary {
  pluginId: string;
  commands: Record<string, unknown>;
  environments: Record<string, unknown>;
}

/**
 * Loads plugins and owns the `App` they see.
 */
export class PluginRuntime {
  readonly commands: RegisteredCommand[] = [];
  /**
   * Text formats plugins have taught the editor about.
   *
   * Held rather than applied: the shell decides which format a file is and
   * whether the user has that format switched on, and the runtime's job is to
   * collect what was offered. A plugin cannot make its format the active one.
   */
  readonly formats: RegisteredFormat[] = [];
  /**
   * What plugins have taught the preview about packages.
   *
   * Held rather than applied, like the formats: which of these is in force is
   * the shell's decision, and a plugin cannot make its own vocabulary the
   * active one.
   */
  readonly vocabularies: RegisteredVocabulary[] = [];
  /**
   * Tools plugins have offered to an agent driving yaz over MCP.
   *
   * Held rather than applied, like the formats and the vocabularies. Whether
   * the MCP server is running at all is the user's decision, and a plugin does
   * not get to make itself reachable from outside the application.
   */
  readonly tools: RegisteredTool[] = [];
  /**
   * Views plugins have offered as tabs.
   *
   * Held rather than applied, like everything else a plugin contributes: the
   * workspace decides what is on screen.
   */
  readonly views: RegisteredView[] = [];
  /**
   * What plugins offered to make of something dropped on the editor.
   *
   * In registration order, and the first that returns text wins. A handler that
   * does not recognise the drop returns `null`, so the order decides only which
   * of two plugins that *both* understand it gets to answer.
   */
  readonly dropHandlers: RegisteredDropHandler[] = [];
  /** Settings panels plugins contributed, shown under Settings → Plugins. */
  readonly settingsPanels: RegisteredSettings[] = [];
  /**
   * Task lists plugins have offered.
   *
   * Held rather than shown, like everything else a plugin contributes: which
   * list a project is linked to is the project's business and the tab's, and a
   * plugin cannot make itself the one in use.
   */
  readonly taskProviders: RegisteredTaskProvider[] = [];
  private readonly loaded = new Map<string, Plugin>();
  /** Stops a second `start()` adding a second listener for the same events. */
  private listening = false;

  constructor(private readonly context: HostContext) {}

  /**
   * Load every bundled plugin the Rust side granted capabilities to.
   *
   * The direction matters: Rust reads each manifest and decides, then this
   * instantiates the code for what came back. A plugin whose manifest did not
   * parse is simply absent here, and its commands never appear — rather than
   * appearing and failing with a capability refusal on first use.
   */
  async start(registry: Record<string, new () => Plugin>): Promise<void> {
    const granted = await ipc.pluginList();
    for (const entry of granted) {
      const factory = registry[entry.id];
      if (!factory) {
        // A manifest bundled without its code, or the reverse. Worth saying:
        // silently skipping would make a missing feature very hard to explain.
        console.warn(`[yaz] no bundled code for plugin ${entry.id}`);
        continue;
      }
      await this.instantiate(entry.id, factory, entry.tools);
    }
    await this.publishTools();
    this.answerInvocations();
  }

  /**
   * Tell the Rust side which tools each plugin ended up offering.
   *
   * Per plugin rather than all at once, because that is how they are withdrawn
   * — a plugin switched off takes its own tools with it and leaves the others
   * alone.
   */
  async publishTools(): Promise<void> {
    const byPlugin = new Map<string, RegisteredTool[]>();
    for (const tool of this.tools) {
      const found = byPlugin.get(tool.pluginId) ?? [];
      found.push(tool);
      byPlugin.set(tool.pluginId, found);
    }
    for (const [pluginId, tools] of byPlugin) {
      try {
        await ipc.mcpSetPluginTools(
          pluginId,
          tools.map((tool) => ({
            pluginId,
            name: tool.name,
            // Resolved here because this is where the catalogues are; Rust
            // hands the text straight to the agent.
            description: tool.description,
            schema: tool.schema ?? null,
          })),
        );
      } catch (error) {
        // MCP being off is not a failure. Nothing is reachable, which is what
        // "off" means, and the tools are still held here for when it is on.
        console.debug(`[yaz] tools for ${pluginId} not published`, error);
      }
    }
  }

  /**
   * Answer an agent's call, on the plugin's behalf.
   *
   * The request arrives as an event because the server is in Rust and the
   * plugin is in the webview, and the reply goes back by command with the id
   * the request carried. Rust holds the waiting agent; this side only has to
   * answer, and to answer *always* — a call that is never replied to is an
   * agent that waits for the timeout.
   */
  private answerInvocations(): void {
    if (this.listening) return;
    this.listening = true;

    void listen<Invocation>("mcp://invoke", async (event) => {
      const { id, pluginId, tool, arguments: given } = event.payload;
      const found = this.tools.find(
        (entry) => entry.pluginId === pluginId && entry.name === tool,
      );

      if (!found) {
        // Registered once and withdrawn since, or never declared. Either way
        // the agent gets an answer rather than a silence.
        await ipc.mcpToolResult(id, null, `no such tool: ${pluginId}.${tool}`);
        return;
      }

      try {
        const result = await found.run(given ?? {});
        await ipc.mcpToolResult(id, result ?? null, null);
      } catch (error) {
        await ipc.mcpToolResult(id, null, String(error));
      }
    });
  }

  private async instantiate(
    pluginId: string,
    factory: new () => Plugin,
    declared: readonly string[] = [],
  ): Promise<void> {
    const app = this.createApp(pluginId);
    const plugin = new factory();
    // `app` is declared readonly on the base class, which is right for plugin
    // authors and means the runtime has to install it. This is the only place
    // that happens.
    Object.defineProperty(plugin, "app", { value: app, writable: false });

    const runtime = this;
    plugin.addCommand = function addCommand(command: Command) {
      runtime.commands.push({
        pluginId,
        id: `${pluginId}.${command.id}`,
        nameKey: command.nameKey,
        name: t(command.nameKey),
        callback: command.callback,
        isAvailable: command.isAvailable,
      });
    };

    plugin.registerFormat = function registerFormat(contribution) {
      // Extensions are held lowercased, because a file called `README.MD` is
      // the same format as one called `readme.md` and a plugin author should
      // not have to think about it.
      runtime.formats.push({
        pluginId,
        id: contribution.id,
        extensions: contribution.extensions.map((entry) =>
          entry.toLowerCase().replace(/^[.]/, ""),
        ),
        nameKey: contribution.nameKey,
        load: contribution.load,
      });
    };

    plugin.registerTool = function registerTool(tool) {
      // The manifest has to have said so first. Without this the declaration
      // would be a comment: free to drift, and free to say less than the
      // plugin actually does — which is exactly what a future registry would
      // be reading to tell somebody what they are installing (ADR-0022).
      //
      // Rust refuses it again on the way to the server, because Rust is the
      // one holding the manifest. This copy is here so that a plugin author
      // finds out at the call site, in development, rather than from a tool
      // that silently never appears.
      if (!declared.includes(tool.name)) {
        console.warn(
          `[yaz] ${pluginId} registered the tool "${tool.name}", ` +
            "which its manifest does not declare under provides.tools",
        );
        return;
      }
      runtime.tools.push({
        pluginId,
        name: tool.name,
        descriptionKey: tool.descriptionKey,
        description: t(tool.descriptionKey),
        schema: tool.schema,
        run: tool.run,
      });
    };

    plugin.registerTaskProvider = function registerTaskProvider(provider) {
      if (
        runtime.taskProviders.some((held) => held.provider.id === provider.id)
      ) {
        console.warn(
          `[yaz] a task provider called "${provider.id}" is already registered`,
        );
        return;
      }
      runtime.taskProviders.push({ pluginId, provider });
    };

    plugin.addSettingsTab = function addSettingsTab(tab) {
      runtime.settingsPanels.push({
        pluginId,
        titleKey: tab.titleKey,
        render: tab.render.bind(tab),
      });
    };

    plugin.registerDropHandler = function registerDropHandler(handler) {
      runtime.dropHandlers.push({
        pluginId,
        flavours: [...handler.flavours],
        handle: handler.handle.bind(handler),
      });
    };

    plugin.registerLatexVocabulary = function registerLatexVocabulary(
      vocabulary,
    ) {
      runtime.vocabularies.push({
        pluginId,
        commands: vocabulary.commands ?? {},
        environments: vocabulary.environments ?? {},
      });
    };

    this.loaded.set(pluginId, plugin);
    await plugin.onload();
  }

  /** Commands that are applicable right now. */
  availableCommands(): RegisteredCommand[] {
    return this.commands.filter((c) => c.isAvailable?.() !== false);
  }

  private createApp(pluginId: string): App {
    const context = this.context;
    const runtime = this;

    const project = (): ProjectApi | null => {
      const open = context.project();
      if (!open) return null;
      return {
        root: open.root,
        entry: open.entry,
        async compile() {
          const result = await context.compile();
          return {
            succeeded: result.succeeded,
            // The IPC layer uses null for "the log did not attribute one"; the
            // public API uses an absent property. Translating here keeps the
            // wire format out of the contract plugin authors program against.
            diagnostics: result.diagnostics.map((d) => ({
              severity: d.severity,
              message: d.message,
              file: d.file ?? undefined,
              line: d.line ?? undefined,
            })),
          };
        },
      };
    };

    return {
      get project() {
        return project();
      },
      get editor() {
        return context.editor();
      },

      settings: {
        async get<T>() {
          // `pluginId` is the identity the runtime instantiated this plugin
          // under, not something the caller passes — so a plugin reads its own
          // settings and has no way to name another's (ADR-0006).
          const stored = await ipc.pluginGetSettings(pluginId);
          return (stored ?? undefined) as T | undefined;
        },
        set: (value: unknown) => ipc.pluginSetSettings(pluginId, value),

        forProject: {
          async get<T>() {
            const open = context.project();
            if (!open) return undefined;
            const stored = await ipc.pluginGetProjectSettings(
              pluginId,
              open.root,
            );
            return (stored ?? undefined) as T | undefined;
          },
          async set(value: unknown) {
            const open = context.project();
            if (!open) throw new Error("no project is open");
            return ipc.pluginSetProjectSettings(pluginId, open.root, value);
          },
        },
      },

      credentials: {
        has: () => ipc.pluginHasCredential(pluginId),
        set: (secret: string) => ipc.pluginSetCredential(pluginId, secret),
        forget: () => ipc.pluginSetCredential(pluginId, null),
        fetch: (url: string, options?: { method?: string; body?: unknown }) =>
          ipc.pluginFetchWithCredential(
            pluginId,
            url,
            options?.method,
            options?.body,
          ),
      },

      tasks: {
        refresh: () => context.refreshTasks(),
      },

      details: {
        // Stamped with the plugin that sent it, so a later detail from the
        // same source replaces this one rather than two sources fighting.
        show: (detail) => context.showDetail({ ...detail, source: pluginId }),
        clear: () => context.showDetail(null),
      },

      workspace: {
        registerView(type, factory, options) {
          // Namespaced by plugin, so two plugins offering a "glossary" get two
          // tabs rather than one of them quietly winning.
          const tab = `${pluginId}:${type}`;
          if (runtime.views.some((view) => view.tab === tab)) {
            console.warn(
              `[yaz] ${pluginId} registered the view "${type}" twice`,
            );
            return;
          }
          runtime.views.push({
            pluginId,
            tab,
            // A view with no title would be a tab with no name. Falling back to
            // the type at least says which one it is.
            titleKey: options?.titleKey ?? type,
            listing: options?.listing ?? null,
            mount: factory,
          });
        },
      },

      fs: {
        async readText(path: string) {
          const open = context.project();
          if (!open) throw new Error("no project is open");
          return ipc.readFile(open.root, path);
        },
        async writeText(path: string, contents: string) {
          const open = context.project();
          if (!open) throw new Error("no project is open");
          return ipc.writeFile(open.root, path, contents);
        },
        async writeBytes(path: string, contents: Uint8Array) {
          const open = context.project();
          if (!open) throw new Error("no project is open");
          return ipc.writeProjectBytes(open.root, path, contents);
        },
        async list() {
          throw new Error("fs.list is not implemented yet");
        },
      },

      i18n: {
        t,
        // A getter, not a value: the public contract is a `string`, but the
        // interface language can change while a plugin is loaded, and a plugin
        // holding the locale it started with would keep formatting dates in it.
        get locale() {
          return locale();
        },
      },

      notices: {
        show(key: string, params?: Record<string, string | number>) {
          context.showNotice(t(key, params));
        },
      },

      ui: {
        pick<T>(options: PickerOptions<T>): Promise<T | null> {
          return new Promise<T | null>((resolve) => {
            const source = options.items;
            const load = async (query: string): Promise<Row[]> => {
              const items: PickerItem<T>[] =
                typeof source === "function"
                  ? await source(query)
                  : filterLocally(source, query);
              // The plugin's value is carried through opaquely; the runtime
              // never inspects it.
              return items.map((item) => ({
                value: item.value,
                label: item.label,
                description: item.description,
                detail: item.detail,
                accentColor: item.accentColor,
              }));
            };

            context.requestPicker({
              titleKey: options.titleKey,
              placeholderKey: options.placeholderKey,
              emptyKey: options.emptyKey,
              query: options.query,
              load,
              resolve: (value) =>
                resolve(value === undefined ? null : (value as T)),
            });
          });
        },
      },

      zotero: {
        status: () =>
          ipc.zoteroStatus(pluginId).then((status) => ({
            kind: status.source,
            sourceKey: status.sourceKey,
            isLive: status.isLive,
            keysAreAuthoritative: status.keysAreAuthoritative,
            dataDir: status.dataDir,
            detail: status.detail,
            isRunning: status.zoteroRunning,
          })),
        search: (query: string, limit?: number) =>
          ipc.zoteroSearch(pluginId, query, limit),
        listAnnotations: (itemKey: string) =>
          ipc.zoteroAnnotations(pluginId, itemKey),
        refreshBibliography: (bibliography?: string, fields?: unknown) => {
          const open = context.project();
          if (!open) return Promise.reject(new Error("no project is open"));
          return ipc.zoteroRefreshBibliography(
            pluginId,
            open.root,
            bibliography,
            fields,
          );
        },
        ensureInBibliography: (
          itemKey: string,
          bibliography?: string,
          scheme?: string,
          fields?: unknown,
        ) => {
          const open = context.project();
          if (!open) return Promise.reject(new Error("no project is open"));
          return ipc.zoteroEnsureInBibliography(
            pluginId,
            open.root,
            itemKey,
            bibliography,
            scheme,
            fields,
          );
        },
        refresh: () => ipc.zoteroReconnect(pluginId),
        isInstalled: () => ipc.zoteroInstalled(pluginId),
        launch: () => ipc.zoteroLaunch(pluginId),
      },

      obsidian: {
        root: null,
        async listNotes() {
          throw new Error("the Obsidian bridge is not implemented yet");
        },
        async translate() {
          throw new Error("the Obsidian bridge is not implemented yet");
        },
      },
    };
  }
}

/**
 * Filter a fixed list.
 *
 * Case-insensitive across every visible field, because a user typing an author's
 * name into a list whose labels are titles should still find the row.
 */
function filterLocally<T>(
  items: PickerItem<T>[],
  query: string,
): PickerItem<T>[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) =>
    [item.label, item.description, item.detail]
      .filter((field): field is string => typeof field === "string")
      .some((field) => field.toLowerCase().includes(needle)),
  );
}
