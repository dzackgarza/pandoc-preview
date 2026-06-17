<script lang="ts">
  import { untrack } from "svelte";

  // A two-integer dimension picker modal, shared by the insertion bar's matrix
  // builder (rows × cols, P57) and table builder (cols × body-rows, P58). The
  // caller supplies the title, the two field descriptors (label + the
  // data-attribute the proof DOM contract keys on), their initial values, and a
  // confirm callback that receives the two parsed positive integers in field
  // order. The confirm callback routes into App.insertMatrix / App.insertTable —
  // the SAME handlers the P57/P58 hooks call — so the inserted content is
  // identical whether driven by this modal or the hook.
  let {
    title,
    firstLabel,
    firstAttr,
    firstInitial,
    secondLabel,
    secondAttr,
    secondInitial,
    confirmAttr,
    onConfirm,
    onCancel,
  }: {
    title: string;
    firstLabel: string;
    firstAttr: string;
    firstInitial: number;
    secondLabel: string;
    secondAttr: string;
    secondInitial: number;
    confirmAttr: string;
    onConfirm: (first: number, second: number) => void;
    onCancel: () => void;
  } = $props();

  // The modal is created fresh per open, so capturing the initial dims once is
  // intentional (same pattern as PromptModal's seeded field).
  let first = $state(untrack(() => firstInitial));
  let second = $state(untrack(() => secondInitial));

  // Confirm with the two values. The shared handlers (buildMatrixSnippet /
  // buildTableSnippet) already reject non-positive-integer dimensions loudly, so
  // this passes the parsed numbers straight through.
  function confirm() {
    onConfirm(first, second);
  }
</script>

<div
  class="fixed inset-0 z-40 flex items-start justify-center bg-black/40 pt-32"
  role="presentation"
  onclick={(e) => e.target === e.currentTarget && onCancel()}
>
  <div class="w-80 rounded-lg bg-white p-4 shadow-xl dark:bg-zinc-800">
    <h2 class="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</h2>
    <div class="flex items-end gap-3">
      <label class="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-300">
        {firstLabel}
        <input
          type="number"
          min="1"
          bind:value={first}
          {...{ [firstAttr]: "" }}
          class="w-20 rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-sky-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
        />
      </label>
      <span class="pb-2 text-zinc-400">×</span>
      <label class="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-300">
        {secondLabel}
        <input
          type="number"
          min="1"
          bind:value={second}
          {...{ [secondAttr]: "" }}
          class="w-20 rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-sky-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
        />
      </label>
    </div>
    <div class="mt-4 flex justify-end gap-2">
      <button
        class="rounded px-3 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
        onclick={onCancel}>Cancel</button
      >
      <button
        class="rounded bg-sky-600 px-3 py-1 text-sm text-white hover:bg-sky-500"
        {...{ [confirmAttr]: "" }}
        onclick={confirm}>Insert</button
      >
    </div>
  </div>
</div>
