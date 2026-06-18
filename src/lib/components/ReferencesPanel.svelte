<script lang="ts">
  // References sidebar pane (P89). The panel lists ONLY the references the
  // current document cites, rendered in the configured citation style. Its data
  // is the preview's resolved bibliography: pandoc --citeproc produces a
  // `#refs` block in the rendered preview HTML that contains exactly the cited
  // keys (one `div#ref-<key>` per cited entry, p27), each rendered as CSL text.
  // We reuse THAT block as the single source of truth — we do NOT re-run
  // citeproc and we do NOT format CSL in JS. The panel parses the same `html`
  // the preview pane renders, extracts every `#refs` entry, and shows its
  // rendered HTML. Because citeproc only emits `#ref-<key>` for keys the
  // document actually cites, an uncited bibliography entry never appears here —
  // the cited-only and live-update properties are inherited from the preview's
  // own render, not re-derived.
  let { html }: { html: string } = $props();

  type Reference = { id: string; html: string };

  // Extract the cited bibliography entries from the preview's rendered HTML.
  // Each citeproc bibliography entry is a `div[id^="ref-"]` inside `#refs`;
  // its innerHTML is the CSL-rendered reference text the preview shows.
  const references = $derived<Reference[]>(parseReferences(html));

  function parseReferences(rendered: string): Reference[] {
    if (!rendered) return [];
    const doc = new DOMParser().parseFromString(rendered, "text/html");
    const refs = doc.querySelector("#refs");
    if (!refs) return [];
    return Array.from(refs.querySelectorAll('[id^="ref-"]')).map((el) => ({
      id: el.id,
      html: el.innerHTML,
    }));
  }
</script>

<div class="flex h-full flex-col bg-zinc-50 dark:bg-zinc-800">
  <div
    class="flex w-full shrink-0 items-center gap-1 border-b border-zinc-200 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
  >
    <span>References</span>
  </div>

  <div class="min-h-0 grow overflow-auto px-2 py-1" data-testid="references">
    {#if references.length === 0}
      <div class="px-1 py-1 text-xs text-zinc-400">
        No references cited in this document
      </div>
    {:else}
      {#each references as ref (ref.id)}
        <div
          class="csl-entry border-b border-zinc-200 py-2 text-sm text-zinc-700 last:border-0 dark:border-zinc-700 dark:text-zinc-300"
          data-ref={ref.id}
        >
          {@html ref.html}
        </div>
      {/each}
    {/if}
  </div>
</div>
