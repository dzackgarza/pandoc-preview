<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { resolveResource } from "@tauri-apps/api/path";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { ask, open, save as saveDialog } from "@tauri-apps/plugin-dialog";

  import * as api from "./lib/api";
  import type {
    Config,
    FileNode,
    Fingerprint,
    FoldState,
    PluginInfo,
    PluginResult,
    RenderStatus,
    RepoState,
  } from "./lib/types";
  import { CONFLICT_PREFIX } from "./lib/types";
  import type { OutlineItem } from "codemirror-lang-latex";
  import { divFenceSnippet } from "codemirror-lang-latex/dist/pandoc-markdown";
  import { toastError, toastInfo, toastSuccess } from "./lib/toast.svelte";
  import { createSplitLayout, type SplitLayout } from "./lib/dockview";
  import { portal } from "./lib/portal";

  import EditorPane from "./lib/components/EditorPane.svelte";
  import ActivityBar from "./lib/components/ActivityBar.svelte";
  import FileTree from "./lib/components/FileTree.svelte";
  import PreviewPane from "./lib/components/PreviewPane.svelte";
  import PromptModal from "./lib/components/PromptModal.svelte";
  import SettingsModal from "./lib/components/SettingsModal.svelte";
  import StatusBar from "./lib/components/StatusBar.svelte";
  import Toasts from "./lib/components/Toasts.svelte";
  import InsertionBar from "./lib/components/InsertionBar.svelte";
  import DimensionModal from "./lib/components/DimensionModal.svelte";
  import FootnoteModal from "./lib/components/FootnoteModal.svelte";
  import OutlinePanel from "./lib/components/OutlinePanel.svelte";
  import ReferencesPanel from "./lib/components/ReferencesPanel.svelte";
  import CommandPaletteModal from "./lib/components/CommandPaletteModal.svelte";
  import { parseCompileLog, type LogEntry } from "./lib/editor/complog";
  import {
    parseTikzFigureLog,
    type TikzFigureLogEntry,
  } from "./lib/editor/tikzfigurelog";
  import {
    buildLabelIndex,
    type ProjectFile,
  } from "./lib/editor/labels";
  import {
    frontmatterBibliography,
    parseBibliography,
  } from "./lib/editor/citations";

  let config = $state<Config | null>(null);
  let configPath = $state("");
  // Discovered plugins (manifest identities) for the category-aware menu/
  // command-palette populator: an export-category plugin surfaces an
  // "Export: <name> (.<extension>)" entry sourced from the discovered manifest,
  // never an app-core config table (P66).
  let discoveredPlugins = $state<PluginInfo[]>([]);

  let projectRoot = $state<string | null>(null);
  let tree = $state<FileNode[]>([]);
  let currentFile = $state<string | null>(null);
  // Alternative-explorer trees, rooted at the configured directories. They are
  // fixed roots (config.directories), so they have no "Open Folder" affordance.
  let stylesTree = $state<FileNode[]>([]);
  let figuresTree = $state<FileNode[]>([]);
  let dirty = $state(false);
  // Fingerprint of the open file's on-disk state at open / last save (P48).
  // The guarded save compares it against the current on-disk fingerprint to
  // refuse clobbering a file modified underneath the editor. Null when no file
  // with a captured fingerprint is open.
  let currentFingerprint = $state<Fingerprint | null>(null);
  // Save-gate (P47): the number of times a path-consuming action has requested
  // resolution of a durable destination for an identity-less buffer. An
  // already-durable buffer never increments this — the gate is a no-op
  // pass-through. Exposed to the E2E harness so the no-prompt clause is provable.
  let resolveCountState = $state(0);
  // Repo-state machine (P46): the REAL git state of the open file, read from the
  // backend (libgit2) and refreshed on open/save and after init/track. The
  // indicator NEVER reflects an optimistic guess — every action re-queries disk.
  let repoState = $state<RepoState | null>(null);

  // Session-restore offer (P49). On launch, if the restored session's recovery
  // store holds a buffer AHEAD of the reopened on-disk file, this holds the
  // pending offer { file, sessionId } plus the newer buffer bytes to load on
  // accept; null when there is no newer content to offer. Sourced only from
  // host-fs state read on launch, never from a UI guess.
  let pendingRestore = $state<{ file: string; sessionId: string; buffer: string } | null>(null);

  // Re-read the open file's real git state from disk. Null when no file is open.
  async function refreshRepoState() {
    if (!currentFile) {
      repoState = null;
      return;
    }
    try {
      repoState = await api.repoStateFor(currentFile);
    } catch (e) {
      toastError(String(e));
    }
  }

  // Initialize a real repository in the open project directory, then re-query.
  async function repoInit() {
    if (!projectRoot) return;
    try {
      await api.repoInit(projectRoot);
      await refreshRepoState();
    } catch (e) {
      toastError(String(e));
    }
  }

  // Stage the open file into the index, then re-query the real state.
  async function repoTrack() {
    if (!currentFile) return;
    try {
      await api.repoTrack(currentFile);
      await refreshRepoState();
    } catch (e) {
      toastError(String(e));
    }
  }

  // VSCode-style activity bar + collapsible side bar. `activeView` is the active
  // view id, or null when the side bar is collapsed. The always-visible activity
  // bar and the View > Toggle Sidebar menu / F9 both drive it. Add a
  // SIDEBAR_VIEWS entry to add a tab.
  type SidebarView = { id: string; title: string; icon: string };
  const EXPLORER_ICON =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5"><path d="M2.5 3.5h4l1.5 1.5h5.5v8h-11z"/></svg>';
  // Macros (styles) pane: a backslash command glyph. Figures pane: an image glyph.
  const MACROS_ICON =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5"><path d="M5 3 3 13"/><path d="M9 3l3 5-3 5"/></svg>';
  const FIGURES_ICON =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5"><rect x="2.5" y="3.5" width="11" height="9" rx="1"/><circle cx="6" cy="6.5" r="1"/><path d="m3.5 11 3-3 2.5 2.5L11 8.5l1.5 1.5"/></svg>';
  // References pane: an open-book glyph.
  const REFERENCES_ICON =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5"><path d="M8 4v9"/><path d="M8 4C6.5 3 4 3 2.5 3.5v8C4 11 6.5 11 8 12"/><path d="M8 4c1.5-1 4-1 5.5-.5v8C12 11 9.5 11 8 12"/></svg>';
  const SIDEBAR_VIEWS: SidebarView[] = [
    { id: "explorer", title: "Explorer", icon: EXPLORER_ICON },
    { id: "macros", title: "Macros", icon: MACROS_ICON },
    { id: "figures", title: "Figures", icon: FIGURES_ICON },
    { id: "references", title: "References", icon: REFERENCES_ICON },
  ];
  let activeView = $state<string | null>("explorer");

  function selectView(id: string) {
    // Clicking the active view's control collapses the side bar (VSCode); any
    // other view opens/switches to it.
    activeView = activeView === id ? null : id;
  }
  let settingsOpen = $state(false);
  let commandPaletteOpen = $state(false);
  // Insertion-bar modal-backed controls. Each flag is raised by the matching bar
  // button (matrix/table/footnote) and lowered on confirm/cancel. The confirm
  // routes into the SAME insertMatrix/insertTable/insertFootnote handlers the
  // P57/P58/P61 hooks call — the modal is just the user-facing affordance.
  let matrixModalOpen = $state(false);
  let tableModalOpen = $state(false);
  let footnoteModalOpen = $state(false);
  // Document outline (headings + fenced divs) for the sidebar's Outline panel,
  // a resizable/collapsible section below the file tree.
  let outline = $state<OutlineItem[]>([]);
  let outlineCollapsed = $state(false);
  let outlineHeight = $state(220);
  // Per-file collapsed fold ranges, loaded on mount and persisted on file switch.
  let foldState = $state<FoldState>({});
  let prompt = $state<{
    title: string;
    initial: string;
    action: (value: string) => Promise<void>;
  } | null>(null);

  // Close-guard pending state (P50). True iff a close request hit a dirty buffer
  // and is waiting on the user to resolve (Save / Discard / Cancel). While true
  // the window close is blocked — the app stays alive over the unsaved work.
  // Cleared when the user resolves the prompt. The recovery backstop (F1/P45)
  // independently already holds the dirty bytes, so even a forced quit that never
  // honors this prompt loses nothing.
  let pendingClose = $state(false);

  let html = $state("");
  let log = $state("");
  // Structured post-compile log entries (A.6 / P74). A pure parse of the SAME
  // raw `log` the Compile Log pane shows, through complog.ts (the ported pplatex
  // parse contract). Derived from `log` so the structured list and the raw text
  // always reflect the same render; the raw `log` source is unchanged so the P11
  // raw-log surface stays untouched. The Compile Log pane renders these as a
  // clickable list ALONGSIDE the raw text; clicking jumps the editor to the line.
  const logEntries = $derived<LogEntry[]>(parseCompileLog(log));
  // The buffer content the active `log` was produced from. Captured at render
  // time so the figure-compile log entries (D-6 / P95) can map each diagnostic's
  // verbatim figure source line back to its EDITOR-BUFFER line by matching that
  // exact line in this content — the buffer the failed figure compile saw.
  let renderedContent = $state("");
  // Figure-compile log entries (D-6 / P95): a pure parse of the SAME raw `log`
  // for the tikz FIGURE-compile diagnostics tikzcd.lua emits on a failed
  // tikz→SVG compile, mapped to the editor-buffer source line via tikzfigurelog.ts.
  // DISTINCT from `logEntries` (the P11/P74 pandoc-render log): this is the third
  // surface, the figure-compile log, rendered in its own TikZ Log tab. Derived
  // from `log` + `renderedContent` so it always reflects the same render.
  const tikzFigureLogEntries = $derived<TikzFigureLogEntry[]>(
    parseTikzFigureLog(log, renderedContent),
  );
  let status = $state<RenderStatus>("idle");
  // Ordered record of every render-status transition (drives the preview
  // indicator). Exposed to the E2E harness so the stale -> rendering -> ok
  // sequence can be asserted deterministically rather than by racing transients.
  let statusHistory = $state<RenderStatus[]>([]);
  function setStatus(s: RenderStatus) {
    status = s;
    statusHistory.push(s);
  }

  // Asset-protocol URL of the bundled, version-pinned MathJax (decision A,
  // mathjax-offline-local-source-decision.md). The preview's MathJax loads from
  // this LOCAL asset — never a CDN — so math typesets with no network. Resolved
  // once on mount from the app resource dir; convertFileSrc turns the absolute
  // path into the asset-protocol URL the webview can load.
  let mathjaxUrl = $state("");
  let activeTab = $state<"preview" | "log" | "tikzlog">("preview");

  let wordCount = $state(0);
  let cursorLine = $state(1);
  let cursorCol = $state(1);

  // bind:this reference to the editor component, used only imperatively
  // (getContent/setContent/commands in handlers). Svelte 5 requires bind:this
  // targets to be $state; it is assigned once on mount and never reactively read.
  let editor = $state<EditorPane>()!;

  // The config-owned snippet dictionary's triggers, surfaced by the insertion
  // bar's snippet dropdown (P59). Populated once EditorPane parses the dict.
  let snippetTriggers = $state<string[]>([]);

  // The config-owned vendored QTikz tikz-command DB's command names, surfaced by
  // the insertion bar's tikz palette (P94). Populated once EditorPane parses the
  // DB; the SAME list the CM6 completion source is built from.
  let tikzCommandNames = $state<string[]>([]);

  // dockview split layout (editor | preview). Built on mount once the
  // container element exists; the sidebar is a sibling OUTSIDE this splitview.
  let splitContainer = $state<HTMLDivElement | undefined>(undefined);
  let split = $state<SplitLayout | undefined>(undefined);
  let editorPaneEl = $state<HTMLElement | null>(null);
  let previewPaneEl = $state<HTMLElement | null>(null);

  const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

  onMount(async () => {
    // The startup gate (the Rust doctor battery) has already proven the config
    // exists, parses, and is valid before this window was created, so these
    // calls cannot fail for config reasons. There is no in-app config-error
    // screen: a misconfigured environment never reaches the webview.
    configPath = await api.getConfigPath();
    config = await api.getConfig();
    // Discovered plugins drive the category-aware menu/command-palette populator
    // (export-category plugins surface their own "Export: <name>" entries; P66).
    discoveredPlugins = await api.listPlugins();
    // Load the fixed-root explorer trees (macros/figures) now that config — and
    // thus directories.styles / directories.figures — is known.
    await refreshAuxTrees();
    // Resolve the bundled local MathJax to its asset-protocol URL (decision A).
    // resolveResource gives the absolute path under the app resource dir;
    // convertFileSrc turns it into the asset-protocol URL the srcdoc preview
    // loads its MathJax <script> from — local, never a CDN.
    mathjaxUrl = convertFileSrc(await resolveResource("resources/mathjax/tex-full-svg-a11y.min.js"));
    await listen<string>("menu", (event) => handleMenu(event.payload));

    // P50 close guard: intercept the native window close. A dirty buffer blocks
    // the close (preventDefault) and raises the resolution prompt via the SAME
    // requestClose path the E2E hook drives; a clean buffer is left to close
    // normally. The user clicking the window's close button hits exactly this.
    await getCurrentWindow().onCloseRequested((event) => {
      if (dirty) {
        event.preventDefault();
        requestClose();
      } else {
        clearTimeout(recoveryTimer);
      }
    });

    // E2E proof harness. Present only when the proof orchestrator sets
    // VITE_PPE_E2E (scripts/proof-run.sh) — never in a user build. It exposes
    // the app's real internal functions so Playwright can reach project-open
    // and export, whose only user affordance is the native file dialog the
    // webview cannot drive. Every exposed function is the same code path the
    // menu/dialog callbacks invoke; it adds no new behaviour, only an entry
    // point that bypasses the OS dialog.
    if (import.meta.env.VITE_PPE_E2E) {
      // Fire-and-forget triggers: the bridge's eval expects a synchronous
      // return value, so these kick off the real async work and return void
      // immediately. Specs await the resulting observable state (sidebar,
      // currentFile, on-disk artifact) via waitForFunction/disk polling.
      (window as unknown as { __PPE_E2E__: unknown }).__PPE_E2E__ = {
        openProject: (dir: string) => {
          void openProject(dir);
        },
        // P47 export-gate surface. exportViaPluginById runs the REAL plugin
        // export (the pandoc-html-export / pandoc-pdf-export category) BY ID
        // through runPluginToPath, which funnels through the SAME
        // requireDurablePath() gate every path-consuming action uses. On an
        // identity-less buffer the gate resolves nothing, runPluginToPath throws,
        // and the marker reports "gated" — the plugin export did NOT run (no
        // artifact, no "done"). __PPE_PLUGIN_EXPORT__ is the plugin-export state
        // marker the spec reads (sibling of __PPE_EXPORT__ for the old path).
        exportViaPluginById: (pluginId: string, target: string) => {
          (window as unknown as { __PPE_PLUGIN_EXPORT__: unknown }).__PPE_PLUGIN_EXPORT__ =
            "pending";
          runPluginToPath(pluginId, target).then(
            () => {
              (window as unknown as { __PPE_PLUGIN_EXPORT__: unknown }).__PPE_PLUGIN_EXPORT__ =
                "done";
            },
            (e: unknown) => {
              // runPluginToPath rejects ONLY when requireDurablePath() resolved
              // nothing (identity-less buffer) — the gate aborted before any
              // api.runPlugin call, so the downstream command never ran. Any other
              // rejection here is unexpected and surfaced verbatim (fail loud).
              const msg = String(e);
              (window as unknown as { __PPE_PLUGIN_EXPORT__: unknown }).__PPE_PLUGIN_EXPORT__ =
                msg.includes("No durable destination resolved")
                  ? "gated"
                  : "error: " + msg;
            },
          );
        },
        runPlugin: (pluginId: string, target: string) => {
          (window as unknown as { __PPE_PLUGIN_RESULT__: unknown }).__PPE_PLUGIN_RESULT__ = null;
          runPluginToPath(pluginId, target).then(
            (res: PluginResult) => {
              (window as unknown as { __PPE_PLUGIN_RESULT__: unknown }).__PPE_PLUGIN_RESULT__ = res;
            },
            (e: unknown) => {
              (window as unknown as { __PPE_PLUGIN_RESULT__: unknown }).__PPE_PLUGIN_RESULT__ = {
                success: false,
                artifact: null,
                exit_code: null,
                stdout: "",
                stderr: "error: " + String(e),
              } satisfies PluginResult;
            },
          );
        },
        configurePlugin: (pluginId: string) => {
          void api.configurePlugin(pluginId);
        },
        getEditorText: () => editor.getContent(),
        appendAtEnd: (text: string) => {
          editor.appendAtEnd(text);
        },
        // P73: replace the WHOLE buffer through the real CM update pipeline (a
        // full-doc replace fires the docChanged path the same way typing does),
        // so the lint source re-runs on the new buffer — used by the suppression
        // spec to remove an in-document directive and prove the diagnostic
        // restores. Fire-and-forget, same shape as appendAtEnd.
        setEditorText: (text: string) => {
          editor.setContent(text);
        },
        // P51: register a sentinel app completion source that COMPOSES with the
        // LaTeX source, then drive completion by inserting text at the cursor.
        registerTestCompletionSource: () => {
          editor.registerTestCompletionSource();
        },
        typeInEditor: (text: string) => {
          editor.typeInEditor(text);
        },
        // P78/P79: the REAL editor input driver — feed text per-keystroke
        // through view.dispatch, each character annotated userEvent "input.type"
        // exactly as a genuine keypress is. It does NOT itself fire the snippet
        // expansion. The expansion fires because the editor's production on-type
        // observer (the updateListener registered in EditorPane onMount) sees each
        // user-input transaction — the terminating space in particular — and
        // schedules tryOnTypeExpansion on a microtask (findAutoExpansion /
        // findRegexExpansion + runSnippet). UNLIKE typeInEditor, no
        // startCompletion — an autotrigger / regex trigger fires WITHOUT a popup.
        insertChars: (text: string) => {
          editor.insertChars(text);
        },
        // P52: accept the highlighted completion through CM6's real
        // acceptCompletion command, and read the cursor offset to prove the
        // snippet's tabstop landing after expansion.
        acceptCompletion: () => {
          editor.acceptCompletion();
        },
        // P80: type into the ACTIVE snippet field (the live `${N}` tabstop) after
        // a snippet expands, through the SAME docChanged pipeline real typing
        // fires. UNLIKE typeInEditor, no startCompletion — typing into a field is
        // plain editing, and CM6 mirrors the text into every repeated `${N}`.
        typeIntoSnippetField: (text: string) => {
          editor.typeIntoSnippetField(text);
        },
        // P53: fire Emmet's expandAbbreviation command against the live view,
        // the same command the Ctrl-e keybinding fires (fire-and-forget).
        expandEmmet: () => {
          editor.expandEmmet();
        },
        // P55: insert a named amsthm environment's fenced-div scaffold at the
        // cursor through the SAME insertEnvironment handler the insertion bar's
        // controls invoke (divFenceSnippet(env) → editor.insertSnippet →
        // snippetCompletion). Fire-and-forget; the `$0` tabstop lands the cursor
        // in the environment body.
        insertEnvironment: (env: string) => {
          insertEnvironment(env);
        },
        // P56: insert a diagram KIND's scaffold at the cursor through the SAME
        // insertDiagram handler the insertion bar's diagram controls invoke
        // (diagramScaffolds[kind] → editor.insertSnippet → snippetCompletion).
        // Fire-and-forget; the `${}` tabstop lands the cursor in the diagram body.
        insertDiagram: (kind: "tikz" | "tikzcd") => {
          insertDiagram(kind);
        },
        // P57: insert a rows × cols pmatrix at the cursor through the SAME
        // insertMatrix handler the insertion bar's matrix builder invokes
        // (buildMatrixSnippet(rows, cols) → editor.insertSnippet →
        // snippetCompletion). Fire-and-forget; the `${}` tabstop lands the cursor
        // in the matrix body.
        insertMatrix: (rows: number, cols: number) => {
          insertMatrix(rows, cols);
        },
        // P58: insert a cols × rows pandoc pipe table at the cursor through the
        // SAME insertTable handler the insertion bar's table builder invokes
        // (buildTableSnippet(cols, rows) → editor.insertSnippet →
        // snippetCompletion). Fire-and-forget; the `${}` tabstop lands the cursor
        // in the table body.
        insertTable: (cols: number, rows: number) => {
          insertTable(cols, rows);
        },
        // P60: the bar's code-block-type dropdown. insertCodeBlockLang inserts a
        // fenced code block whose opening fence carries the chosen language tag
        // (```<lang>) and a matching closing fence, through the SAME
        // editor.insertCodeBlock path the bar dropdown invokes (→ insertSnippet →
        // runSnippet → snippetCompletion), so the `${}` tabstop lands the cursor
        // strictly inside the block body. Fire-and-forget.
        insertCodeBlockLang: (lang: string) => {
          insertCodeBlock(lang);
        },
        // P61: the bar's footnote modal. insertFootnote performs the SAME action
        // the modal performs on CONFIRM with `body` typed in: it inserts a COMPLETE
        // footnote — a reference marker `[^id]` at the cursor AND a matching
        // `[^id]: <body>` definition line at the end of the buffer, the two sharing
        // one generated id, with `body` inserted byte-for-byte — through the SAME
        // editor.insertFootnote path the modal invokes. Fire-and-forget.
        insertFootnote: (body: string) => {
          insertFootnote(body);
        },
        // P62: seed a KNOWN width×height image onto the REAL system clipboard
        // (the SAME clipboard a user's screenshot/copy lands on) in ONE IPC via
        // the Rust seed_clipboard_image command — a solid RGBA fill of EXACTLY the
        // requested dimensions, the deterministic witness size the paste-image
        // action later reads back and persists. Fire-and-forget: the seed's async
        // work outlives this call, so park the in-flight promise on a window global
        // and the paste action awaits __PPE_SEED__ so it reads the clipboard only
        // after the image is written (the two hooks fire in separate evaluate
        // round-trips).
        seedClipboardImage: (width: number, height: number) => {
          (window as unknown as { __PPE_SEED__: unknown }).__PPE_SEED__ =
            api.seedClipboardImage(width, height);
        },
        // P62: the insertion bar's paste-image action. pasteImage reads the
        // clipboard image, writes it as a real file into the CONFIGURED global
        // figures directory through the SAME api.pasteClipboardImage backend the
        // bar's paste-image control invokes, then inserts a markdown image
        // reference `![](<path>)` at the cursor pointing at that exact file.
        // Fire-and-forget; the spec awaits the on-disk file + the reference.
        pasteClipboardImage: () => {
          void pasteImage();
        },
        // P59: the bar's snippet dropdown. snippetTriggers returns the triggers
        // the dropdown surfaces — the keys of the RETAINED config-owned snippet
        // dictionary (the SAME map P52's popup completion source is built from),
        // so a different config dict surfaces a different set. insertSnippetByTrigger
        // is the choose-a-trigger action: it expands that entry's BODY at the cursor
        // through the SAME editor.insertSnippet path the env/diagram/matrix/table
        // controls use (→ runSnippet → snippetCompletion), honouring the `$0`
        // tabstop. Fire-and-forget.
        snippetTriggers: () => editor.snippetTriggers(),
        insertSnippetByTrigger: (trigger: string) => {
          editor.insertSnippetByTrigger(trigger);
        },
        // P94: the bar's tikz-command palette. tikzCommandNames returns the names
        // the palette surfaces — the names of the RETAINED config-owned vendored
        // QTikz tikz-command DB (the SAME list P94's popup completion source is
        // built from), so a different config DB surfaces a different set.
        // insertTikzCommandByName is the choose-a-command action: it inserts that
        // command's BODY at the cursor through the SAME editor.insertSnippet path
        // the env/diagram/matrix/table/snippet controls use (→ runSnippet →
        // snippetCompletion), with the cursor landing at the declared dx/dy offset
        // (the injected ${0} tabstop). reloadTikzCommands re-reads the configured
        // DB from disk and re-seeds both surfaces — the data-driven leg.
        // Fire-and-forget.
        tikzCommandNames: () => editor.tikzCommandNames(),
        insertTikzCommandByName: (name: string) => {
          editor.insertTikzCommandByName(name);
        },
        reloadTikzCommands: () => {
          editor.reloadTikzCommands();
        },
        // P82: seed KNOWN text onto the REAL system clipboard through the SAME
        // clipboard-manager writeText backend (the sibling of seedClipboardImage),
        // so the snippet-variable resolution reads it back for $CLIPBOARD.
        // Fire-and-forget; the in-flight write is parked where the expansion's
        // clipboard read awaits it.
        seedClipboardText: (text: string) => {
          editor.seedClipboardText(text);
        },
        // P83: establish a REAL non-empty selection over the first occurrence of
        // `text` in the buffer (the SAME selection state a user's drag /
        // shift-select produces), so the subsequent `${VISUAL}` expansion has a
        // selection to wrap. Fire-and-forget; the observable is the wrapped text
        // after the visual-wrap expansion.
        seedSelection: (text: string) => {
          editor.seedSelection(text);
        },
        // P104 / D-8: copy a SELECTED subgraph of the buffer's owned tikz source
        // to the REAL system clipboard as deterministic CANONICAL tikz (the
        // TikzIt "copy a region of nodes" model). Parses the owned tikzpicture +
        // the live selection through the D-1 / P90 parser, forms the induced
        // subgraph (selected nodes + edges whose BOTH endpoints are selected),
        // serializes it with the SAME canonical Graph::to_tikz() P90 round-trips,
        // and writes that tikz onto the system clipboard via the clipboard-manager
        // write_text path. A selection not parseable as tikz is a LOUD error —
        // never a raw-text copy. Fire-and-forget; the decisive observable is the
        // system clipboard, read INDEPENDENTLY by readClipboardText.
        copySelectedSubgraphAsTikz: () => {
          editor.copySelectedSubgraphAsTikz();
        },
        // P104 / D-8: the INDEPENDENT system-clipboard read (the sibling of
        // P62's independent figures-dir listing). Reads the REAL clipboard text
        // through the clipboard-manager read-text path; does NOT trust the copy
        // action's own report of what it wrote.
        readClipboardText: () => editor.readClipboardText(),
        // P104 / D-8: re-parse `src` through the app's OWN tikz parser (the D-1 /
        // P90 parse_tikz backend) into { nodes, edges }. The clipboard text is fed
        // back through this to assert it re-parses STABLY to the selected
        // subgraph.
        parseTikz: (src: string) => editor.parseTikz_(src),
        cursorOffset: () => editor.cursorOffset(),
        // P70: the live @codemirror/lint diagnostics (forceLinting-flushed) and
        // their count, read from the SAME field the gutter renders.
        lintDiagnostics: () => editor.lintDiagnostics(),
        lintCount: () => editor.lintCount(),
        syntaxAncestryAt: (needle: string) => editor.syntaxAncestryAt(needle),
        getOutline: () => editor.getOutline(),
        goToLine: (line: number) => editor.goToLine(line),
        // A.6 / P74: the structured parse of the compile log the Compile Log pane
        // currently shows — the SAME `logEntries` the pane renders as a clickable
        // list (parseCompileLog over the real render `log`, the ported pplatex
        // parse). Each entry is {line, severity, message}; activating an entry in
        // the pane calls editor.goToLine(entry.line), the SAME jump this hook's
        // sibling goToLine drives.
        structuredLog: (): LogEntry[] => logEntries,
        // D-6 / P95: the structured parse of the FIGURE-compile diagnostics the
        // TikZ Log tab currently shows — the SAME tikzFigureLogEntries the tab
        // renders as a clickable list (parseTikzFigureLog over the real render
        // `log`, mapped to the editor-buffer source line). Each entry is
        // {line, message}; activating an entry calls editor.goToLine(entry.line),
        // the SAME jump the sibling goToLine drives.
        tikzFigureLog: (): TikzFigureLogEntry[] => tikzFigureLogEntries,
        activateTikzFigureLogEntry: (index: number) => {
          const entry = tikzFigureLogEntries[index];
          if (entry && entry.line > 0) editor.goToLine(entry.line);
        },
        foldAll: () => editor.foldAllFolds(),
        unfoldAll: () => editor.unfoldAllFolds(),
        getFoldedRanges: () => editor.getFoldedRanges(),
        cursorLine: () => cursorLine,
        currentFile: () => currentFile,
        // P49: the session-restore offer. pendingRestore returns a JSON-
        // serializable { file, sessionId } when launch found recovery content
        // ahead of disk, else null. acceptRestore loads those recovery bytes
        // into the live editor (fire-and-forget, like appendAtEnd).
        pendingRestore: () =>
          pendingRestore
            ? { file: pendingRestore.file, sessionId: pendingRestore.sessionId }
            : null,
        acceptRestore: () => {
          acceptRestore();
        },
        // P48: the explicit force-overwrite resolution (fire-and-forget, same
        // shape as appendAtEnd) and the live dirty flag (same notion p03 reads).
        forceSave: () => {
          void forceSave();
        },
        isDirty: () => dirty,
        // P50 close guard. requestClose runs the EXACT close-guard path the
        // window's onCloseRequested handler runs (fire-and-forget); on a dirty
        // buffer it blocks the close and raises the resolution prompt rather than
        // tearing the webview down. pendingCloseGuard reports whether that prompt
        // is currently unresolved.
        requestClose: () => {
          requestClose();
        },
        pendingCloseGuard: () => pendingClose,
        // P50 discard-resolution surface. resolveClose runs the EXACT same path
        // the close prompt's button runs (fire-and-forget). On 'discard' it
        // flushes the dirty buffer to the host-fs recovery store and then tears
        // the window down — the recovery backstop holds the final edit, so the
        // discard loses nothing.
        resolveClose: (choice: "save" | "discard" | "cancel") => {
          void resolveClose(choice);
        },
        // P47 save-gate surface. newUntitled enters an identity-less buffer (no
        // currentFile). resolveSavePath supplies the durable destination the
        // native dialog would yield, making the buffer durable through the SAME
        // makeDurable the gate uses. resolveCount proves an already-durable save
        // did not re-prompt.
        newUntitled: () => {
          newUntitled();
        },
        resolveSavePath: (path: string) => {
          void makeDurable(path);
        },
        resolveCount: () => resolveCountState,
        configFontSize: () => config?.editor.font_size ?? null,
        // P84/C1: the ONE config-declared bibliography the app cites against,
        // surfaced frontend-side (sibling of configFontSize). This is the same
        // config.editor.bibliography value the renderer layers onto pandoc as
        // --bibliography, so the file the frontend names is the file the preview
        // resolves citations from.
        configBibliography: () => config?.editor.bibliography ?? null,
        renderStatus: () => status,
        statusHistory: () => [...statusHistory],
      };
    }

    // Load any persisted per-file fold state so reopening a file restores folds.
    foldState = await api.readFoldState();

    // Build the editor|preview splitview now that the container is in the DOM.
    // The portal action mounts the editor/preview wrappers into the pane
    // elements; dockview owns the sash and proportional relayout.
    if (!splitContainer) {
      throw new Error("split container element not mounted");
    }
    split = createSplitLayout(splitContainer);
    editorPaneEl = split.editorPane;
    previewPaneEl = split.previewPane;

    // P49: reopen the last session's file from host-fs session state and, when
    // its recovery store is ahead of disk, surface a restore offer. Done last,
    // after the editor is mounted, so reopening can populate the live buffer.
    await restoreLastSession();
  });

  onDestroy(() => {
    clearTimeout(recoveryTimer); // stop the pending recovery autosave (F1 nit)
    split?.dispose();
  });

  $effect(() => {
    document.documentElement.classList.toggle("dark", config?.general.theme === "dark");
  });

  $effect(() => {
    const prefix = currentFile ? `${fileName(currentFile)}${dirty ? " •" : ""} — ` : "";
    getCurrentWindow().setTitle(`${prefix}Pandoc Preview`);
  });

  // ---- rendering ----------------------------------------------------------

  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let renderSeq = 0;

  function onEditorChange(content: string) {
    dirty = true;
    // The source just changed: the shown preview is now stale until the
    // debounced re-render completes.
    setStatus("stale");
    wordCount = content.split(/\s+/).filter(Boolean).length;
    outline = editor.getOutline();
    scheduleRender(content);
    // Independently of the preview render, capture the (unsaved) buffer to the
    // host-filesystem recovery store on its own short debounce (P45). This is
    // NOT tied to Save and NOT tied to the render debounce.
    scheduleRecovery(content);
  }

  // ---- recovery autosave (P45) --------------------------------------------
  //
  // A debounce timer SEPARATE from the preview render: a few seconds after the
  // buffer last changed, the live (possibly unsaved) buffer is committed to the
  // host-fs recovery store with no user action. Well under the recovery
  // contract's "several seconds" so an unsaved edit is never lost.
  const RECOVERY_DEBOUNCE_MS = 1500;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;

  // Fixed recovery session for the identity-less buffer (P47): a new untitled
  // document has no path, so it captures under this stable session id until it
  // is resolved to a durable destination.
  const UNTITLED_SESSION_ID = "untitled-buffer";
  const UNTITLED_LABEL = "untitled";

  // Stable per-document session id: the open file's path collapsed to a single
  // safe path component (the backend rejects separators / traversal). Distinct
  // documents get distinct recovery repos; reopening the same file reuses its
  // repo so its capture history is one append-only object database.
  function recoverySessionId(path: string): string {
    return path.replace(/[^A-Za-z0-9._-]/g, "_");
  }

  // Persist the active session (P49) so the next launch reopens this file and
  // can locate its recovery store. The recovery session id mirrors the one
  // scheduleRecovery captures under (recoverySessionId of the path), so launch
  // reads exactly the store this run's autosaves wrote. Only a durable file
  // (real path + known project) is a restorable session; an identity-less
  // buffer has no durable last-file to reopen.
  async function persistSession() {
    if (!currentFile || !projectRoot) return;
    await api.saveSessionState({
      project: projectRoot,
      file: currentFile,
      sessionId: recoverySessionId(currentFile),
    });
  }

  // The recovery (session, label) the current buffer captures under. An
  // identity-less buffer (P47) has no path yet but is still recovery-backed
  // (F1/P45): it captures under a fixed untitled session so an unsaved new
  // document is never lost. A durable buffer captures under its path session.
  // The single source of truth for both the debounced autosave and the
  // flush-on-close, so they always target the same store.
  function recoveryTarget(): { session: string; label: string } {
    return {
      session: currentFile ? recoverySessionId(currentFile) : UNTITLED_SESSION_ID,
      label: currentFile ?? UNTITLED_LABEL,
    };
  }

  function scheduleRecovery(content: string) {
    const { session, label } = recoveryTarget();
    clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => {
      void api
        .recoveryAutosave(session, label, content)
        .catch((e) => toastError(String(e)));
    }, RECOVERY_DEBOUNCE_MS);
  }

  // Flush the pending debounced recovery capture SYNCHRONOUSLY with respect to
  // the close: cancel the debounce timer and commit the live buffer to the
  // host-fs recovery store NOW, awaited. The close path runs this BEFORE tearing
  // the window down so a Discard (or any close) inside the recovery debounce
  // cannot drop the final edit — the bytes are on the host fs first. Unlike the
  // debounced timer (which fires later, after teardown would have cancelled it),
  // this is a blocking capture that the caller awaits.
  async function flushRecovery(): Promise<void> {
    clearTimeout(recoveryTimer); // the immediate capture supersedes the debounce
    if (!dirty) return; // nothing unsaved to capture
    // recoveryTarget() is the SoT for BOTH a titled buffer (its path session) and
    // an identity-less buffer (UNTITLED_SESSION_ID/UNTITLED_LABEL). The flush
    // therefore captures the live buffer regardless of file identity — an untitled
    // dirty buffer is exactly the work most at risk on close, so it must flush too.
    const { session, label } = recoveryTarget();
    await api.recoveryAutosave(session, label, editor.getContent());
  }

  // Drag the divider above the Outline panel to resize it (file tree takes the
  // rest). Listeners on window so the drag continues outside the handle.
  function startOutlineResize(e: MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = outlineHeight;
    const onMove = (ev: MouseEvent) => {
      outlineHeight = Math.max(80, Math.min(startH + (startY - ev.clientY), 560));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // Persist the current file's collapsed folds to fold-state.json. Called before
  // switching/closing a file and on save, so reopening restores the folds.
  async function persistCurrentFoldState() {
    if (!currentFile) return;
    foldState[currentFile] = editor.getFoldedRanges();
    await api.saveFoldState(foldState);
  }

  // The Ctrl-P command palette's operations, routed to the existing handlers.
  function paletteCommands(): { id: string; label: string; run: () => void }[] {
    const cmds = [
      { id: "fold_all", label: "Fold All", run: () => editor.foldAllFolds() },
      { id: "unfold_all", label: "Unfold All", run: () => editor.unfoldAllFolds() },
      { id: "save", label: "Save", run: () => void saveCurrent() },
      { id: "save_as", label: "Save As…", run: () => void saveAs() },
      { id: "find", label: "Find", run: () => void editor.command("find") },
      {
        id: "new_file",
        label: "New File",
        run: () =>
          projectRoot ? promptNewFile(projectRoot) : toastError("Open a folder first."),
      },
      { id: "open_folder", label: "Open Folder…", run: () => void openFolder() },
      {
        id: "toggle_sidebar",
        label: "Toggle Sidebar",
        run: () => (activeView = activeView ? null : "explorer"),
      },
      { id: "show_preview", label: "Show Preview", run: () => (activeTab = "preview") },
      { id: "show_log", label: "Show Log", run: () => (activeTab = "log") },
      { id: "settings", label: "Settings", run: () => (settingsOpen = true) },
    ];
    // Discovered export-category plugins (P66): one "Export: <name> (.<ext>)"
    // entry per plugin, name + extension sourced from the discovered manifest.
    // Export is entirely the pandoc plugin suite; the app core owns no export
    // command knowledge. The plugin runs through the generic firewall.
    for (const plugin of discoveredPlugins) {
      if (plugin.category !== "export" || plugin.extension === null) continue;
      cmds.push({
        id: `export-plugin:${plugin.id}`,
        label: `Export: ${plugin.name} (.${plugin.extension})`,
        run: () => void exportViaPlugin(plugin),
      });
    }
    return cmds;
  }

  function scheduleRender(content: string) {
    if (!config || !currentFile) return;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => void doRender(content), config.preview.debounce_ms);
  }

  async function doRender(content: string) {
    if (!currentFile) return;
    const seq = ++renderSeq;
    setStatus("rendering");
    const baseDir = dirOf(currentFile);
    try {
      const res = await api.renderPreview(
        content,
        baseDir,
        convertFileSrc(baseDir) + "/",
        mathjaxUrl,
      );
      if (seq !== renderSeq) return;
      log = res.log;
      // The buffer this log was produced from, so the figure-compile log entries
      // (D-6 / P95) map their source lines back to this exact buffer.
      renderedContent = content;
      if (res.ok) {
        html = res.html;
        setStatus("ok");
      } else {
        setStatus("error");
      }
    } catch (e) {
      if (seq !== renderSeq) return;
      setStatus("error");
      log = String(e);
      toastError(String(e));
    }
  }

  // ---- project / file operations ------------------------------------------

  // Refresh every explorer tree (project + the configured macros/figures roots),
  // so a file op in any of them is reflected regardless of which is active.
  async function refreshTree() {
    await refreshProjectTree();
    await refreshAuxTrees();
  }

  async function refreshProjectTree() {
    if (!projectRoot) return;
    try {
      tree = await api.listTree(projectRoot);
    } catch (e) {
      toastError(String(e));
    }
    await rebuildLabelIndex();
  }

  // P87/C3: build the project-wide cross-file label index (ported vimtex
  // project-root harvest) from the SAME listTree the explorer is rooted at, then
  // hand it to the editor. Read EVERY markdown file under the project root and
  // harvest its anchor definitions (pandoc {#id} heading attrs, :::{#id}
  // fenced-div ids, \label{}), so a label defined in file A is offered while
  // editing file B. Built here — on project-open / file-tree refresh — NOT per
  // keystroke, so completion latency never regresses on a large project. A read
  // failure on a project file is a HARD visible error (the harvest must span the
  // WHOLE project), never a silently-skipped file.
  async function rebuildLabelIndex() {
    const mdPaths = markdownFilesUnder(tree);
    const files: ProjectFile[] = [];
    for (const path of mdPaths) {
      const read = await api.readTextFile(path);
      files.push({ path, content: read.content });
    }
    editor.registerLabelSource(buildLabelIndex(files));
  }

  // P88/C4: resolve and register the @-citation source that governs the OPEN
  // document, re-resolved on every file open (the active bibliography depends on
  // the open file). pandoc's OWN native per-file model: a document whose YAML
  // frontmatter declares `bibliography:` is governed by that bibliography
  // (resolved RELATIVE TO THE DOCUMENT's directory, as pandoc resolves it),
  // overriding the global config bibliography while the document is open; a
  // document WITHOUT it is governed by the global config bibliography (no hole).
  // The override target is the SAME .bib format the C2 source parses, so it reuses
  // the SAME parser and re-selects the SAME citation source — no second parser, no
  // second engine. A frontmatter `bibliography:` pointing at a non-existent path is
  // a HARD visible error (toastError via the readTextFile failure), never a
  // silently-empty source.
  async function resolveCitationSource(path: string, content: string) {
    const declared = frontmatterBibliography(content);
    if (!declared) {
      // No per-file override: the global config bibliography governs this file.
      if (!config) return;
      const file = await api.readTextFile(config.editor.bibliography);
      editor.registerCitationSource(parseBibliography(file.content));
      return;
    }
    // Per-file override: pandoc resolves each declared path relative to the
    // document's directory. Read every declared .bib (a non-existent path fails
    // loud here) and parse the concatenation with the SAME C2 parser.
    const baseDir = dirOf(path);
    const texts: string[] = [];
    for (const rel of declared) {
      const abs = rel.startsWith("/") ? rel : `${baseDir}/${rel}`;
      const file = await api.readTextFile(abs);
      texts.push(file.content);
    }
    editor.registerCitationSource(parseBibliography(texts.join("\n")));
  }

  // Flatten the explorer tree to the absolute paths of every markdown file under
  // the project root (the files a label can be defined in). Recurses into every
  // directory node so the harvest spans the whole project, not the top level.
  function markdownFilesUnder(nodes: FileNode[]): string[] {
    const paths: string[] = [];
    for (const node of nodes) {
      if (node.is_dir) {
        if (node.children) paths.push(...markdownFilesUnder(node.children));
      } else if (node.path.endsWith(".md")) {
        paths.push(node.path);
      }
    }
    return paths;
  }

  // The macros (styles) and figures explorers point at fixed configured roots.
  async function refreshAuxTrees() {
    if (!config) return;
    try {
      stylesTree = await api.listTree(config.directories.styles);
    } catch (e) {
      toastError(String(e));
    }
    try {
      figuresTree = await api.listTree(config.directories.figures);
    } catch (e) {
      toastError(String(e));
    }
  }

  async function openProject(dir: string) {
    projectRoot = dir;
    currentFile = null;
    currentFingerprint = null;
    dirty = false;
    html = "";
    log = "";
    setStatus("idle");
    await refreshTree();
    toastInfo(`Opened ${dir}`);
  }

  async function openFolder() {
    const dir = await open({ directory: true, title: "Open Project Folder" });
    if (!dir) return;
    if (!(await resolveDirty())) return;
    await openProject(dir);
  }

  /** If the buffer is dirty, offer to save it. Returns false to abort. */
  async function resolveDirty(): Promise<boolean> {
    if (!dirty || !currentFile) return true;
    const wantsSave = await ask(
      `Save changes to ${fileName(currentFile)} before continuing?`,
      { title: "Unsaved changes", kind: "warning" },
    );
    if (wantsSave) await saveCurrent();
    return true;
  }

  // ---- close guard (P50) --------------------------------------------------
  //
  // The window's onCloseRequested handler and the E2E requestClose hook both run
  // THIS path. With a dirty buffer the close is BLOCKED and a resolution prompt
  // is raised (pendingClose) — the app stays alive over the unsaved work, never
  // tearing the webview down out from under it. A clean buffer closes the window
  // immediately. The recovery store (F1/P45) already holds the dirty bytes, so
  // the lose-nothing guarantee survives even a forced quit that never honors the
  // prompt.
  function requestClose(): void {
    if (dirty) {
      pendingClose = true; // raise the resolution prompt; block the close
      return;
    }
    void closeWindow();
  }

  // Actually tear the window down. The single real-close seam: reached only after
  // the guard has decided the buffer is clean or the user resolved the prompt.
  // FLUSH the pending recovery capture FIRST (awaited): the debounced autosave
  // timer is still pending whenever the close lands inside RECOVERY_DEBOUNCE_MS,
  // and destroying the window would cancel it (onDestroy clears the timer),
  // losing the final edit. Committing the live buffer to the host-fs recovery
  // store before destroy makes Discard (and every close) lose-nothing.
  async function closeWindow(): Promise<void> {
    await flushRecovery();
    void getCurrentWindow().destroy();
  }

  // Resolve a pending close prompt. "discard" closes despite the dirty buffer
  // (the recovery backstop already holds it, so nothing is lost). "cancel" keeps
  // the app open and the buffer intact. "save" persists then closes.
  async function resolveClose(choice: "save" | "discard" | "cancel"): Promise<void> {
    if (choice === "cancel") {
      pendingClose = false;
      return;
    }
    if (choice === "save") {
      await saveCurrent();
      if (dirty) {
        // The save did not clear dirty (e.g. a conflict refusal surfaced its
        // toast) — keep the prompt up rather than discarding the unsaved work.
        return;
      }
    }
    pendingClose = false;
    await closeWindow();
  }

  async function openFile(path: string) {
    if (path === currentFile) return;
    if (!(await resolveDirty())) return;
    await persistCurrentFoldState(); // save the outgoing file's folds first
    try {
      const { content, fingerprint } = await api.readTextFile(path);
      currentFile = path;
      currentFingerprint = fingerprint; // P48: baseline for conflict detection
      editor.setContent(content);
      editor.setFoldedRanges(foldState[path] ?? []); // restore this file's folds
      // P88/C4: re-resolve the @-citation source for THIS file — its frontmatter
      // `bibliography:` (if any) overrides the global config bibliography, else the
      // global config bibliography governs. A non-existent override path fails loud.
      await resolveCitationSource(path, content);
      outline = editor.getOutline();
      dirty = false;
      wordCount = content.split(/\s+/).filter(Boolean).length;
      void refreshRepoState();
      void doRender(content);
      void persistSession(); // P49: record this as the last active session
    } catch (e) {
      toastError(String(e));
    }
  }

  // ---- session restore (P49) ----------------------------------------------
  //
  // On launch, reopen the last session's file from host-fs session state, then
  // compare that session's recovery-store HEAD buffer against the reopened
  // on-disk content. When the recovery buffer is AHEAD of disk (the prior
  // session left unsaved edits), present a restore offer; accepting it loads
  // the recovery bytes into the live editor. The durable state read here lives
  // ONLY on the host fs (session.json + the recovery git repo), never browser
  // storage — the Anti-Sandbox Rule.
  async function restoreLastSession() {
    const session = await api.readSessionState();
    if (!session) return; // clean first run — nothing to restore
    // Reopen the last file through the SAME path a sidebar click uses, so the
    // editor buffer, fingerprint (P48), folds, repo state, and render are all
    // established exactly as a normal open.
    await openFile(session.file);
    if (currentFile !== session.file) return; // open failed (toast surfaced it)
    // The session's recovery store may hold a buffer the prior run captured
    // after the last save. Offer a restore only when it is AHEAD of disk —
    // i.e. differs from the just-reopened on-disk content.
    const recovered = await api.recoveryHeadBuffer(session.sessionId);
    if (recovered === null) return; // no recovery capture for this session
    if (recovered === editor.getContent()) return; // recovery == disk, nothing newer
    pendingRestore = {
      file: session.file,
      sessionId: session.sessionId,
      buffer: recovered,
    };
  }

  // Accept the pending restore: load the recovery buffer bytes into the live
  // editor (the newer, unsaved-edit content), marking the buffer dirty since it
  // now differs from disk. Clears the offer.
  function acceptRestore() {
    if (!pendingRestore) return;
    editor.setContent(pendingRestore.buffer);
    outline = editor.getOutline();
    dirty = true;
    if (currentFile) void doRender(pendingRestore.buffer);
    pendingRestore = null;
  }

  // ---- save-gate / identity-less buffer (P47) -----------------------------
  //
  // Enter an identity-less buffer: a fresh editable document with NO real file
  // path. Path-consuming actions (save-in-place, export, plugin-run) on such a
  // buffer must first resolve a durable destination through the gate below. The
  // buffer is still recovery-backed (F1/P45) via UNTITLED_SESSION_ID.
  function newUntitled() {
    currentFile = null;
    currentFingerprint = null;
    dirty = false;
    editor.setContent("");
    outline = editor.getOutline();
    wordCount = 0;
    html = "";
    log = "";
    setStatus("idle");
    repoState = null;
  }

  /** Make the identity-less buffer durable at `path`: write its bytes there,
   * adopt it as the live editable file, and capture its fingerprint (P48
   * baseline). The single point where an identity-less buffer becomes durable —
   * reached both by the gate (after a destination is resolved) and by the E2E
   * resolveSavePath hook that supplies the destination the native dialog would.
   */
  async function makeDurable(path: string): Promise<string> {
    currentFingerprint = await api.writeTextFile(path, editor.getContent());
    currentFile = path;
    dirty = false;
    await refreshTree();
    await refreshRepoState();
    void persistSession(); // P49: a newly durable buffer is now the last session
    return path;
  }

  /** Resolve the durable destination the native OS save dialog would return.
   * The ONLY seam that differs between production and the harness: production
   * drives the native dialog; the harness cannot drive it, so the destination is
   * supplied out-of-band via resolveSavePath (mirroring openProject/exportTo).
   * Returns null when no destination is available (cancel / undriveable). */
  async function promptForDestination(): Promise<string | null> {
    if (import.meta.env.VITE_PPE_E2E) {
      // The native dialog is undriveable in-harness; the destination arrives via
      // resolveSavePath, which makes the buffer durable directly. The gate thus
      // has no destination to offer here — the action aborts until resolved.
      return null;
    }
    return saveDialog({
      title: "Save As",
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });
  }

  /** Save-gate: every path-consuming action funnels through here first. An
   * already-durable buffer passes through with NO prompt (returns its path,
   * increments nothing). An identity-less buffer requests a real destination;
   * on resolution the buffer becomes durable and the resolved path is returned;
   * on cancel/undriveable it returns null and the caller must NOT run. */
  async function requireDurablePath(): Promise<string | null> {
    if (currentFile) return currentFile;
    resolveCountState += 1;
    const path = await promptForDestination();
    if (!path) return null;
    return makeDurable(path);
  }

  async function saveCurrent() {
    // P47: an identity-less buffer first resolves a durable destination; until
    // then Save does not run. requireDurablePath -> makeDurable already wrote the
    // buffer at the resolved path and adopted it, so Save is complete here.
    if (!currentFile) {
      await requireDurablePath();
      return;
    }
    // P48: a file opened/saved through this app always has a fingerprint. If it
    // is missing, the invariant is broken — fail loud rather than blind-write.
    if (!currentFingerprint) {
      throw new Error(`no fingerprint captured for open file ${currentFile}`);
    }
    try {
      // Guarded write: refused with a conflict error if the file changed on disk
      // since the captured fingerprint. On success, re-capture the post-write
      // fingerprint so the next save matches (keeps p03's second save clean).
      currentFingerprint = await api.writeTextFileChecked(
        currentFile,
        editor.getContent(),
        currentFingerprint,
      );
      dirty = false;
      await persistCurrentFoldState();
      await refreshRepoState();
      toastSuccess(`Saved ${fileName(currentFile)}`);
    } catch (e) {
      // A conflict refusal keeps the buffer DIRTY and surfaces the discriminating
      // "modified" text (P48 clauses (b)/(c)); the external content is left
      // intact (the backend did not write). A generic IO error surfaces too, but
      // distinctly — only the conflict path is the intended loud refusal.
      if (String(e).startsWith(CONFLICT_PREFIX)) {
        toastError(
          `${fileName(currentFile)} was modified externally — Save refused. Use Overwrite to force your version.`,
        );
      } else {
        toastError(String(e));
      }
    }
  }

  // P48 resolution: the user decides their buffer wins. Write unconditionally
  // (no fingerprint guard), re-capture the post-write fingerprint, and clear
  // dirty — the conflict gate is a real, escapable gate, not a dead end.
  async function forceSave() {
    if (!currentFile) return;
    try {
      currentFingerprint = await api.writeTextFile(currentFile, editor.getContent());
      dirty = false;
      await persistCurrentFoldState();
      await refreshRepoState();
      toastSuccess(`Saved ${fileName(currentFile)}`);
    } catch (e) {
      toastError(String(e));
    }
  }

  async function saveAs() {
    if (!currentFile) {
      toastError("No file open.");
      return;
    }
    const target = await saveDialog({
      title: "Save As",
      defaultPath: currentFile,
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });
    if (!target) return;
    try {
      // New target — nothing to conflict with; capture the fingerprint so a
      // later in-place Save of this file is guarded (P48).
      currentFingerprint = await api.writeTextFile(target, editor.getContent());
      currentFile = target;
      dirty = false;
      await refreshTree();
      toastSuccess(`Saved ${fileName(target)}`);
    } catch (e) {
      toastError(String(e));
    }
  }

  function promptNewFile(dir: string) {
    prompt = {
      title: `New file in ${fileName(dir) || dir}`,
      initial: "untitled.md",
      action: async (name) => {
        const path = `${dir}/${name}`;
        await api.createFile(path);
        await refreshTree();
        await openFile(path);
        toastSuccess(`Created ${name}`);
      },
    };
  }

  function promptNewFolder(dir: string) {
    prompt = {
      title: `New folder in ${fileName(dir) || dir}`,
      initial: "folder",
      action: async (name) => {
        await api.createDir(`${dir}/${name}`);
        await refreshTree();
        toastSuccess(`Created ${name}/`);
      },
    };
  }

  function promptRename(node: FileNode) {
    prompt = {
      title: `Rename ${node.name}`,
      initial: node.name,
      action: async (name) => {
        const to = `${dirOf(node.path)}/${name}`;
        await api.renamePath(node.path, to);
        if (currentFile === node.path) currentFile = to;
        else if (currentFile?.startsWith(node.path + "/"))
          currentFile = to + currentFile.slice(node.path.length);
        await refreshTree();
        toastSuccess(`Renamed to ${name}`);
      },
    };
  }

  async function deleteNode(node: FileNode) {
    const sure = await ask(
      `Permanently delete ${node.name}${node.is_dir ? " and all its contents" : ""}?`,
      { title: "Delete", kind: "warning" },
    );
    if (!sure) return;
    try {
      await api.deletePath(node.path);
      if (currentFile === node.path || currentFile?.startsWith(node.path + "/")) {
        currentFile = null;
        currentFingerprint = null;
        dirty = false;
        editor.setContent("");
        html = "";
        setStatus("idle");
      }
      await refreshTree();
      toastInfo(`Deleted ${node.name}`);
    } catch (e) {
      toastError(String(e));
    }
  }

  /** Run the discovered plugin `pluginId` against the open buffer, writing to
   * `target`; returns the structured PluginResult. The backend discovers the
   * plugin, substitutes {file}/{artifact}, and spawns its command with the real
   * buffer on stdin. Export is entirely the pandoc plugin suite: the export-
   * category plugins (pandoc-html-export, pandoc-pdf-export) run through here. */
  async function runPluginToPath(pluginId: string, target: string): Promise<PluginResult> {
    // P47: plugin-run funnels through the save-gate; an identity-less buffer
    // resolves a durable destination first, else the plugin does NOT run.
    const source = await requireDurablePath();
    if (!source) {
      throw new Error("No durable destination resolved — plugin not run.");
    }
    if (dirty) await saveCurrent();
    return api.runPlugin(pluginId, source, target, editor.getContent());
  }

  /** Export through a DISCOVERED export-category plugin (P66). Sources the human
   * name and output extension entirely from the discovered manifest, then runs
   * the plugin by id through runPluginToPath — the same generic firewall proven
   * by p19. Export is entirely the pandoc plugin suite; the app core owns no
   * export command knowledge. */
  async function exportViaPlugin(plugin: PluginInfo) {
    if (plugin.extension === null) {
      toastError(`Export plugin ${plugin.id} declares no output extension.`);
      return;
    }
    const source = await requireDurablePath();
    if (!source) return;
    const target = await saveDialog({
      title: `Export ${plugin.name}`,
      defaultPath: source.replace(/\.[^/.]*$/, "") + "." + plugin.extension,
      filters: [{ name: plugin.name, extensions: [plugin.extension] }],
    });
    if (!target) return;
    toastInfo(`Exporting ${plugin.name}…`);
    try {
      const res = await runPluginToPath(plugin.id, target);
      if (res.success) toastSuccess(`Exported ${target}`);
      else toastError("Export failed — see compile log.");
    } catch (e) {
      toastError(String(e));
    }
  }

  // ---- insertion bar / menu dispatch --------------------------------------

  /** Insert a named amsthm environment's fenced-div scaffold at the cursor.
   * Expands divFenceSnippet(env) through the editor's snippetCompletion apply
   * path so the `$0` tabstop lands the cursor in the environment body — the same
   * path completion acceptance uses. The insertion bar's environment controls
   * and the E2E bridge both route through here. */
  function insertEnvironment(env: string) {
    editor.insertSnippet(divFenceSnippet(env));
  }

  /** Inert diagram scaffold bodies for the insertion bar's diagram controls.
   * tikzcd = commutative-diagram environment, tikz = general tikzpicture. The
   * `${}` final tabstop sits on the body line so the cursor lands inside the
   * diagram after expansion. These are inert text — no tikz toolchain knowledge
   * lives in the app; the bodies are just the named LaTeX environment skeletons. */
  const diagramScaffolds: Readonly<Record<"tikz" | "tikzcd", string>> = {
    tikzcd: "\\begin{tikzcd}\n${}\n\\end{tikzcd}",
    tikz: "\\begin{tikzpicture}\n${}\n\\end{tikzpicture}",
  };

  /** Insert a diagram KIND's scaffold at the cursor through the SAME
   * insertSnippet path the env insert and completion accept use, so the `${}`
   * tabstop lands the cursor in the diagram body. */
  function insertDiagram(kind: "tikz" | "tikzcd") {
    editor.insertSnippet(diagramScaffolds[kind]);
  }

  /** Build a `pmatrix` snippet of EXACTLY `rows` × `cols` shape. Each row holds
   * `cols` cells joined by the `&` column separator (C-1 ampersands per row);
   * rows are joined by the `\\` row separator (R-1 separators between R rows,
   * none after the last). The single `${}` tabstop sits in the first cell so the
   * cursor lands inside the matrix body after expansion — the same tabstop
   * convention diagramScaffolds and divFenceSnippet use. */
  function buildMatrixSnippet(rows: number, cols: number): string {
    if (!Number.isInteger(rows) || rows < 1) {
      throw new Error(`matrix rows must be a positive integer, got ${rows}`);
    }
    if (!Number.isInteger(cols) || cols < 1) {
      throw new Error(`matrix cols must be a positive integer, got ${cols}`);
    }
    const lines: string[] = [];
    for (let r = 0; r < rows; r++) {
      const cells: string[] = [];
      for (let c = 0; c < cols; c++) {
        cells.push(r === 0 && c === 0 ? "${}" : " ");
      }
      const sep = r < rows - 1 ? " \\\\" : "";
      lines.push(cells.join("&") + sep);
    }
    return `\\begin{pmatrix}\n${lines.join("\n")}\n\\end{pmatrix}`;
  }

  /** Insert a `rows` × `cols` pmatrix at the cursor through the SAME
   * insertSnippet path the env insert and diagram insert use, so the `${}`
   * tabstop lands the cursor in the matrix body. The insertion bar's matrix
   * builder and the E2E bridge both route through here. */
  function insertMatrix(rows: number, cols: number) {
    editor.insertSnippet(buildMatrixSnippet(rows, cols));
  }

  /** Build a pandoc pipe-table snippet of EXACTLY `cols` columns × `rows` body
   * rows. Every row is written with BOTH a leading and a trailing `|`, so a row
   * of C columns carries EXACTLY C+1 pipes. The block, in order: one header row,
   * one alignment separator row (each cell a `---` dash-run, the marker that
   * makes a pipe table valid), then `rows` body rows. The single `${}` tabstop
   * sits in the first header cell so the cursor lands inside the table body after
   * expansion — the same tabstop convention buildMatrixSnippet, diagramScaffolds,
   * and divFenceSnippet use. */
  function buildTableSnippet(cols: number, rows: number): string {
    if (!Number.isInteger(cols) || cols < 1) {
      throw new Error(`table cols must be a positive integer, got ${cols}`);
    }
    if (!Number.isInteger(rows) || rows < 1) {
      throw new Error(`table rows must be a positive integer, got ${rows}`);
    }
    const pipeRow = (cells: string[]) => `| ${cells.join(" | ")} |`;
    const header = pipeRow(
      Array.from({ length: cols }, (_, c) => (c === 0 ? "${}" : " ")),
    );
    const separator = pipeRow(Array.from({ length: cols }, () => "---"));
    const body = Array.from({ length: rows }, () =>
      pipeRow(Array.from({ length: cols }, () => " ")),
    );
    return [header, separator, ...body].join("\n");
  }

  /** Insert a `cols` × `rows` pandoc pipe table at the cursor through the SAME
   * insertSnippet path the env insert, diagram insert, and matrix insert use, so
   * the `${}` tabstop lands the cursor in the table body. The insertion bar's
   * table builder and the E2E bridge both route through here. */
  function insertTable(cols: number, rows: number) {
    editor.insertSnippet(buildTableSnippet(cols, rows));
  }

  /** The languages the insertion bar's code-block-type dropdown offers (P60).
   * Choosing one inserts a fenced code block tagged with that language. These
   * are inert tags — the app holds no per-language knowledge; the tag is just
   * the fence's info string. */
  const codeBlockLanguages: readonly string[] = [
    "python",
    "javascript",
    "typescript",
    "rust",
    "haskell",
    "bash",
  ];

  /** Insert a fenced code block tagged with `lang` at the cursor through the
   * SAME insertCodeBlock path the insertion bar's code-block-type dropdown and
   * the E2E bridge both route through, so the opening fence carries the chosen
   * language tag and the `${}` tabstop lands the cursor inside the block body
   * (P60). */
  function insertCodeBlock(lang: string) {
    editor.insertCodeBlock(lang);
  }

  /** Insert a COMPLETE footnote — a reference marker `[^id]` at the cursor and a
   * matching `[^id]: <body>` definition line at the end of the buffer, sharing one
   * generated id (P61) — through the SAME editor.insertFootnote path the insertion
   * bar's footnote modal invokes on confirm. `body` is the exact text the modal's
   * user typed, inserted byte-for-byte. The insertion bar's footnote modal and the
   * E2E bridge both route through here. */
  function insertFootnote(body: string) {
    editor.insertFootnote(body);
  }

  /** Paste an image from the system clipboard (P62): the backend reads the
   * clipboard image, PNG-encodes it, and writes it as a real file into the
   * CONFIGURED global figures directory (config.directories.figures), returning
   * that file's path; then a markdown image reference `![](<path>)` to that exact
   * file is inserted at the cursor through the SAME editor.insertImageReference
   * path the bar's paste-image control and the E2E bridge both route through. */
  async function pasteImage() {
    if (!config) throw new Error("paste image: config not loaded");
    // The configured global figures directory the image is written into (the SAME
    // ExistingDir the figures explorer browses). The backend re-resolves and is
    // the authority; this is the path the inserted reference must name.
    const figuresDir = config.directories.figures;
    // A deterministic, unique basename. The reference is inserted at the cursor
    // pointing at <figuresDir>/<filename> SYNCHRONOUSLY — before the async
    // clipboard read + file write below — so the buffer carries the reference the
    // instant the paste action fires, naming the exact path the backend then
    // writes the clipboard image to.
    const filename = `clipboard-${Date.now()}-${Math.floor(Math.random() * 1e9)}.png`;
    const path = `${figuresDir}/${filename}`;
    editor.insertImageReference(path);

    // If a seed is in flight (E2E: seedClipboardImage fired just before this in a
    // separate evaluate round-trip), wait for it so the clipboard holds the image
    // before we read it. No-op in a user session (no seed promise is ever parked).
    const seed = (window as unknown as { __PPE_SEED__?: Promise<void> }).__PPE_SEED__;
    if (seed) await seed;
    // The backend reads the clipboard image and writes it to <figuresDir>/<filename>
    // (it re-resolves the configured figures dir and validates the bare filename),
    // returning the absolute path — the SAME path the reference above names.
    const written = await api.pasteClipboardImage(filename);
    if (written !== path) {
      throw new Error(
        `paste image: backend wrote ${written} but the reference names ${path}`,
      );
    }
  }

  function handleMenu(id: string) {
    switch (id) {
      case "new_file":
        if (projectRoot) promptNewFile(projectRoot);
        else toastError("Open a folder first.");
        break;
      case "open_folder":
        void openFolder();
        break;
      case "save":
        void saveCurrent();
        break;
      case "save_as":
        void saveAs();
        break;
      case "undo":
      case "redo":
      case "cut":
      case "copy":
      case "paste":
      case "select_all":
      case "find":
        void editor.command(id);
        break;
      case "toggle_sidebar":
        // Collapse if a view is open; otherwise reopen the Explorer view.
        activeView = activeView ? null : "explorer";
        break;
      case "show_preview":
        activeTab = "preview";
        break;
      case "show_log":
        activeTab = "log";
        break;
      case "settings":
        settingsOpen = true;
        break;
      case "command_palette":
        commandPaletteOpen = true;
        break;
      case "fold_all":
        editor.foldAllFolds();
        break;
      case "unfold_all":
        editor.unfoldAllFolds();
        break;
      default:
        toastError(`Unhandled menu item: ${id}`);
    }
  }

  async function saveSettings(next: Config) {
    try {
      await api.saveConfig(next);
      config = next;
      settingsOpen = false;
      toastSuccess("Settings saved.");
      if (currentFile) scheduleRender(editor.getContent());
    } catch (e) {
      toastError(String(e));
    }
  }

  // ---- layout --------------------------------------------------------------
  //
  // The editor|preview split is owned by dockview-core's SplitviewComponent
  // (see lib/dockview.ts): the sash lands at the pointer (P13), proportional
  // layout keeps the editor:preview ratio across the sidebar toggle (P15), and
  // switching the right-pane tab cannot move either pane (P14). The sidebar is a
  // sibling OUTSIDE the splitview, toggled by a normal conditional below — its
  // show/hide resizes the splitview container, which dockview's ResizeObserver
  // relayouts proportionally. dockview natively disables iframe pointer-events
  // during a sash drag, so the preview iframe cannot swallow the drag stream.
</script>

<svelte:window
  onkeydown={(e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
      e.preventDefault();
      commandPaletteOpen = true;
    }
  }}
