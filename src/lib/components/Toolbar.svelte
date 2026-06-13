<script lang="ts">
  let {
    onAction,
    fileOpen,
  }: {
    onAction: (action: string) => void;
    fileOpen: boolean;
  } = $props();

  const buttons: { action: string; label: string; title: string }[] = [
    { action: "h1", label: "H1", title: "Heading 1" },
    { action: "h2", label: "H2", title: "Heading 2" },
    { action: "h3", label: "H3", title: "Heading 3" },
    { action: "bold", label: "B", title: "Bold (Ctrl+B)" },
    { action: "italic", label: "I", title: "Italic (Ctrl+I)" },
    { action: "strike", label: "S̶", title: "Strikethrough" },
    { action: "code", label: "`", title: "Inline code" },
    { action: "codeblock", label: "```", title: "Code block" },
    { action: "link", label: "🔗", title: "Link (Ctrl+K)" },
    { action: "image", label: "🖼", title: "Image" },
    { action: "ul", label: "•", title: "Bullet list" },
    { action: "ol", label: "1.", title: "Numbered list" },
    { action: "quote", label: "❝", title: "Blockquote" },
  ];
</script>

<div
  class="flex items-center gap-0.5 border-b border-zinc-200 bg-zinc-50 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
>
  {#each buttons as b (b.action)}
    <button
      class="rounded px-2 py-0.5 text-sm text-zinc-700 hover:bg-zinc-200 disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-zinc-700"
      title={b.title}
      disabled={!fileOpen}
      onclick={() => onAction(b.action)}
    >
      {b.label}
    </button>
  {/each}
</div>
