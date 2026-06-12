<script lang="ts">
  import { toasts, dismiss } from "../toast.svelte";

  const styles = {
    info: "bg-zinc-800 text-zinc-100 dark:bg-zinc-700",
    success: "bg-emerald-700 text-emerald-50",
    error: "bg-red-700 text-red-50",
  } as const;
</script>

<div class="pointer-events-none fixed right-4 bottom-10 z-50 flex flex-col gap-2">
  {#each toasts as toast (toast.id)}
    <button
      class="pointer-events-auto max-w-md rounded-lg px-4 py-2 text-left text-sm shadow-lg {styles[
        toast.kind
      ]}"
      title="Dismiss"
      onclick={() => dismiss(toast.id)}
    >
      {toast.message}
    </button>
  {/each}
</div>
