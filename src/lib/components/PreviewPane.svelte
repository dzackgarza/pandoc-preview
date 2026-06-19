<script lang="ts">
  import type { RenderStatus } from "../types";
  import type { LogEntry } from "../editor/complog";
  import type { TikzFigureLogEntry } from "../editor/tikzfigurelog";

  let {
    html,
    log,
    logEntries,
    onEntryClick,
    tikzFigureLogEntries,
    onTikzEntryClick,
    status,
    pdfStatus,
    onPdfViewerMount,
    dragging = false,
    activeTab = $bindable(),
  }: {
    html: string;
    log: string;
    // Structured compile-log entries (A.6 / P74) parsed from the SAME raw `log`,
    // rendered as a clickable list ABOVE the raw text. Activating an entry calls
    // onEntryClick(entry), which jumps the editor to entry.line.
    logEntries: LogEntry[];
    onEntryClick: (entry: LogEntry) => void;
    // Figure-compile log entries (D-6 / P95): the tikz FIGURE-compile diagnostics
    // parsed from the SAME raw `log`, rendered as a clickable list in the TikZ Log
    // tab (DISTINCT from the Compile Log tab's pandoc-render entries). Activating
    // an entry calls onTikzEntryClick(entry), which jumps the editor to the
    // offending tikz source line entry.line.
    tikzFigureLogEntries: TikzFigureLogEntry[];
    onTikzEntryClick: (entry: TikzFigureLogEntry) => void;
    status: RenderStatus;
    // The PDF compile-on-idle scheduler's OWN status (Phase F / F1 / P107), the
    // sibling of `status` for the HTML preview: drives the PDF tab's status
    // cluster (Recompiling…/Up to date/Compile failed). Distinct from `status`.
    pdfStatus: RenderStatus;
    // Called with the PDF viewer container element once the PDF tab mounts it, so
    // App.svelte's PDF scheduler can paint the compiled PDF into it via pdf.js.
    onPdfViewerMount: (el: HTMLElement) => void;
    // True while the editor/preview divider is being dragged: the iframe's
    // pointer-events are disabled so the cursor crossing it cannot swallow the
    // drag's pointermove stream.
    dragging?: boolean;
    activeTab: "preview" | "pdf" | "log" | "tikzlog";
  } = $props();

  // Svelte action: hand the mounted PDF viewer container up to App.svelte so its
  // PDF compile-on-idle scheduler can paint the compiled PDF into it via pdf.js.
  function mountPdfViewer(node: HTMLElement) {
    onPdfViewerMount(node);
  }
</script>

<div class="flex h-full flex-col bg-white dark:bg-zinc-900">
  <div
    class="flex items-center gap-1 border-b border-zinc-200 bg-zinc-50 px-2 dark:border-zinc-700 dark:bg-zinc-800"
  >
    {#each [["preview", "Preview"], ["pdf", "PDF"], ["log", "Compile Log"], ["tikzlog", "TikZ Log"]] as const as [id, label] (id)}
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
        {#if id === "tikzlog" && tikzFigureLogEntries.length > 0}
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
  {:else if activeTab === "pdf"}
    <!-- Embedded pdf.js viewer (Phase F / F1 / P107). The compile-on-idle PDF
         scheduler in App.svelte drives the configured PDF export command to a
         .pdf on disk, then paints it into this container via pdf.js. App receives
         this element through onPdfViewerMount and owns the painting. The PDF
         tab carries its OWN status cluster (pdfStatus), the sibling of the HTML
         render-status. -->
    <div class="flex h-full grow flex-col overflow-hidden">
      <div
        class="flex shrink-0 items-center gap-1.5 border-b border-zinc-200 bg-zinc-50 px-3 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
        data-testid="pdf-render-status"
        data-status={pdfStatus}
      >
        {#if pdfStatus === "rendering"}
          <span
            class="h-3 w-3 animate-spin rounded-full border-[1.5px] border-sky-500 border-t-transparent"
            aria-hidden="true"
          ></span>
          <span class="text-sky-600 dark:text-sky-400">Compiling PDF…</span>
        {:else if pdfStatus === "stale"}
          <span class="h-2 w-2 rounded-full bg-amber-500"></span>
          <span class="text-amber-600 dark:text-amber-400">Out of date</span>
        {:else if pdfStatus === "error"}
          <span class="h-2 w-2 rounded-full bg-red-500"></span>
          <span class="text-red-500">PDF compile failed — see log</span>
        {:else if pdfStatus === "ok"}
          <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
          <span class="text-zinc-400">Up to date</span>
        {:else}
          <span class="text-zinc-400">Not compiled</span>
        {/if}
      </div>
      <div
        class="grow overflow-auto bg-zinc-200 dark:bg-zinc-950"
        data-testid="pdf-viewer"
        use:mountPdfViewer
      ></div>
    </div>
  {:else if activeTab === "tikzlog"}
    <!-- Figure-compile log (D-6 / P95): the tikz FIGURE-compile diagnostics, a
         clickable list parsed from the raw `log` and mapped to the offending
         tikz SOURCE line. Clicking jumps the editor to that source line. This is
         the figure-compile surface, DISTINCT from the Compile Log tab's
         pandoc-render entries. -->
    <div class="flex h-full grow flex-col overflow-hidden">
      {#if tikzFigureLogEntries.length > 0}
        <ul
          class="shrink-0 divide-y divide-zinc-200 overflow-auto border-b border-zinc-200 bg-white dark:divide-zinc-700 dark:border-zinc-700 dark:bg-zinc-800"
          data-testid="tikz-figure-log"
        >
          {#each tikzFigureLogEntries as entry, i (i)}
            <li>
              <button
                type="button"
                class="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700"
                onclick={() => onTikzEntryClick(entry)}
              >
                <span class="font-mono font-semibold text-red-600 dark:text-red-400"
                  >figure</span
                >
                <span class="font-mono text-zinc-400">L{entry.line}</span>
                <span class="grow text-zinc-700 dark:text-zinc-200">{entry.message}</span>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="p-3 text-xs text-zinc-400">No figure-compile errors.</p>
      {/if}
    </div>
  {:else}
    <div class="flex h-full grow flex-col overflow-hidden">
      <!-- Structured entries (A.6 / P74): a clickable list parsed from the raw
           log via the ported pplatex parse. Clicking jumps the editor to the
           cited source line. Shown ABOVE — and ALONGSIDE — the raw log, which
           stays the P11 surface below. -->
      {#if logEntries.length > 0}
        <ul
          class="shrink-0 divide-y divide-zinc-200 overflow-auto border-b border-zinc-200 bg-white dark:divide-zinc-700 dark:border-zinc-700 dark:bg-zinc-800"
          data-testid="structured-log"
        >
          {#each logEntries as entry, i (i)}
            <li>
              <button
                type="button"
                class="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700"
                onclick={() => onEntryClick(entry)}
              >
                <span
                  class="font-mono font-semibold {entry.severity === 'error'
                    ? 'text-red-600 dark:text-red-400'
                    : entry.severity === 'warning'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-sky-600 dark:text-sky-400'}"
                  >{entry.severity}</span
                >
                <span class="font-mono text-zinc-400">L{entry.line}</span>
                <span class="grow text-zinc-700 dark:text-zinc-200"
                  >{entry.message}</span
                >
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      <pre
        class="grow overflow-auto bg-zinc-50 p-3 font-mono text-xs whitespace-pre-wrap text-zinc-800 select-text dark:bg-zinc-900 dark:text-zinc-200">{log ||
          "No compilation has run yet."}</pre>
    </div>
  {/if}
</div>
