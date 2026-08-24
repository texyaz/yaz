<script lang="ts">
  import { untrack } from "svelte";
  import { INSERTIONS, prepareAt } from "./lib/editor/insert";
  import { open } from "@tauri-apps/plugin-dialog";
  import type { Extension } from "@codemirror/state";
  import type { EditorApi } from "@yaz/api";
  import type { Menu, MenuItem } from "./lib/MenuBar.svelte";
  import Ribbon, {
    type RibbonAction,
    type RibbonControl,
    type RibbonHeight,
    type RibbonTab,
  } from "./lib/Ribbon.svelte";
  import TitleBar from "./lib/TitleBar.svelte";
  import StatusBar from "./lib/StatusBar.svelte";
  import { countWords } from "./lib/editor/wordCount";
  import {
    DEFAULT_PAPER,
    LANGUAGES,
    ORIENTATIONS,
    PAPER_DIMENSIONS,
    PAPER_SIZES,
    isJustified,
    readProperties,
    requirePackage,
    setProperty,
  } from "./lib/editor/properties";
  import type { Properties } from "./lib/editor/properties";
  import { formatDate, readDate, writeDate } from "./lib/editor/documentDate";
  import type { DateChoice } from "./lib/editor/documentDate";
  import Settings, { type Section } from "./lib/Settings.svelte";
  import type { Health } from "./lib/StatusLight.svelte";
  import History from "./lib/History.svelte";
  import Outline from "./lib/Outline.svelte";
  import PluginView from "./lib/PluginView.svelte";
  import BibliographyFix from "./lib/BibliographyFix.svelte";
  import Citations from "./lib/Citations.svelte";
  import Tasks from "./lib/Tasks.svelte";
  import Details from "./lib/Details.svelte";
  import type { Heading } from "./lib/editor/structure";
  import { LINE_NUMBERING } from "./lib/editor/lineNumbers";
  import {
    applyToFiles,
    filesIn,
    hasIncludes,
    mapChanges,
    mapSegments,
    resolveInclude,
    stitch,
  } from "./lib/editor/stitch";
  import type { Change, Segment } from "./lib/editor/stitch";
  import { KeyDispatcher } from "./lib/keys/dispatcher";
  import {
    DEFAULT_PREFERENCES,
    SUITES,
    conflicts,
    describe as describeBinding,
    isOptional,
    resolve as resolveShortcuts,
  } from "./lib/keys/registry";
  import type { CommandId, KeyPreferences, SuiteId } from "./lib/keys/registry";
  import type { LineNumbering } from "./lib/editor/lineNumbers";
  import { orderTabs } from "./lib/ribbonOrder";
  import FileTree from "./lib/files/FileTree.svelte";
  import ContextMenu from "./lib/ContextMenu.svelte";
  import Confirm from "./lib/Confirm.svelte";
  import NewProject from "./lib/NewProject.svelte";
  import type { DocumentKind } from "./lib/NewProject.svelte";
  import {
    formatOf,
    isEnabled,
    languageFor,
    optionalFormats,
    setContributedFormats,
  } from "./lib/formats/registry";
  import type { FormatId, FormatPreferences } from "./lib/formats/registry";
  import { setContributions } from "./lib/editor/vocabulary";
  import {
    ALL_VISIBLE,
    buildTree,
    initiallyOpen,
    visibleRows,
  } from "./lib/files/tree";
  import type { Filters, Node as ProjectNode } from "./lib/files/tree";
  import Prompt from "./lib/Prompt.svelte";
  import ThemeBuilder from "./lib/ThemeBuilder.svelte";
  import * as theming from "./lib/theme";
  import { setLocale, availableLocales, locale, t } from "./lib/i18n";
  import { formatInCell } from "./lib/editor/tableWidget";
  import { figureFor, nameFor, suffixFor } from "./lib/editor/pastedImage";
  import Search from "./lib/Search.svelte";
  import type { FileMatches } from "./lib/Search.svelte";
  import {
    findMatches,
    PLAIN_SEARCH,
    replaceAll,
    replaceOne,
  } from "./lib/editor/search";
  import type { Match, SearchOptions } from "./lib/editor/search";
  import Pane from "./lib/workspace/Pane.svelte";
  import * as layoutTree from "./lib/workspace/layout";
  import type { Node as LayoutNode, TabId } from "./lib/workspace/layout";
  import PdfView from "./lib/PdfView.svelte";
  import Picker from "./lib/Picker.svelte";
  import * as ipc from "./lib/ipc";
  import {
    PluginRuntime,
    type PickerRequest,
    type RegisteredDropHandler,
    type RegisteredSettings,
    type RegisteredTaskProvider,
    type RegisteredView,
  } from "./lib/plugins/host";
  import type {
    Detail,
    ListingKind,
    Task,
    TaskProject,
    TaskPatch,
    TaskSection,
  } from "@yaz/api";
  import {
    declaredBibliographies,
    numberCitations,
    citationStyle,
    citedWorks,
    diagnoseBibliography,
    ownsPreamble,
    readBib,
    withBibliography,
  } from "./lib/editor/bibliography";
  import type {
    BibProblem,
    CitedWork,
  } from "./lib/editor/bibliography";
  import type { BibEntry } from "./lib/editor/semanticView";
  import {
    appliedFormatting,
    clearFormatting,
    FONT_FAMILIES,
    FONT_SIZES,
    setColour,
    setFamily,
    setSize,
    TEXT_COLOURS,
    toggleEnvironment,
    toggleHeading,
    toggleInline,
  } from "./lib/editor/formatting";
  import type {
    AppliedFormatting,
    FontFamily,
    FontSize,
    InlineFormat,
    TextColour,
  } from "./lib/editor/formatting";
  import {
    canPaginate,
    DOCUMENT_VIEWS,
    viewFor,
  } from "./lib/editor/documentView";
  import type { DocumentView } from "./lib/editor/documentView";
  import ZoteroPlugin from "../../../plugins/zotero/src/main";
  import ObsidianPlugin from "../../../plugins/obsidian/src/main";
  import FormatsPlugin from "../../../plugins/formats/src/main";
  import LearnPlugin from "../../../plugins/learn/src/main";
  import LatexPackagesPlugin from "../../../plugins/latex-packages/src/main";
  import TodoistPlugin from "../../../plugins/todoist/src/main";

  /**
   * The editor component itself, not the plugin-facing handle.
   *
   * The ribbon needs to apply formatting and to read what the selection already
   * is, and neither belongs in `EditorApi`: that is the plugin contract
   * (ADR-0005), and widening it so the shell can talk to its own editor would
   * be the privileged back door the tiers exist to prevent.
   */
  let editorComponent = $state<{
    format: (
      produce: (
        text: string,
        from: number,
        to: number,
      ) => {
        changes: { from: number; to: number; insert: string }[];
        from: number;
        to: number;
        requires?: { package: string } | undefined;
      },
    ) => void;
    formattingNow: () => AppliedFormatting;
  } | null>(null);

  /**
   * What the selection is, for the ribbon to show.
   *
   * Re-read when the caret moves rather than derived from the text, because
   * "what is this selection inside" is a question about a position and the text
   * alone cannot answer it.
   */
  let selectionFormat = $state<AppliedFormatting>({
    inline: [],
    family: null,
    size: null,
    colour: null,
  });

  /** Apply a formatting edit, from wherever it was asked for. */
  function applyFormatting(
    produce: (
      text: string,
      from: number,
      to: number,
    ) => {
      changes: { from: number; to: number; insert: string }[];
      from: number;
      to: number;
      requires?: { package: string } | undefined;
    },
    /**
     * Which inline command this is, where it is one.
     *
     * Named rather than inferred, because a closure cannot be asked what it
     * does — and a drawn table cell has to know before it can answer.
     */
    command?: InlineFormat,
  ) {
    // A selection inside a drawn table cell is a DOM selection and not a
    // CodeMirror one, so the ordinary path has nothing to act on there. The
    // cell answers for itself, and says whether it did.
    if (command && formatInCell(command)) return;

    editorComponent?.format(produce);
    selectionFormat =
      editorComponent?.formattingNow() ?? appliedFormatting("", 0, 0);
  }

  /**
   * The title bar, so a shortcut can put the caret in its search box.
   *
   * A binding rather than a `document.querySelector`: the field belongs to that
   * component, and finding it by selector would break the first time its markup
   * gained a wrapper.
   */
  let titleBar = $state<{ focusSearch: () => void } | null>(null);

  /** The plugin the shell asks about connection status on the user's behalf. */
  const ZOTERO_PLUGIN_ID = "com.yaz.zotero";

  /** The plugins whose commands the shell puts somewhere particular. */
  const TODOIST_PLUGIN_ID = "com.yaz.todoist";
  const LEARN_PLUGIN_ID = "com.yaz.learn";

  /**
   * The commands one plugin contributes.
   *
   * The shell places a handful of plugins' commands deliberately — beside the
   * connection they need, or in the tab whose job they do. Everything else a
   * plugin adds is reachable from the command palette without the shell knowing
   * anything about it, which is the arrangement ADR-0005 asks for: this is a
   * courtesy for the bundled few, not a privilege they depend on.
   */
  function commandsOf(pluginId: string) {
    return commands.filter((command) => command.pluginId === pluginId);
  }

  /**
   * The editor is loaded when a file is first opened, not at startup.
   *
   * CodeMirror plus the Vim keymap is the largest thing left in the initial
   * bundle, and until a document is open there is nothing for it to do. The
   * window that appears before that is a toolbar, a file list and two empty
   * panes.
   *
   * PdfView stays eagerly imported: it is a thin shell, and the heavy part
   * (pdf.js) does its own lazy load from inside.
   */
  let EditorComponent = $state<typeof import("./lib/Editor.svelte").default | null>(null);
  let editorLoadFailed = $state(false);

  let project = $state<ipc.ProjectInfo | null>(null);
  let currentFile = $state<string | null>(null);
  let docText = $state("");
  let dirty = $state(false);
  let busy = $state(false);
  let result = $state<ipc.CompileResult | null>(null);
  let pdfData = $state<Uint8Array | null>(null);
  /**
   * Which PDF is on screen, when it is not the one yaz compiled.
   *
   * Null means the compile's own output, which is the usual case and the only
   * one inverse search works for — a PDF from somewhere else has no SyncTeX
   * database, so there is nothing to jump back to. Anything else is a file the
   * author opened from the list: a reference, a figure, last month's version.
   */
  let pdfFile = $state<string | null>(null);
  /** How many pages the compiled PDF has, for the status bar. */
  let pdfPages = $state<number | null>(null);
  let vimMode = $state(false);
  /** Render the source as styled text. Same buffer, decorations only. */
  let richText = $state(false);
  /** Caret offset, so the outline can show where the reader is. */
  let cursor = $state(0);
  /**
   * How the gutter numbers lines.
   *
   * Absolute to begin with, because that is what a compiler error names. Prose
   * does not want numbers at all and Vim wants them relative, which is why
   * this is three states rather than a checkbox.
   */
  let numbering = $state<LineNumbering>("absolute");
  /**
   * What the file list shows, and which folders are open.
   *
   * The filters are a view of the project rather than a property of it, so
   * they live here and not in the scan — which returns everything, once.
   */
  let fileFilters = $state<Filters>({ ...ALL_VISIBLE });
  /** Build artefacts are dimmed by default rather than hidden. */
  let dimBuild = $state(true);
  let openFolders = $state<Set<string>>(new Set());

  const fileTree = $derived(
    buildTree(project?.files ?? [], fileFilters, project?.directories ?? []),
  );
  const fileRows = $derived(visibleRows(fileTree, openFolders));

  /**
   * Open the folders on the way to the entry document, when a project opens.
   *
   * Opening everything buries the file that matters in a project with two
   * hundred images; opening nothing means three clicks before anyone can
   * start.
   */
  $effect(() => {
    const files = project?.files;
    if (files) openFolders = initiallyOpen(files);
  });

  /** Open a folder, or close it. */
  function toggleFolder(path: string) {
    const next = new Set(openFolders);
    if (!next.delete(path)) next.add(path);
    openFolders = next;
  }
  /**
   * Whether the document's files are edited as one.
   *
   * Off is what ADR-0004 describes and what most projects want: one buffer
   * holding one file, byte for byte. On, the buffer holds the entry document
   * with every `\include` expanded in place and each edit is written back to
   * the file it came from
   * ([ADR-0020](https://generalpawz.github.io/yaz/adr/0020-stitched-multi-file-editing)).
   */
  let joined = $state(false);
  /**
   * The text of every file the joined buffer drew from, as it stands now.
   *
   * Held in full rather than re-read on save, because these are the files
   * *after* the edits that have not been saved yet — the buffer is the only
   * other place that text exists, and it no longer knows which file it is in.
   */
  let joinedFiles = $state<Map<string, string>>(new Map());
  /**
   * The map as it was stitched, which is what the editor is handed.
   *
   * Deliberately *not* updated as the user types. The editor moves its own copy
   * with every change, and feeding a new map back per keystroke would put a
   * second transaction on the keystroke path to tell it what it already knows.
   */
  let joinedSegments = $state<Segment[] | null>(null);
  /**
   * The same map, moved as the editor moves its own.
   *
   * The shell needs its own copy because it writes the edits to the files, and
   * a change arrives in the coordinates the buffer has *now* — measured against
   * the map as first stitched, the second keystroke onwards would be written at
   * the wrong offset and, past a seam, into the wrong file.
   *
   * Not `$state`: nothing on screen is derived from it, and making it reactive
   * would feed it back into the editor as a prop on every character.
   */
  let liveSegments: Segment[] | null = null;
  /** The files edited since the last save, which is what a save writes. */
  let joinedDirty = $state<Set<string>>(new Set());
  /** Included files that could not be read, left in the buffer as commands. */
  let joinedMissing = $state<string[]>([]);

  /**
   * What the editor treats as "a different document".
   *
   * Joining is a different document even though the file has not changed —
   * a buffer of seven files is not the file it started from, and the editor
   * has to replace the text rather than fold the change into what is there.
   *
   * The project's root is part of it because the *name* is not enough: nearly
   * every project has a `main.tex`, so opening a second one left the first
   * one's text on screen — the editor was told the document had not changed.
   */
  const editorDocId = $derived(
    joined && project
      ? `joined:${project.root}:${project.entry}`
      : `${project?.root ?? ""}:${currentFile ?? ""}`,
  );

  /**
   * How the text is set: plain, a centred column, or on paper.
   *
   * What the author chose, which is not always what is drawn: a Markdown file
   * has no paper size, so the page view falls back to the column for it and
   * comes back when a `.tex` is opened again. Keeping the choice rather than
   * silently rewriting it is what makes switching between two files not lose
   * the setting.
   */
  let chosenView = $state<DocumentView>("continuous");
  /** How large the text is drawn, as a percentage. */
  let zoom = $state(100);
  /** Whether a line too long for the pane comes back round. */
  let wrap = $state(true);
  /**
   * Whether the author's comments are on screen.
   *
   * On, because a comment is something the author wrote. Off is for reading a
   * document that has been commented as heavily as one under review, where
   * there is more `%` than prose and none of it reaches the PDF.
   */
  let comments = $state(true);
  /**
   * Whether an explicit line break shows as itself.
   *
   * Off, because the break is the thing a reader sees and the two characters
   * asking for it are not. On for checking a title block, or working out why a
   * line ended early.
   */
  let lineBreaks = $state(false);
  /**
   * Whether the document's machinery is on screen.
   *
   * `\begin{titlepage}`, `\renewcommand`, `\addcontentsline`: instructions that
   * produce no words. On when the author is working on the machinery itself and
   * would rather not put the whole view back to source.
   */
  let machinery = $state(false);

  /**
   * Whether a table stays drawn when the caret is inside it.
   *
   * Off by default, because everywhere else in the view the caret reveals the
   * source and a table should not be the odd one out without being asked.
   */
  let tablesLocked = $state(false);
  /**
   * Whether the page is white paper whatever the interface is.
   *
   * A separate question from the colour mode, and not a consequence of it:
   * someone proofreading wants paper, and the same person writing at midnight
   * wants the dark they chose for everything else.
   */
  let paperLight = $state(false);
  /** Whether the ribbon's body shows, and which way it runs. */
  let ribbonOpen = $state(true);
  let ribbonVertical = $state(false);
  /**
   * How tall the ribbon is, as one of two named sizes.
   *
   * Not a draggable edge: a ribbon dragged thin has its labels cut off and one
   * dragged tall is a window with no document in it, and both are states a
   * handle invites.
   */
  let ribbonHeight = $state<RibbonHeight>("regular");
  /** Whether saving happens by itself. */
  let autosave = $state(false);
  /** What is in the title bar's search box. */
  let search = $state("");

  /**
   * The standardised things the document declares.
   *
   * Read out of the source rather than held beside it: there is one document
   * and it is the `.tex` (ADR-0004), so a co-author who writes `\author{}` by
   * hand and one who uses the ribbon are editing the same thing.
   */
  const properties = $derived<Properties>(readProperties(docText));
  /**
   * The sheet's proportions, turned if the whole document is.
   *
   * A document set landscape has landscape paper, so the two numbers swap
   * here rather than every consumer of them having to remember to ask.
   */
  const paperSize = $derived.by(() => {
    const size = PAPER_DIMENSIONS[properties.paper] ?? PAPER_DIMENSIONS[DEFAULT_PAPER]!;
    return properties.orientation === "landscape"
      ? { width: size.height, height: size.width }
      : size;
  });
  const wordCount = $derived(countWords(docText));
  /** Whether paragraphs are set justified, as the document asks. */
  const justified = $derived(isJustified(docText));
  /**
   * The date as one of the three things `\date{}` can mean.
   *
   * An absent `\date` is `\today` in LaTeX, and `readDate` says so — which is
   * why the empty string the properties reader returns for "no command" has to
   * be turned back into `null` here.
   */
  const documentDate = $derived<DateChoice>(
    readDate(/\\date\s*\{/.test(docText) ? properties.date : null),
  );

  /**
   * How the application looks and what language it speaks.
   *
   * Held here rather than read where it is needed, because a theme is one
   * attribute on the document and a language is a catalogue swap: both are
   * application-wide by nature, and threading them through components would
   * make every component care about something none of them decide.
   */
  let appearance = $state<ipc.Appearance>({
    theme: theming.BUNDLED_THEME,
    colourMode: "system",
    interfaceLocale: "en-US",
  });
  let themes = $state<ipc.ThemeInfo[]>([]);
  let buildingTheme = $state(false);

  /**
   * What the keyboard does.
   *
   * The registry declares every shortcut; this is only what the user changed —
   * suites switched off, bindings replaced. Kept whole rather than as a list of
   * bindings so that adding a shortcut in a later version reaches people who
   * have customised others.
   */
  let keyPreferences = $state<KeyPreferences>(DEFAULT_PREFERENCES);

  /**
   * Which text formats have their own support switched on.
   *
   * Absent means on, so a format added in a later version arrives on for
   * someone who has already been here — the same reason the keyboard stores
   * only what changed.
   */
  let formatPreferences = $state<FormatPreferences>({});

  /**
   * What kind of file is open, and the language to highlight it as.
   *
   * The language is loaded when a file of that kind is first opened, so a
   * session that never opens a `.yaml` never loads the YAML mode. `null` is the
   * floor — line numbers, wrapping, Vim, search — and is what an unknown format
   * and a switched-off one both get.
   */
  /*
   * Preview is LaTeX's, for now.
   *
   * Its decorations are LaTeX constructs, and drawing them over a YAML file
   * would be a view of something the file is not. The View entry is disabled
   * rather than left to do nothing, because a switch that looks live and is
   * not is worse than one that is plainly off.
   */
  const currentFormat = $derived<FormatId>(
    joined ? "latex" : formatOf(currentFile ?? ""),
  );
  let language = $state<Extension | null>(null);

  /**
   * The view actually drawn, which is the chosen one unless it cannot apply.
   *
   * @see {@link viewFor}
   */
  const shownView = $derived(viewFor(chosenView, currentFormat));


  $effect(() => {
    const wanted = currentFormat;
    const preferences = formatPreferences;
    let cancelled = false;

    void languageFor(wanted, preferences).then((loaded) => {
      // The file may have changed while the chunk was in flight, and applying
      // a language to the wrong document is worse than applying none.
      if (!cancelled) language = loaded;
    });

    return () => {
      cancelled = true;
    };
  });

  /** Switch a format's own support on or off. */
  async function chooseFormat(id: FormatId, enabled: boolean) {
    formatPreferences = { ...formatPreferences, [id]: enabled };
    const disabled = optionalFormats().filter(
      (format) => !isEnabled(format.id, formatPreferences),
    ).map((format) => format.id);
    try {
      await ipc.setFormatPreferences({ disabled });
    } catch (error) {
      failure = String(error);
    }
  }
  const shortcuts = $derived(resolveShortcuts(keyPreferences));
  const keyConflicts = $derived(conflicts(shortcuts));

  /** Put the chosen theme and mode on the document. */
  async function applyAppearance() {
    theming.applyAppearance(appearance.theme, appearance.colourMode);
    setLocale(appearance.interfaceLocale);
    try {
      theming.applyStylesheet(await ipc.themeStylesheet(appearance.theme));
    } catch {
      // A theme whose file has gone leaves the token defaults in place, which
      // is a working interface rather than an unstyled one.
      theming.applyStylesheet("");
    }
  }

  /** Store the appearance and put it into effect. */
  async function changeAppearance(next: Partial<ipc.Appearance>) {
    appearance = { ...appearance, ...next };
    await applyAppearance();
    try {
      await ipc.setAppearance(appearance);
    } catch (error) {
      failure = String(error);
    }
  }
  let failure = $state<string | null>(null);
  let engines = $state<ipc.EngineInfo[]>([]);
  let selectedEngine = $state<string | null>(null);

  let editorApi: EditorApi | null = null;
  let picker = $state<PickerRequest | null>(null);
  let notice = $state<string | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  let zoteroStatus = $state<ipc.ZoteroStatus | null>(null);
  let connectionsBusy = $state(false);
  let settingsOpen = $state(false);
  let settingsSection = $state<string | undefined>(undefined);
  let enginesLoaded = $state(false);
  let recent = $state<ipc.RecentProject[]>([]);

  let vcs = $state<ipc.VcsStatus | null>(null);
  let vcsBackends = $state<ipc.VcsBackend[]>([]);
  let commits = $state<ipc.Commit[]>([]);
  let vcsBusy = $state(false);
  /** Set while the commit-message prompt is open. */
  let askingForMessage = $state(false);

  /** Refresh version-control state and history for the open project. */
  async function refreshVcs() {
    if (!project) {
      vcs = null;
      commits = [];
      return;
    }
    try {
      vcs = await ipc.vcsStatus(project.root);
      commits = vcs.enabled ? await ipc.vcsHistory(project.root) : [];
    } catch (error) {
      failure = String(error);
    }
  }

  /**
   * Turn recording on or off.
   *
   * Off is a settings line: the repository and every recorded version stay
   * exactly where they are, and switching back on finds them.
   */
  async function toggleVcs() {
    if (!project) return;
    vcsBusy = true;
    try {
      vcs = vcs?.enabled
        ? await ipc.vcsDisable(project.root)
        : await ipc.vcsEnable(project.root, vcs?.backend ?? "git");
      commits = vcs.enabled ? await ipc.vcsHistory(project.root) : [];
      showNotice(t(vcs.enabled ? "vcs-recording" : "vcs-not-recording"));
    } catch (error) {
      failure = String(error);
    } finally {
      vcsBusy = false;
    }
  }

  /**
   * Record a version.
   *
   * `message` absent means "you describe it" — the backend generates one from
   * what changed. A message the author wrote is never overruled.
   */
  async function recordVersion(message?: string) {
    if (!project || !vcs?.enabled) return;
    vcsBusy = true;
    try {
      const commit = await ipc.vcsCommit(project.root, message);
      if (commit) {
        showNotice(t("vcs-committed", { id: commit.shortId }));
      }
      await refreshVcs();
    } catch (error) {
      failure = String(error);
    } finally {
      vcsBusy = false;
    }
  }

  async function restoreVersion(commit: ipc.Commit) {
    if (!project) return;
    vcsBusy = true;
    try {
      await ipc.vcsRestore(project.root, commit.id);
      showNotice(t("vcs-restored", { id: commit.shortId }));
      // The file on disk changed underneath the editor, so re-read it.
      if (currentFile) await openFile(currentFile);
      await refreshVcs();
    } catch (error) {
      failure = String(error);
    } finally {
      vcsBusy = false;
    }
  }

  /**
   * Jump to the source behind a point in the compiled PDF.
   *
   * The PDF is a rendering of the file being edited, so a click in it is a
   * question about the source — "what wrote this?" — and answering it is what
   * makes the two panes one document rather than two windows.
   *
   * A location in a file that is not the open one opens that file first. A
   * location outside the project is reported rather than silently ignored:
   * more often than not it is a package, and knowing that is the answer.
   */
  async function jumpToSource(page: number, x: number, y: number) {
    if (!project || !result?.synctexPath) return;
    try {
      const found = await ipc.locateInSource(project.root, result.synctexPath, page, x, y);
      if (!found) return;
      if (!found.inProject) {
        showNotice(t("synctex-outside-project", { path: found.path }));
        return;
      }
      if (found.path !== currentFile) await openFile(found.path);
      revealLine(found.line, found.path);
    } catch (error) {
      failure = String(error);
    }
  }

  /**
   * Put the cursor on a line of the open document.
   *
   * Offsets rather than a line API because the buffer is the `.tex` in both
   * views (ADR-0004), so counting line breaks in the text the shell already
   * holds gives the same answer the editor would.
   */
  function revealLine(line: number, file?: string) {
    // Joined, a line number from elsewhere counts lines in *its own file* and
    // the buffer holds all of them, so the file's own start has to be added
    // back. Without this a click near the end of a chapter landed near the
    // start of the document.
    const base =
      joined && file
        ? ((liveSegments ?? []).find((segment) => segment.file === file)?.from ??
          0)
        : 0;

    let start = base;
    for (let current = 1; current < line; current += 1) {
      const next = docText.indexOf("\n", start);
      if (next === -1) break;
      start = next + 1;
    }
    const end = docText.indexOf("\n", start);
    editorApi?.revealRange(start, end === -1 ? docText.length : end);
  }

  /**
   * Read the stored appearance before anything is painted.
   *
   * `system` has to keep following the system, so the change listener outlives
   * this: a machine that switches to dark at sunset should take the
   * application with it.
   */
  $effect(() => {
    void (async () => {
      try {
        appearance = await ipc.getAppearance();
        themes = await ipc.listThemes();

        // What View was left at. Applied before anything is drawn, so the
        // document does not appear as source and then flip to preview.
        const view = await ipc.getViewPreferences();
        richText = view.richText;
        chosenView = view.documentView as DocumentView;
        numbering = view.lineNumbering as LineNumbering;
        wrap = view.wrap;
        comments = view.comments;
        lineBreaks = view.lineBreaks;
        machinery = view.machinery;
        tablesLocked = view.tablesLocked;
        paperLight = view.paperLight;
        zoom = view.zoom;
        vimMode = view.vimMode;
        autosave = view.autosave;
        dimBuild = view.dimBuild;
        fileFilters = {
          showHidden: view.showHidden,
          showOther: view.showOther,
          showBuild: view.showBuild,
        };
        ribbonOpen = view.ribbonOpen;
        ribbonHeight = view.ribbonHeight as RibbonHeight;
        ribbonVertical = view.ribbonVertical;
        // Only now may the effect above write: before this it would have
        // overwritten the file with the defaults it had not yet replaced.
        viewLoaded = true;

        // The stored suites are strings: a settings file written by a later
        // version can name a group this one has never heard of, and the
        // registry ignores what it does not recognise rather than refusing to
        // start.
        const stored = await ipc.getKeyPreferences();
        keyPreferences = {
          disabledSuites: stored.disabledSuites as SuiteId[],
          overrides: stored.overrides,
        };
      } catch {
        // Defaults are already in place, and an interface that will not start
        // because it could not read a colour preference would be worse.
      }
      await applyAppearance();
    })();

    return theming.watchSystemMode(() => {
      if (appearance.colourMode === "system") {
        theming.applyAppearance(appearance.theme, appearance.colourMode);
      }
    });
  });

  /**
   * Install a theme bundle the user points at.
   *
   * A folder rather than a zip: unzipping is something every desktop already
   * does, and asking yaz to do it too would mean carrying an archive library
   * for a step the file manager finished a moment ago.
   */
  async function installTheme() {
    const chosen = await open({ directory: true, multiple: false });
    if (typeof chosen !== "string") return;
    try {
      const installed = await ipc.installTheme(chosen);
      themes = await ipc.listThemes();
      showNotice(t("theme-installed", { name: installed.name }));
      await changeAppearance({ theme: installed.id });
    } catch (error) {
      failure = String(error);
    }
  }

  /** Write a built theme somewhere the user can share it from. */
  async function exportTheme(_id: string, css: string, manifest: string) {
    const chosen = await open({ directory: true, multiple: false });
    if (typeof chosen !== "string") return;
    try {
      const written = await ipc.exportTheme(chosen, manifest, css);
      showNotice(t("theme-exported", { path: written }));
    } catch (error) {
      failure = String(error);
    }
  }

  /**
   * Use a theme that was just built.
   *
   * It is written into the themes folder first, because "use this" has to
   * survive closing the window — a theme that exists only in the builder's
   * state would vanish on the next start and take the interface's appearance
   * with it.
   */
  async function applyBuiltTheme(id: string, name: string, css: string, manifest: string) {
    try {
      await ipc.saveTheme(manifest, css);
      themes = await ipc.listThemes();
      await changeAppearance({ theme: id });
      showNotice(t("theme-installed", { name }));
    } catch (error) {
      failure = String(error);
    }
    buildingTheme = false;
  }

  /**
   * Change one of the document's declared properties.
   *
   * Written into the source through the editor rather than to the file, so it
   * is one undo step and the editor's view of the document never diverges from
   * the shell's.
   */
  function changeProperty(key: keyof Properties, value: string) {
    const edit = setProperty(docText, key, value);
    if (!edit) return;
    if (editorApi) {
      editorApi.replaceRange(edit.from, edit.to, edit.insert);
      return;
    }
    // No editor open: the file is still the document, so edit the text and let
    // the usual save path carry it. Joined, there is no such thing — the text
    // belongs to no one file, and only the editor's map says which.
    if (joined) return;
    docText = docText.slice(0, edit.from) + edit.insert + docText.slice(edit.to);
    dirty = true;
  }

  /**
   * Make sure the document loads a package a formatting edit needs.
   *
   * Colour is the case: `	extcolor` is `xcolor`, which is a package and not
   * the kernel, so applying a colour to a document that does not load it would
   * produce a document that no longer compiles.
   *
   * Written where the preamble actually is. With a chapter open, that is
   * `main.tex` and not the buffer — the same split the bibliography needed, and
   * the same answer.
   */
  async function ensurePackage(name: string) {
    const buffer = editorApi?.getText() ?? docText;

    if (ownsPreamble(buffer)) {
      const edit = requirePackage(buffer, name);
      if (!edit) return;
      // Through the editor, so it is one Ctrl+Z away like any other edit.
      if (editorApi) editorApi.replaceRange(edit.from, edit.to, edit.insert);
      else if (!joined) {
        docText =
          docText.slice(0, edit.from) + edit.insert + docText.slice(edit.to);
        dirty = true;
      }
      return;
    }

    if (!project) return;
    const open = project;
    try {
      const entry = await ipc.readFile(open.root, open.entry);
      const edit = requirePackage(entry, name);
      if (!edit) return;
      const next =
        entry.slice(0, edit.from) + edit.insert + entry.slice(edit.to);
      await ipc.writeFile(open.root, open.entry, next);
      entryText = next;
      showNotice(t("format-package-added", { package: name, file: open.entry }));
    } catch (error) {
      failure = String(error);
    }
  }

  /**
   * Save by itself, once the typing stops.
   *
   * Debounced rather than on every keystroke: a save is a write to disk and,
   * with version control on, a commit — doing either per character would make
   * the history unreadable and the disk busy for no benefit.
   */
  $effect(() => {
    if (!autosave || !dirty || !currentFile) return;
    const timer = setTimeout(() => void save(), 1200);
    return () => clearTimeout(timer);
  });

  /** Keep the keyboard the user arranged. */
  async function saveKeys() {
    try {
      await ipc.setKeyPreferences(keyPreferences);
    } catch (error) {
      failure = String(error);
    }
  }

  /**
   * Do what a shortcut asked for.
   *
   * The window-scoped half of the registry ends up here. The editor-scoped
   * half never does — those run inside CodeMirror, where they can see the
   * document.
   */
  function runShortcut(command: CommandId) {
    switch (command) {
      case "navigate.commands":
        openCommandPalette();
        return;
      case "view.toggleRichText":
        richText = !richText;
        return;
      case "view.toggleSource":
        richText = false;
        return;
      case "view.togglePageView":
        // Round the three rather than to a fixed one, for the same reason the
        // line-number shortcut does: a shortcut that always lands on the same
        // setting is half a shortcut.
        chosenView =
          DOCUMENT_VIEWS[
            (DOCUMENT_VIEWS.indexOf(chosenView) + 1) % DOCUMENT_VIEWS.length
          ] ?? "continuous";
        return;
      case "view.toggleFiles":
        toggleTab("files");
        return;
      case "view.wrap":
        wrap = !wrap;
        return;
      case "view.lineNumbers":
        // Round the three states rather than to a fixed one: a shortcut that
        // always lands on the same setting is half a shortcut.
        numbering =
          LINE_NUMBERING[
            (LINE_NUMBERING.indexOf(numbering) + 1) % LINE_NUMBERING.length
          ] ?? "absolute";
        return;
      case "navigate.search":
        focusSearch(false);
        return;
      case "navigate.replace":
        focusSearch(true);
        return;
      case "navigate.outline":
        updateLayout(
          layoutTree.isOpen(layout, "outline")
            ? layoutTree.closeTab(layout, "outline")
            : layoutTree.openTab(layout, "outline"),
        );
        return;
      case "document.compile":
        void compile();
        return;
      case "document.recordVersion":
        askingForMessage = true;
        return;
      default:
        // Editor-scoped commands reach CodeMirror instead, and anything else
        // is a command declared but not yet wired — which the settings list
        // will show as bound to a key that does nothing.
        return;
    }
  }

  /**
   * The keyboard, at the window.
   *
   * Capture phase, so a chord prefix is taken before CodeMirror is asked for
   * it. Everything else falls through untouched, which is what lets the editor
   * keep its own bindings.
   */
  $effect(() => {
    const dispatcher = new KeyDispatcher(runShortcut);
    dispatcher.update(shortcuts);

    const onkeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dispatcher.cancel();
        return;
      }
      if (dispatcher.handle(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("keydown", onkeydown, true);
    return () => window.removeEventListener("keydown", onkeydown, true);
  });

  /** Refresh the recent list. Cheap, and only read when a menu opens. */
  async function loadRecent() {
    try {
      recent = await ipc.recentProjects();
    } catch {
      recent = [];
    }
  }

  /**
   * The pane layout.
   *
   * Replaces a hard-coded editor-left / PDF-right grid. Every view added after
   * those two — rich text, an outline, a diff — would otherwise have needed its
   * own slot and its own arrangement rule; a tree costs the same for two panes
   * or six, and "close the preview and give the source the whole window" stops
   * being a special case.
   */
  let layout = $state<LayoutNode>(layoutTree.defaultLayout());

  /**
   * Tabs plugins have contributed, once they have loaded.
   *
   * Copied out of the runtime rather than read from it, because the runtime is
   * a plain object and this has to be reactive: a glossary tab that appeared
   * only after the next unrelated state change would look like a bug in the
   * plugin.
   */
  let pluginViews = $state<RegisteredView[]>([]);

  /**
   * What plugins offered to make of something dropped on the editor.
   *
   * Copied out of the runtime for the same reason the views are: the runtime is
   * a plain object, and a handler that only became live after the next
   * unrelated state change would look like the plugin had failed.
   */
  let dropTakers = $state<RegisteredDropHandler[]>([]);

  /**
   * What the Details tab is showing.
   *
   * Whatever was last clicked, from wherever. Not opened automatically: a pane
   * that appeared on every citation click would be a pane fighting the document
   * for room, so it is opened from View and then follows the cursor.
   */
  let detail = $state<Detail | null>(null);

  /** Describe a citation for the Details tab. */
  function showCitationDetail(work: CitedWork) {
    detail = work.entry
      ? {
          source: "yaz",
          kindKey: "details-kind-citation",
          title: work.entry.label,
          subtitle: work.entry.detail,
          fields: [
            { labelKey: "details-citation-key", value: work.key },
            { labelKey: "details-citation-uses", value: String(work.at.length) },
          ],
        }
      : {
          source: "yaz",
          kindKey: "details-kind-citation",
          title: work.key,
          subtitle: t("citations-not-in-bibliography"),
          fields: [{ labelKey: "details-citation-key", value: work.key }],
          actions: [
            {
              labelKey: "details-citation-fix",
              run: () => void explainCitation(work.key),
            },
          ],
        };
  }

  /**
   * Sections of the linked list, for moving a task between them.
   *
   * Read once when the list loads rather than each time a task is clicked: a
   * project's sections change rarely and a request per click would make the
   * Details tab feel like it was thinking.
   */
  let taskSections = $state<TaskSection[]>([]);

  /**
   * When something happened, as a person writes it.
   *
   * Todoist stamps its timestamps to the millisecond. Nobody reading "when was
   * this made" wants `2026-08-01T09:00:00.123456Z`, so it is shown as a day and
   * a time and the rest is dropped.
   */
  function readableMoment(stamp: string): string {
    const when = new Date(stamp);
    if (Number.isNaN(when.getTime())) return stamp;
    return when.toLocaleString(locale(), {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  /**
   * What a task actually is, in the Details tab.
   *
   * No "mark done" here. The checkbox in the list is where a task is ticked
   * off, and a second way to do it inside the description of the task is a
   * destructive button sitting under the reader's eye while they read.
   *
   * No project either: a paper is linked to exactly one list, so naming it on
   * every task says nothing that the tab above does not already say.
   *
   * What is here instead is everything the list has no room for, and most of it
   * can be changed — the title, the description, when it is due, how urgent it
   * is, and which section it sits in. A pane that could only show those would
   * be a pane you read and then went to Todoist to act on.
   */
  function showTaskDetail(task: Task) {
    const held = taskProvider;
    const writable = Boolean(held?.provider.updateTask);

    detail = {
      source: "yaz",
      kindKey: "details-kind-task",
      title: task.title,
      rename: writable
        ? (title: string) => changeTask(task, { title })
        : undefined,
      fields: task.created
        ? [
            {
              labelKey: "details-task-created",
              value: readableMoment(task.created),
            },
          ]
        : [],
      // Always offered, not only when there is something there: a description
      // you cannot see how to add is a description nobody adds, and the same
      // for a due date.
      edits: writable
        ? [
            {
              labelKey: "details-task-description",
              kind: "paragraph" as const,
              value: task.notes ?? "",
              placeholderKey: "details-task-description-empty",
              save: (notes: string) => changeTask(task, { notes }),
            },
            {
              labelKey: "details-task-due",
              kind: "date" as const,
              value: task.due ?? "",
              placeholderKey: "details-task-due-empty",
              save: (due: string) => changeTask(task, { due: due || null }),
            },
          ]
        : undefined,
      choices: [
        ...(writable
          ? [
              {
                labelKey: "details-task-priority",
                value: task.priority === null ? null : String(task.priority),
                options: [1, 2, 3, 4].map((level) => ({
                  value: String(level),
                  label: t(`details-task-priority-${level}`),
                })),
                choose: (value: string | null) =>
                  changeTask(task, {
                    priority: value === null ? null : Number(value),
                  }),
              },
            ]
          : []),
        ...(held?.provider.moveTask && taskSections.length > 0
          ? [
              {
                labelKey: "details-task-section",
                value: task.sectionId ?? null,
                noneKey: "details-task-section-none",
                options: taskSections.map((one) => ({
                  value: one.id,
                  label: one.name,
                })),
                choose: (value: string | null) => moveTask(task, value),
              },
            ]
          : []),
      ],
    };
  }

  /**
   * Change a task, and show what it became.
   *
   * The list is re-read rather than patched in place: the service decides what
   * a due date of "every Monday" actually becomes, and a pane showing what was
   * typed instead of what was stored would be a pane that disagrees with
   * Todoist about the task in front of you.
   */
  async function changeTask(task: Task, patch: TaskPatch) {
    const held = taskProvider;
    if (!held?.provider.updateTask) return;
    tasksBusy = true;
    try {
      await held.provider.updateTask(task.id, patch);
      await loadTasks();
      const shown = tasks.find((one) => one.id === task.id);
      if (shown) showTaskDetail(shown);
    } catch (error) {
      failure = String(error);
    } finally {
      tasksBusy = false;
    }
  }

  /**
   * Move a task into a section, and show where it ended up.
   *
   * The list is re-read rather than patched: a service may put the task at a
   * different place in the section's order, and a list that disagrees with the
   * service about where something is is worse than one that takes a moment.
   */
  async function moveTask(task: Task, sectionId: string | null) {
    const held = taskProvider;
    if (!held?.provider.moveTask) return;
    tasksBusy = true;
    try {
      await held.provider.moveTask(task.id, sectionId);
      await loadTasks();
      const shown = tasks.find((one) => one.id === task.id);
      if (shown) showTaskDetail(shown);
    } catch (error) {
      failure = String(error);
    } finally {
      tasksBusy = false;
    }
  }


  /**
   * Searching, and replacing.
   *
   * The query lives here rather than in the title bar because two places show
   * it — the box and the tab — and a second copy would be a second thing to
   * keep in step.
   */
  let searchOptions = $state<SearchOptions>({ ...PLAIN_SEARCH });
  let replacing = $state(false);
  let replacement = $state("");
  let searchResults = $state<FileMatches[]>([]);
  let searchBusy = $state(false);
  let searchCapped = $state(false);

  /**
   * How many matches to look for in total.
   *
   * A one-letter query on a thesis is tens of thousands, and nobody is going to
   * read them. Stopping is honest as long as it is *said* — the tab says so —
   * whereas a window that stops responding says nothing.
   */
  const SEARCH_LIMIT = 500;

  /** Which files are worth reading. A `.pdf` is not text. */
  function searchable(path: string): boolean {
    return /\.(tex|bib|md|txt|toml|yaml|yml|cls|sty|json)$/i.test(path);
  }

  /** Matches in the open buffer, which is the copy that may be unsaved. */
  const searchHere = $derived(
    search === "" ? [] : findMatches(docText, search, searchOptions, SEARCH_LIMIT),
  );

  /** How many the box shows, which is the whole project once it has read it. */
  const searchCount = $derived(
    searchResults.reduce((count, group) => count + group.matches.length, 0),
  );

  /**
   * Run the search over the project.
   *
   * The open buffer first and from memory, so results appear as fast as they
   * can be drawn; the other files after, read from disk. Debounced, because a
   * project of forty files read on every keystroke is forty reads per letter.
   */
  let searchRun = 0;
  async function runSearch() {
    const mine = (searchRun += 1);
    if (search === "") {
      searchResults = [];
      searchBusy = false;
      searchCapped = false;
      return;
    }

    const groups: FileMatches[] = [];
    let budget = SEARCH_LIMIT;

    if (currentFile) {
      const here = searchHere.slice(0, budget);
      budget -= here.length;
      if (here.length > 0) {
        groups.push({ file: currentFile, open: true, matches: here });
      }
    }
    searchResults = groups;
    searchBusy = project !== null;
    searchCapped = false;
    if (!project) {
      searchBusy = false;
      return;
    }

    const open = project;
    for (const file of open.files) {
      // A newer query started while this one was reading; its results are the
      // ones the user is waiting for.
      if (mine !== searchRun) return;
      if (file.relativePath === currentFile) continue;
      if (!searchable(file.relativePath)) continue;
      if (budget <= 0) {
        searchCapped = true;
        break;
      }

      let text: string;
      try {
        text = await ipc.readFile(open.root, file.relativePath);
      } catch {
        // A file that cannot be read is one result missing, not a failed
        // search. Reporting each would be a wall of notices for a `.gitignore`.
        continue;
      }
      const found = findMatches(text, search, searchOptions, budget);
      if (found.length === 0) continue;
      budget -= found.length;
      searchResults = [
        ...searchResults,
        { file: file.relativePath, open: false, matches: found },
      ];
    }

    if (mine === searchRun) searchBusy = false;
  }

  /**
   * Re-run when the query, the switches or the document change.
   *
   * Debounced on the query and immediate on the switches: typing is a stream
   * and a toggle is a decision.
   */
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    // Read so the effect depends on them.
    void search;
    void searchOptions;
    void docText;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void runSearch(), 200);
    return () => clearTimeout(searchTimer);
  });

  /** Put the caret in the search box, and open the results beside it. */
  function focusSearch(withReplace: boolean) {
    if (withReplace) replacing = true;
    titleBar?.focusSearch();
    if (!layoutTree.isOpen(layout, "search")) {
      updateLayout(layoutTree.openTab(layout, "search"));
    }
  }

  /** Go to a match, opening the file it is in when it is not the one open. */
  async function goToMatch(file: string, match: Match) {
    if (file !== currentFile) await openFile(file);
    editorApi?.revealRange(match.from, match.to);
  }

  /**
   * Replace the first match in the open file.
   *
   * Only the open file: replacing in a file you are not looking at is a change
   * you cannot see, and doing it one at a time is the case where seeing it is
   * the point.
   */
  function replaceOnce() {
    const at = editorApi?.getSelection()?.from ?? 0;
    const next =
      searchHere.find((match) => match.from >= at) ?? searchHere[0];
    if (!next || !editorApi) return;

    const change = replaceOne(next, replacement, searchOptions);
    editorApi.replaceRange(change.from, change.to, change.insert);
    editorApi.revealRange(
      change.from,
      change.from + change.insert.length,
    );
  }

  /**
   * Replace every match in the open file, as one edit.
   *
   * Applied from the end backwards so that each change leaves the offsets of
   * the ones not yet applied alone — and through the editor, so the whole lot
   * is one Ctrl+Z rather than four hundred.
   */
  function replaceEvery() {
    if (!editorApi || searchHere.length === 0) return;
    const changes = replaceAll(searchHere, replacement, searchOptions);
    for (const change of [...changes].reverse()) {
      editorApi.replaceRange(change.from, change.to, change.insert);
    }
    showNotice(t("search-replaced", { count: changes.length }));
  }


  /**
   * Save a picture pasted onto the editor, and answer with the figure for it.
   *
   * The file goes into the project rather than anywhere else, because a `.tex`
   * that refers to a screenshot in a temp directory is a `.tex` that stops
   * compiling on the next machine — or after a reboot.
   *
   * The name is derived rather than asked for. A dialog per paste is the thing
   * that stops people pasting, and a name built from the document sorts with
   * its siblings and still says where it came from next month.
   *
   * `null` when there is nowhere to put it, so the paste does nothing rather
   * than writing a reference to a file that is not there.
   */
  async function savePastedImage(
    bytes: Uint8Array,
    type: string,
  ): Promise<string | null> {
    const suffix = suffixFor(type);
    if (!suffix) {
      // Reached only if the clipboard check and this one disagree, which would
      // be a bug rather than a user's problem — but silence is what made the
      // first version impossible to diagnose.
      showNotice(t("paste-image-unsupported"));
      return null;
    }
    if (!project) {
      // Without a project there is no "inside the document" to save into, and
      // guessing at a directory would scatter screenshots across the disk.
      showNotice(t("paste-image-no-project"));
      return null;
    }

    const open = project;
    const taken = open.files.map((file) => file.relativePath);
    const path = nameFor(currentFile ?? open.entry, suffix, taken);

    try {
      await ipc.writeProjectBytes(open.root, path, bytes);
    } catch (error) {
      failure = String(error);
      return null;
    }

    // Re-read the project, so the next paste counts past this file and the
    // file list shows it without waiting for the project to be reopened.
    project = await ipc.openProject(open.root);
    showNotice(t("paste-image-saved", { file: path }));
    return figureFor(path);
  }

  /**
   * The View switches, as they were left last time.
   *
   * Written back whenever one changes rather than on close: yaz can be closed
   * by the window manager, by a crash, or by an update, and a preference that
   * only survived a graceful exit would be one that mostly did not.
   *
   * Debounced, because the zoom control fires on every wheel notch and a write
   * to disk per notch is a write per notch.
   */
  let viewLoaded = $state(false);
  let viewTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    // Read so the effect depends on each of them.
    const preferences: ipc.ViewPreferences = {
      richText,
      documentView: chosenView,
      lineNumbering: numbering,
      wrap,
      comments,
      lineBreaks,
      machinery,
      tablesLocked,
      paperLight,
      zoom,
      vimMode,
      autosave,
      dimBuild,
      showHidden: fileFilters.showHidden,
      showOther: fileFilters.showOther,
      showBuild: fileFilters.showBuild,
      ribbonOpen,
      ribbonHeight,
      ribbonVertical,
    };
    // Not before they have been read: the first run of this effect happens with
    // the defaults still in place, and writing those back would overwrite what
    // is on disk with what has not been loaded from it yet.
    if (!viewLoaded) return;

    clearTimeout(viewTimer);
    viewTimer = setTimeout(() => {
      void ipc.setViewPreferences(preferences).catch(() => {
        // A preference that could not be written is not worth interrupting
        // somebody's writing for. It will be written again on the next change.
      });
    }, 400);
    return () => clearTimeout(viewTimer);
  });

  /**
   * The right-click menu in the file list: what was clicked, and where.
   *
   * The node is `null` for the empty space below the rows, which means the
   * project root — a real target, because "new folder" with nothing selected
   * still has to put the folder somewhere.
   */
  let fileMenu = $state<{
    node: ProjectNode | null;
    x: number;
    y: number;
  } | null>(null);

  /** A pending rename or new name, and what to do with the answer. */
  let namePrompt = $state<{
    titleKey: string;
    initial: string;
    onname: (name: string) => Promise<void>;
  } | null>(null);

  /** A pending deletion, held until it is confirmed. */
  let pendingDelete = $state<{ path: string; name: string } | null>(null);

  /** Whether the new-project wizard is open, and what it last refused. */
  let makingProject = $state(false);
  let newProjectFailure = $state<string | null>(null);

  /** Open or close a tab from a switch, saving the arrangement once. */
  function toggleTab(tab: TabId) {
    updateLayout(
      layoutTree.isOpen(layout, tab)
        ? layoutTree.closeTab(layout, tab)
        : layoutTree.openTab(layout, tab),
    );
  }

  /**
   * Re-read the project after something on disk has changed.
   *
   * The scan is the only thing that knows what is really there, and it is
   * cheap. Patching the list in memory instead would mean two ideas of the
   * project — and the one that is wrong is always the one on screen.
   */
  async function refreshProject() {
    if (!project) return;
    project = await ipc.openProject(project.root);
  }

  /**
   * Re-read the project when the window comes back to the front.
   *
   * Somebody who has just made a file in Explorer, unzipped a folder of
   * figures, or had a compile write into `build/` comes back to yaz expecting
   * to see it. Without this the list is only as fresh as the last thing yaz
   * itself did to the folder, and the fix — close the tab and open it again —
   * does not work either, because the tab redraws the same stale scan.
   *
   * On focus rather than on a watcher: a walk of the project is cheap and
   * happens at most once per time somebody switches windows, where a watcher is
   * a thread, a platform difference, and a stream of events during a compile
   * that writes thirty files.
   */
  $effect(() => {
    const onfocus = () => {
      void refreshProject().catch(() => {
        // A folder that has been deleted or unmounted under us. The list keeps
        // what it had, which is better than emptying itself over a blip.
      });
    };
    window.addEventListener("focus", onfocus);
    return () => window.removeEventListener("focus", onfocus);
  });

  /**
   * Where a new file or folder goes, given what was right-clicked.
   *
   * A folder means inside it; a file means beside it, because "new file" on a
   * file is somebody pointing at where they want the new one, not at the file.
   * Nothing means the root.
   */
  function targetFolder(node: ProjectNode | null): string {
    if (!node) return "";
    if (node.type === "folder") return node.path;
    const cut = node.path.lastIndexOf("/");
    return cut === -1 ? "" : node.path.slice(0, cut);
  }

  /** Join a folder and a name, without a leading slash at the root. */
  function within(folder: string, name: string): string {
    return folder ? `${folder}/${name}` : name;
  }

  /** Ask for a name, then create a folder there. */
  function askNewFolder(node: ProjectNode | null) {
    const folder = targetFolder(node);
    namePrompt = {
      titleKey: "files-new-folder-title",
      initial: "",
      onname: async (name) => {
        if (!project) return;
        await ipc.createDirectory(project.root, within(folder, name));
        await refreshProject();
        // Opened, so the folder somebody just made is somewhere they can put
        // something rather than a closed row they have to click again.
        openFolders = new Set([...openFolders, within(folder, name)]);
      },
    };
  }

  /** Ask for a name, then create an empty file there and open it. */
  function askNewFile(node: ProjectNode | null) {
    const folder = targetFolder(node);
    namePrompt = {
      titleKey: "files-new-file-title",
      initial: ".tex",
      onname: async (name) => {
        if (!project) return;
        const path = within(folder, name);
        await ipc.createFile(project.root, path);
        await refreshProject();
        if (folder) openFolders = new Set([...openFolders, folder]);
        // Opened straight away: a new file nobody is editing is a new file
        // nobody asked for.
        await openFile(path);
      },
    };
  }

  /** Ask for a new name, then rename in place. */
  function askRename(node: ProjectNode) {
    namePrompt = {
      titleKey: "files-rename-title",
      initial: node.name,
      onname: async (name) => {
        if (!project || name === node.name) return;
        const wasOpen = currentFile === node.path;
        await ipc.renameEntry(project.root, node.path, name);
        await refreshProject();

        // The editor is holding a path that no longer names anything. Follow
        // the rename rather than closing the file, which is what somebody who
        // renamed the thing they were writing in expects.
        if (node.type === "file" && wasOpen) {
          const cut = node.path.lastIndexOf("/");
          await openFile(cut === -1 ? name : `${node.path.slice(0, cut)}/${name}`);
        } else if (node.type === "folder" && currentFile?.startsWith(`${node.path}/`)) {
          const cut = node.path.lastIndexOf("/");
          const parent = cut === -1 ? "" : node.path.slice(0, cut);
          await openFile(
            within(within(parent, name), currentFile.slice(node.path.length + 1)),
          );
        }
      },
    };
  }

  /**
   * Carry out a deletion that has been confirmed.
   *
   * The Rust side sends it to the recycle bin rather than unlinking it, which
   * is what makes this recoverable — and is why the confirmation says where it
   * went rather than warning that it cannot be undone.
   */
  async function deletePath(path: string) {
    if (!project) return;
    try {
      await ipc.deleteEntry(project.root, path);
      // The open file has just gone. Nothing to show, and showing its contents
      // would invite somebody to save them back.
      if (currentFile === path || currentFile?.startsWith(`${path}/`)) {
        currentFile = null;
        docText = "";
        dirty = false;
      }
      await refreshProject();
      showNotice(t("files-deleted", { name: path }));
    } catch (error) {
      failure = String(error);
    }
  }

  /**
   * What a right-click offers, given what it landed on.
   *
   * Built here rather than in the file list because these are project
   * operations, and the file list is a view of the project — the same split
   * that keeps the filters here and the scan in Rust.
   */
  function fileMenuItems(node: ProjectNode | null): MenuItem[] {
    const items: MenuItem[] = [];

    if (node?.type === "file") {
      items.push({
        labelKey: "files-open",
        icon: "page" as const,
        action: () => void openFile(node.path),
      });
    }

    items.push(
      {
        // Always offered, and it is the answer to "I made a file in Explorer
        // and yaz has not noticed". The list also re-reads itself whenever the
        // window is focused, so this is for the case where something changed
        // while yaz was already in front.
        labelKey: "files-refresh",
        icon: "redo" as const,
        separatorBefore: Boolean(node),
        action: () => void refreshProject(),
      },
      {
        labelKey: "files-new-file",
        icon: "file-plus" as const,
        separatorBefore: node?.type === "file",
        action: () => askNewFile(node),
      },
      {
        labelKey: "files-new-folder",
        icon: "folder-plus" as const,
        action: () => askNewFolder(node),
      },
    );

    if (node) {
      items.push(
        {
          labelKey: "files-rename",
          icon: "pencil" as const,
          separatorBefore: true,
          action: () => askRename(node),
        },
        {
          labelKey: "files-delete",
          icon: "trash" as const,
          destructive: true,
          action: () => {
            pendingDelete = { path: node.path, name: node.name };
          },
        },
      );
    }

    return items;
  }

  /**
   * Make a project, then open it.
   *
   * The wizard stays up if this is refused — a folder of that name already
   * there is the usual reason — because closing it would throw away the two
   * answers it had just been given.
   */
  async function createProject(parent: string, name: string, kind: DocumentKind) {
    newProjectFailure = null;
    try {
      const info = await ipc.createProject(parent, name, kind);
      makingProject = false;
      await adoptProject(info);
      showNotice(t("new-project-created", { name }));
    } catch (error) {
      newProjectFailure = String(error);
    }
  }

  /** Settings panels plugins contributed, shown under Settings → Plugins. */
  let pluginPanels = $state<RegisteredSettings[]>([]);

  /**
   * The task lists plugins offered, and what this project is linked to.
   *
   * Which list a paper uses is stored by the provider *with the paper*
   * (ADR-0026), so it is asked for when the project opens rather than held per
   * install — and the tab never learns how the provider stores it.
   */
  let taskProviders = $state<RegisteredTaskProvider[]>([]);
  let taskProject = $state<TaskProject | null>(null);
  let tasks = $state<Task[]>([]);
  let tasksBusy = $state(false);
  let tasksReady = $state(false);

  /**
   * The provider serving this project.
   *
   * The first registered, for now: two to-do plugins installed at once is a
   * problem worth having before it is a problem worth solving, and picking
   * between them is a setting nobody yet needs.
   */
  const taskProvider = $derived(taskProviders[0] ?? null);

  /*
   * Re-read the tasks when the project changes.
   *
   * Which list a paper uses is stored with the paper, so opening a different
   * one is opening a different list — and the tab that showed the last one is
   * showing the wrong thing until this runs.
   */
  $effect(() => {
    // The dependencies, named. `loadTasks` writes state it also reads, and an
    // effect that tracked those reads would re-run itself — so what it depends
    // on is declared here and the call is untracked.
    void project?.root;
    void taskProviders.length;
    untrack(() => void loadTasks());
  });

  /** Read the link and the list it names. */
  async function loadTasks() {
    const held = taskProvider;
    if (!project || !held) {
      tasks = [];
      taskProject = null;
      tasksReady = false;
      return;
    }

    tasksBusy = true;
    try {
      tasksReady = await held.provider.isReady();
      if (!tasksReady) {
        tasks = [];
        taskProject = null;
        return;
      }
      taskProject = await held.provider.linkedProject();
      tasks = taskProject
        ? await held.provider.listTasks(taskProject.id)
        : [];
      // Sections are the provider's option to have, and a failure to read them
      // only costs the Details tab its dropdown — so it is not a failure of
      // loading the list, which is what somebody opened the tab for.
      taskSections =
        taskProject && held.provider.listSections
          ? await held.provider.listSections(taskProject.id).catch(() => [])
          : [];
    } catch (error) {
      failure = String(error);
      tasks = [];
      taskSections = [];
    } finally {
      tasksBusy = false;
    }
  }

  /**
   * Choose which of the service's projects this paper is linked to.
   *
   * The picker lists what is there and offers making a new one, because a paper
   * started today has no list yet and sending the author to another application
   * to make one before they can use this tab is the wrong way round.
   */
  async function linkTasks() {
    const held = taskProvider;
    if (!held) return;

    tasksBusy = true;
    try {
      const projects = await held.provider.listProjects();
      const chosen = await new Promise<TaskProject | "new" | null>(
        (resolve) => {
          picker = {
            titleKey: "tasks-link-title",
            placeholderKey: "tasks-link-placeholder",
            emptyKey: "tasks-link-empty",
            load: async (query: string) => {
              const wanted = query.trim().toLowerCase();
              const rows = projects
                .filter((entry) => entry.name.toLowerCase().includes(wanted))
                .map((entry) => ({
                  value: entry,
                  label: entry.name,
                }));
              // Offered last and always, so a name that matches nothing is an
              // invitation to create it rather than a dead end.
              return [
                ...rows,
                {
                  value: "new" as const,
                  label: t("tasks-link-new", {
                    name: query.trim() || currentProjectName(),
                  }),
                },
              ];
            },
            resolve: (value) =>
              resolve(value as TaskProject | "new" | null),
          };
        },
      );
      picker = null;

      if (chosen === null) return;
      const linked =
        chosen === "new"
          ? await held.provider.createProject(currentProjectName())
          : chosen;
      await held.provider.link(linked);
    } catch (error) {
      failure = String(error);
    } finally {
      tasksBusy = false;
    }
    await loadTasks();
  }

  /** The open project's folder name, which is what a new list is called. */
  function currentProjectName(): string {
    return project?.root.split(/[\/]/).filter(Boolean).pop() ?? "yaz";
  }

  /** Add a task to the linked list. */
  async function addTask(title: string) {
    const held = taskProvider;
    if (!held || !taskProject) return;
    tasksBusy = true;
    try {
      await held.provider.createTask(taskProject.id, title);
    } catch (error) {
      failure = String(error);
    } finally {
      tasksBusy = false;
    }
    await loadTasks();
  }

  /** Tick one off. */
  async function completeTask(task: Task) {
    const held = taskProvider;
    if (!held) return;
    tasksBusy = true;
    try {
      await held.provider.completeTask(task.id);
      // Taken off the list here rather than waiting for the round trip, so the
      // checkbox does what a checkbox does.
      tasks = tasks.filter((held) => held.id !== task.id);
    } catch (error) {
      failure = String(error);
      await loadTasks();
    } finally {
      tasksBusy = false;
    }
  }

  /**
   * The `.bib` files the open document declares.
   *
   * Read from the buffer rather than from the project, because it is the
   * document that decides: a project can hold three `.bib` files and load one.
   */
  /**
   * The entry file's text, when it is not the file that is open.
   *
   * Read once per project rather than watched. What it is wanted for — the
   * `\addbibresource` and the class — lives in the preamble, and a preamble
   * does not change while the author is editing a section of chapter four.
   */
  let entryText = $state("");

  $effect(() => {
    const open = project;
    if (!open) {
      entryText = "";
      return;
    }
    let cancelled = false;
    void ipc
      .readFile(open.root, open.entry)
      .then((text) => {
        if (!cancelled) entryText = text;
      })
      .catch(() => {
        // An entry file that cannot be read is not worth reporting here: the
        // project would not have opened.
      });
    return () => {
      cancelled = true;
    };
  });

  /**
   * The `.bib` files the project loads.
   *
   * From the open buffer *and* from the entry file, because they are usually
   * not the same file: `\addbibresource` goes in the preamble, and the
   * citations that need it are in `sections/Vorbemerkungen.tex`. Reading only
   * the open buffer meant opening any section found no bibliography at all and
   * turned every citation in it red — which is what happened.
   */
  const declaredBibs = $derived.by(() => {
    const found = declaredBibliographies(docText);
    for (const name of declaredBibliographies(entryText)) {
      if (!found.includes(name)) found.push(name);
    }
    return found;
  });

  /**
   * What those files say, keyed by citation key.
   *
   * Loaded when the declaration or the project changes, and after a citation is
   * inserted — not on every keystroke. A `.bib` is a file on disk, and reading
   * it as the author types would put IO on the typing path (ADR-0015).
   */
  let bibEntries = $state<ReadonlyMap<string, BibEntry>>(new Map());

  /** Bumped to re-read the `.bib` after something has written to it. */
  let bibGeneration = $state(0);

  $effect(() => {
    const open = project;
    const names = declaredBibs;
    void bibGeneration;
    if (!open || names.length === 0) {
      bibEntries = new Map();
      return;
    }

    let cancelled = false;
    void loadBibliography().then((merged) => {
      if (!cancelled) bibEntries = merged;
    });

    return () => {
      cancelled = true;
    };
  });

  /** Read every declared `.bib`, merged. */
  async function loadBibliography(): Promise<Map<string, BibEntry>> {
    const open = project;
    const merged = new Map<string, BibEntry>();
    if (!open) return merged;

    for (const name of declaredBibs) {
      try {
        const text = await ipc.readFile(open.root, name);
        // First declaration wins for a key defined twice, which is what
        // biblatex does with two resources.
        for (const [key, entry] of readBib(text)) {
          if (!merged.has(key)) merged.set(key, entry);
        }
      } catch {
        // A declared file that is not there is not an error to report here —
        // it is what the fix modal explains when a citation is clicked.
      }
    }
    return merged;
  }

  /**
   * Every work the document cites, resolved against the bibliography.
   *
   * Derived rather than loaded: it is a walk of the buffer the shell already
   * has, and the tab has to agree with the text it is describing.
   */
  const documentCitations = $derived(citedWorks(docText, bibEntries));

  /**
   * What each work prints, when the document's style is numeric.
   *
   * The style is declared in the preamble, so it is read from the entry file as
   * well as the open one — the same reason the bibliography is. Empty for an
   * author-year style, where a citation prints its short form instead.
   */
  const citationNumbers = $derived.by(() => {
    const style = citationStyle(
      ownsPreamble(docText) ? docText : `${docText}
${entryText}`,
    );
    return style === "numeric"
      ? numberCitations(documentCitations)
      : new Map<string, number>();
  });

  /**
   * The unresolved citation being explained, and what is wrong.
   *
   * Null until one is clicked. Working this out reads the project directory,
   * so it happens on the click and nowhere else.
   */
  let bibProblem = $state<{ key: string; problem: BibProblem } | null>(null);

  /**
   * Explain why a citation will not resolve.
   *
   * The scan is `project.files`, which the shell already has from opening the
   * project — so "scan the directory" costs a filter rather than a walk, and
   * the only fresh work is deciding what it means.
   */
  async function explainCitation(key: string) {
    if (!project) return;

    // Re-read first. Citing from Zotero writes the `.bib` behind the editor's
    // back, so the citation the author is clicking may already be fine — and
    // explaining a problem that has just been fixed is worse than saying
    // nothing.
    const fresh = await loadBibliography();
    bibEntries = fresh;
    if (fresh.has(key)) return;

    const present = project.files
      .map((file) => file.relativePath)
      .filter((path) => /\.bib$/i.test(path));
    bibProblem = { key, problem: diagnoseBibliography(declaredBibs, present) };
  }

  /**
   * Point the document at a bibliography file.
   *
   * Which file gets the declaration is the whole difficulty. `\addbibresource`
   * belongs in the preamble, and the preamble is in the entry file — but the
   * citation that prompted this is usually in a section, so the file the author
   * is looking at is the wrong one to edit. Writing it there produced a
   * declaration that vanished the moment they opened something else, which is
   * exactly what was reported.
   *
   * So: the open buffer when it is the one holding the preamble, through the
   * editor so the change lands in undo; the entry file on disk otherwise.
   */
  async function useBibliography(name: string) {
    if (!project) return;
    const open = project;

    const buffer = editorApi?.getText() ?? docText;

    try {
      if (ownsPreamble(buffer) && editorApi) {
        // Through the editor rather than by assigning the text: the buffer is
        // the document (ADR-0004), and an edit made this way is one Ctrl+Z
        // away if the author did not mean to accept it.
        const next = withBibliography(buffer, name);
        editorApi.replaceRange(0, buffer.length, next);
      } else {
        const entry = await ipc.readFile(open.root, open.entry);
        const next = withBibliography(entry, name);
        await ipc.writeFile(open.root, open.entry, next);
        entryText = next;
        showNotice(t("bib-fix-declared-in", { file: open.entry }));
      }
    } catch (error) {
      failure = String(error);
      return;
    }

    bibProblem = null;
    bibGeneration += 1;
  }

  /** Create an empty bibliography, and make sure the document loads it. */
  async function createBibliography(name: string) {
    if (!project) return;
    try {
      // Only if it is not already there: writing over a `.bib` that exists
      // would delete somebody's references to fix a declaration.
      const present = project.files.some(
        (file) => file.relativePath.toLowerCase() === name.toLowerCase(),
      );
      if (!present) {
        await ipc.writeFile(project.root, name, "");
        project = await ipc.openProject(project.root);
      }
      if (!declaredBibs.includes(name)) {
        await useBibliography(name);
      } else {
        bibProblem = null;
        bibGeneration += 1;
      }
      showNotice(t("bib-fix-created", { file: name }));
    } catch (error) {
      failure = String(error);
    }
  }

  /** Tab names. A filename is data, so it is not a message key. */
  const tabTitles = $derived<Record<TabId, string>>({
    editor: currentFile ?? t("workspace-tab-editor"),
    files: t("workspace-tab-files"),
    outline: t("workspace-tab-outline"),
    citations: t("workspace-tab-citations"),
    tasks: t("workspace-tab-tasks"),
    details: t("workspace-tab-details"),
    pdf: t("workspace-tab-pdf"),
    history: t("workspace-tab-history"),
    ...Object.fromEntries(
      pluginViews.map((view) => [view.tab, t(view.titleKey)]),
    ),
  });

  /**
   * Which generated lists have somewhere to be read.
   *
   * The contents is the outline's, always — it is the document's own headings
   * and core draws them. Everything else arrives from a plugin, because
   * everything else comes from a package (ADR-0023).
   */
  const listingHomes = $derived<ListingKind[]>([
    "contents",
    ...pluginViews.flatMap((view) => (view.listing ? [view.listing] : [])),
  ]);

  /** The contributed view a tab id names, or null for one of the shell's own. */
  function pluginTab(tab: TabId): RegisteredView | null {
    return pluginViews.find((view) => view.tab === tab) ?? null;
  }

  /** Which tab shows a given generated list. */
  function listingTab(kind: ListingKind): TabId | null {
    if (kind === "contents") return "outline";
    return pluginViews.find((view) => view.listing === kind)?.tab ?? null;
  }

  /**
   * Open the tab that shows a generated list, and bring it to the front.
   *
   * Opened *and* focused: the card in the preview is a way in, and a way in
   * that put the tab behind another one would have done nothing a reader could
   * see. One update rather than two, so the arrangement is saved once.
   */
  function openListing(kind: ListingKind): void {
    const tab = listingTab(kind);
    if (!tab) return;
    const opened = layoutTree.isOpen(layout, tab)
      ? layout
      : layoutTree.openTab(layout, tab);
    updateLayout(layoutTree.focusTab(opened, tab));
  }

  /**
   * Persist the arrangement with the project.
   *
   * Per project rather than globally: a thesis and a conference paper want
   * different arrangements, and the engine choice already lives here.
   */
  async function saveLayout() {
    if (!project) return;
    try {
      await ipc.setProjectWorkspace(project.root, layoutTree.serialise(layout));
    } catch {
      // A layout is a convenience. Failing to store it must not interrupt
      // whatever the user was actually doing.
    }
  }

  function updateLayout(next: LayoutNode | null) {
    layout = next ?? layoutTree.defaultLayout();
    void saveLayout();
  }

  /**
   * What the status light shows.
   *
   * `unknown` is a real state, not a placeholder: nothing connects at startup
   * any more, so until the user asks, yaz genuinely does not know. Painting it
   * green or red would be a guess presented as a fact.
   */
  const health = $derived<Health>(
    !zoteroStatus
      ? "unknown"
      : zoteroStatus.source === "none"
        ? "off"
        : // Green when Zotero is running, even though queries read a copy of
          // the database: the copy is refreshed from a file Zotero is actively
          // maintaining, so the data is current. Amber means the library is
          // readable but nothing is keeping it up to date.
          zoteroStatus.zoteroRunning
          ? "live"
          : "degraded",
  );

  const healthKey = $derived(
    !zoteroStatus
      ? "connections-unknown"
      : zoteroStatus.zoteroRunning
        ? "zotero-live-available"
        : zoteroStatus.sourceKey,
  );

  /**
   * Detect the installed TeX engines.
   *
   * Deliberately not at startup. Each engine is detected by running it, and a
   * system TeX on this platform is usually x86-64 under emulation — four probes
   * cost over two seconds and flashed a console window each. Nothing needs the
   * answer until the settings dialog is opened.
   */
  async function loadEngines() {
    if (enginesLoaded) return;
    try {
      engines = await ipc.listEngines();
      enginesLoaded = true;
      if (project && !selectedEngine) {
        const settings = await ipc.getProjectSettings(project.root);
        selectedEngine = settings.engineId ?? engines.find((e) => e.available)?.id ?? null;
      }
    } catch (error) {
      failure = String(error);
    }
  }

  function openSettings(section?: string) {
    settingsSection = section;
    settingsOpen = true;
    void loadEngines();
    // Detecting git is a process start, so it happens when the dialog that
    // shows the answer is opened rather than at launch.
    if (vcsBackends.length === 0) {
      void ipc
        .vcsBackends()
        .then((found) => (vcsBackends = found))
        .catch(() => {});
    }
  }

  /**
   * Connect to Zotero, or re-probe if already connected.
   *
   * The only thing that starts a connection. Nothing probes on startup, so a
   * user who never cites never pays for Zotero being looked for.
   */
  async function connectZotero() {
    connectionsBusy = true;
    try {
      if (zoteroStatus) await ipc.zoteroReconnect(ZOTERO_PLUGIN_ID);
      zoteroStatus = await ipc.zoteroStatus(ZOTERO_PLUGIN_ID);
      showNotice(t(zoteroStatus.liveStatusKey));
    } catch (error) {
      failure = String(error);
    } finally {
      connectionsBusy = false;
    }
  }

  /**
   * Sign in to the task service, from Connections rather than Settings.
   *
   * Connecting to the things a paper is built from is its own kind of work and
   * it lives in one place — beside Zotero, where somebody looking for "what is
   * this paper wired up to" will look. Settings keeps what is per install.
   */
  function notImplemented() {
    showNotice(t("menu-not-implemented"));
  }

  function showNotice(text: string) {
    notice = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = null), 6000);
  }

  /**
   * The plugin runtime.
   *
   * Core plugins are bundled, but they see only `@yaz/api` and every privileged
   * call they make is refused by the capability broker in the Rust process
   * first. That is the forcing function in ADR-0005 — the Zotero bridge gets no
   * shortcut the shell would not give an external author.
   */
  const runtime = new PluginRuntime({
    project: () => (project ? { root: project.root, entry: project.entry } : null),
    editor: () => editorApi,
    compile: async () => {
      await compile();
      if (!result) throw new Error("compile produced no result");
      return result;
    },
    requestPicker: (request) => {
      picker = request;
    },
    showNotice,
    refreshTasks: () => void loadTasks(),
    showDetail: (shown: Detail | null) => (detail = shown),
    // The same path the clipboard paste takes, so a picture from a plugin
    // lands where a pasted one does and is named the same way.
    saveImage: (bytes: Uint8Array, type: string) => savePastedImage(bytes, type),
  });

  let commands = $state<ReturnType<PluginRuntime["availableCommands"]>>([]);

  /**
   * Everything the palette can run: yaz's own commands and the plugins'.
   *
   * One list, because from the author's side there is one question — "what can
   * I do?" — and which half of the application answers it is not part of the
   * question. A plugin's command appears here by having been registered at all;
   * there is nothing for a plugin author to opt into, which is the property
   * that keeps the palette complete as plugins come and go.
   */
  const paletteEntries = $derived([
    ...shortcuts
      // Not the palette itself: offering "open the palette" inside the palette
      // is a row that can only take you where you already are.
      .filter((shortcut) => shortcut.id !== "navigate.commands")
      .map((shortcut) => ({
        label: t(shortcut.labelKey),
        binding: describeBinding(shortcut.binding),
        run: () => runShortcut(shortcut.id),
      })),
    ...commands.map((command) => ({
      label: command.name,
      // Which plugin it came from, so two plugins offering "Refresh" are
      // telling the author which is which.
      binding: pluginNameOf(command.pluginId),
      run: () => runCommand(command.id),
    })),
    // The LaTeX a paper is made of. Only where the document is LaTeX: offering
    // to insert a `tabular` into a Markdown file would be offering nonsense.
    ...(currentFormat === "latex"
      ? INSERTIONS.map((entry) => ({
          label: t(entry.labelKey),
          binding: "",
          run: () => insertLatex(entry.template),
        }))
      : []),
  ]);

  /**
   * Put a construct into the document, with the caret where the writing starts.
   *
   * Through the editor rather than by assigning the text, so it lands in undo
   * with everything else and the buffer stays the document (ADR-0004).
   */
  function insertLatex(template: string) {
    if (!editorApi) return;
    const { from } = editorApi.getSelection();
    const text = editorApi.getText();
    // Indented to sit where it is going: a `tabular` inserted inside an
    // already-indented environment should line up with what is around it.
    const lineStart = text.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
    const prepared = prepareAt(template, text.slice(lineStart, from));
    editorApi.replaceRange(from, from, prepared.text);
    editorApi.revealRange(from + prepared.caret, from + prepared.caret);
  }

  /** The display name of the plugin a command came from. */
  function pluginNameOf(pluginId: string): string {
    return plugins.find((plugin) => plugin.id === pluginId)?.name ?? "";
  }

  /**
   * Show every command, and run the one chosen.
   *
   * The picker rather than a palette of its own: filtering a list and choosing
   * a row is what it already does, and a second thing that looked almost the
   * same would be a second thing to keep in step.
   */
  function openCommandPalette() {
    const entries = paletteEntries;
    picker = {
      titleKey: "palette-title",
      placeholderKey: "palette-placeholder",
      emptyKey: "palette-empty",
      load: async (query: string) => {
        const wanted = query.trim().toLowerCase();
        return entries
          .filter((entry) => entry.label.toLowerCase().includes(wanted))
          .map((entry) => ({
            value: entry,
            label: entry.label,
            description: entry.binding || undefined,
          }));
      },
      resolve: (value) => {
        picker = null;
        // After the picker has gone, so a command that opens another one is
        // not fighting this for the screen.
        if (value) (value as { run: () => void }).run();
      },
    };
  }


  function refreshCommands() {
    commands = runtime.availableCommands();
  }

  async function runCommand(id: string) {
    const command = runtime.commands.find((c) => c.id === id);
    if (!command) return;
    try {
      await command.callback();
    } catch (error) {
      failure = String(error);
    }
  }

  /**
   * The menu bar.
   *
   * Plugin commands land under Tools rather than in the toolbar, so a plugin can
   * contribute a command without the shell growing a button for it — and without
   * the shell knowing what the command does.
   */
  /**
   * What can be done with the project as a whole.
   *
   * On the yaz mark in the corner rather than in the ribbon, because opening,
   * closing and reopening a project is not part of writing one — it is what you
   * do before and after. Every application with a mark in that corner puts the
   * same three things behind it, so it is where somebody looks first.
   */
  const projectMenu = $derived<MenuItem[]>([
    {
      // First, because it is the one thing somebody who has just installed yaz
      // can do. Opening a folder assumes they already have a project; this is
      // how they get one.
      labelKey: "menu-file-new-project",
      icon: "file-plus" as const,
      group: "group-project",
      action: () => {
        newProjectFailure = null;
        makingProject = true;
      },
    },
    {
      labelKey: "menu-file-open-folder",
      icon: "folder" as const,
      group: "group-project",
      action: chooseProject,
    },
    {
      labelKey: "menu-file-open-recent",
      icon: "clock" as const,
      group: "group-project",
      // Titles here are folder names, which are data rather than interface
      // copy, so they are passed through as labels and not message keys.
      items:
        recent.length > 0
          ? recent.map((entry) => ({
              labelKey: entry.name,
              literalLabel: true,
              tooltip: entry.root,
              action: () => openProjectAt(entry.root),
            }))
          : [{ labelKey: "menu-file-no-recent", disabled: true }],
    },
    {
      labelKey: "menu-file-close-project",
      icon: "close" as const,
      group: "group-project",
      action: closeProject,
      disabled: !project,
      separatorBefore: true,
    },
  ]);

  const menus = $derived<Menu[]>([
    {
      labelKey: "menu-view",
      items: [
        // One entry per way of setting the text, rather than one switch: they
        // are three choices and not two states, and a checkbox cannot say that.
        ...DOCUMENT_VIEWS.map((mode) => ({
          labelKey: `menu-view-${mode}`,
          icon: "page" as const,
          group: "group-views",
          checked: chosenView === mode,
          // The page needs a paper size, and only a `.tex` declares one.
          disabled: mode === "page" && !canPaginate(currentFormat),
          action: () => {
            chosenView = mode;
          },
        })),
        {
          labelKey: "ribbon-compact",
          icon: "layout" as const,
          group: "group-panes",
          checked: ribbonHeight === "compact",
          action: () => {
            ribbonHeight = ribbonHeight === "compact" ? "regular" : "compact";
          },
        },
        {
          labelKey: "ribbon-vertical",
          icon: "columns" as const,
          group: "group-panes",
          checked: ribbonVertical,
          action: () => {
            ribbonVertical = !ribbonVertical;
          },
        },
        {
          labelKey: "menu-view-joined",
          icon: "layers" as const,
          group: "group-views",
          checked: joined,
          disabled: !project,
          // An include that could not be read stays in the buffer as a command
          // rather than disappearing, and this is where to find out why the
          // document has one in it.
          tooltip:
            joinedMissing.length > 0
              ? t("joined-unexpanded", { missing: joinedMissing.join(", ") })
              : undefined,
          action: toggleJoined,
        },
        {
          labelKey: "menu-view-line-breaks",
          icon: "wrap" as const,
          group: "group-editing",
          checked: lineBreaks,
          action: () => {
            lineBreaks = !lineBreaks;
          },
        },
        {
          labelKey: "menu-view-machinery",
          icon: "wrench" as const,
          group: "group-editing",
          checked: machinery,
          action: () => {
            machinery = !machinery;
          },
        },
        {
          labelKey: "menu-view-lock-tables",
          icon: "columns" as const,
          group: "group-editing",
          checked: tablesLocked,
          action: () => {
            tablesLocked = !tablesLocked;
          },
        },
        {
          labelKey: "menu-view-comments",
          icon: "text" as const,
          group: "group-editing",
          checked: comments,
          action: () => {
            comments = !comments;
          },
        },
        {
          labelKey: "menu-view-paper",
          icon: "sun" as const,
          group: "group-views",
          checked: paperLight,
          action: () => {
            paperLight = !paperLight;
          },
        },
        {
          labelKey: "menu-view-rich-text",
          icon: "text" as const,
          group: "group-views",
          checked: richText && currentFormat === "latex",
          // Only LaTeX has a preview so far, and a switch that appears to do
          // something and does not is worse than one that is plainly off.
          disabled: currentFormat !== "latex",
          action: () => {
            richText = !richText;
          },
        },
        {
          labelKey: "menu-view-vim",
          icon: "wrench" as const,
          group: "group-editing",
          checked: vimMode,
          action: () => {
            vimMode = !vimMode;
          },
        },
        {
          labelKey: "files-show-hidden",
          icon: "folder" as const,
          group: "group-files",
          checked: fileFilters.showHidden,
          action: () => {
            fileFilters = { ...fileFilters, showHidden: !fileFilters.showHidden };
          },
        },
        {
          labelKey: "files-show-other",
          icon: "list" as const,
          group: "group-files",
          checked: fileFilters.showOther,
          action: () => {
            fileFilters = { ...fileFilters, showOther: !fileFilters.showOther };
          },
        },
        {
          labelKey: "files-show-build",
          icon: "settings" as const,
          group: "group-files",
          checked: fileFilters.showBuild,
          action: () => {
            fileFilters = { ...fileFilters, showBuild: !fileFilters.showBuild };
          },
        },
        {
          labelKey: "files-dim-build",
          icon: "wrench" as const,
          group: "group-files",
          checked: dimBuild,
          disabled: !fileFilters.showBuild,
          action: () => {
            dimBuild = !dimBuild;
          },
        },
        {
          labelKey: "menu-view-files",
          icon: "list" as const,
          group: "group-panes",
          checked: layoutTree.isOpen(layout, "files"),
          action: () => toggleTab("files"),
        },
        {
          labelKey: "menu-view-wrap",
          icon: "wrap" as const,
          group: "group-editing",
          checked: wrap,
          action: () => {
            wrap = !wrap;
          },
        },
        {
          labelKey: "menu-view-line-numbers",
          icon: "numbers" as const,
          group: "group-editing",
          separatorBefore: true,
          items: LINE_NUMBERING.map((mode) => ({
            labelKey: `menu-view-line-numbers-${mode}`,
            // A tick rather than a radio dot: the menu has no radio group, and
            // exactly one of the three is always ticked, which reads the same.
            checked: numbering === mode,
            action: () => {
              numbering = mode;
            },
          })),
        },
        {
          labelKey: "menu-view-tabs",
          icon: "layout" as const,
          group: "group-panes",
          separatorBefore: true,
          // Closed tabs come back from here. A tab that can be closed and not
          // reopened is a tab that gets closed once and then missed.
          items: [
            {
              // Not a workspace tab — a shell region. It is listed here because
              // this is where someone looks to get a part of the window back,
              // and a ribbon nobody can find again is a ribbon nobody collapses.
              labelKey: "ribbon-title",
              checked: ribbonOpen,
              action: () => {
                ribbonOpen = !ribbonOpen;
              },
            },
            // The shell's own tabs, then whatever the plugins added. A
            // contributed view names itself with its own message key, which is
            // why the two halves cannot share one template.
            ...[
              ...(
                [
                  "files",
                  "editor",
                  "pdf",
                  "outline",
                  "search",
                  "citations",
                  "tasks",
                  "details",
                  "history",
                ] as TabId[]
              ).map(
                (tab) => ({ tab, labelKey: `workspace-tab-${tab}` }),
              ),
              ...pluginViews.map((view) => ({
                tab: view.tab,
                labelKey: view.titleKey,
              })),
            ].map(({ tab, labelKey }) => ({
            labelKey,
            checked: layoutTree.isOpen(layout, tab),
            action: () => {
              updateLayout(
                layoutTree.isOpen(layout, tab)
                  ? layoutTree.closeTab(layout, tab)
                  : layoutTree.openTab(layout, tab),
              );
            },
            })),
          ],
        },
        {
          labelKey: "menu-view-reset-layout",
          icon: "layout" as const,
          group: "group-panes",
          action: () => updateLayout(layoutTree.defaultLayout()),
        },
      ],
    },
    {
      // Connecting to the things a paper is built from is its own kind of work,
      // and it was buried in a Tools menu that held nothing else worth opening.
      // A tab of its own also gives each connection somewhere to grow: what is
      // one button for Zotero today is a section tomorrow.
      labelKey: "ribbon-connections",
      items: [
        {
          labelKey: zoteroStatus
            ? "connections-reconnect-zotero"
            : "connections-connect-zotero",
          icon: "plug" as const,
          group: "connections-zotero-group",
          dot: health,
          disabled: connectionsBusy,
          action: connectZotero,
        },
        // What the *Zotero* plugin contributes, and only that. Its commands
        // belong beside the connection they need — every one of them fails
        // without it — but that reasoning is exactly why another plugin's
        // commands do not belong here. This used to take every command from
        // every plugin, so capturing a screenshot and adding a task both
        // appeared under Zotero.
        ...commandsOf(ZOTERO_PLUGIN_ID).map((command) => ({
          labelKey: command.nameKey,
          icon: "book" as const,
          group: "connections-zotero-group",
          action: () => runCommand(command.id),
        })),
        // The task service, beside the others. Connecting a paper to the
        // things it is built from is one kind of work and belongs in one
        // place — Settings keeps what is per install.
        ...(taskProvider
          ? [
              {
                // Per project: which list *this paper* uses. The sign-in is
                // per install and lives in the plugin's own settings panel —
                // one credential serves every paper, and asking for it here
                // would be asking a project-shaped question about the machine.
                labelKey: taskProject
                  ? "connections-tasks-relink"
                  : "connections-tasks-link",
                icon: "calendar" as const,
                group: "connections-tasks-group",
                dot: (tasksReady
                  ? taskProject
                    ? "ok"
                    : "unknown"
                  : "error") as Health,
                disabled: connectionsBusy || !tasksReady || !project,
                action: () => void linkTasks(),
              },
              // What the to-do plugin contributes, beside its own connection
              // for the same reason Zotero's are beside Zotero's.
              ...commandsOf(TODOIST_PLUGIN_ID).map((command) => ({
                labelKey: command.nameKey,
                icon: "calendar" as const,
                group: "connections-tasks-group",
                action: () => runCommand(command.id),
              })),
              // Said rather than left to be guessed from a disabled button:
              // "sign in first" is a different problem from "no project open".
              ...(tasksReady
                ? []
                : [
                    {
                      labelKey: "connections-tasks-sign-in-first",
                      icon: "info" as const,
                      group: "connections-tasks-group",
                      action: () => showNotice(t("connections-tasks-sign-in-first")),
                    },
                  ]),
            ]
          : []),
        {
          labelKey: "connections-obsidian",
          icon: "folder" as const,
          group: "connections-obsidian-group",
          dot: "unknown" as const,
          disabled: true,
          action: notImplemented,
        },
      ],
    },
    {
      labelKey: "menu-help",
      items: [
        // Capturing part of the application is documentation work: it is how
        // the manual gets its pictures. It needs no connection to anything, so
        // it has no business under Connections — which is where it was, because
        // that tab used to take every plugin's commands.
        ...commandsOf(LEARN_PLUGIN_ID).map((command) => ({
          labelKey: command.nameKey,
          icon: "page" as const,
          group: "group-capture",
          action: () => runCommand(command.id),
        })),
        { labelKey: "menu-help-documentation",
          icon: "book" as const,
          group: "group-learn", action: notImplemented, disabled: true },
        { labelKey: "menu-help-report-issue",
          icon: "bug" as const,
          group: "group-learn", action: notImplemented, disabled: true },
        {
          labelKey: "menu-help-about",
          icon: "info" as const,
          group: "group-about",
          action: notImplemented,
          disabled: true,
          separatorBefore: true,
        },
      ],
    },
  ]);

  /**
   * A menu's entries, gathered into the ribbon's command groups.
   *
   * The grouping is declared on each entry rather than here, so a command is
   * declared once and lands in the right group without a second list to keep
   * in step. Entries with no group named fall into one of their menu's own,
   * which is what stops a newly added command disappearing.
   *
   * The first command of the first group is drawn large. In a ribbon that is
   * not decoration: it is how a tab says what it is for, and a wall of
   * identically sized buttons gives the eye nowhere to land.
   */
  function intoGroups(menu: Menu) {
    const order: string[] = [];
    const grouped = new Map<string, RibbonControl[]>();

    for (const item of menu.items) {
      const key = item.group ?? menu.labelKey;
      if (!grouped.has(key)) {
        grouped.set(key, []);
        order.push(key);
      }
      grouped.get(key)!.push(
        item.items?.length
          ? {
              kind: "menu" as const,
              labelKey: item.labelKey,
              icon: item.icon,
              items: item.items,
            }
          : {
              kind: "action" as const,
              labelKey: item.labelKey,
              icon: item.icon,
              disabled: item.disabled,
              checked: item.checked,
              onclick: () => void item.action?.(),
            },
      );
    }

    return order.map((key, index) => {
      const controls = grouped.get(key)!;
      const first = controls[0];
      if (index === 0 && first?.kind === "action") {
        controls[0] = { ...first, prominent: true };
      }
      return { titleKey: key, controls };
    });
  }

  /**
   * The ribbon, built from the menus plus the tabs only it can have.
   *
   * The menus are not rewritten: each becomes a tab, its plain entries become
   * buttons and its flyouts become dropdowns. One declaration, two shapes —
   * otherwise every command would have to be added in both places, and one of
   * them would fall behind.
   *
   * Layout and Document are the tabs that justify the ribbon existing. They let
   * someone set a paper size or an author without knowing that those are a
   * package option and a preamble command, which is the whole point.
   */
  /**
   * The on-or-off formatting buttons, in the order a ribbon puts them.
   *
   * `emph` is missing on purpose, though it is the command a LaTeX author
   * should usually reach for: two buttons that both look like italic is a
   * choice nobody wants to make mid-sentence. The button writes `\\textit`, and
   * `\\emph` is still understood when the document already has it.
   */
  const INLINE_FORMATS: {
    command: InlineFormat;
    labelKey: string;
    icon: "text" | "heading" | "code";
  }[] = [
    { command: "textbf", labelKey: "format-bold", icon: "text" },
    { command: "textit", labelKey: "format-italic", icon: "text" },
    { command: "underline", labelKey: "format-underline", icon: "text" },
    { command: "textsc", labelKey: "format-small-caps", icon: "text" },
    { command: "texttt", labelKey: "format-monospace", icon: "code" },
  ];

  /**
   * Whether the formatting controls can do anything.
   *
   * A `.md` or a `.bib` has no `\\textbf`, and buttons that write LaTeX into one
   * would be buttons that damage the file rather than format it.
   */
  const canFormat = $derived(Boolean(currentFile) && currentFormat === "latex");

  const ribbonTabs = $derived<RibbonTab[]>(
    orderTabs([
    ...menus.map((menu) => ({
      id: menu.labelKey,
      labelKey: menu.labelKey,
      groups: intoGroups(menu),
    })),
    {
      /*
       * Formatting, where somebody who learnt Word will look for it.
       *
       * The same commands as the bar that follows a selection, and the same
       * three-family, ten-size lists — because those are what LaTeX has. Two
       * ways to reach one set of commands is not duplication: it is the
       * difference between the person who selects text and expects something to
       * appear, and the person who selects text and looks up.
       */
      id: "start",
      labelKey: "ribbon-start",
      groups: [
        {
          titleKey: "ribbon-font",
          controls: [
            ...INLINE_FORMATS.map((format) => ({
              kind: "action" as const,
              labelKey: format.labelKey,
              icon: format.icon,
              checked: selectionFormat.inline.includes(format.command),
              disabled: !canFormat,
              onclick: () =>
                applyFormatting(
                  (text, from, to) =>
                    toggleInline(text, from, to, format.command),
                  format.command,
                ),
            })),
            {
              kind: "select" as const,
              labelKey: "format-family",
              icon: "text" as const,
              value: selectionFormat.family ?? "",
              options: [
                { value: "", label: t("format-family-default") },
                ...FONT_FAMILIES.map((family) => ({
                  value: family,
                  label: t(`format-family-${family}`),
                })),
              ],
              onchange: (value: string) =>
                applyFormatting((text, from, to) =>
                  setFamily(text, from, to, (value || null) as FontFamily | null),
                ),
            },
            {
              kind: "select" as const,
              labelKey: "format-size",
              icon: "heading" as const,
              value: selectionFormat.size ?? "",
              options: [
                { value: "", label: t("format-size-default") },
                ...FONT_SIZES.map((size) => ({
                  value: size,
                  label: t(`format-size-${size}`),
                })),
              ],
              onchange: (value: string) =>
                applyFormatting((text, from, to) =>
                  setSize(text, from, to, (value || null) as FontSize | null),
                ),
            },
            {
              kind: "menu" as const,
              labelKey: "format-colour",
              icon: "sun" as const,
              items: [
                ...TEXT_COLOURS.map((colour) => ({
                  labelKey: `format-colour-${colour}`,
                  group: "group-colours",
                  checked: selectionFormat.colour === colour,
                  action: () =>
                    applyFormatting((text, from, to) =>
                      setColour(text, from, to, colour as TextColour),
                    ),
                })),
                {
                  labelKey: "format-colour-none",
                  group: "group-colours",
                  separatorBefore: true,
                  action: () =>
                    applyFormatting((text, from, to) =>
                      setColour(text, from, to, null),
                    ),
                },
              ],
            },
            {
              kind: "action" as const,
              labelKey: "format-clear",
              icon: "close" as const,
              disabled: !canFormat,
              onclick: () => applyFormatting(clearFormatting),
            },
          ],
        },
        {
          titleKey: "ribbon-paragraph",
          controls: [
            ...([1, 2, 3] as const).map((level) => ({
              kind: "action" as const,
              labelKey: `format-heading-${level}`,
              icon: "heading" as const,
              disabled: !canFormat,
              onclick: () =>
                applyFormatting((text, from) => toggleHeading(text, from, level)),
            })),
            {
              kind: "action" as const,
              labelKey: "format-quote",
              icon: "book" as const,
              disabled: !canFormat,
              onclick: () =>
                applyFormatting((text, from, to) =>
                  toggleEnvironment(text, from, to, "quote"),
                ),
            },
          ],
        },
      ],
    },
    {
      id: "layout",
      labelKey: "ribbon-layout",
      groups: [
        {
          titleKey: "ribbon-page-setup",
          controls: [
            {
              kind: "select" as const,
              labelKey: "ribbon-paper",
              icon: "page" as const,
              value: properties.paper,
              options: PAPER_SIZES.map((size) => ({
                value: size,
                label: t(`paper-${size}`),
              })),
              onchange: (value: string) => changeProperty("paper", value),
            },
            {
              kind: "select" as const,
              labelKey: "ribbon-orientation",
              icon: "columns" as const,
              value: properties.orientation,
              options: ORIENTATIONS.map((orientation) => ({
                value: orientation,
                label: t(`orientation-${orientation}`),
              })),
              onchange: (value: string) =>
                changeProperty("orientation", value),
            },
          ],
        },
      ],
    },
    {
      id: "document",
      labelKey: "ribbon-document",
      groups: [
        {
          titleKey: "ribbon-title-block",
          controls: [
            {
              kind: "text" as const,
              labelKey: "ribbon-doc-title",
              icon: "heading" as const,
              value: properties.title,
              onchange: (value: string) => changeProperty("title", value),
            },
            {
              kind: "text" as const,
              labelKey: "ribbon-doc-author",
              icon: "person" as const,
              value: properties.author,
              onchange: (value: string) => changeProperty("author", value),
            },
            {
              kind: "date" as const,
              labelKey: "ribbon-doc-date",
              icon: "calendar" as const,
              choice: documentDate,
              formatted:
                documentDate.kind === "on"
                  ? formatDate(documentDate.iso, properties.language)
                  : "",
              onchange: (choice: DateChoice) =>
                changeProperty("date", writeDate(choice)),
            },
          ],
        },
        {
          titleKey: "settings-document-locale",
          controls: [
            {
              kind: "select" as const,
              labelKey: "settings-document-locale",
              icon: "globe" as const,
              value: properties.language,
              options: [
                { value: "", label: t("status-language-unset") },
                ...LANGUAGES.map((language) => ({
                  value: language.option,
                  label: t(language.labelKey),
                })),
              ],
              onchange: (value: string) => changeProperty("language", value),
            },
          ],
        },
      ],
    },
    {
      // The buttons that used to sit beside the title bar. Gathered rather than
      // scattered, until there is a reason to put each somewhere better.
      id: "work",
      labelKey: "ribbon-work",
      groups: [
        {
          titleKey: "ribbon-work",
          controls: [
            {
              kind: "action" as const,
              labelKey: "compile-run",
              icon: "play" as const,
              prominent: true,
              disabled: !project || busy,
              onclick: () => void compile(),
            },
            {
              kind: "action" as const,
              labelKey: "view-mode-source",
              icon: "code" as const,
              checked: !richText,
              onclick: () => (richText = !richText),
            },
            {
              kind: "action" as const,
              labelKey: vcs?.enabled ? "vcs-recording" : "vcs-enable",
              icon: "branch" as const,
              disabled: !project || vcsBusy,
              checked: vcs?.enabled,
              onclick: () => void toggleVcs(),
            },
            {
              kind: "action" as const,
              labelKey: "vcs-commit-with-message",
              icon: "clock" as const,
              disabled: !vcs?.enabled || !vcs.dirty || vcsBusy,
              onclick: () => {
                askingForMessage = true;
              },
            },
          ],
        },
      ],
    },
    ]),
  );

  /**
   * The buttons on the tab strip itself.
   *
   * Compiling and settings belong to no tab because they are wanted from every
   * one. Settings inside a tab means someone looking for it has to guess
   * which, and the guess is wrong often enough that they stop looking.
   */
  const ribbonActions = $derived<RibbonAction[]>([
    {
      id: "compile",
      labelKey: "compile-run",
      icon: "play" as const,
      disabled: !project || busy,
      onclick: () => void compile(),
      // The other ways to compile, where a right-click already means exactly
      // that. Stubs for now, and disabled rather than absent so the shape of
      // what is coming is visible.
      menu: [
        { labelKey: "compile-clean", disabled: true, action: notImplemented },
        { labelKey: "compile-choose-engine", disabled: true, action: notImplemented },
        { labelKey: "compile-open-log", disabled: true, action: notImplemented },
      ],
    },
    {
      id: "settings",
      labelKey: "menu-edit-settings",
      icon: "settings" as const,
      onclick: () => openSettings("appearance"),
    },
  ]);

  /**
   * What the title bar shows.
   *
   * The folder name rather than the full path: the path was a long absolute
   * string across the top of the window, and the useful part is the last
   * segment.
   */
  const windowTitle = $derived.by(() => {
    if (!project) return "";
    // The folder name, not the path and not the product name. The window
    // already says which application it is; repeating it in the title bar of
    // that application spends the only line there is.
    return project.root.replace(/[\/]+$/, "").split(/[\/]/).pop() ?? "";
  });

  const selectedEngineInfo = $derived(engines.find((e) => e.id === selectedEngine) ?? null);

  /**
   * What yaz can be driven by, and what is driving it.
   *
   * Held rather than derived: the server is a live thing, and asking Rust each
   * time the dialog rendered would put an IPC call in a reactive expression.
   */
  let mcp = $state<ipc.McpStatus>({
    running: false,
    address: null,
    token: null,
    tools: 0,
  });

  /** The bundled plugins, as Rust reported them at startup. */
  let plugins = $state<ipc.CorePlugin[]>([]);

  /** What the last update check found, by plugin id. */
  let updateReport = $state<Record<string, string>>({});

  /** Whether a check is in flight, so the button can say so. */
  let checkingUpdates = $state(false);

  /** A directory a plugin is being developed in, if the user picked one. */
  let developmentPlugin = $state<string | null>(null);

  /** Switch the MCP server on or off, and remember what happened. */
  async function switchMcp(on: boolean): Promise<void> {
    try {
      mcp = on ? await ipc.mcpStart() : await ipc.mcpStop();
      if (on) {
        // The tools are held in the runtime whether or not anything is
        // listening; starting the server is when they become reachable.
        await runtime.publishTools();
        mcp = await ipc.mcpStatus();
        // An agent that can drive yaz should be able to see the open project.
        await ipc.mcpSetProject(project?.root ?? null);
      }
    } catch (error) {
      failure = String(error);
    }
  }

  /**
   * Ask each plugin's own repository what the newest release is.
   *
   * The plugin says where to look — yaz holds no list of plugins it knows
   * about (ADR-0021) — so this reads the `updates` block out of each manifest
   * and goes there. A plugin with no `updates` block does not take updates,
   * which is a legitimate answer and not an error.
   */
  async function checkForUpdates(): Promise<void> {
    checkingUpdates = true;
    const found: Record<string, string> = {};
    await Promise.all(
      plugins.map(async (plugin) => {
        if (!plugin.updates) {
          found[plugin.id] = t("plugins-update-none");
          return;
        }
        try {
          const latest = await ipc.pluginLatestRelease(plugin.id);
          found[plugin.id] =
            latest === null
              ? t("plugins-update-unknown")
              : latest === plugin.version
                ? t("plugins-update-current", { version: plugin.version })
                : t("plugins-update-available", { version: latest });
        } catch {
          found[plugin.id] = t("plugins-update-unreachable");
        }
      }),
    );
    updateReport = found;
    checkingUpdates = false;
  }

  /** Point yaz at a directory a plugin is being written in. */
  async function chooseDevelopmentPlugin(): Promise<void> {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    developmentPlugin = picked;
    try {
      await ipc.setDevelopmentPlugin(picked);
    } catch (error) {
      failure = String(error);
    }
  }

  /** Stop using it. */
  async function clearDevelopmentPlugin(): Promise<void> {
    developmentPlugin = null;
    try {
      await ipc.setDevelopmentPlugin(null);
    } catch (error) {
      failure = String(error);
    }
  }

  /**
   * The settings dialog's contents.
   *
   * The engine choice lives here rather than in the toolbar: it is set once per
   * project and then not touched, which is the definition of a setting rather
   * than a control.
   */
  const settingsSections = $derived<Section[]>([
    {
      id: "formats",
      labelKey: "settings-section-formats",
      glyph: "¶",
      groups: [
        {
          titleKey: "settings-group-formats",
          fields: [
            { kind: "note" as const, labelKey: "settings-formats-help" },
            ...optionalFormats().map((entry) => ({
              kind: "toggle" as const,
              labelKey: entry.labelKey,
              value: isEnabled(entry.id, formatPreferences),
              onchange: (value: boolean) => void chooseFormat(entry.id, value),
            })),
          ],
        },
      ],
    },
    {
      id: "general",
      labelKey: "settings-section-general",
      glyph: "⚙",
      groups: [
        {
          titleKey: "settings-group-editor",
          fields: [
            {
              kind: "toggle",
              labelKey: "menu-view-vim",
              helpKey: "settings-vim-help",
              value: vimMode,
              onchange: (value) => (vimMode = value),
            },
          ],
        },
      ],
    },
    {
      id: "engine",
      labelKey: "settings-section-engine",
      glyph: "⌘",
      groups: [
        {
          titleKey: "settings-group-typesetting",
          fields: [
            {
              kind: "select",
              labelKey: "settings-engine",
              helpKey: "settings-engine-help",
              value: selectedEngine ?? "",
              options: engines.map((engine) => ({
                value: engine.id,
                // Unavailable engines stay listed but unselectable. Hiding one
                // leaves somebody hunting for an engine the docs promised.
                //
                // So does an engine for the other document language: Typst
                // cannot compile a `.tex` and the LaTeX engines cannot compile
                // a `.typ`. Saying which language it is for explains the grey;
                // omitting it explains nothing.
                label: !engine.available
                  ? `${engine.label} — ${t("engine-unavailable-suffix")}`
                  : engine.language !== projectLanguage
                    ? `${engine.label} — ${t(`engine-language-${engine.language}`)}`
                    : engine.label,
                disabled: !engine.available || engine.language !== projectLanguage,
              })),
              onchange: (value) => void chooseEngine(value),
              warningKey:
                selectedEngineInfo && !selectedEngineInfo.available
                  ? (selectedEngineInfo.unavailableReasonKey ?? undefined)
                  : undefined,
            },
            ...(project ? [] : [{ kind: "note" as const, labelKey: "settings-engine-no-project" }]),
          ],
        },
      ],
    },
    {
      id: "appearance",
      labelKey: "settings-appearance",
      glyph: "◐",
      groups: [
        {
          titleKey: "settings-appearance",
          fields: [
            {
              kind: "select" as const,
              labelKey: "settings-theme",
              helpKey: "settings-theme-help",
              value: appearance.theme,
              // A theme's name is its author's, so it is data and not a
              // message key — translating it would be renaming someone's work.
              options: themes.map((theme) => ({ value: theme.id, label: theme.name })),
              onchange: (id: string) => void changeAppearance({ theme: id }),
            },
            {
              kind: "select" as const,
              labelKey: "settings-colour-mode",
              value: appearance.colourMode,
              options: theming.COLOUR_MODES.map((mode) => ({
                value: mode,
                label: t(`settings-colour-mode-${mode}`),
              })),
              onchange: (mode: string) =>
                void changeAppearance({ colourMode: mode as ipc.Appearance["colourMode"] }),
            },
            {
              kind: "select" as const,
              labelKey: "settings-interface-locale",
              helpKey: "settings-interface-locale-help",
              value: appearance.interfaceLocale,
              // Endonyms: a language list is read by people looking for their
              // own, and someone who cannot read the current interface can
              // still find "Deutsch".
              options: availableLocales.map((entry) => ({
                value: entry.code,
                label: entry.name,
              })),
              onchange: (code: string) => void changeAppearance({ interfaceLocale: code }),
            },
          ],
        },
        {
          titleKey: "settings-appearance-build",
          fields: [
            {
              kind: "button" as const,
              labelKey: "settings-appearance-build",
              helpKey: "settings-appearance-build-help",
              actionKey: "settings-appearance-build-open",
              onclick: () => {
                settingsOpen = false;
                buildingTheme = true;
              },
            },
            {
              kind: "button" as const,
              labelKey: "settings-appearance-install",
              actionKey: "settings-appearance-install",
              onclick: () => void installTheme(),
            },
          ],
        },
      ],
    },
    {
      id: "keys",
      labelKey: "settings-section-keys",
      glyph: "⌨",
      groups: [
        {
          titleKey: "keys-suites",
          fields: SUITES.map((suite) => ({
            kind: "toggle" as const,
            labelKey: suite.labelKey,
            helpKey: suite.helpKey,
            value: !keyPreferences.disabledSuites.includes(suite.id),
            onchange: (on: boolean) => {
              // The core cannot be switched off. Offering the switch and
              // ignoring it would be worse than not offering it, so it is
              // shown as already on and stays that way.
              if (!isOptional(suite.id)) return;
              keyPreferences = {
                ...keyPreferences,
                disabledSuites: on
                  ? keyPreferences.disabledSuites.filter((id) => id !== suite.id)
                  : [...keyPreferences.disabledSuites, suite.id],
              };
              void saveKeys();
            },
          })),
        },
        ...SUITES.map((suite) => ({
          titleKey: suite.labelKey,
          fields: shortcuts
            .filter((shortcut) => shortcut.suites.includes(suite.id))
            .map((shortcut) => ({
              kind: "shortcut" as const,
              labelKey: shortcut.labelKey,
              binding: describeBinding(shortcut.binding),
              active: shortcut.active,
              conflicting: [...keyConflicts.values()].some((ids) =>
                ids.includes(shortcut.id),
              ),
              changed: shortcut.changed,
              onrebind: (binding: string) => {
                keyPreferences = {
                  ...keyPreferences,
                  overrides: { ...keyPreferences.overrides, [shortcut.id]: binding },
                };
                void saveKeys();
              },
              onreset: () => {
                const { [shortcut.id]: _removed, ...rest } = keyPreferences.overrides;
                keyPreferences = { ...keyPreferences, overrides: rest };
                void saveKeys();
              },
            })),
        })),
      ],
    },
    {
      id: "version-control",
      labelKey: "vcs-title",
      glyph: "⎇",
      groups: [
        {
          titleKey: "vcs-title",
          fields: [
            {
              kind: "select",
              labelKey: "vcs-settings-backend",
              helpKey: "vcs-settings-backend-help",
              value: vcs?.backend ?? "git",
              options: vcsBackends.map((backend) => ({
                value: backend.id,
                label: backend.available
                  ? t(backend.labelKey)
                  : `${t(backend.labelKey)} — ${t("engine-unavailable-suffix")}`,
                disabled: !backend.available,
              })),
              onchange: (value) => void switchBackend(value),
            },
            {
              kind: "note",
              labelKey: vcs?.enabled ? "vcs-recording" : "vcs-not-recording",
            },
          ],
        },
      ],
    },
    {
      id: "plugins",
      labelKey: "settings-section-plugins",
      glyph: "⊞",
      groups: [
        {
          titleKey: "plugins-installed",
          fields: [
            // A count, not a list. Each plugin has a section of its own below
            // the rule now, which is where its name, its version and its own
            // settings are — so repeating them here would be saying everything
            // twice and burying the two controls that really are general.
            {
              kind: "note" as const,
              labelKey: "plugins-installed",
              text:
                plugins.length === 0
                  ? t("plugins-none")
                  : t("plugins-installed-count", { count: plugins.length }),
            },
            {
              kind: "button" as const,
              labelKey: "plugins-update-label",
              helpKey: "plugins-update-help",
              actionKey: checkingUpdates ? "plugins-update-checking" : "plugins-update-action",
              onclick: () => void checkForUpdates(),
            },
          ],
        },
        {
          titleKey: "plugins-development",
          fields: [
            {
              kind: "path" as const,
              labelKey: "plugins-development-directory",
              helpKey: "plugins-development-help",
              value: developmentPlugin,
              emptyKey: "plugins-development-none",
              onchoose: () => void chooseDevelopmentPlugin(),
              onclear: () => void clearDevelopmentPlugin(),
            },
          ],
        },
        {
          titleKey: "mcp-title",
          fields: [
            {
              kind: "toggle" as const,
              labelKey: "mcp-enabled",
              helpKey: "mcp-enabled-help",
              value: mcp.running,
              onchange: (on: boolean) => void switchMcp(on),
            },
            {
              kind: "copy" as const,
              labelKey: "mcp-address",
              helpKey: "mcp-address-help",
              value: mcp.address ?? "",
              emptyKey: "mcp-not-running",
            },
            {
              kind: "copy" as const,
              labelKey: "mcp-token",
              helpKey: "mcp-token-help",
              value: mcp.token ?? "",
              emptyKey: "mcp-not-running",
              // Masked until asked for: it is the whole of the authentication,
              // and settings dialogs get screen-shared.
              secret: true,
            },
            {
              kind: "note" as const,
              labelKey: "mcp-tools",
              text: t("mcp-tools", { count: String(mcp.tools) }),
            },
          ],
        },
      ],
    },
    {
      id: "connections",
      labelKey: "settings-section-connections",
      glyph: "⇄",
      groups: [
        {
          titleKey: "connections-zotero",
          // Notes rather than controls: connecting is a menu action, and this
          // is where the detail behind the status light lives — which source is
          // answering, where it was found, and what to do about it.
          fields: [
            {
              kind: "note",
              labelKey: zoteroStatus ? zoteroStatus.liveStatusKey : "connections-unknown",
            },
            ...(zoteroStatus ? [{ kind: "note" as const, labelKey: zoteroStatus.sourceKey }] : []),
            ...(zoteroStatus?.liveStatusKey === "zotero-live-api-disabled"
              ? [{ kind: "note" as const, labelKey: "zotero-live-api-disabled-help" }]
              : []),
            ...(zoteroStatus?.wasDemoted
              ? [{ kind: "note" as const, labelKey: "zotero-demoted" }]
              : []),
            ...(zoteroStatus && !zoteroStatus.keysAreAuthoritative && zoteroStatus.source !== "none"
              ? [{ kind: "note" as const, labelKey: "zotero-keys-generated" }]
              : []),
          ],
        },
        {
          titleKey: "connections-obsidian",
          fields: [{ kind: "note", labelKey: "connections-not-configured" }],
        },
      ],
    },
    /*
     * One section per installed plugin, below a rule.
     *
     * The way Obsidian and Zotero do it, and for the reason they do: a list
     * that ends at "Plugins" makes what is installed something you have to
     * open a page to find out, when it is the first thing somebody opening
     * this dialog wants to see.
     *
     * Named with the plugin's own name rather than a message key, because a
     * plugin's name is its author's and is not ours to translate.
     */
    ...plugins.map((plugin, index) => ({
      id: `plugin:${plugin.id}`,
      // Required by the shape and unused where `label` is set; it is what a
      // plugin with no name at all would fall back to.
      labelKey: "settings-section-plugins",
      label: plugin.name,
      // Its own mark where its manifest gave one, so a list of six plugins is
      // six recognisable rows rather than six identical diamonds.
      glyph: plugin.icon ?? "◈",
      // Only the first carries the rule, so it reads as one boundary rather
      // than a line between every plugin.
      separated: index === 0,
      groups: [
        {
          titleKey: "plugins-about",
          fields: [
            {
              kind: "note" as const,
              labelKey: "plugins-about",
              text: plugin.description,
            },
            {
              kind: "note" as const,
              labelKey: "plugins-version",
              text: t("plugins-version-value", { version: plugin.version }),
            },
            ...(updateReport[plugin.id]
              ? [
                  {
                    kind: "note" as const,
                    labelKey: "plugins-update-unknown",
                    text: updateReport[plugin.id],
                  },
                ]
              : []),
          ],
        },
        // Its own panel, where it has one. A plugin with nothing to ask still
        // gets a section, because "installed and has no settings" is worth
        // seeing and an absent section reads as "not installed".
        ...pluginPanels
          .filter((panel) => panel.pluginId === plugin.id)
          .map((panel) => ({
            titleKey: panel.titleKey,
            fields: [
              {
                kind: "panel" as const,
                labelKey: panel.titleKey,
                render: panel.render,
              },
            ],
          })),
      ],
    })),
  ]);

  /** Change which backend records this project. */
  async function switchBackend(id: string) {
    if (!project) return;
    vcsBusy = true;
    try {
      vcs = vcs?.enabled ? await ipc.vcsEnable(project.root, id) : { ...vcs!, backend: id };
      await refreshVcs();
    } catch (error) {
      failure = String(error);
    } finally {
      vcsBusy = false;
    }
  }

  function closeProject() {
    project = null;
    currentFile = null;
    joined = false;
    joinedSegments = null;
    liveSegments = null;
    joinedFiles = new Map();
    joinedDirty = new Set();
    joinedMissing = [];
    docText = "";
    result = null;
    pdfData = null;
    pdfFile = null;
    void ipc.pluginSetProject(null);
  }

  /**
   * Which language this project is written in, inferred from its entry.
   *
   * Typst is not a third interchangeable engine: Tectonic and the system
   * engines are two ways to typeset the same `.tex`, and Typst is a different
   * document language whose projects are `.typ`. So the engines for the other
   * language are shown and disabled rather than hidden — hiding them explains
   * nothing, and offering them yields a parse error nobody can act on.
   */
  const projectLanguage = $derived<"latex" | "typst">(
    project?.entry.endsWith(".typ") ? "typst" : "latex",
  );

  const errorCount = $derived(
    result?.diagnostics.filter((d) => d.severity === "error").length ?? 0,
  );

  // Reported once, after mount, so the startup budget is measured against the
  // moment the UI is actually usable rather than when the window appeared.
  $effect(() => {
    void ipc.reportReady().catch(() => {
      /* measurement only; never worth surfacing to the user */
    });
    // Engines are NOT detected here. Detection runs each engine to see whether
    // it exists, and a system TeX on Windows-on-ARM is x86-64 under emulation:
    // four probes cost over two seconds and flashed a console window each.
    // The settings dialog asks for them when it opens, which is the first
    // moment anyone needs the answer.
    //
    // Zotero is not contacted here either. Nothing connects until the user
    // asks, so a session that never cites anything never looks for a library.

    // Plugins load after the first paint, not before it. The window is usable
    // without them, and blocking startup on a plugin would spend the budget in
    // ADR-0015 on something the user has not asked for yet.
    // A small TOML read, so it can happen at startup without being felt - and
    // the File menu needs it populated the first time it is opened.
    void loadRecent();
    void ipc
      .getFormatPreferences()
      .then(({ disabled }) => {
        formatPreferences = Object.fromEntries(
          disabled.map((id) => [id, false]),
        );
      })
      .catch(() => {
        /* Every format on is the right answer when the file cannot be read. */
      });

    // What is installed, where its updates come from, and what it declares.
    // Read once: the answer changes only when plugins are reloaded.
    void ipc
      .pluginList()
      .then((found) => {
        plugins = found;
      })
      .catch(() => {
        /* The panel says "no plugins are loaded", which is then true. */
      });
    void ipc
      .getDevelopmentPlugin()
      .then((path) => {
        developmentPlugin = path;
      })
      .catch(() => {
        /* Nothing chosen is the right answer when the setting cannot be read. */
      });
    // Whether an agent is already being let in — the server survives a window
    // reload, so the switch must show what is actually true and not what this
    // window last did.
    void ipc
      .mcpStatus()
      .then((status) => {
        mcp = status;
      })
      .catch(() => {
        /* Off is the right answer when it cannot be asked. */
      });

    void runtime
      .start({
        [ZOTERO_PLUGIN_ID]: ZoteroPlugin,
        "com.yaz.obsidian": ObsidianPlugin,
        "com.yaz.formats": FormatsPlugin,
        "com.yaz.learn": LearnPlugin,
        "com.yaz.latex-packages": LatexPackagesPlugin,
        "com.yaz.todoist": TodoistPlugin,
      })
      .then(() => {
        // What the plugins offered, handed to the registry once they have all
        // loaded. Held apart from the built-in formats, so which came from
        // where stays answerable (ADR-0021).
        // What the plugins know about LaTeX packages. yaz knows LaTeX
        // itself and nothing else (ADR-0005, and `vocabulary.ts`).
        setContributions(
          runtime.vocabularies.map((entry) => ({
            pluginId: entry.pluginId,
            commands: entry.commands as never,
            environments: entry.environments as never,
          })),
        );
        setContributedFormats(
          runtime.formats.map((entry) => ({
            id: entry.id,
            extensions: entry.extensions,
            labelKey: entry.nameKey,
            load: async () => (await entry.load()) as never,
          })),
        );
        // The tabs the plugins added. A copy, because the runtime's array is
        // not reactive and a glossary tab that only appeared after the next
        // unrelated change would look like the plugin had failed.
        pluginViews = [...runtime.views];
        dropTakers = [...runtime.dropHandlers];
        pluginPanels = [...runtime.settingsPanels];
        taskProviders = [...runtime.taskProviders];
        void loadTasks();
        refreshCommands();
      })
      .catch((error) => {
        failure = String(error);
      });
  });

  async function chooseEngine(id: string) {
    if (!project) return;
    selectedEngine = id;
    try {
      await ipc.setProjectEngine(project.root, id);
    } catch (error) {
      failure = String(error);
    }
  }

  async function chooseProject() {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    await openProjectAt(picked);
  }

  async function openProjectAt(picked: string) {
    failure = null;
    try {
      await adoptProject(await ipc.openProject(picked));
    } catch (error) {
      failure = String(error);
    }
  }

  /**
   * Settle into a project that has already been scanned.
   *
   * Split out from {@link openProjectAt} because the wizard has the scan
   * already — creating a project returns it — and everything after the scan is
   * the same work either way. Two copies of this would be two places to
   * remember that the plugin brokers have to be re-scoped.
   */
  async function adoptProject(info: ipc.ProjectInfo) {
      // The previous project's joined buffer goes first, and it has to go
      // before the new entry is opened. Otherwise `openFile` takes its joined
      // branch, looks for `main.tex` among the *old* document's segments,
      // finds one — nearly every project has a `main.tex` — and moves the
      // cursor inside the old text instead of loading the new file. Which is
      // exactly what a new project looked like: created, opened, and showing
      // the last project's document.
      joined = false;
      joinedSegments = null;
      liveSegments = null;
      joinedFiles = new Map();
      joinedDirty = new Set();
      joinedMissing = [];

      project = info;
      // Filesystem capabilities are scoped to the open project, so the brokers
      // have to be told. Without this a plugin keeps writing into whichever
      // project was open when it loaded.
      await ipc.pluginSetProject(info.root);
      result = null;
      pdfData = null;
      // The stored choice only. Resolving "no choice" to the first *available*
      // engine would need the engine probe, and that is exactly what has been
      // moved off the startup path; the settings dialog resolves it when opened.
      const settings = await ipc.getProjectSettings(info.root);
      selectedEngine = settings.engineId;
      layout = layoutTree.deserialise(settings.workspace);
      void loadRecent();
      void refreshVcs();
      await openFile(info.entry);

      // A document that is several files opens as several files joined.
      //
      // Not a preference guessed at: a root that is `\include` lines and a
      // preamble has no prose, no tables and no glossary in it, so the
      // single-file view of it is not a view of the document — it is a view of
      // the list of its parts. Where a document *is* one file this changes
      // nothing, which is why the condition is the document's and not a
      // setting. Amends ADR-0020, which had this off for everyone.
      if (hasIncludes(docText)) await join();
  }

  async function ensureEditorLoaded() {
    if (EditorComponent || editorLoadFailed) return;
    try {
      EditorComponent = (await import("./lib/Editor.svelte")).default;
    } catch (error) {
      // A failed chunk load leaves the pane empty forever otherwise, with no
      // clue why. Better to say so than to look merely broken.
      editorLoadFailed = true;
      failure = String(error);
    }
  }

  /**
   * Read every source file in the project, so stitching can be synchronous.
   *
   * `stitch` walks the includes itself and asks for files as it needs them,
   * which an `await` per file cannot answer. Reading them all first costs a few
   * dozen small reads once per join, against making the whole expansion async
   * and awaiting inside a recursion.
   */
  async function readSources(): Promise<Map<string, string>> {
    const texts = new Map<string, string>();
    if (!project) return texts;

    for (const file of project.files) {
      if (file.kind !== "tex" && file.kind !== "style") continue;
      try {
        texts.set(
          file.relativePath,
          await ipc.readFile(project.root, file.relativePath),
        );
      } catch {
        // Left out, so the include stays visible as a command. A file that
        // cannot be read is not an empty chapter.
      }
    }
    return texts;
  }

  /** Join the document's files into one buffer. */
  async function join() {
    if (!project) return;
    // Whatever is in the single-file buffer goes to disk first: the join reads
    // from disk, and an unsaved paragraph would simply vanish from the text.
    await save();

    const texts = await readSources();
    const result = stitch(project.entry, (path) => texts.get(path) ?? null);

    joinedFiles = texts;
    joinedSegments = result.segments;
    liveSegments = result.segments;
    joinedMissing = result.missing;
    joinedDirty = new Set();
    docText = result.text;
    dirty = false;
    joined = true;

    const count = filesIn(result.segments).length;
    showNotice(
      result.missing.length > 0
        ? t("joined-missing", { count, missing: result.missing.join(", ") })
        : t("joined-entered", { count }),
    );
  }

  /** Go back to editing one file at a time. */
  async function unjoin() {
    await save();
    joined = false;
    joinedSegments = null;
    liveSegments = null;
    joinedFiles = new Map();
    joinedDirty = new Set();
    joinedMissing = [];
    if (project) await openFile(currentFile ?? project.entry);
  }

  function toggleJoined() {
    void (joined ? unjoin() : join());
  }

  /**
   * Send an edit to the file it belongs to.
   *
   * The editor has already refused anything that spans a seam, so a refusal
   * here means the map and the buffer have drifted apart. Saying so is the only
   * honest response: writing the change somewhere would write it to the wrong
   * file, and dropping it silently would lose the author's text.
   */
  function recordJoinedChanges(changes: Change[]) {
    if (!liveSegments || changes.length === 0) return;

    const mapped = mapChanges(liveSegments, changes);
    const moved = mapSegments(liveSegments, changes);
    if (!("byFile" in mapped) || !moved) {
      // The editor refuses an unwritable edit before it applies, so reaching
      // here means the buffer and the map have drifted apart. Nothing further
      // is written, because writing against a map that no longer describes the
      // buffer is how a paragraph ends up in the wrong chapter.
      liveSegments = null;
      failure = t("joined-drifted");
      return;
    }

    joinedFiles = applyToFiles(joinedFiles, mapped);
    liveSegments = moved;
    const touched = new Set(joinedDirty);
    for (const file of mapped.byFile.keys()) touched.add(file);
    joinedDirty = touched;
  }

  /** Open the file an `\\include` names, from a click on its path. */
  async function openInclude(argument: string) {
    if (!project) return;
    // Relative to the file the command is in — which, joined, is whichever file
    // the caret is in rather than the entry document.
    const from = joined
      ? (locateJoined(cursor)?.file ?? project.entry)
      : (currentFile ?? project.entry);
    await openFile(resolveInclude(argument, from));
  }

  /** Which file an offset in the joined buffer belongs to. */
  function locateJoined(offset: number): { file: string } | null {
    for (const segment of liveSegments ?? []) {
      if (offset >= segment.from && offset <= segment.to) return segment;
    }
    return null;
  }

  /**
   * Figure images, as object URLs, by the path the document names.
   *
   * Cached because a decoration is rebuilt on every keystroke and each rebuild
   * asks for its image again — reading the file each time would put a
   * filesystem round trip on the keystroke path, which ADR-0015 does not allow.
   * Bounded by the number of figures in the document, which is a number the
   * author controls and is never large.
   */
  const figureUrls = new Map<string, Promise<string | null>>();

  /**
   * The extensions a figure's path may be missing.
   *
   * LaTeX lets `\includegraphics{logo}` find `logo.png`, so the same list is
   * tried here — and PDF and EPS figures are left out, because a browser cannot
   * show them and a broken image is worse than a frame with a name in it.
   */
  const FIGURE_EXTENSIONS = ["", ".png", ".jpg", ".jpeg", ".gif", ".webp"];

  /** Turn a figure's path into a URL, or null when nothing can be read. */
  function resolveImage(path: string): Promise<string | null> {
    const known = figureUrls.get(path);
    if (known) return known;

    const loading = (async () => {
      if (!project) return null;
      // Relative to the file that names it, which joined is whichever file the
      // caret is in — the same rule an `\include` follows.
      const from = joined
        ? (locateJoined(cursor)?.file ?? project.entry)
        : (currentFile ?? project.entry);
      const directory = from.includes("/")
        ? from.slice(0, from.lastIndexOf("/"))
        : "";

      for (const extension of FIGURE_EXTENSIONS) {
        const candidate = `${directory ? `${directory}/` : ""}${path}${extension}`;
        try {
          const bytes = await ipc.readProjectBytes(project.root, candidate);
          return URL.createObjectURL(new Blob([bytes as BlobPart]));
        } catch {
          // The next extension, or none of them — a figure whose file is not
          // there is drawn as its name, which is what the author needs to see.
        }
      }
      return null;
    })();

    figureUrls.set(path, loading);
    return loading;
  }

  /** Whether a path names a PDF, which the viewer shows rather than the editor. */
  function isPdf(path: string): boolean {
    return path.toLowerCase().endsWith(".pdf");
  }

  /**
   * Show a PDF from the project in the viewer.
   *
   * Any PDF, not only the compile's output: a figure, a standard, last term's
   * version of the same document. The editor is not opened for it, because a
   * PDF is not source and showing its bytes as text helps nobody.
   */
  async function openPdf(relativePath: string) {
    if (!project) return;
    failure = null;
    try {
      pdfData = await ipc.readProjectBytes(project.root, relativePath);
      pdfFile = relativePath;
      pdfPages = null;
      updateLayout(layoutTree.focusTab(layout, "pdf"));
    } catch (error) {
      failure = String(error);
    }
  }

  async function openFile(relativePath: string) {
    if (!project) return;
    if (isPdf(relativePath)) {
      await openPdf(relativePath);
      return;
    }
    void ensureEditorLoaded();

    if (joined) {
      // The file is already on screen; opening it means going to it. This is
      // the whole point of the mode — the file list becomes a way of moving
      // around one document rather than a way of swapping documents.
      const segment = (liveSegments ?? []).find(
        (candidate) => candidate.file === relativePath,
      );
      if (segment) {
        currentFile = relativePath;
        editorApi?.revealRange(segment.from, segment.from);
        return;
      }
      // A file that is not part of the document — a `.bib`, a stray draft —
      // cannot be shown inside it, so opening it leaves the joined view. Said
      // out loud, because a mode that switches itself off silently is a mode
      // nobody trusts.
      showNotice(t("joined-left", { file: relativePath }));
      await unjoin();
    }

    try {
      docText = await ipc.readFile(project.root, relativePath);
      currentFile = relativePath;
      dirty = false;
    } catch (error) {
      failure = String(error);
    }
  }

  async function save() {
    if (!project) return;

    if (joined) {
      // Per file, and reported per file: a save that half-succeeds leaves the
      // document in a state no single file records, and "saving failed" without
      // a name is not something anyone can act on.
      for (const file of joinedDirty) {
        const text = joinedFiles.get(file);
        if (text === undefined) continue;
        try {
          await ipc.writeFile(project.root, file, text);
        } catch (error) {
          failure = t("joined-save-failed", { file, error: String(error) });
          return;
        }
      }
      joinedDirty = new Set();
      dirty = false;
      if (vcs?.enabled) await recordVersion();
      return;
    }

    if (!currentFile || !dirty) return;
    await ipc.writeFile(project.root, currentFile, docText);
    dirty = false;
    // Recording is part of saving when it is switched on. A save with no edits
    // records nothing, so this does not fill the history with empty versions.
    if (vcs?.enabled) await recordVersion();
  }

  async function compile() {
    if (!project || busy) return;
    busy = true;
    failure = null;
    try {
      await save();
      const outcome = await ipc.compile(project.root);
      result = outcome;
      // A PDF can exist even when the compile reported errors, so this is keyed
      // off the artefact rather than off `succeeded`.
      pdfData = outcome.pdfPath ? await ipc.readArtefact(outcome.pdfPath) : null;
      // Back to the compile's own output, which is the one inverse search can
      // follow — whatever was being read before.
      pdfFile = null;
    } catch (error) {
      failure = String(error);
    } finally {
      busy = false;
    }
  }
