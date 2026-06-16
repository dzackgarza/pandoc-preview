<script lang="ts">
  import { pandocDivEnvironments } from "codemirror-lang-latex/dist/pandoc-markdown";

  let {
    onInsertEnvironment,
    onInsertDiagram,
    fileOpen,
  }: {
    onInsertEnvironment: (env: string) => void;
    onInsertDiagram: (kind: "tikz" | "tikzcd") => void;
    fileOpen: boolean;
  } = $props();

  // Diagram scaffolds offered by the bar. tikzcd = commutative diagram,
  // tikz = general tikzpicture. The labels are the scaffold kinds.
  const diagramKinds: readonly ("tikz" | "tikzcd")[] = ["tikz", "tikzcd"];
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
  <span class="mx-1 h-4 w-px bg-zinc-300 dark:bg-zinc-600"></span>
  {#each diagramKinds as kind (kind)}
    <button
      class="rounded px-2 py-0.5 text-sm text-zinc-700 hover:bg-zinc-200 disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-zinc-700"
      title={`Insert ${kind} diagram scaffold`}
      data-insert-diagram={kind}
      disabled={!fileOpen}
      onclick={() => onInsertDiagram(kind)}
    >
      {kind}
    </button>
  {/each}
</div>
