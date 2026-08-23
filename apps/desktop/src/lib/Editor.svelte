<script lang="ts">
  import { untrack } from "svelte";
  import { EditorState, Compartment } from "@codemirror/state";
  import {
    EditorView,
    keymap,
    highlightActiveLine,
    highlightActiveLineGutter,
    drawSelection,
    dropCursor,
    rectangularSelection,
    crosshairCursor,
  } from "@codemirror/view";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
  import {
    autocompletion,
    completionKeymap,
    closeBrackets,
    closeBracketsKeymap,
  } from "@codemirror/autocomplete";
  import {
    syntaxHighlighting,
    HighlightStyle,
    bracketMatching,
    foldGutter,
    foldKeymap,
    indentOnInput,
  } from "@codemirror/language";
  import { tags } from "@lezer/highlight";
  import { vim } from "@replit/codemirror-vim";
  import type { Extension } from "@codemirror/state";
  import type { EditorApi } from "@yaz/api";
  import {
    richText,
    richTextEnabled,
    setRichText,
    setShowComments,
    setShowLineBreaks,
    setLockTables,
    setShowMachinery,
  } from "./editor/richText";
  import {
    bibliography,
    citationNumbering,
    followCitation,
    imageSource,
  } from "./editor/semanticView";
  import type { BibEntry } from "./editor/semanticView";
  import { listingTabs } from "./editor/listingLink";
  import type { ListingKind } from "./editor/generated";
  import { changesIn, setSegments, stitched } from "./editor/stitched";
  import type { Change, Segment } from "./editor/stitch";
  import { includeLinks } from "./editor/includeLinks";
  import { dropTakers, pluginDrops } from "./editor/dropped";
  import type { DropTaker } from "./editor/dropped";
  import type { DocumentView } from "./editor/documentView";
  import FormatBar from "./FormatBar.svelte";
  import { placeBar } from "./editor/formatBar";
  import { formatInCell } from "./editor/tableWidget";
  import {
    appliedFormatting,
    clearFormatting,
    setColour,
    setFamily,
    setSize,
    toggleInline,
  } from "./editor/formatting";
  import type {
    AppliedFormatting,
    FontFamily,
    FontSize,
    InlineFormat,
    TextColour,
  } from "./editor/formatting";
  import { lineNumbering } from "./editor/lineNumbers";
  import type { LineNumbering } from "./editor/lineNumbers";
  import {
    paginated,
    paper,
    pagination,
  } from "./editor/pagination";
  import { editorKeymap } from "./keys/editorKeys";
  import type { ResolvedShortcut } from "./keys/registry";

  interface Props {
    /** Buffer contents. Changing this to a different file replaces the document. */
    doc: string;
    /** Which file this buffer belongs to; used to decide replace-vs-update. */
    docId: string;
    /**
     * The buffer changed.
     *
     * The text and the changes both. The text is what everything reading the
     * document wants; the changes are what writing back to several files needs,
     * since an edit can only be sent to a file if it is known as an edit and not
     * as a new version of half a megabyte of text.
     */
    onChange: (text: string, changes: Change[]) => void;
    onSave: () => void;
    vimMode: boolean;
    /** Render LaTeX as styled text. Decorations over the same buffer. */
    rich: boolean;
    /** How the gutter numbers lines, if at all. */
    numbering: LineNumbering;
    /**
     * Which language to highlight the buffer as.
     *
     * `null` is a real answer and the floor everything else stands on: line
     * numbers, wrapping, Vim and search, with no opinion about the text. A
     * file of an unknown format gets it, and so does one whose format the user
     * has switched off.
     */
    language?: Extension | null;
    /**
     * Set the text on a sheet of paper rather than filling the pane.
     *
     * The sheet is the size the document declares, so what is on screen has
     * the proportions of what will come out of the printer. It is not a
     * preview — the lines do not break where LaTeX will break them, and
     * claiming otherwise would be worse than not showing a page at all.
     */
    /**
     * How the text is set: plain, a centred column, or on paper.
     *
     * Already resolved by the shell — a Markdown file cannot be on paper, and
     * deciding that here would mean the editor knowing what a format is.
     */
    documentView: DocumentView;
    /** The page's proportions, in millimetres. */
    page: { width: number; height: number };
    /** How large the text is drawn, as a percentage. */
    zoom: number;
    /**
     * Whether the author's comments are on screen.
     *
     * Hiding them is a reading aid, not an edit: the characters stay in the
     * buffer and come back the moment the switch moves.
     */
    comments?: boolean;
    /**
     * Whether an explicit line break shows as itself or as the break it makes.
     *
     * Off draws the break, which is what a reader sees; on shows the two
     * characters, which is what someone checking a title block wants.
     */
    lineBreaks?: boolean;
    /**
     * Whether the document's machinery is on screen.
     *
     * `\begin{titlepage}`, `\renewcommand{\arraystretch}{1.2}` — instructions to
     * the typesetter that produce no words. Off by default, because rich text
     * is a view of the document rather than of the instructions for making it.
     */
    machinery?: boolean;
    /**
     * Whether a table stays drawn while the caret is inside it.
     *
     * Opt-in: the rest of the view reveals a construct's source when the caret
     * arrives, and a table should not be the odd one out unless asked.
     */
    tablesLocked?: boolean;
    /**
     * Whether the page is drawn as white paper whatever the interface is.
     *
     * Someone proofreading wants paper; someone writing at midnight wants the
     * dark they set the rest of the application to. The two are different
     * questions, so this is a separate switch and not a consequence of the
     * colour mode.
     */
    paperLight?: boolean;
    /**
     * Whether paragraphs are set justified, as LaTeX sets them by default.
     *
     * Read from the document rather than chosen here: a document that says
     * `\raggedright` means it, and a paragraph shown flush on both edges when it
     * will print ragged is a paragraph whose shape on screen is a lie.
     */
    justified?: boolean;
    /**
     * Whether a line too long for the pane comes back round.
     *
     * On by default. A pasted URL or a long sentence otherwise runs off to the
     * right and takes the rest of the document with it — the horizontal
     * scrollbar appears, every other line becomes shorter than the pane, and
     * reading means scrolling sideways and back for one line in fifty.
     *
     * Off is a real preference, not an oversight: someone lining up a table by
     * hand, or reading a generated file where a line's length is the point,
     * wants to see where a line actually ends.
     */
    wrap: boolean;
    /**
     * The shortcuts, already resolved against the user's preferences.
     *
     * Passed in rather than read here: the registry is the application's, and
     * an editor that reached for it directly would be a second place shortcuts
     * come from.
     */
    shortcuts: ResolvedShortcut[];
    /**
     * Which file each stretch of the buffer belongs to, or null for one file.
     *
     * Handed over whole, when the shell stitches the document. It is
     * deliberately *not* fed back on every keystroke: the editor moves the map
     * itself as the text changes, because an edit has to be judged before it
     * applies and a map that arrives a frame later arrives after the damage
     * ([ADR-0020](https://generalpawz.github.io/yaz/adr/0020-stitched-multi-file-editing)).
     */
    segments?: Segment[] | null;
    /**
     * An edit was refused because it spanned a seam.
     *
     * Nothing happened to the document, so this is the only sign the keystroke
     * was heard at all — which is why it is reported rather than dropped.
     */
    onRefused?: (() => void) | undefined;
    /**
     * A file name in an `\\include` was clicked, as written in the source.
     *
     * Passed on unresolved: the path is relative to the file that contains it,
     * and the editor does not know which file that is.
     */
    onOpenInclude?: ((argument: string) => void) | undefined;
    /**
     * Turn a figure's path into something an `<img>` can show.
     *
     * Passed in because reading a file is the shell's business and not the
     * editor's — the capability check lives in the Rust process (ADR-0006), and
     * an editor that reached for the filesystem would be going round it.
     */
    resolveImage?: ((path: string) => Promise<string | null>) | undefined;
    /**
     * Which generated lists the shell can show in a tab.
     *
     * The preview no longer draws a contents list or a glossary on the paper —
     * it draws a card standing in for one — and the card is only a way in where
     * something is there to open. Which kinds those are is the shell's to say:
     * the outline answers for the contents and a plugin answers for the
     * glossary, and the editor knows neither.
     */
    listings?: readonly ListingKind[] | undefined;
    /** A generated list's card was clicked. */
    onOpenListing?: ((kind: ListingKind) => void) | undefined;
    /**
     * What the project's bibliography says, keyed by citation key.
     *
     * Supplied by the shell because a `.bib` is a different file — and in
     * single-file mode not even the one that is open. Empty is a fine value: a
     * citation then draws its key, which is what the author typed.
     */
    bibliography?: ReadonlyMap<string, BibEntry> | undefined;
    /**
     * What each work prints under a numeric citation style.
     *
     * Counted by the shell over the whole document rather than here, because a
     * `\cite` in chapter four is `[17]` on account of works cited in chapters
     * this buffer does not contain. Empty means the style is not numeric.
     */
    citationNumbers?: ReadonlyMap<string, number> | undefined;
    /**
     * A citation whose key nothing defines was clicked.
     *
     * The shell answers this by looking at the project directory, which is why
     * it is a click and not a watcher: reading the filesystem on every
     * keystroke to warn about something most documents never hit would be the
     * wrong trade (ADR-0015).
     */
    onUnresolvedCitation?: ((key: string) => void) | undefined;
    /**
     * What plugins offered to make of something dropped on the editor.
     *
     * Passed in rather than reached for: which plugins are loaded is the
     * shell's business, and the editor's is only to offer them the drop.
     */
    dropTakers?: readonly DropTaker[] | undefined;
    /** Caret moved, as an offset into the source. */
    onCursor?: ((offset: number) => void) | undefined;
    /**
     * Asked for a different magnification, as a percentage.
     *
     * The editor does not hold the zoom — the shell does, because the status
     * bar shows it — so Ctrl and the wheel report upwards rather than setting
     * anything here.
     */
    onZoom?: ((percent: number) => void) | undefined;
    /**
     * Handed an `EditorApi` when the view exists, and `null` when it goes away.
     *
     * This is how a plugin reaches the buffer. It is deliberately a callback
     * rather than an exported binding: the view outlives neither the component
     * nor a file switch, and a stale handle would let a plugin write into a
     * destroyed document.
     */
    onReady?: (api: EditorApi | null) => void;
    /**
     * A formatting edit needs a package the preamble may not have.
     *
     * Reported rather than written: the preamble is often in another file —
     * main.tex, while a chapter is what is open — and only the shell knows
     * which file that is.
     */
    onRequirePackage?: ((name: string) => void) | undefined;
    /**
     * Whether the bar that follows a selection is offered at all.
     *
     * Off for a format with no notion of bold: a Markdown or plain-text buffer
     * would otherwise get a bar writing LaTeX commands into it.
     */
    formatBar?: boolean;
  }

  let {
    doc,
    docId,
    onChange,
    onSave,
    vimMode,
    rich,
    numbering,
    language = null,
    documentView,
    page,
    zoom,
    wrap,
    comments = true,
    lineBreaks = false,
    machinery = false,
    tablesLocked = false,
    paperLight = false,
    justified = true,
    shortcuts,
    segments = null,
    resolveImage,
    listings = [],
    onOpenListing,
    bibliography: bibEntries = new Map<string, BibEntry>(),
    citationNumbers: bibNumbers = new Map<string, number>(),
    onUnresolvedCitation,
    dropTakers: takers = [],
    onRefused,
    onOpenInclude,
    onCursor,
    onZoom,
    onReady,
    onRequirePackage,
    formatBar = false,
  }: Props = $props();


  /**
   * The bar that follows a selection.
   *
   * Held here rather than inside CodeMirror because it is a control and not a
   * decoration: it draws over the document, not into it, and nothing about it
   * belongs in the buffer (ADR-0004).
   */
  let barShown = $state(false);
  let barLeft = $state(0);
  let barTop = $state(0);
  let barApplied = $state<AppliedFormatting>({
    inline: [],
    family: null,
    size: null,
    colour: null,
  });

  /** The bar's own measured size, so it can be placed without covering the text. */
  let barBox: HTMLElement | undefined = $state();

  /**
   * Work out whether the bar shows, and where.
   *
   * Called on every selection change, so it does nothing at all in the common
   * case — a plain cursor. The measuring is here and the deciding is in
   * `placeBar`, which is what makes the awkward half testable: jsdom reports
   * every rectangle as zero.
   */
  function updateFormatBar(instance: EditorView) {
    const range = instance.state.selection.main;
    if (!formatBar || range.empty) {
      barShown = false;
      return;
    }

    const start = instance.coordsAtPos(range.from);
    const end = instance.coordsAtPos(range.to);
    if (!start || !end) {
      barShown = false;
      return;
    }

    const pane = instance.dom.getBoundingClientRect();
    const selection = {
      left: Math.min(start.left, end.left) - pane.left,
      right: Math.max(start.right, end.right) - pane.left,
      top: Math.min(start.top, end.top) - pane.top,
      bottom: Math.max(start.bottom, end.bottom) - pane.top,
    };

    barApplied = appliedFormatting(
      instance.state.doc.toString(),
      range.from,
      range.to,
    );

    // Its own size, or a sensible guess before it has ever been drawn. The
    // guess is only used for the first frame; the next selection measures it.
    const box = barBox?.getBoundingClientRect();
    const size = {
      width: box && box.width > 0 ? box.width : 320,
      height: box && box.height > 0 ? box.height : 34,
    };

    const placed = placeBar(
      selection,
      { width: pane.width, height: pane.height },
      size,
    );
    barLeft = placed.left;
    barTop = placed.top;
    barShown = true;
  }

  /**
   * Apply a formatting edit from outside — the ribbon, or the palette.
   *
   * Exported rather than reached for through `EditorApi`, because `EditorApi`
   * is the *plugin* contract (ADR-0005) and this is the shell talking to its
   * own editor. Widening a public interface to save the shell a binding would
   * be exactly the privileged back door that ADR forbids.
   */
  export function format(
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
  ) {
    applyFormat(produce);
  }

  /** What the selection already is, for controls that live outside the pane. */
  export function formattingNow(): AppliedFormatting {
    const instance = view;
    if (!instance) {
      return { inline: [], family: null, size: null, colour: null };
    }
    const range = instance.state.selection.main;
    return appliedFormatting(
      instance.state.doc.toString(),
      range.from,
      range.to,
    );
  }

  /**
   * Apply a formatting edit to the selection.
   *
   * One dispatch, so it is one step of undo — formatting is something the
   * author did, and taking it back should not need five presses.
   */
  function applyFormat(
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
  ) {
    const instance = view;
    if (!instance) return;
    const range = instance.state.selection.main;
    const result = produce(
      instance.state.doc.toString(),
      range.from,
      range.to,
    );
    if (result.requires) onRequirePackage?.(result.requires.package);
    if (result.changes.length === 0) return;

    instance.dispatch({
      changes: result.changes,
      selection: { anchor: result.from, head: result.to },
      userEvent: "input.format",
    });
    // The selection survives the edit, so the bar stays where the words are —
    // and a second button can be pressed without selecting again.
    instance.focus();
    updateFormatBar(instance);
  }

  /** Whether the text is set on paper. */
  const paged = $derived(documentView === "page");

  /** The map currently installed, so a re-stitch can be told from a keystroke. */
  let loadedSegments: Segment[] | null = null;

  /**
   * The buffer as `@yaz/api` describes it.
   *
   * There is one buffer holding the raw `.tex` in both source and visual mode,
   * so this needs no notion of modes (ADR-0004).
   */
  function editorApi(instance: EditorView): EditorApi {
    return {
      getText: () => instance.state.doc.toString(),
      getSelection: () => {
        const range = instance.state.selection.main;
        return { from: range.from, to: range.to };
      },
      replaceRange: (from, to, text) => {
        instance.dispatch({ changes: { from, to, insert: text } });
      },
      insertAtCursor: (text) => {
        const range = instance.state.selection.main;
        instance.dispatch({
          changes: { from: range.from, to: range.to, insert: text },
          // Leave the caret after what was inserted, which is where someone
          // who just pasted a citation expects to keep typing.
          selection: { anchor: range.from + text.length },
        });
        instance.focus();
      },
      getMode: () => (instance.state.field(richTextEnabled, false) ? "visual" : "source"),
      revealRange: (from, to) => {
        // Clamped, because the offsets come from somewhere that read the
        // buffer earlier: an outline built before a file was switched, a
        // SyncTeX record for a file that is not the one on screen, a segment
        // map from a joined document that has since been taken apart. Out of
        // range, CodeMirror throws out of `dispatch` and the view is left
        // wedged — which is what "the editor goes wrong when I switch files"
        // was.
        const end = instance.state.doc.length;
        const anchor = Math.max(0, Math.min(from, end));
        const head = Math.max(0, Math.min(to, end));
        instance.dispatch({
          selection: { anchor, head },
          // `center` rather than the default, so a heading jumped to from
          // the outline does not land against the top edge.
          effects: EditorView.scrollIntoView(anchor, { y: "center" }),
        });
        instance.focus();
      },
    };
  }

  let host: HTMLDivElement;

  /** The range the zoom is allowed to take, matching the status bar's slider. */
  const SMALLEST_ZOOM = 10;
  const LARGEST_ZOOM = 400;

  /**
   * Ctrl and the wheel, which is how every other document application zooms.
   *
   * Attached by hand rather than with `onwheel`, because it has to be
   * non-passive: the browser will not let a passive listener call
   * `preventDefault`, and without that Ctrl-wheel zooms the whole window
   * instead of the page.
   *
   * Proportional rather than a fixed step, so that one notch feels the same at
   * 25% as it does at 300% — a flat five points is a third of the way at the
   * bottom of the range and barely visible at the top.
   */
  $effect(() => {
    const element = host;
    const report = onZoom;
    if (!element || !report) return;

    const wheeled = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      // `zoom` is read here rather than captured when the listener was
      // attached: a destructured prop compiles to a getter, so this is the
      // magnification now and not the one the effect last saw.
      const now = zoom;
      report(
        Math.round(
          Math.min(LARGEST_ZOOM, Math.max(SMALLEST_ZOOM, now * factor)),
        ),
      );
    };

    element.addEventListener("wheel", wheeled, { passive: false });
    return () => element.removeEventListener("wheel", wheeled);
  });
  let view: EditorView | undefined;
  let loadedDocId = "";

  const vimCompartment = new Compartment();
  const numberCompartment = new Compartment();
  const keyCompartment = new Compartment();
  const wrapCompartment = new Compartment();
  const pageCompartment = new Compartment();
  const listingCompartment = new Compartment();
  const dropCompartment = new Compartment();
  const bibCompartment = new Compartment();
  const languageCompartment = new Compartment();

  /*
   * Colours come from the theme token contract, never literals — ADR-0010 makes
   * a hardcoded colour in a component a lint failure, and it is what lets a user
   * theme restyle the editor without touching code.
   */
  const yazTheme = EditorView.theme(
    {
      "&": {
        color: "var(--yaz-editor-text)",
        backgroundColor: "var(--yaz-editor-bg)",
        height: "100%",
        fontSize: "var(--yaz-font-size-base)",
      },
      ".cm-content": {
        fontFamily: "var(--yaz-font-mono)",
        lineHeight: "var(--yaz-line-height)",
        caretColor: "var(--yaz-editor-cursor)",
      },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--yaz-editor-cursor)" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "var(--yaz-bg-selection)",
      },
      ".cm-activeLine": { backgroundColor: "var(--yaz-editor-active-line)" },
      ".cm-gutters": {
        backgroundColor: "var(--yaz-editor-gutter-bg)",
        color: "var(--yaz-editor-gutter-text)",
        border: "none",
        borderInlineEnd: "1px solid var(--yaz-border)",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "var(--yaz-bg-hover)",
        color: "var(--yaz-text-primary)",
      },
      ".cm-scroller": { overflow: "auto" },
    },
    { dark: true },
  );

  const yazHighlight = HighlightStyle.define([
    { tag: tags.keyword, color: "var(--yaz-syntax-command)" },
    { tag: tags.tagName, color: "var(--yaz-syntax-environment)" },
    { tag: tags.comment, color: "var(--yaz-syntax-comment)", fontStyle: "italic" },
    { tag: tags.string, color: "var(--yaz-syntax-string)" },
    { tag: tags.atom, color: "var(--yaz-syntax-math)" },
    { tag: tags.number, color: "var(--yaz-syntax-math)" },
    { tag: tags.bracket, color: "var(--yaz-text-muted)" },
    { tag: tags.variableName, color: "var(--yaz-syntax-reference)" },
    { tag: tags.invalid, color: "var(--yaz-syntax-error)" },
  ]);

  function baseExtensions() {
    return [
      // The line-number gutter is not here: it lives in a compartment, so that
      // switching it off or over to relative numbers reconfigures the view
      // rather than rebuilding the document.
      highlightActiveLineGutter(),
      highlightActiveLine(),
      foldGutter(),
      history(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      crosshairCursor(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      highlightSelectionMatches(),
      EditorState.allowMultipleSelections.of(true),
      // The language arrives later and from a compartment: which one it is
      // depends on the file, and loading every language the editor knows at
      // startup to be ready for a file nobody has opened is the opposite of
      // what the lazy loading is for.
      //
      // TODO(phase-4): replace the legacy stex mode with a Lezer LaTeX grammar.
      // Visual mode needs a real syntax tree to hang decorations off, and a
      // StreamLanguage does not give us one (ADR-0004).
      languageCompartment.of([]),
      // Rich text is decorations over this same buffer, never a second
      // document (ADR-0004).
      richText(),
      syntaxHighlighting(yazHighlight),
      yazTheme,
      keymap.of([
        { key: "Mod-s", preventDefault: true, run: () => (onSave(), true) },
        indentWithTab,
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        // Completion's own `Ctrl-Space` is dropped: the window takes that as
        // the prefix every yaz shortcut hangs off, so the binding could never
        // fire. It is re-registered as `edit.complete` on `Ctrl+Shift+Space`,
        // where it is listed and rebindable rather than quietly gone.
        ...completionKeymap.filter((binding) => binding.key !== "Mod-Space"),
        ...searchKeymap,
      ]),
      // A figure's image, when the shell can supply one. Constant for the life
      // of the view: the resolver is a function, not a value that changes.
      imageSource.of((path) => resolveImage?.(path) ?? Promise.resolve(null)),
      pagination(),
      listingCompartment.of(listingHomes(listings)),
      bibCompartment.of([
        bibliography.of(bibEntries),
        citationNumbering.of(bibNumbers),
      ]),
      // Clicking a citation whose key nothing defines. A resolved one does
      // nothing here — going to a `.bib` entry is a different feature, and one
      // that silently did nothing would read as broken.
      followCitation.of((key) => {
        if (!bibEntries.has(key)) onUnresolvedCitation?.(key);
      }),
      pluginDrops(),
      dropCompartment.of(dropTakers.of(takers)),
      pageCompartment.of([
        paginated.of(false),
        paper.of(null),
      ]),
      // Both are inert until they are given something: stitched mode refuses
      // nothing without a segment map, and a document with no `\\include` in it
      // has no links to draw.
      stitched(() => onRefused?.()),
      includeLinks((argument) => onOpenInclude?.(argument)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChange(update.state.doc.toString(), changesIn(update.changes));
        }
        // The outline highlights the section the caret is in, so it needs the
        // position rather than the text.
        if (update.selectionSet || update.docChanged) {
          onCursor?.(update.state.selection.main.head);
          updateFormatBar(update.view);
        }
        // A scroll moves the text under a bar that is anchored to the pane, so
        // it is re-placed rather than left behind pointing at nothing.
        if (update.geometryChanged && barShown) updateFormatBar(update.view);
      }),
    ];
  }

  /**
   * Create the view once, for as long as there is an element to put it in.
   *
   * **This effect must depend on `host` and nothing else.** Everything else it
   * needs is read through `untrack`, because an effect re-runs when anything it
   * read changes — and `doc` changes on every keystroke, since `onChange` feeds
   * the text straight back in as a prop.
   *
   * Reading `doc` here therefore destroyed and rebuilt CodeMirror on every
   * character typed: the editor lost focus and the caret jumped to the top of
   * the file, so the document could only be written one keystroke per click.
   *
   * Subsequent changes are handled by the effects below, which is the point of
   * having them: a new file replaces the document, and toggling Vim
   * reconfigures a compartment. Neither rebuilds the view.
   */
  $effect(() => {
    if (!host) return;
    const parent = host;

    const instance = untrack(
      () =>
        new EditorView({
          parent,
          state: EditorState.create({
            doc,
            // Vim goes in a compartment so it can be toggled without rebuilding
            // the document, which would lose the undo history and cursor.
            extensions: [
              vimCompartment.of(vimMode ? vim() : []),
              numberCompartment.of(lineNumbering(numbering)),
              keyCompartment.of(editorKeymap(shortcuts, { save: onSave })),
              // Wrapping is what the pane's width means. In the page view the
              // content box is the page, so the same extension wraps to the
              // paper rather than to the window — the measure follows the
              // document's own layout without a second setting to keep in step.
              wrapCompartment.of(wrap ? EditorView.lineWrapping : []),
              ...baseExtensions(),
            ],
          }),
        }),
    );

    // Opening straight into rich text should not need a second frame, and
    // neither should opening straight into a stitched document.
    untrack(() => {
      const effects = [];
      if (rich) effects.push(setRichText.of(true));
      if (segments) effects.push(setSegments.of([...segments]));
      if (effects.length > 0) instance.dispatch({ effects });
    });

    view = instance;
    untrack(() => {
      loadedDocId = docId;
      loadedSegments = segments;
      onReady?.(editorApi(instance));
    });

    return () => {
      instance.destroy();
      view = undefined;
      untrack(() => onReady?.(null));
    };
  });

  // Replace the document only when the *file* changes. Reacting to `doc` alone
  // would fight the user's own typing, since onChange feeds it straight back.
  //
  // The segment map rides along in the same transaction rather than arriving in
  // one of its own. Switching into stitched mode changes both at once, and a
  // document replaced while the old map was still installed would be a document
  // every offset of which pointed at the wrong file — briefly, but the refusal
  // filter runs in exactly that window.
  $effect(() => {
    const nextSegments = segments;
    if (!view) return;
    const newDocument = docId !== loadedDocId;
    if (!newDocument && nextSegments === loadedSegments) return;

    view.dispatch({
      ...(newDocument
        ? {
            changes: { from: 0, to: view.state.doc.length, insert: doc },
            selection: { anchor: 0 },
          }
        : {}),
      effects: setSegments.of(nextSegments ? [...nextSegments] : []),
    });
    loadedDocId = docId;
    loadedSegments = nextSegments;
  });

  $effect(() => {
    // An effect rather than a reconfigure: switching view must not rebuild the
    // editor, or the caret and the undo history go with it.
    view?.dispatch({ effects: setRichText.of(rich) });
  });

  // A compartment, for the reason every other one here is: switching the
  // language must not rebuild the document, or the caret and the undo history
  // go with it.
  $effect(() => {
    view?.dispatch({
      effects: languageCompartment.reconfigure(language ?? []),
    });
  });

  $effect(() => {
    view?.dispatch({ effects: setShowComments.of(comments) });
  });

  $effect(() => {
    view?.dispatch({ effects: setShowLineBreaks.of(lineBreaks) });
  });

  $effect(() => {
    view?.dispatch({ effects: setShowMachinery.of(machinery) });
  });

  $effect(() => {
    view?.dispatch({ effects: setLockTables.of(tablesLocked) });
  });

  $effect(() => {
    view?.dispatch({
      effects: vimCompartment.reconfigure(vimMode ? vim() : []),
    });
  });

  // A compartment for the same reason Vim has one: changing the gutter must
  // not rebuild the document.
  $effect(() => {
    view?.dispatch({
      effects: numberCompartment.reconfigure(lineNumbering(numbering)),
    });
  });

  $effect(() => {
    view?.dispatch({
      effects: wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []),
    });
  });

  /**
   * A CSS millimetre, in pixels. Fixed by the specification, not by the screen.
   */
  const PIXELS_PER_MM = 96 / 25.4;

  /**
   * How many lines fit on a sheet, and whether to draw sheets at all.
   *
   * `defaultLineHeight` is a measurement, but a stable one: it depends on the
   * font and the zoom and not on what has been scrolled into view, so a page
   * break derived from it does not move while the reader scrolls — which is
   * the whole reason the break positions are counted rather than measured.
   *
   * The zoom cancels. The sheet is drawn at `height x zoom` and the line is
   * drawn at `line-height x zoom`, so their ratio — which is all this is — is
   * the same at every magnification.
   */
  $effect(() => {
    const instance = view;
    if (!instance) return;

    // Arithmetic, not measurement. A sheet of A4 is 297 mm tall whatever the
    // font is doing, and the magnification is a number we already have — so
    // there is nothing here to read back from the browser, and nothing that
    // can be read before the browser has caught up.
    //
    // Measuring this is what broke it: the zoom is a CSS custom property, so
    // reading a line height straight after changing it paired the old height
    // with the new zoom. How tall the *content* turned out is still measured,
    // in `pagination.ts`, which is where a measurement belongs.
    const magnified = zoom / 100;
    const sheet = paged
      ? {
          height: page.height * PIXELS_PER_MM * magnified,
          width: page.width * PIXELS_PER_MM * magnified,
          margin: PAGE_MARGIN_MM * PIXELS_PER_MM * magnified,
          gap: PAGE_GAP_MM * PIXELS_PER_MM * magnified,
          turnedHeight: page.width * PIXELS_PER_MM * magnified,
        }
      : null;

    instance.dispatch({
      effects: pageCompartment.reconfigure([
        paginated.of(paged),
        paper.of(sheet),
      ]),
    });
  });

  /**
   * Where a generated list can be read, as the preview sees it.
   *
   * A fresh object each time on purpose: the decorations rebuild when the facet
   * changes, and identity is what "changed" means for a facet holding a pair of
   * functions.
   */
  function listingHomes(kinds: readonly ListingKind[]) {
    const known = new Set(kinds);
    return listingTabs.of({
      has: (kind) => known.has(kind),
      open: (kind) => onOpenListing?.(kind),
    });
  }

  // A plugin registering the glossary tab arrives after the view exists, so the
  // cards have to be told rather than being right once at startup.
  $effect(() => {
    view?.dispatch({
      effects: listingCompartment.reconfigure(listingHomes(listings)),
    });
  });

  // A plugin registering a drop handler arrives after the view exists, the same
  // way a contributed tab does.
  $effect(() => {
    view?.dispatch({
      effects: dropCompartment.reconfigure(dropTakers.of(takers)),
    });
  });

  // The bibliography arrives after the file is read, and changes when the
  // author writes to the `.bib` — so it is reconfigured rather than fixed at
  // creation.
  $effect(() => {
    view?.dispatch({
      effects: bibCompartment.reconfigure([
        bibliography.of(bibEntries),
        citationNumbering.of(bibNumbers),
      ]),
    });
  });

  /** What separates one sheet from the next. */
  const PAGE_GAP_MM = 8;

  /** What a page leaves around its text. Kept in step with the stylesheet. */
  const PAGE_MARGIN_MM = 25;

  // Rebinding a shortcut in settings takes effect where the caret is, without
  // the document being rebuilt underneath it.
  $effect(() => {
    view?.dispatch({
      effects: keyCompartment.reconfigure(editorKeymap(shortcuts, { save: onSave })),
    });
  });
