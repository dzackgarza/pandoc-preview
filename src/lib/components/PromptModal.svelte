<script lang="ts">
  // Minimal text-input modal: the dialog plugin has no text prompt, so file
  // and folder names are collected here.
  let {
    title,
    initial,
    onSubmit,
    onCancel,
  }: {
    title: string;
    initial: string;
    onSubmit: (value: string) => void;
    onCancel: () => void;
  } = $props();

  let value = $state(initial);
  let input: HTMLInputElement;

  $effect(() => {
    input.focus();
    input.select();
  });

  function submit() {
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
  }
</script>

<div
  class="fixed inset-0 z-40 flex items-start justify-center bg-black/40 pt-32"
  role="presentation"
  onclick={(e) => e.target === e.currentTarget && onCancel()}
>
  <div class="w-96 rounded-lg bg-white p-4 shadow-xl dark:bg-zinc-800">
    <h2 class="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</h2>
    <input
      bind:this={input}
      bind:value
      class="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-sky-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
      onkeydown={(e) => {
        if (e.key === "Enter") submit();
        if (e.key === "Escape") onCancel();
      }}
    />
    <div class="mt-3 flex justify-end gap-2">
      <button
        class="rounded px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
        onclick={onCancel}>Cancel</button
      >
      <button
        class="rounded bg-sky-600 px-3 py-1 text-sm text-white hover:bg-sky-500"
        onclick={submit}>OK</button
      >
    </div>
  </div>
</div>
