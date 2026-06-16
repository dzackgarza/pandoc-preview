<script lang="ts">
  import { pandocDivEnvironments } from "codemirror-lang-latex/dist/pandoc-markdown";

  let {
    onInsertEnvironment,
    onInsertDiagram,
    onInsertSnippet,
    onInsertCodeBlock,
    onPasteImage,
    snippetTriggers,
    codeBlockLanguages,
    fileOpen,
  }: {
    onInsertEnvironment: (env: string) => void;
    onInsertDiagram: (kind: "tikz" | "tikzcd") => void;
    // Choose a config-dictionary snippet trigger from the bar dropdown (P59).
    onInsertSnippet: (trigger: string) => void;
    // Choose a language from the code-block-type dropdown (P60): inserts a
    // fenced code block tagged with that language at the cursor.
    onInsertCodeBlock: (lang: string) => void;
    // Paste the system clipboard's image: write it into the configured figures
    // dir and insert a markdown image reference at the cursor (P62).
    onPasteImage: () => void;
    // The config-owned snippet dictionary's triggers the dropdown surfaces (P59).
    snippetTriggers: readonly string[];
    // The languages the code-block-type dropdown offers (P60).
    codeBlockLanguages: readonly string[];
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
  <button
    class="rounded px-2 py-0.5 text-sm text-zinc-700 hover:bg-zinc-200 disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-zinc-700"
    title="Paste image from clipboard into the configured figures directory"
    data-paste-image
    disabled={!fileOpen}
    onclick={() => onPasteImage()}
  >
    paste image
  </button>
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
  {#if snippetTriggers.length > 0}
    <span class="mx-1 h-4 w-px bg-zinc-300 dark:bg-zinc-600"></span>
    <select
      class="rounded px-2 py-0.5 text-sm text-zinc-700 hover:bg-zinc-200 disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-zinc-700"
      title="Insert a snippet from the configured dictionary"
      data-insert-snippet
      disabled={!fileOpen}
      value=""
      onchange={(e) => {
        const trigger = e.currentTarget.value;
        if (trigger.length === 0) return;
        onInsertSnippet(trigger);
        e.currentTarget.value = "";
      }}
    >
      <option value="" disabled>snippet</option>
      {#each snippetTriggers as trigger (trigger)}
        <option value={trigger}>{trigger}</option>
      {/each}
    </select>
  {/if}
  {#if codeBlockLanguages.length > 0}
    <span class="mx-1 h-4 w-px bg-zinc-300 dark:bg-zinc-600"></span>
    <select
      class="rounded px-2 py-0.5 text-sm text-zinc-700 hover:bg-zinc-200 disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-zinc-700"
      title="Insert a fenced code block tagged with a language"
      data-insert-codeblock
      disabled={!fileOpen}
      value=""
      onchange={(e) => {
        const lang = e.currentTarget.value;
        if (lang.length === 0) return;
        onInsertCodeBlock(lang);
        e.currentTarget.value = "";
      }}
    >
      <option value="" disabled>code</option>
      {#each codeBlockLanguages as lang (lang)}
        <option value={lang}>{lang}</option>
      {/each}
    </select>
  {/if}
</div>
