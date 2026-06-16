<script lang="ts">
  interface Command {
    id: string;
    label: string;
    run: () => void;
  }

  let { commands, onClose }: { commands: Command[]; onClose: () => void } = $props();

  let query = $state("");
  let selected = $state(0);
  let inputEl = $state<HTMLInputElement>();

  const filtered = $derived(
    commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())),
  );

  $effect(() => {
    inputEl?.focus();
  });
  $effect(() => {
    if (selected >= filtered.length) selected = Math.max(0, filtered.length - 1);
  });

  function run(c: Command | undefined) {
    if (!c) return;
    onClose();
    c.run();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      selected = Math.min(selected + 1, filtered.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selected = Math.max(selected - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(filtered[selected]);
    }
  }
</script>

<div
  class="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24"
  role="presentation"
  onclick={(e) => e.target === e.currentTarget && onClose()}
>
  <div
    class="w-[520px] overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-zinc-800"
    data-testid="command-palette"
  >
    <input
      bind:this={inputEl}
      bind:value={query}
      onkeydown={onKey}
      placeholder="Type a command…"
      class="w-full border-b border-zinc-200 bg-transparent px-4 py-2.5 text-sm text-zinc-800 outline-none dark:border-zinc-700 dark:text-zinc-100"
    />
    <div class="max-h-80 overflow-auto p-1">
      {#each filtered as c, i (c.id)}
        <button
          class="block w-full rounded px-3 py-1.5 text-left text-sm {i === selected
            ? 'bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100'
            : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700/60'}"
          onmouseenter={() => (selected = i)}
          onclick={() => run(c)}
        >
          {c.label}
        </button>
      {/each}
      {#if filtered.length === 0}
        <div class="px-3 py-2 text-sm text-zinc-400">No matching commands</div>
      {/if}
    </div>
  </div>
</div>