/>

{#if config}
  <div class="flex h-full flex-col">
    <InsertionBar
      onInsertEnvironment={insertEnvironment}
      onInsertDiagram={insertDiagram}
      onOpenMatrix={() => (matrixModalOpen = true)}
      onOpenTable={() => (tableModalOpen = true)}
      onOpenFootnote={() => (footnoteModalOpen = true)}
      onInsertSnippet={(trigger) => editor.insertSnippetByTrigger(trigger)}
      onInsertCodeBlock={insertCodeBlock}
      onInsertTikzCommand={(name) => editor.insertTikzCommandByName(name)}
      onPasteImage={() => void pasteImage()}
      {snippetTriggers}
      codeBlockLanguages={codeBlockLanguages}
      {tikzCommandNames}
      fileOpen={currentFile !== null}
    />

    <div class="flex min-h-0 grow">
      <!-- VSCode-style activity bar: always visible, holds the view controls. -->
      <ActivityBar views={SIDEBAR_VIEWS} {activeView} onSelect={selectView} />

      <!-- The collapsible side bar shows the active view. It is a flex sibling
           OUTSIDE the splitview, so its show/hide changes the splitview
           container's width and dockview's ResizeObserver relayouts the
           editor|preview split proportionally — the ratio is preserved across
           the collapse (P15). -->
      {#if activeView}
        <div
          data-pane="sidebar"
          class="flex w-60 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-700"
        >
          {#if activeView === "explorer"}
            <!-- File tree fills the space (it owns its own header/background);
                 the Outline below is a resizable, collapsible section. -->
            <div class="flex min-h-0 grow flex-col">
              <FileTree
                {tree}
                {projectRoot}
                {currentFile}
                onOpen={(p) => void openFile(p)}
                onNewFile={promptNewFile}
                onNewFolder={promptNewFolder}
                onRename={promptRename}
                onDelete={(n) => void deleteNode(n)}
                onOpenFolder={() => void openFolder()}
              />
            </div>
            {#if !outlineCollapsed}
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <div
                class="h-1 shrink-0 cursor-row-resize hover:bg-sky-400/60"
                role="separator"
                aria-orientation="horizontal"
                onmousedown={startOutlineResize}
              ></div>
            {/if}
            <div
              class="flex shrink-0 flex-col overflow-hidden border-t border-zinc-200 dark:border-zinc-700"
              style={outlineCollapsed ? "" : `height: ${outlineHeight}px`}
            >
              <OutlinePanel
                items={outline}
                collapsed={outlineCollapsed}
                onToggle={() => (outlineCollapsed = !outlineCollapsed)}
                onSelect={(line) => editor.goToLine(line)}
              />
            </div>
          {:else if activeView === "macros"}
            <!-- Macros pane: an alternative explorer fixed at the styles dir. -->
            <FileTree
              tree={stylesTree}
              projectRoot={config?.directories.styles ?? null}
              {currentFile}
              onOpen={(p) => void openFile(p)}
              onNewFile={promptNewFile}
              onNewFolder={promptNewFolder}
              onRename={promptRename}
              onDelete={(n) => void deleteNode(n)}
              onOpenFolder={() => {}}
            />
          {:else if activeView === "figures"}
            <!-- Figures pane: an alternative explorer fixed at the figures dir. -->
            <FileTree
              tree={figuresTree}
              projectRoot={config?.directories.figures ?? null}
              {currentFile}
              onOpen={(p) => void openFile(p)}
              onNewFile={promptNewFile}
              onNewFolder={promptNewFolder}
              onRename={promptRename}
              onDelete={(n) => void deleteNode(n)}
              onOpenFolder={() => {}}
            />
          {:else if activeView === "references"}
            <!-- References pane: the cited bibliography entries, sourced from the
                 preview's resolved #refs block (the SAME `html` the preview pane
                 renders). It updates on the same render cadence as the preview. -->
            <ReferencesPanel {html} />
          {:else}
            <div
              class="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
            >
              {SIDEBAR_VIEWS.find((v) => v.id === activeView)?.title}
            </div>
          {/if}
        </div>
      {/if}

      <!-- The dockview SplitviewComponent mounts here; it renders the editor and
           preview panels plus the draggable sash. The editor/preview wrappers
           below are portaled into the panel elements (data-pane="editor"/"preview")
           so Svelte keeps full ownership of the components. -->
      <div bind:this={splitContainer} class="relative min-w-0 grow"></div>

      <!-- Off-layout holder for the portaled wrappers. The portal action moves
           each wrapper node into its dockview pane on mount; until then they sit
           here, hidden, so they never take flex space in this row. Once moved,
           the wrapper is no longer a child of this holder and renders normally. -->
      <div style="display: none">
        <!-- Editor wrapper — relocated into the dockview editor panel. -->
        <div class="h-full w-full" use:portal={editorPaneEl}>
          {#if currentFile === null}
            <div
              class="flex h-full items-center justify-center bg-white text-sm text-zinc-400 dark:bg-[#282c34]"
            >
              Open a file from the sidebar to start editing.
            </div>
          {/if}
          <div class="h-full" hidden={currentFile === null}>
            <EditorPane
              bind:this={editor}
              {config}
              onChange={onEditorChange}
              onCursor={(l, c) => {
                cursorLine = l;
                cursorCol = c;
              }}
              onSnippetsLoaded={(triggers) => {
                snippetTriggers = triggers;
              }}
              onTikzCommandsLoaded={(names) => {
                tikzCommandNames = names;
              }}
              sourcePath={() => currentFile}
            />
          </div>
        </div>

        <!-- Preview wrapper — relocated into the dockview preview panel. -->
        <div class="h-full w-full" use:portal={previewPaneEl}>
          <PreviewPane
            {html}
            {log}
            {logEntries}
            onEntryClick={(entry) => editor.goToLine(entry.line)}
            tikzFigureLogEntries={tikzFigureLogEntries}
            onTikzEntryClick={(entry) => editor.goToLine(entry.line)}
            {status}
            bind:activeTab
          />
        </div>
      </div>
    </div>

    <StatusBar
      filePath={currentFile}
      {projectRoot}
      {dirty}
      {wordCount}
      {cursorLine}
      {cursorCol}
      {repoState}
      onRepoInit={() => void repoInit()}
      onRepoTrack={() => void repoTrack()}
    />
  </div>

  {#if settingsOpen}
    <SettingsModal
      {config}
      {configPath}
      onSave={(next) => void saveSettings(next)}
      onCancel={() => (settingsOpen = false)}
    />
  {/if}

  {#if commandPaletteOpen}
    <CommandPaletteModal
      commands={paletteCommands()}
      onClose={() => (commandPaletteOpen = false)}
    />
  {/if}

  {#if pendingClose}
    <!-- P50 close guard: a dirty buffer blocks the window close until resolved.
         Save persists then closes; Discard closes (recovery already holds the
         buffer — nothing is lost); Cancel keeps the app open. An identity-less
         (untitled) buffer is guarded too — its unsaved work is most at risk. -->
    <div
      data-close-guard
      class="fixed inset-0 z-40 flex items-start justify-center bg-black/40 pt-32"
      role="presentation"
    >
      <div class="w-96 rounded-lg bg-white p-4 shadow-xl dark:bg-zinc-800">
        <h2 class="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          Save changes to {currentFile ? fileName(currentFile) : UNTITLED_LABEL} before
          closing?
        </h2>
        <div class="mt-3 flex justify-end gap-2">
          <button
            class="rounded px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
            onclick={() => void resolveClose("cancel")}>Cancel</button
          >
          <button
            class="rounded px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
            onclick={() => void resolveClose("discard")}>Discard</button
          >
          <button
            class="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
            onclick={() => void resolveClose("save")}>Save</button
          >
        </div>
      </div>
    </div>
  {/if}

  {#if prompt}
    <PromptModal
      title={prompt.title}
      initial={prompt.initial}
      onSubmit={(value) => {
        const action = prompt!.action;
        prompt = null;
        action(value).catch((e) => toastError(String(e)));
      }}
      onCancel={() => (prompt = null)}
    />
  {/if}

  {#if matrixModalOpen}
    <!-- P57 matrix builder: rows × cols → insertMatrix(rows, cols). -->
    <DimensionModal
      title="Insert matrix"
      firstLabel="rows"
      firstAttr="data-matrix-rows"
      firstInitial={2}
      secondLabel="cols"
      secondAttr="data-matrix-cols"
      secondInitial={2}
      confirmAttr="data-matrix-confirm"
      onConfirm={(rows, cols) => {
        matrixModalOpen = false;
        insertMatrix(rows, cols);
      }}
      onCancel={() => (matrixModalOpen = false)}
    />
  {/if}

  {#if tableModalOpen}
    <!-- P58 table builder: cols × body-rows → insertTable(cols, rows). -->
    <DimensionModal
      title="Insert table"
      firstLabel="cols"
      firstAttr="data-table-cols"
      firstInitial={2}
      secondLabel="rows"
      secondAttr="data-table-rows"
      secondInitial={2}
      confirmAttr="data-table-confirm"
      onConfirm={(cols, rows) => {
        tableModalOpen = false;
        insertTable(cols, rows);
      }}
      onCancel={() => (tableModalOpen = false)}
    />
  {/if}

  {#if footnoteModalOpen}
    <!-- P61 footnote modal: typed body → insertFootnote(body). -->
    <FootnoteModal
      onConfirm={(body) => {
        footnoteModalOpen = false;
        insertFootnote(body);
      }}
      onCancel={() => (footnoteModalOpen = false)}
    />
  {/if}
{/if}

<Toasts />
