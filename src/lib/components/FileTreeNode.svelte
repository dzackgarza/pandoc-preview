<script lang="ts">
  import { untrack } from "svelte";
  import FileTreeNode from "./FileTreeNode.svelte";
  import type { FileNode } from "../types";

  let {
    node,
    depth,
    currentFile,
    onOpen,
    onContextMenu,
  }: {
    node: FileNode;
    depth: number;
    currentFile: string | null;
    onOpen: (path: string) => void;
    onContextMenu: (e: MouseEvent, node: FileNode) => void;
  } = $props();

  // Root nodes start expanded. `depth` is structurally constant per node, so the
  // initial-value capture is intentional (untrack documents that, not a stale read).
  let expanded = $state(untrack(() => depth === 0));
</script>

<button
  class="flex w-full items-center gap-1.5 truncate rounded px-1.5 py-0.5 text-left text-sm {currentFile ===
  node.path
    ? 'bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100'
    : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700/60'}"
  style="padding-left: {depth * 14 + 6}px"
  onclick={() => (node.is_dir ? (expanded = !expanded) : onOpen(node.path))}
  oncontextmenu={(e) => {
    e.preventDefault();
    onContextMenu(e, node);
  }}
>
  <span class="w-4 shrink-0 text-xs text-zinc-400">
    {node.is_dir ? (expanded ? "▾" : "▸") : "·"}
  </span>
  <span class="truncate">{node.name}</span>
</button>

{#if node.is_dir && expanded && node.children}
  {#each node.children as child (child.path)}
    <FileTreeNode node={child} depth={depth + 1} {currentFile} {onOpen} {onContextMenu} />
  {/each}
{/if}
