<script lang="ts">
  // VSCode-style activity bar: an always-visible vertical strip of view
  // controls. Clicking a view's control opens it in the side bar; clicking the
  // active view's control collapses the side bar (onSelect toggles in App). The
  // `views` array is the single extension point — add an entry to add a tab.

  type View = { id: string; title: string; icon: string };

  let {
    views,
    activeView,
    onSelect,
  }: {
    views: View[];
    activeView: string | null;
    onSelect: (id: string) => void;
  } = $props();
</script>

<div
  class="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-zinc-200 bg-zinc-100 py-2 dark:border-zinc-700 dark:bg-zinc-900"
>
  {#each views as v (v.id)}
    <button
      data-view={v.id}
      title={v.title}
      aria-label={v.title}
      aria-pressed={activeView === v.id}
      class="relative flex h-10 w-10 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 {activeView ===
      v.id
        ? 'text-zinc-900 dark:text-zinc-100'
        : ''}"
      onclick={() => onSelect(v.id)}
    >
      {#if activeView === v.id}
        <span class="absolute bottom-1 left-0 top-1 w-0.5 rounded bg-sky-500"></span>
      {/if}
      <!-- icon is a trusted constant SVG string from the views array, never user input -->
      {@html v.icon}
    </button>
  {/each}
</div>
