<script lang="ts">
  import type { Config } from "../types";

  let {
    config,
    configPath,
    onSave,
    onCancel,
  }: {
    config: Config;
    configPath: string;
    onSave: (next: Config) => void;
    onCancel: () => void;
  } = $props();

  // Editable working copy; the live config is only replaced on Save.
  let draft = $state<Config>(JSON.parse(JSON.stringify(config)));
  let extraArgsText = $state(config.pandoc.extra_args.join("\n"));
  let pane = $state<"general" | "editor" | "preview" | "pandoc">("general");

  const panes = [
    ["general", "General"],
    ["editor", "Editor"],
    ["preview", "Preview"],
    ["pandoc", "Pandoc"],
  ] as const;

  let error = $state<string | null>(null);

  function save() {
    if (draft.editor.font_size < 8 || draft.editor.font_size > 48) {
      error = "Font size must be between 8 and 48.";
      return;
    }
    if (draft.preview.debounce_ms < 0 || draft.preview.debounce_ms > 10000) {
      error = "Debounce must be between 0 and 10000 ms.";
      return;
    }
    if (!draft.pandoc.path.trim()) {
      error = "Pandoc path must not be empty.";
      return;
    }
    if (!draft.pandoc.from_format.trim()) {
      error = "Pandoc input format must not be empty.";
      return;
    }
    draft.pandoc.extra_args = extraArgsText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    onSave(JSON.parse(JSON.stringify(draft)));
  }

  const labelCls = "block text-sm text-zinc-700 dark:text-zinc-300";
  const inputCls =
    "mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-sky-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100";
</script>

<div
  class="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
  role="presentation"
  onclick={(e) => e.target === e.currentTarget && onCancel()}
>
  <div
    class="flex h-[480px] w-[680px] flex-col rounded-lg bg-white shadow-2xl dark:bg-zinc-800"
  >
    <div class="border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-700">
      <h2 class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Settings</h2>
    </div>

    <div class="flex grow overflow-hidden">
      <nav class="w-40 shrink-0 border-r border-zinc-200 p-2 dark:border-zinc-700">
        {#each panes as [id, label] (id)}
          <button
            class="mb-0.5 block w-full rounded px-3 py-1.5 text-left text-sm {pane === id
              ? 'bg-sky-100 font-medium text-sky-900 dark:bg-sky-900/50 dark:text-sky-100'
              : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700'}"
            onclick={() => (pane = id)}
          >
            {label}
          </button>
        {/each}
      </nav>

      <div class="grow space-y-4 overflow-auto p-4">
        {#if pane === "general"}
          <label class={labelCls}>
            Theme
            <select bind:value={draft.general.theme} class={inputCls}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
        {:else if pane === "editor"}
          <label class={labelCls}>
            Font size (px)
            <input type="number" min="8" max="48" bind:value={draft.editor.font_size} class={inputCls} />
          </label>
          <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" bind:checked={draft.editor.line_wrapping} />
            Wrap long lines
          </label>
          <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" bind:checked={draft.editor.line_numbers} />
            Show line numbers
          </label>
        {:else if pane === "preview"}
          <label class={labelCls}>
            Render debounce (ms)
            <input type="number" min="0" max="10000" step="50" bind:value={draft.preview.debounce_ms} class={inputCls} />
          </label>
          <label class={labelCls}>
            Math engine
            <select bind:value={draft.preview.math} class={inputCls}>
              <option value="katex">KaTeX</option>
              <option value="mathjax">MathJax</option>
            </select>
          </label>
        {:else if pane === "pandoc"}
          <label class={labelCls}>
            Pandoc executable
            <input type="text" bind:value={draft.pandoc.path} class={inputCls} />
          </label>
          <label class={labelCls}>
            Input format (--from)
            <input type="text" bind:value={draft.pandoc.from_format} class={inputCls} />
          </label>
          <label class={labelCls}>
            Extra arguments (one per line)
            <textarea rows="5" bind:value={extraArgsText} class="{inputCls} font-mono"></textarea>
          </label>
        {/if}
      </div>
    </div>

    <div
      class="flex items-center gap-3 border-t border-zinc-200 px-4 py-2.5 dark:border-zinc-700"
    >
      <span class="grow truncate text-xs text-zinc-400" title={configPath}>
        {configPath}
      </span>
      {#if error}
        <span class="text-xs text-red-500">{error}</span>
      {/if}
      <button
        class="rounded px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
        onclick={onCancel}>Cancel</button
      >
      <button
        class="rounded bg-sky-600 px-3 py-1 text-sm text-white hover:bg-sky-500"
        onclick={save}>Save</button
      >
    </div>
  </div>
</div>
