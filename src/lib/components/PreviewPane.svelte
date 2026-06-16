<script lang="ts">
  import type { RenderStatus } from "../types";

  let {
    html,
    log,
    status,
    dragging = false,
    activeTab = $bindable(),
  }: {
    html: string;
    log: string;
    status: RenderStatus;
    // True while the editor/preview divider is being dragged: the iframe's
    // pointer-events are disabled so the cursor crossing it cannot swallow the
    // drag's pointermove stream.
    dragging?: boolean;
    activeTab: "preview" | "log";
  } = $props();
</script>

<div class="flex h-full flex-col bg-white dark:bg-zinc-900">
  <div
    class="flex items-center gap-1 border-b border-zinc-200 bg-zinc-50 px-2 dark:border-zinc-700 dark:bg-zinc-800"
  >
    {#each [["preview", "Preview"], ["log", "Compile Log"]] as const as [id, label] (id)}
      <button
        class="relative border-b-2 px-3 py-1.5 text-sm {activeTab === id
          ? 'border-sky-500 font-medium text-zinc-900 dark:text-zinc-100'
          : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'}"
        onclick={() => (activeTab = id)}
      >
        {label}
        {#if id === "log" && status === "error"}
          <span class="absolute -top-0 -right-0 h-2 w-2 rounded-full bg-red-500"></span>
        {/if}
      </button>
    {/each}
    <div class="grow"></div>
    <span
      class="flex items-center gap-1.5 px-2 text-xs"
      data-testid="render-status"
      data-status={status}
    >
      {#if status === "rendering"}
        <span
          class="h-3 w-3 animate-spin rounded-full border-[1.5px] border-sky-500 border-t-transparent"
          aria-hidden="true"
        ></span>
        <span class="text-sky-600 dark:text-sky-400">Recompiling…</span>
      {:else if status === "stale"}
        <span class="h-2 w-2 rounded-full bg-amber-500"></span>
        <span class="text-amber-600 dark:text-amber-400">Out of date</span>
      {:else if status === "error"}
        <span class="h-2 w-2 rounded-full bg-red-500"></span>
        <span class="text-red-500">Compile failed — see log</span>
      {:else if status === "ok"}
        <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
        <span class="text-zinc-400">Up to date</span>
      {:else}
        <span class="text-zinc-400">Not compiled</span>
      {/if}
    </span>
  </div>

  {#if activeTab === "preview"}
    <iframe
      title="Rendered preview"
      class="h-full w-full grow border-0 bg-white"
      style={dragging ? "pointer-events: none" : ""}
      sandbox="allow-same-origin allow-scripts"
      srcdoc={html}
    ></iframe>
  {:else}
    <pre
      class="h-full grow overflow-auto bg-zinc-50 p-3 font-mono text-xs whitespace-pre-wrap text-zinc-800 select-text dark:bg-zinc-900 dark:text-zinc-200">{log ||
        "No compilation has run yet."}</pre>
  {/if}
</div>
