<script lang="ts">
  // The insertion bar's footnote modal (P61): the user types the footnote body
  // and confirms; onConfirm receives the typed body and routes into
  // App.insertFootnote — the SAME handler the P61 hook calls — which inserts a
  // reference marker at the cursor plus a matching definition line carrying the
  // body. Empty bodies are rejected (a footnote with no body is not a footnote).
  let {
    onConfirm,
    onCancel,
  }: {
    onConfirm: (body: string) => void;
    onCancel: () => void;
  } = $props();

  let body = $state("");
  let textarea: HTMLTextAreaElement;

  $effect(() => {
    textarea.focus();
  });

  function confirm() {
    if (body.length > 0) onConfirm(body);
  }
</script>

<div
  class="fixed inset-0 z-40 flex items-start justify-center bg-black/40 pt-32"
  role="presentation"
  onclick={(e) => e.target === e.currentTarget && onCancel()}
>
  <div class="w-96 rounded-lg bg-white p-4 shadow-xl dark:bg-zinc-800">
    <h2 class="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">Footnote</h2>
    <textarea
      bind:this={textarea}
      bind:value={body}
      data-footnote-body
      rows="3"
      placeholder="Footnote body…"
      class="w-full resize-y rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-sky-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
      onkeydown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    ></textarea>
    <div class="mt-3 flex justify-end gap-2">
      <button
        class="rounded px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
        onclick={onCancel}>Cancel</button
      >
      <button
        class="rounded bg-sky-600 px-3 py-1 text-sm text-white hover:bg-sky-500"
        data-footnote-confirm
        onclick={confirm}>Insert</button
      >
    </div>
  </div>
</div>
