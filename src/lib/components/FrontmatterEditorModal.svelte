<script lang="ts">
  import { untrack } from "svelte";
  import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

  // P106 (E5): the structured YAML frontmatter editor. It owns the document's
  // leading `--- … ---` block and NOTHING else — on confirm it rewrites ONLY
  // that block (re-emitted with the maintained `yaml` package, the same one C4
  // parses per-file bibliography overrides with) and splices it back ahead of
  // the ORIGINAL body bytes, which are passed through untouched. A buffer with
  // no frontmatter gains a well-formed block at its head, above the body.
  //
  // Sibling of SettingsModal: the `.fixed.inset-0` panel, the `<h2>` title, the
  // footer `Save`/`Cancel`, and one stable-hooked input per known field (the
  // `data-setting="…"` convention, here `data-frontmatter="…"`).
  let {
    buffer,
    onSave,
    onCancel,
  }: {
    buffer: string;
    onSave: (nextBuffer: string) => void;
    onCancel: () => void;
  } = $props();

  // The five fields P106 owns. Order here is the emit/render order.
  const FIELDS = ["title", "author", "date", "bibliography", "csl"] as const;
  type Field = (typeof FIELDS)[number];

  // Split the buffer into its leading `--- … ---` block and the body that
  // follows. `body` is EVERY byte after the closing fence line's EOL — the
  // exact region whose bytes must survive a confirm unchanged. Returns null
  // when the buffer does not begin with a `---` block. Mirrors the spec's
  // splitFrontmatter so the splice the spec re-reads is the one built here.
  function split(text: string): { yamlSource: string; body: string } | null {
    if (!text.startsWith("---\n")) return null;
    const close = text.indexOf("\n---", 3);
    if (close < 0) return null;
    const afterClose = close + "\n---".length;
    const rest = text.slice(afterClose);
    const bodyStart = rest.startsWith("\n") ? 1 : 0;
    const yamlSource = text.slice("---\n".length, close + 1);
    const body = rest.slice(bodyStart);
    return { yamlSource, body };
  }

  // Parse the existing block ONCE on open. Any keys outside the five owned
  // fields are preserved verbatim into the re-emit (the SettingsModal "edit a
  // working copy of the whole config" discipline). A document with no block
  // parses to an empty object and keeps an empty body.
  const initial = untrack(() => {
    const parts = split(buffer);
    const parsed =
      parts === null
        ? {}
        : ((parseYaml(parts.yamlSource) ?? {}) as Record<string, unknown>);
    const body = parts === null ? buffer : parts.body;
    const draft: Record<Field, string> = {
      title: "",
      author: "",
      date: "",
      bibliography: "",
      csl: "",
    };
    for (const f of FIELDS) {
      const v = parsed[f];
      if (v !== undefined && v !== null) draft[f] = String(v);
    }
    return { parsed, body, draft };
  });

  let draft = $state<Record<Field, string>>(initial.draft);

  function save() {
    // Start from the parsed block so unknown keys survive; set the owned
    // fields from the form (an empty field DELETES that key — the editor's
    // truth is the form). Re-emit with the `yaml` package: never hand-built.
    const next: Record<string, unknown> = { ...initial.parsed };
    for (const f of FIELDS) {
      const value = draft[f].trim();
      if (value) next[f] = value;
      else delete next[f];
    }
    const yamlSource = stringifyYaml(next);
    // Reassemble: a well-formed `--- … ---` block ahead of the ORIGINAL body
    // bytes. `stringifyYaml` ends every emit with a newline, so the closing
    // fence is `---` and the body follows after the fence's own EOL — the
    // inverse of `split`, so a re-split recovers exactly this body.
    const nextBuffer = `---\n${yamlSource}---\n${initial.body}`;
    onSave(nextBuffer);
  }

  const labelCls = "block text-sm text-zinc-700 dark:text-zinc-300";
  const inputCls =
    "mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-sky-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100";

  const FIELD_LABELS: Record<Field, string> = {
    title: "Title",
    author: "Author",
    date: "Date",
    bibliography: "Bibliography",
    csl: "CSL",
  };
</script>

<div
  class="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
  role="presentation"
  onclick={(e) => e.target === e.currentTarget && onCancel()}
>
  <div
    class="flex max-h-[480px] w-[560px] flex-col rounded-lg bg-white shadow-2xl dark:bg-zinc-800"
  >
    <div class="border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-700">
      <h2 class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Frontmatter</h2>
    </div>

    <div class="grow space-y-4 overflow-auto p-4">
      {#each FIELDS as field (field)}
        <label class={labelCls}>
          {FIELD_LABELS[field]}
          <input
            type="text"
            data-frontmatter={field}
            bind:value={draft[field]}
            class={inputCls}
          />
        </label>
      {/each}
    </div>

    <div
      class="flex items-center gap-3 border-t border-zinc-200 px-4 py-2.5 dark:border-zinc-700"
    >
      <span class="grow"></span>
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
