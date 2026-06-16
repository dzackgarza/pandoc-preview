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
    FoldState,
    PluginResult,
    RenderStatus,
  } from "./lib/types";
  import type { OutlineItem } from "codemirror-lang-latex";
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
  import Toolbar from "./lib/components/Toolbar.svelte";
  import OutlinePanel from "./lib/components/OutlinePanel.svelte";
  import CommandPaletteModal from "./lib/components/CommandPaletteModal.svelte";

  let config = $state<Config | null>(null);
  let configPath = $state("");

  let projectRoot = $state<string | null>(null);
  let tree = $state<FileNode[]>([]);
  let currentFile = $state<string | null>(null);
  let dirty = $state(false);

  // VSCode-style activity bar + collapsible side bar. `activeView` is the active
  // view id, or null when the side bar is collapsed. The always-visible activity
  // bar and the View > Toggle Sidebar menu / F9 both drive it. Add a
  // SIDEBAR_VIEWS entry to add a tab.
  type SidebarView = { id: string; title: string; icon: string };
  const EXPLORER_ICON =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5"><path d="M2.5 3.5h4l1.5 1.5h5.5v8h-11z"/></svg>';
  const SIDEBAR_VIEWS: SidebarView[] = [
    { id: "explorer", title: "Explorer", icon: EXPLORER_ICON },
  ];
  let activeView = $state<string | null>("explorer");

  function selectView(id: string) {
    // Clicking the active view's control collapses the side bar (VSCode); any
    // other view opens/switches to it.
    activeView = activeView === id ? null : id;
  }
  let settingsOpen = $state(false);
  let commandPaletteOpen = $state(false);
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

  let html = $state("");
  let log = $state("");
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
  let activeTab = $state<"preview" | "log">("preview");

  let wordCount = $state(0);
  let cursorLine = $state(1);
  let cursorCol = $state(1);

  // bind:this reference to the editor component, used only imperatively
  // (getContent/setContent/commands in handlers). Svelte 5 requires bind:this
  // targets to be $state; it is assigned once on mount and never reactively read.
  let editor = $state<EditorPane>()!;

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
    // Resolve the bundled local MathJax to its asset-protocol URL (decision A).
    // resolveResource gives the absolute path under the app resource dir;
    // convertFileSrc turns it into the asset-protocol URL the srcdoc preview
    // loads its MathJax <script> from — local, never a CDN.
    mathjaxUrl = convertFileSrc(await resolveResource("resources/mathjax/tex-full-svg-a11y.min.js"));
    await listen<string>("menu", (event) => handleMenu(event.payload));

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
        exportTo: (pluginId: string, target: string) => {
          (window as unknown as { __PPE_EXPORT__: unknown }).__PPE_EXPORT__ = "pending";
          exportToPath(pluginId, target).then(
            () => {
              (window as unknown as { __PPE_EXPORT__: unknown }).__PPE_EXPORT__ = "done";
            },
            (e: unknown) => {
              (window as unknown as { __PPE_EXPORT__: unknown }).__PPE_EXPORT__ =
                "error: " + String(e);
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
        syntaxAncestryAt: (needle: string) => editor.syntaxAncestryAt(needle),
        getOutline: () => editor.getOutline(),
        goToLine: (line: number) => editor.goToLine(line),
        foldAll: () => editor.foldAllFolds(),
        unfoldAll: () => editor.unfoldAllFolds(),
        getFoldedRanges: () => editor.getFoldedRanges(),
        cursorLine: () => cursorLine,
        currentFile: () => currentFile,
        configFontSize: () => config?.editor.font_size ?? null,
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
  });

  onDestroy(() => {
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
    for (const [id, plugin] of Object.entries(config?.export ?? {})) {
      cmds.push({ id: `export:${id}`, label: `Export: ${plugin.label}`, run: () => void exportDoc(id) });
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

  async function refreshTree() {
    if (!projectRoot) return;
    try {
      tree = await api.listTree(projectRoot);
    } catch (e) {
      toastError(String(e));
    }
  }

  async function openProject(dir: string) {
    projectRoot = dir;
    currentFile = null;
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

  async function openFile(path: string) {
    if (path === currentFile) return;
    if (!(await resolveDirty())) return;
    await persistCurrentFoldState(); // save the outgoing file's folds first
    try {
      const content = await api.readTextFile(path);
      currentFile = path;
      editor.setContent(content);
      editor.setFoldedRanges(foldState[path] ?? []); // restore this file's folds
      outline = editor.getOutline();
      dirty = false;
      wordCount = content.split(/\s+/).filter(Boolean).length;
      void doRender(content);
    } catch (e) {
      toastError(String(e));
    }
  }

  async function saveCurrent() {
    if (!currentFile) return;
    try {
      await api.writeTextFile(currentFile, editor.getContent());
      dirty = false;
      await persistCurrentFoldState();
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
      await api.writeTextFile(target, editor.getContent());
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

  /** Run the configured [export.<pluginId>] plugin, writing to `target`. The
   * single export command path (the menu handler and the E2E hook both reach
   * this). The plugin's command is the whole compilation pipeline; the backend
   * substitutes {input}/{output} and spawns it. */
  async function exportToPath(pluginId: string, target: string) {
    if (!currentFile) {
      toastError("No file open to export.");
      return;
    }
    if (dirty) await saveCurrent();
    const label = config?.export[pluginId]?.label ?? pluginId;
    toastInfo(`Exporting ${label}…`);
    try {
      const res = await api.exportDocument(pluginId, currentFile, target);
      log = res.log;
      if (res.ok) {
        toastSuccess(`Exported ${target}`);
      } else {
        activeTab = "log";
        toastError("Export failed — see compile log.");
      }
    } catch (e) {
      toastError(String(e));
    }
  }

  /** Run the discovered plugin `pluginId` against the open buffer, writing to
   * `target`; returns the structured PluginResult. The generic counterpart of
   * exportToPath: the backend discovers the plugin, substitutes {file}/{artifact},
   * and spawns its command with the real buffer on stdin. */
  async function runPluginToPath(pluginId: string, target: string): Promise<PluginResult> {
    if (!currentFile) {
      throw new Error("No file open to run a plugin against.");
    }
    if (dirty) await saveCurrent();
    return api.runPlugin(pluginId, currentFile, target, editor.getContent());
  }

  async function exportDoc(pluginId: string) {
    if (!currentFile) {
      toastError("No file open to export.");
      return;
    }
    const plugin = config?.export[pluginId];
    if (!plugin) {
      toastError(`Unknown export plugin: ${pluginId}`);
      return;
    }
    const target = await saveDialog({
      title: `Export ${plugin.label}`,
      defaultPath: currentFile.replace(/\.[^/.]*$/, "") + "." + plugin.extension,
      filters: [{ name: plugin.label, extensions: [plugin.extension] }],
    });
    if (!target) return;
    await exportToPath(pluginId, target);
  }

  // ---- toolbar / menu dispatch --------------------------------------------

  function toolbarAction(action: string) {
    const ops: Record<string, () => void> = {
      h1: () => editor.prefixLines("# "),
      h2: () => editor.prefixLines("## "),
      h3: () => editor.prefixLines("### "),
      bold: () => editor.wrapSelection("**", "**"),
      italic: () => editor.wrapSelection("*", "*"),
      strike: () => editor.wrapSelection("~~", "~~"),
      code: () => editor.wrapSelection("`", "`"),
      codeblock: () => editor.insertCodeBlock(),
      link: () => editor.insertLink(),
      image: () => editor.insertImage(),
      ul: () => editor.prefixLines("- "),
      ol: () => editor.prefixLines("1. "),
      quote: () => editor.prefixLines("> "),
    };
    const op = ops[action];
    if (!op) throw new Error(`unknown toolbar action: ${action}`);
    op();
  }

  function handleMenu(id: string) {
    // Export menu items carry the plugin id: "export:<id>". One item per
    // configured [export.<id>] plugin; the handler runs the same export command
    // path as the E2E hook.
    if (id.startsWith("export:")) {
      void exportDoc(id.slice("export:".length));
      return;
    }
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
    <Toolbar onAction={toolbarAction} fileOpen={currentFile !== null} />

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
            />
          </div>
        </div>

        <!-- Preview wrapper — relocated into the dockview preview panel. -->
        <div class="h-full w-full" use:portal={previewPaneEl}>
          <PreviewPane {html} {log} {status} bind:activeTab />
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
{/if}

<Toasts />
