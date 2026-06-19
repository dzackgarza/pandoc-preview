<script lang="ts">
  // Workspace-search sidebar pane (Phase E / E1 / P101+P102). The global
  // full-text content search across the open project — a sibling of the
  // explorer / references panes in SIDEBAR_VIEWS, riding the P18 activity-bar
  // model. Distinct from in-file find and from filename filtering: this searches
  // file CONTENT across every workspace file.
  //
  // The panel is presentational + input: it owns the query box and the
  // per-directory scope control, and renders the result list App.svelte computes
  // (via api.workspaceSearch → the workspace-search firewall plugin running real
  // ripgrep). Each result carries data-search-result="<project-relative path>"
  // (the stable click-free observable) and data-heat-rank="<integer>" (the
  // relevancy weight, higher = hotter), surfaced ALSO as a discriminable heat
  // CSS class so the user can tell a high-match file from a low-match one.
  // Clicking a result opens that file in the editor at the matched line.
  import type { SearchResult } from "../types";

  let {
    results,
    query,
    scope,
    onSearch,
    onScopeChange,
    onOpenResult,
  }: {
    results: SearchResult[];
    query: string;
    scope: string;
    onSearch: (query: string) => void;
    onScopeChange: (scope: string) => void;
    onOpenResult: (result: SearchResult) => void;
  } = $props();

  // Local input mirrors of the parent's query/scope, kept in sync when the
  // parent changes them (e.g. the E2E setSearchScope hook) without re-seeding on
  // every keystroke. The parent's search state is the source of truth; the
  // submit handler pushes the local edits back up.
  let queryInput = $state("");
  let scopeInput = $state("");
  $effect(() => {
    queryInput = query;
  });
  $effect(() => {
    scopeInput = scope;
  });

  // The discriminable heat class for a result: bucket its heatRank against the
  // highest rank in the current result set into three classes (low / mid / high),
  // mirroring Zettlr's green=high / blue=relevant / gray=low heatmap. The
  // data-heat-rank integer is the decidable observable; the class is the visible
  // surface.
  const maxRank = $derived(results.reduce((m, r) => Math.max(m, r.heatRank), 0));
  function heatClass(rank: number): string {
    if (maxRank <= 0) return "heat-low";
    const frac = rank / maxRank;
    if (frac >= 0.66) return "heat-high";
    if (frac >= 0.33) return "heat-mid";
    return "heat-low";
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    onScopeChange(scopeInput.trim());
    onSearch(queryInput);
  }
</script>

<div class="flex h-full flex-col bg-zinc-50 dark:bg-zinc-800">
  <div
    class="flex w-full shrink-0 items-center gap-1 border-b border-zinc-200 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
  >
    <span>Search</span>
  </div>

  <form class="flex shrink-0 flex-col gap-1.5 border-b border-zinc-200 px-2 py-2 dark:border-zinc-700" onsubmit={submit}>
    <input
      type="text"
      bind:value={queryInput}
      placeholder={'Search content — space=AND, | =OR, !term=NOT, "phrase"'}
      data-search-query
      class="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-800 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
    />
    <input
      type="text"
      bind:value={scopeInput}
      placeholder="Scope to subdirectory (blank = whole project)"
      data-search-scope
      class="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200"
    />
  </form>

  <div class="min-h-0 grow overflow-auto px-1 py-1" data-testid="search-results">
    {#if results.length === 0}
      <div class="px-2 py-1 text-xs text-zinc-400">No content matches</div>
    {:else}
      {#each results as result (result.path)}
        <button
          type="button"
          class={`search-result flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-zinc-200 dark:hover:bg-zinc-700 ${heatClass(result.heatRank)}`}
          data-search-result={result.path}
          data-heat-rank={result.heatRank}
          onclick={() => onOpenResult(result)}
        >
          <span class="flex w-full items-center gap-1.5">
            <span class="heat-dot inline-block h-2 w-2 shrink-0 rounded-full"></span>
            <span class="truncate text-sm text-zinc-800 dark:text-zinc-100">{result.path}</span>
            <span class="ml-auto shrink-0 text-xs text-zinc-400">{result.heatRank}</span>
          </span>
          {#if result.hits.length > 0}
            <span class="truncate pl-3.5 text-xs text-zinc-500 dark:text-zinc-400">
              {result.hits[0].line}: {result.hits[0].text.trim()}
            </span>
          {/if}
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  /* Discriminable heat classes (Zettlr-style relevancy heatmap): the heat dot's
     colour distinguishes a high-match file from a low-match one at a glance. The
     data-heat-rank integer remains the decidable observable. */
  .search-result.heat-high .heat-dot {
    background-color: rgb(34 197 94); /* green-500 — high heat */
  }
  .search-result.heat-mid .heat-dot {
    background-color: rgb(59 130 246); /* blue-500 — relevant */
  }
  .search-result.heat-low .heat-dot {
    background-color: rgb(161 161 170); /* zinc-400 — low heat */
  }
</style>
