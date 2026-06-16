<script lang="ts">
  import type { RepoState } from "../types";

  let {
    filePath,
    projectRoot,
    dirty,
    wordCount,
    cursorLine,
    cursorCol,
    repoState,
    onRepoInit,
    onRepoTrack,
  }: {
    filePath: string | null;
    projectRoot: string | null;
    dirty: boolean;
    wordCount: number;
    cursorLine: number;
    cursorCol: number;
    repoState: RepoState | null;
    onRepoInit: () => void;
    onRepoTrack: () => void;
  } = $props();

  const displayPath = $derived(
    filePath && projectRoot && filePath.startsWith(projectRoot)
      ? filePath.slice(projectRoot.length + 1)
      : filePath,
  );

  // Human-readable label per state; the machine value lives in data-repo-state.
  const repoLabel: Record<RepoState, string> = {
    noRepo: "No repository",
    untracked: "Untracked",
    tracked: "Tracked",
  };
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
  {#if filePath && repoState}
    <!-- Repo-state machine (P46): indicator reflects REAL git state of the open
         file; the action buttons drive a real init / stage on disk, then the
         indicator is re-queried (App.svelte), never optimistically relabeled. -->
    <span
      data-repo-state={repoState}
      class="rounded px-1.5 py-0.5"
      class:bg-amber-200={repoState === "noRepo"}
      class:bg-yellow-100={repoState === "untracked"}
      class:bg-emerald-100={repoState === "tracked"}
      class:dark:bg-amber-900={repoState === "noRepo"}
      class:dark:bg-yellow-900={repoState === "untracked"}
      class:dark:bg-emerald-900={repoState === "tracked"}
    >
      {repoLabel[repoState]}
    </span>
    {#if repoState === "noRepo"}
      <button
        type="button"
        data-repo-action="init"
        class="rounded border border-zinc-300 px-1.5 py-0.5 hover:bg-zinc-200 dark:border-zinc-600 dark:hover:bg-zinc-700"
        onclick={onRepoInit}
      >
        Initialize repository
      </button>
    {:else if repoState === "untracked"}
      <button
        type="button"
        data-repo-action="track"
        class="rounded border border-zinc-300 px-1.5 py-0.5 hover:bg-zinc-200 dark:border-zinc-600 dark:hover:bg-zinc-700"
        onclick={onRepoTrack}
      >
        Start tracking
      </button>
    {/if}
  {/if}
  {#if filePath}
    <span>Ln {cursorLine}, Col {cursorCol}</span>
    <span>{wordCount} words</span>
  {/if}
</div>
