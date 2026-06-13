<script lang="ts">
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { ask, open, save as saveDialog } from "@tauri-apps/plugin-dialog";

  import * as api from "./lib/api";
  import type { Config, FileNode, RenderStatus } from "./lib/types";
  import { toastError, toastInfo, toastSuccess } from "./lib/toast.svelte";

  import EditorPane from "./lib/components/EditorPane.svelte";
  import FileTree from "./lib/components/FileTree.svelte";
  import PreviewPane from "./lib/components/PreviewPane.svelte";
  import PromptModal from "./lib/components/PromptModal.svelte";
  import SettingsModal from "./lib/components/SettingsModal.svelte";
  import StatusBar from "./lib/components/StatusBar.svelte";
  import Toasts from "./lib/components/Toasts.svelte";
  import Toolbar from "./lib/components/Toolbar.svelte";

  let config = $state<Config | null>(null);
  let configPath = $state("");

  let projectRoot = $state<string | null>(null);
  let tree = $state<FileNode[]>([]);
  let currentFile = $state<string | null>(null);
  let dirty = $state(false);

  let sidebarVisible = $state(true);
  let splitRatio = $state(0.5);
  let settingsOpen = $state(false);
  let prompt = $state<{
    title: string;
    initial: string;
    action: (value: string) => Promise<void>;
  } | null>(null);

  let html = $state("");
  let log = $state("");
  let status = $state<RenderStatus>("idle");
  let activeTab = $state<"preview" | "log">("preview");

  let wordCount = $state(0);
  let cursorLine = $state(1);
  let cursorCol = $state(1);

  let editor: EditorPane;

  const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

  onMount(async () => {
    // The startup gate (the Rust doctor battery) has already proven the config
    // exists, parses, and is valid before this window was created, so these
    // calls cannot fail for config reasons. There is no in-app config-error
    // screen: a misconfigured environment never reaches the webview.
    configPath = await api.getConfigPath();
    config = await api.getConfig();
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
        getEditorText: () => editor.getContent(),
        appendAtEnd: (text: string) => {
          editor.appendAtEnd(text);
        },
        currentFile: () => currentFile,
        configFontSize: () => config?.editor.font_size ?? null,
      };
    }
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
    wordCount = content.split(/\s+/).filter(Boolean).length;
    scheduleRender(content);
  }

  function scheduleRender(content: string) {
    if (!config || !currentFile) return;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => void doRender(content), config.preview.debounce_ms);
  }

  async function doRender(content: string) {
    if (!currentFile) return;
    const seq = ++renderSeq;
    status = "rendering";
    const baseDir = dirOf(currentFile);
    try {
      const res = await api.renderPreview(content, baseDir, convertFileSrc(baseDir) + "/");
      if (seq !== renderSeq) return;
      log = res.log;
      if (res.ok) {
        html = res.html;
        status = "ok";
      } else {
        status = "error";
      }
    } catch (e) {
      if (seq !== renderSeq) return;
      status = "error";
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
    status = "idle";
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
    try {
      const content = await api.readTextFile(path);
      currentFile = path;
      editor.setContent(content);
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
        status = "idle";
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
        sidebarVisible = !sidebarVisible;
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

  // ---- split drag ----------------------------------------------------------
  //
  // The split is computed against the editor+preview region ONLY (the sidebar
  // is a sibling OUTSIDE splitRegion), so the divider lands at the pointer
  // regardless of the sidebar width (P13). Both panes are sized as a percentage
  // of that region, so switching the right-pane tab (P14) and toggling the
  // sidebar (P15) cannot shift the split. The separator captures the pointer so
  // pointermove keeps tracking even when the cursor crosses the preview iframe,
  // and the iframe's pointer-events are disabled for the drag's duration.

  let splitRegion: HTMLDivElement;
  let dragging = $state(false);

  function startSplitDrag(e: PointerEvent) {
    e.preventDefault();
    const separator = e.currentTarget as HTMLElement;
    // Pointer capture keeps pointermove/pointerup targeted at the separator even
    // when the cursor moves over the preview iframe. setPointerCapture can throw
    // if there is no active pointer for the id (e.g. a synthetic event); guard it
    // so the drag still proceeds via the window listeners below.
    try {
      separator.setPointerCapture(e.pointerId);
    } catch {
      // No active pointer to capture (synthetic event): window listeners suffice.
    }
    dragging = true;

    const move = (ev: PointerEvent) => {
      const rect = splitRegion.getBoundingClientRect();
      splitRatio = Math.min(0.8, Math.max(0.2, (ev.clientX - rect.left) / rect.width));
    };
    const up = (ev: PointerEvent) => {
      dragging = false;
      try {
        separator.releasePointerCapture(ev.pointerId);
      } catch {
        // Nothing captured; nothing to release.
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
</script>

{#if config}
  <div class="flex h-full flex-col">
    <Toolbar
      onAction={toolbarAction}
      onSave={saveCurrent}
      {dirty}
      fileOpen={currentFile !== null}
    />

    <div class="flex min-h-0 grow">
      {#if sidebarVisible}
        <div class="w-60 shrink-0 border-r border-zinc-200 dark:border-zinc-700">
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
      {/if}

      <!-- The editor+preview split region. The sidebar is OUTSIDE this region,
           so the split ratio is computed against editor+preview only: the
           divider lands at the pointer (P13) and toggling the sidebar cannot
           shift the editor:preview ratio (P15). Both panes are percentage-sized,
           so switching the right-pane tab cannot move them either (P14). -->
      <div bind:this={splitRegion} class="flex min-w-0 grow">
        <div class="min-w-0 shrink-0" style="width: {splitRatio * 100}%">
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

        <div
          class="w-1 shrink-0 cursor-col-resize bg-zinc-200 hover:bg-sky-400 dark:bg-zinc-700 dark:hover:bg-sky-500"
          role="separator"
          aria-orientation="vertical"
          onpointerdown={startSplitDrag}
        ></div>

        <div class="min-w-0 grow">
          <PreviewPane {html} {log} {status} {dragging} bind:activeTab />
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