</script>

<!--
  The page's width is set in millimetres and its content scaled by the zoom, so
  that "100%" means the sheet is drawn at its real proportions and a change of
  zoom is one number rather than a recalculation of everything on it.
-->
<div
  class="editor"
  class:paged
  class:flowing={documentView === "continuous"}
  class:paper={paperLight}
  class:justified
  style:--yaz-page-width="{page.width}mm"
  style:--yaz-page-height="{page.height}mm"
  style:--yaz-zoom={zoom / 100}
  bind:this={host}
></div>

<!--
  Drawn over the document rather than into it: the buffer holds the source and
  nothing else (ADR-0004), so a control that follows the selection is a sibling
  of the editor and not a decoration inside it.
-->
{#if barShown}
  <FormatBar
    bind:element={barBox}
    applied={barApplied}
    left={barLeft}
    top={barTop}
    oninline={(command: InlineFormat) => {
      // The cell first: a selection inside a drawn table is a DOM selection,
      // and the buffer path has nothing to act on there.
      if (formatInCell(command)) return;
      applyFormat((text, from, to) => toggleInline(text, from, to, command));
    }}
    onfamily={(family: FontFamily | null) =>
      applyFormat((text, from, to) => setFamily(text, from, to, family))}
    onsize={(size: FontSize | null) =>
      applyFormat((text, from, to) => setSize(text, from, to, size))}
    oncolour={(colour: TextColour | null) =>
      applyFormat((text, from, to) => setColour(text, from, to, colour))}
    onclear={() => applyFormat(clearFormatting)}
  />
{/if}

<style>
  .editor {
    block-size: 100%;
    inline-size: 100%;
    overflow: hidden;
    /* The formatting bar is placed in this box's coordinates. */
    position: relative;
    /* What a page leaves around its text, and what the band undoes to reach
       the paper's edge. */
    --yaz-page-margin: 25mm;
  }

  /* Zoom applies whether or not the page is showing: someone reading a long
     document wants larger text on a full-width pane too. */
  .editor :global(.cm-content) {
    font-size: calc(var(--yaz-font-size-base) * var(--yaz-zoom, 1));
  }

  /* Justified, which is what LaTeX does unless the document says otherwise.
     `text-wrap: pretty` keeps the last line of a paragraph from being a single
     short word, which is the one thing hyphenless justification gets worst. */
  .editor.justified :global(.cm-content) {
    text-align: justify;
    text-wrap: pretty;
    hyphens: auto;
  }

  /* White paper under a dark interface.

     The tokens are overridden rather than the colours set directly, so
     everything drawn inside the page — headings, rules, the bands, a rendered
     table — follows without each of them needing to know about this switch
     (ADR-0010). */
  .editor.paper :global(.cm-editor) {
    --yaz-editor-bg: #ffffff;
    --yaz-editor-text: #1a1a1a;
    --yaz-bg-primary: #ffffff;
    --yaz-bg-secondary: #f4f4f5;
    --yaz-bg-tertiary: #e9e9ec;
    --yaz-bg-hover: #e4e4e7;
    --yaz-text-primary: #1a1a1a;
    --yaz-text-secondary: #3f3f46;
    --yaz-text-muted: #71717a;
    --yaz-border: #d4d4d8;
    --yaz-editor-active-line: #f4f4f5;
    --yaz-editor-gutter-bg: #fafafa;
    --yaz-editor-gutter-text: #a1a1aa;
  }

  /* The continuous view: a column of a sensible measure, centred in the pane.

     The measure is in `em`, and the content box's font size is already scaled
     by the zoom — so the column grows and shrinks with the text and the number
     of characters across it stays the same, which is the thing that actually
     makes a measure comfortable to read.

     No paper, no page breaks and no paper size, which is why this is offered
     for every text format while the page view is not. */
  .editor.flowing {
    overflow: hidden;
    --yaz-measure: calc(52rem * var(--yaz-zoom, 1));
  }

  /* The column is the scroller's *padding*, not its width.

     Three attempts live in this rule. Setting a `max-width` on the content box
     does not work: with wrapping off CodeMirror puts a `min-width` on it equal
     to the longest line so that line can be scrolled to, and `min-width` beats
     `max-width` — so the column quietly grew to the longest line, which is the
     one thing a measure must not do. Narrowing the scroller instead does hold
     the measure, but the scrollbar belongs to the scroller, so it came inboard
     and sat against the text rather than at the edge of the pane.

     Padding a full-width scroller gets both: the bar stays at the pane's right
     edge where a scrollbar belongs, and the text is inset to the measure. The
     `max()` is what stops the padding going negative in a pane narrower than
     the column. */
  .editor.flowing :global(.cm-scroller) {
    padding-inline: max(
      var(--yaz-space-4),
      calc((100% - var(--yaz-measure)) / 2)
    );
  }

  .editor.flowing :global(.cm-content) {
    box-sizing: border-box;
    padding-block: var(--yaz-space-6);
  }

  .editor.flowing :global(.cm-gutters) {
    background: transparent;
    border: none;
  }

  /* A long line with wrapping off runs past the column and is reached by
     scrolling sideways — but without a bar under the text.

     A horizontal bar across a reading column is a piece of interface sitting
     in the middle of the page, and it would be there permanently for the sake
     of the one line in the document that is too long. The scrolling still
     works: a tilt wheel, a trackpad swipe and Shift with the wheel all reach
     it, because the element is still an overflowing one — it just does not
     draw the bar. The vertical bar is left alone, since that one is how you
     know where you are in the document. */
  .editor.flowing :global(.cm-scroller::-webkit-scrollbar:horizontal) {
    block-size: 0;
    display: none;
  }

  /* The page. A sheet of the declared size, centred on the surround, with the
     text inside it — the editor still owns the scrolling, so a long document
     scrolls as one continuous sheet rather than paginating. Pagination is
     LaTeX's answer and arrives with the PDF; guessing at it here would put two
     different page breaks in front of the same author. */
  .editor.paged {
    background: var(--yaz-pdf-bg);
    overflow: auto;
  }

  .editor.paged :global(.cm-editor) {
    background: transparent;
  }

  .editor.paged :global(.cm-scroller) {
    justify-content: center;
  }

  /* The content box *is* the stack of paper.

     The sheets are painted on it as a repeating gradient rather than drawn per
     line, which is the whole of the current design: a gradient is the page
     size and the gap and knows nothing about the content, so no arrangement of
     text can make one sheet taller than another. What the text does instead is
     get pushed past each boundary by a gap of exactly the right height
     (`pagination.ts`).

     The horizontal margins are padding here, once, rather than on every line —
     lines, widgets and gaps all sit inside them without each having to know. */
  .editor.paged :global(.cm-content) {
    inline-size: calc(var(--yaz-page-width) * var(--yaz-zoom, 1));
    max-inline-size: calc(var(--yaz-page-width) * var(--yaz-zoom, 1));
    box-sizing: border-box;
    padding-inline: var(--yaz-page-margin);
    padding-block: 0;
    margin-block: var(--yaz-space-4);
    background-color: transparent;
  }

  .editor.paged :global(.cm-gutters) {
    background: transparent;
    border: none;
  }

  /* The front and back matter, as a band the width of the paper.

     On paper this material is not part of the document at all — it is what
     produces the document — so in the view that shows the paper it is drawn
     as a strip across it rather than as text set in the measure. One row when
     it is closed, a band of rows when it is opened. */
  /* Nothing on the page needs its own paper any more: the paper is painted
     once, on the content box. A child that drew its own would be a second
     opinion about where a sheet is. */

  /* Turned: as wide as the paper is tall, which is the point of turning it —
     a table that did not fit across the measure fits across this one. */
  .editor.paged :global(.cm-content > .cm-yaz-sheet-turned),
  .editor.paged :global(.cm-content > .cm-yaz-page-fill-turned) {
    inline-size: calc(var(--yaz-page-height) * var(--yaz-zoom, 1));
  }

  /* The band across the front and back matter.

     No negative margin: the sheet's own padding box already spans the paper,
     so a background on it reaches the edges without being pulled outwards —
     and pulling it outwards is what stopped the marks being centred. */
  .editor.paged :global(.cm-yaz-boundary),
  .editor.paged :global(.cm-yaz-matter) {
    background: var(--yaz-bg-tertiary);
  }

  .editor.paged :global(.cm-yaz-boundary) {
    /* Full strength here: on the page it is a band and not an ornament
       floating in the margin, so half-hiding it would read as a mistake. */
    opacity: 1;
  }
</style>
