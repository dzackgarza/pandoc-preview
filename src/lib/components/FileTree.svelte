<script lang="ts">
  import FileTreeNode from "./FileTreeNode.svelte";
  import type { FileNode } from "../types";

  let {
    tree,
    projectRoot,
    currentFile,
    onOpen,
    onNewFile,
    onNewFolder,
    onRename,
    onDelete,
    onOpenFolder,
  }: {
    tree: FileNode[];
    projectRoot: string | null;
    currentFile: string | null;
    onOpen: (path: string) => void;
    onNewFile: (dir: string) => void;
    onNewFolder: (dir: string) => void;
    onRename: (node: FileNode) => void;
    onDelete: (node: FileNode) => void;
    onOpenFolder: () => void;
  } = $props();

  let menu = $state<{ x: number; y: number; node: FileNode } | null>(null);

  const rootName = $derived(projectRoot?.split("/").filter(Boolean).at(-1) ?? "");

  function showMenu(e: MouseEvent, node: FileNode) {
    menu = { x: e.clientX, y: e.clientY, node };
  }

  /** Directory a "new file/folder here" action should target. */
  function targetDir(node: FileNode): string {
    if (node.is_dir) return node.path;
    return node.path.slice(0, node.path.lastIndexOf("/"));
  }
</script>

<svelte:window onclick={() => (menu = null)} />

<div class="flex h-full flex-col bg-zinc-50 dark:bg-zinc-800">
  <div
    class="flex items-center gap-1 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-700"
  >
    <span
      class="grow truncate text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400"
      title={projectRoot}
    >
      {rootName || "No folder"}
    </span>
    {#if projectRoot}
      <button
        class="rounded px-1.5 text-sm text-zinc-500 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700"
        title="New file in project root"
        onclick={() => onNewFile(projectRoot)}>＋</button
      >
      <button
        class="rounded px-1.5 text-sm text-zinc-500 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700"
        title="New folder in project root"
        onclick={() => onNewFolder(projectRoot)}>📁</button
      >
    {/if}
  </div>

  <div class="grow overflow-auto p-1">
    {#if !projectRoot}
      <div class="px-3 py-6 text-center text-sm text-zinc-400">
        <p class="mb-3">No folder open.</p>
        <button
          class="rounded bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-500"
          onclick={onOpenFolder}
        >
          Open Folder…
        </button>
      </div>
    {:else}
      {#each tree as node (node.path)}
        <FileTreeNode {node} depth={0} {currentFile} {onOpen} onContextMenu={showMenu} />
      {/each}
    {/if}
  </div>
</div>

{#if menu}
  <div
    class="fixed z-50 w-44 rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-xl dark:border-zinc-600 dark:bg-zinc-800"
    style="left: {menu.x}px; top: {menu.y}px"
  >
    {#each [
      { label: "New File Here", run: () => onNewFile(targetDir(menu!.node)) },
      { label: "New Folder Here", run: () => onNewFolder(targetDir(menu!.node)) },
      { label: "Rename…", run: () => onRename(menu!.node) },
      { label: "Delete", run: () => onDelete(menu!.node), danger: true },
    ] as item (item.label)}
      <button
        class="block w-full px-3 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700 {item.danger
          ? 'text-red-600 dark:text-red-400'
          : 'text-zinc-700 dark:text-zinc-200'}"
        onclick={() => {
          item.run();
          menu = null;
        }}
      >
        {item.label}
      </button>
    {/each}
  </div>
{/if}