</script>

<!--
  What each tab renders. A snippet rather than a component map, so the editor and
  the preview keep the props they already had and the workspace stays ignorant
  of what a tab actually is.
-->
{#snippet tabContent(tab: TabId)}
  {#if tab === "editor"}
    {#if currentFile && EditorComponent}
      <EditorComponent
        doc={docText}
        docId={editorDocId}
        {vimMode}
        segments={joinedSegments}
        onRefused={() => showNotice(t("joined-refused"))}
        onOpenInclude={(argument) => void openInclude(argument)}
        onChange={(text, changes) => {
          docText = text;
          dirty = true;
          if (joined) recordJoinedChanges(changes);
        }}
        onSave={save}
        rich={richText && currentFormat === "latex"}
        {numbering}
        {shortcuts}
        documentView={shownView}
        page={paperSize}
        {zoom}
        {wrap}
        {language}
        {comments}
        {lineBreaks}
        {machinery}
        {tablesLocked}
        {paperLight}
        {justified}
        {resolveImage}
        {dropTakers}
        bibliography={bibEntries}
        {citationNumbers}
        onUnresolvedCitation={(key) => void explainCitation(key)}
        listings={listingHomes}
        onOpenListing={openListing}
        onCursor={(offset) => {
          cursor = offset;
          // Read rather than derived: "what is this selection inside" is a
          // question about a position, and the text alone cannot answer it.
          selectionFormat =
            editorComponent?.formattingNow() ?? selectionFormat;
        }}
        onZoom={(percent) => (zoom = percent)}
        bind:this={editorComponent}
        onReady={(api) => {
          editorApi = api;
          refreshCommands();
        }}
        formatBar={currentFormat === "latex"}
        latex={currentFormat === "latex"}
        onPasteImage={currentFormat === "latex" ? savePastedImage : undefined}
        onRequirePackage={(name) => void ensurePackage(name)}
      />
    {:else if currentFile}
      <p class="empty">{t("editor-loading")}</p>
    {:else}
      <p class="empty">{t("workspace-no-file-open")}</p>
    {/if}
  {:else if tab === "files"}
    {#if !project}
      <p class="empty">{t("workspace-no-project")}</p>
    {:else}
      <!-- Not gated on there being rows: an empty project is exactly when
           somebody needs to right-click and make the first file. -->
      <FileTree
        rows={fileRows}
        open={openFolders}
        current={currentFile}
        {dimBuild}
        ontoggle={toggleFolder}
        onopen={openFile}
        oncontext={(node, x, y) => (fileMenu = { node, x, y })}
      />
    {/if}
  {:else if tab === "pdf"}
    <PdfView
      data={pdfData}
      name={pdfFile}
      onclickpoint={pdfFile === null ? jumpToSource : undefined}
      onpages={(n) => (pdfPages = n)}
    />
  {:else if tab === "outline"}
    <Outline
      doc={docText}
      file={currentFile}
      {cursor}
      onnavigate={(heading: Heading) => {
        // The offsets address the raw source, which is the same buffer in both
        // views — so this works identically in rich text.
        editorApi?.revealRange(heading.titleFrom, heading.titleTo);
      }}
    />
  {:else if tab === "search"}
    <Search
      query={search}
      results={searchResults}
      busy={searchBusy}
      capped={searchCapped}
      onnavigate={(file, match) => void goToMatch(file, match)}
    />
  {:else if tab === "citations"}
    <Citations
      works={documentCitations}
      file={currentFile}
      hasBibliography={bibEntries.size > 0}
      onnavigate={(at) => editorApi?.revealRange(at, at)}
      onexplain={(key) => void explainCitation(key)}
      onselect={showCitationDetail}
    />
  {:else if tab === "details"}
    <Details {detail} />
  {:else if tab === "tasks"}
    <Tasks
      hasProject={project !== null}
      providerName={taskProvider ? t(taskProvider.provider.nameKey) : null}
      linked={taskProject}
      {tasks}
      busy={tasksBusy}
      ready={tasksReady}
      onlink={() => void linkTasks()}
      onadd={(title) => void addTask(title)}
      oncomplete={(task) => void completeTask(task)}
      onrefresh={() => void loadTasks()}
      onselect={showTaskDetail}
    />
  {:else if pluginTab(tab)}
    <PluginView view={pluginTab(tab)!} doc={docText} />
  {:else if tab === "history"}
    <History
      status={vcs}
      {commits}
      busy={vcsBusy}
      onenable={toggleVcs}
      onrestore={restoreVersion}
      oncommit={() => {
        askingForMessage = true;
      }}
    />
  {/if}
{/snippet}

{#if fileMenu}
  <ContextMenu
    items={fileMenuItems(fileMenu.node)}
    x={fileMenu.x}
    y={fileMenu.y}
    onclose={() => (fileMenu = null)}
  />
{/if}

{#if namePrompt}
  <Prompt
    titleKey={namePrompt.titleKey}
    initial={namePrompt.initial}
    onsubmit={(value) => {
      const pending = namePrompt;
      namePrompt = null;
      const name = value?.trim();
      if (!pending || !name) return;
      void pending.onname(name).catch((error: unknown) => {
        failure = String(error);
      });
    }}
  />
{/if}

{#if pendingDelete}
  <Confirm
    titleKey="files-delete-confirm"
    values={{ name: pendingDelete.name }}
    detailKey="files-delete-detail"
    confirmKey="files-delete"
    destructive
    onchoose={(confirmed) => {
      const pending = pendingDelete;
      pendingDelete = null;
      if (confirmed && pending) void deletePath(pending.path);
    }}
  />
{/if}

{#if makingProject}
  <NewProject
    failure={newProjectFailure}
    onbrowse={async () => {
      const picked = await open({ directory: true, multiple: false });
      return typeof picked === "string" ? picked : null;
    }}
    oncreate={(parent, name, kind) => void createProject(parent, name, kind)}
    oncancel={() => (makingProject = false)}
  />
{/if}

{#if bibProblem}
  <BibliographyFix
    citationKey={bibProblem.key}
    problem={bibProblem.problem}
    onuse={(name) => void useBibliography(name)}
    oncreate={(name) => void createBibliography(name)}
    onclose={() => (bibProblem = null)}
  />
{/if}

{#if buildingTheme}
  <ThemeBuilder
    mode={theming.resolveMode(appearance.colourMode)}
    onapply={applyBuiltTheme}
    onexport={exportTheme}
    onclose={() => (buildingTheme = false)}
  />
{/if}

<div class="app">
  <!-- The window is undecorated, so this row is the title bar. The project
       name lives here, which is where a title bar puts it — and is why the
       long absolute path came out of the toolbar. -->
  <!-- The window is undecorated, so this row is the title bar. What is on
       it is what you reach for without thinking about which part of the
       application it belongs to; everything else went to the ribbon. -->
  <TitleBar
    bind:this={titleBar}
    title={windowTitle}
    {dirty}
    canSave={Boolean(currentFile)}
    onsave={save}
    {autosave}
    onautosave={(on) => (autosave = on)}
    onundo={() => showNotice(t("menu-not-implemented"))}
    onredo={() => showNotice(t("menu-not-implemented"))}
    {search}
    onsearch={(value) => (search = value)}
    options={searchOptions}
    onoptions={(next) => (searchOptions = next)}
    matches={searchCount}
    {replacing}
    onreplacing={(open) => (replacing = open)}
    {replacement}
    onreplacement={(value) => (replacement = value)}
    onreplaceone={replaceOnce}
    onreplaceall={replaceEvery}
    {projectMenu}
  />

  {#if !ribbonVertical}
    <Ribbon
      tabs={ribbonTabs}
      actions={ribbonActions}
      height={ribbonHeight}
      orientation="horizontal"
      expanded={ribbonOpen}
      ontoggle={() => (ribbonOpen = !ribbonOpen)}
    />
  {/if}

  <div class="body">
    {#if ribbonVertical}
      <Ribbon
        tabs={ribbonTabs}
        actions={ribbonActions}
        height={ribbonHeight}
        orientation="vertical"
        expanded={ribbonOpen}
        ontoggle={() => (ribbonOpen = !ribbonOpen)}
      />
    {/if}
    <Pane
      node={layout}
      titles={tabTitles}
      content={tabContent}
      onmove={(tab, target, zone) =>
        updateLayout(layoutTree.moveTab(layout, tab, target, zone))}
      onfocus={(tab) => updateLayout(layoutTree.focusTab(layout, tab))}
      onclose={(tab) => updateLayout(layoutTree.closeTab(layout, tab))}
      onresize={(path, sizes) => updateLayout(layoutTree.resize(layout, path, sizes))}
    />
  </div>

  {#if picker}
    <Picker
      titleKey={picker.titleKey}
      placeholderKey={picker.placeholderKey}
      emptyKey={picker.emptyKey}
      query={picker.query}
      load={picker.load}
      onchoose={(value) => {
        const pending = picker;
        picker = null;
        pending?.resolve(value);
      }}
      oncancel={() => {
        const pending = picker;
        picker = null;
        // Resolving with undefined is how `ui.pick` reports a dismissal, so a
        // plugin awaiting it is never left hanging.
        pending?.resolve(undefined);
      }}
    />
  {/if}

  {#if settingsOpen}
    <Settings
      sections={settingsSections}
      initial={settingsSection}
      onclose={() => (settingsOpen = false)}
    />
  {/if}

  {#if askingForMessage}
    <Prompt
      titleKey="vcs-commit-title"
      placeholderKey="vcs-commit-placeholder"
      hintKey="vcs-commit-hint"
      onsubmit={(value) => {
        askingForMessage = false;
        // Null is a dismissal; an empty string is "you describe it", which is
        // why they are distinguished rather than both treated as cancel.
        if (value !== null) void recordVersion(value);
      }}
    />
  {/if}

  {#if notice}
    <output class="notice">{notice}</output>
  {/if}

  <StatusBar
    compileMessage={failure ??
      (result
        ? result.succeeded
          ? t("compile-succeeded", { seconds: (result.elapsedMs / 1000).toFixed(1) })
          : t("compile-failed")
        : null)}
    compileFailed={Boolean(failure) || (result !== null && !result.succeeded)}
    compileErrors={errorCount}
    {health}
    healthLabel={t(healthKey)}
    onhealth={connectZotero}
    page={null}
    pages={pdfPages}
    words={wordCount}
    language={properties.language}
    languages={LANGUAGES.map((language) => ({
      value: language.option,
      label: t(language.labelKey),
    }))}
    onlanguage={(value) => changeProperty("language", value)}
    view={shownView}
    onview={() => {
      chosenView =
        DOCUMENT_VIEWS[
          (DOCUMENT_VIEWS.indexOf(chosenView) + 1) % DOCUMENT_VIEWS.length
        ] ?? "continuous";
    }}
    rich={richText}
    onsource={() => (richText = !richText)}
    {zoom}
    onzoom={(percent) => (zoom = percent)}
  />
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    block-size: 100vh;
    background: var(--yaz-bg-primary);
    color: var(--yaz-text-primary);
    font-family: var(--yaz-font-ui);
    font-size: var(--yaz-font-size-base);
  }

  /* The workspace, which arranges itself — including the file list, which is
     a tab in it rather than a column beside it. */
  .body {
    flex: 1;
    display: flex;
    min-block-size: 0;
  }

  .body > :global(*) {
    flex: 1;
    min-inline-size: 0;
  }


  .empty {
    color: var(--yaz-text-muted);
    padding: var(--yaz-space-4);
    margin: 0;
  }




  .notice {
    position: fixed;
    inset-block-end: var(--yaz-space-8);
    inset-inline-start: 50%;
    transform: translateX(-50%);
    padding-block: var(--yaz-space-2);
    padding-inline: var(--yaz-space-4);
    background: var(--yaz-bg-overlay);
    color: var(--yaz-text-primary);
    border: 1px solid var(--yaz-border);
    border-radius: var(--yaz-radius-md);
    box-shadow: var(--yaz-shadow-overlay);
    z-index: 110;
  }

</style>
