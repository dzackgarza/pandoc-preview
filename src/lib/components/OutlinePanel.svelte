<script lang="ts">
  import type { OutlineItem } from "codemirror-lang-latex";

  let {
    items,
    collapsed,
    onToggle,
    onSelect,
  }: {
    items: OutlineItem[];
    collapsed: boolean;
    onToggle: () => void;
    onSelect: (line: number) => void;
  } = $props();
</script>

<div class="flex h-full flex-col">
  <!-- Collapsible section header (chevron toggles the list). -->
  <button
    class="flex w-full shrink-0 items-center gap-1 px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700/40"
    onclick={onToggle}
    data-testid="outline-header"
  >
    <span class="w-3 text-[10px] text-zinc-400">{collapsed ? "▸" : "▾"}</span>
    <span>Outline</span>
    {#if items.length > 0}
      <span class="ml-auto text-[10px] font-normal text-zinc-400">{items.length}</span>
    {/if}
  </button>

  {#if !collapsed}
    <div class="min-h-0 grow overflow-auto px-1 pb-1" data-testid="outline">
      {#if items.length === 0}
        <div class="px-2 py-1 text-xs text-zinc-400">No headings or divs</div>
      {:else}
        {#each items as item (item.line)}
          <button
            class="flex w-full items-center gap-1.5 truncate rounded px-1.5 py-0.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
            style="padding-left: {item.depth * 12 + 6}px"
            onclick={() => onSelect(item.line)}
            title={item.label}
          >
            {#if item.kind === "heading"}
              <span
                class="shrink-0 rounded bg-zinc-200 px-1 text-[10px] font-medium text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
              >
                H{item.level}
              </span>
            {:else}
              <span class="w-4 shrink-0 text-center text-xs text-sky-500">§</span>
            {/if}
            <span class="truncate">{item.label}</span>
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>
