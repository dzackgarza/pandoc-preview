<script lang="ts">
  let {
    filePath,
    projectRoot,
    dirty,
    wordCount,
    cursorLine,
    cursorCol,
  }: {
    filePath: string | null;
    projectRoot: string | null;
    dirty: boolean;
    wordCount: number;
    cursorLine: number;
    cursorCol: number;
  } = $props();

  const displayPath = $derived(
    filePath && projectRoot && filePath.startsWith(projectRoot)
      ? filePath.slice(projectRoot.length + 1)
      : filePath,
  );
</script>

<div
  class="flex items-center gap-4 border-t border-zinc-200 bg-zinc-100 px-3 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
>
  <span class="truncate">
    {#if displayPath}
      {displayPath}{dirty ? " ●" : ""}
    {:else}
      No file open
    {/if}
  </span>
  <div class="grow"></div>
  {#if filePath}
    <span>Ln {cursorLine}, Col {cursorCol}</span>
    <span>{wordCount} words</span>
  {/if}
</div>
