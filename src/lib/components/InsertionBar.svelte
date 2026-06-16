<script lang="ts">
  import { pandocDivEnvironments } from "codemirror-lang-latex/dist/pandoc-markdown";

  let {
    onInsertEnvironment,
    fileOpen,
  }: {
    onInsertEnvironment: (env: string) => void;
    fileOpen: boolean;
  } = $props();
</script>

<div
  class="flex items-center gap-0.5 border-b border-zinc-200 bg-zinc-50 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
>
  {#each pandocDivEnvironments as env (env)}
    <button
      class="rounded px-2 py-0.5 text-sm capitalize text-zinc-700 hover:bg-zinc-200 disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-zinc-700"
      title={`Insert ${env} environment`}
      data-insert-env={env}
      disabled={!fileOpen}
      onclick={() => onInsertEnvironment(env)}
    >
      {env}
    </button>
  {/each}
</div>
