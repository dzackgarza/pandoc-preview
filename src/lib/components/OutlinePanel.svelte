<script lang="ts">
  import type { OutlineItem } from "codemirror-lang-latex";

  let {
    items,
    onSelect,
  }: { items: OutlineItem[]; onSelect: (line: number) => void } = $props();
</script>

<div class="flex h-full flex-col">
  <div
    class="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
  >
    Outline
  </div>
  <div class="min-h-0 grow overflow-auto px-1 py-1" data-testid="outline">
    {#if items.length === 0}
      <div class="px-2 py-1 text-xs text-zinc-400">No headings or divs</div>
    {:else}
      {#each items as item (item.line)}
        <button
          class="flex w-full items-center gap-1.5 truncate rounded px-1.5 py-0.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
          style="padding-left: {item.depth * 14 + 6}px"
          onclick={() => onSelect(item.line)}
        >
          <span class="w-5 shrink-0 text-xs text-zinc-400">
            {item.kind === "heading" ? "H" + item.level : "§"}
          </span>
          <span class="truncate">{item.label}</span>
        </button>
      {/each}
    {/if}
  </div>
</div>
