<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { EditorView, keymap, lineNumbers } from "@codemirror/view";
  import { EditorState, Compartment, EditorSelection } from "@codemirror/state";
  import { basicSetup } from "codemirror";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { languages } from "@codemirror/language-data";
  import { undo, redo, selectAll } from "@codemirror/commands";
  import { openSearchPanel } from "@codemirror/search";
  import { oneDark } from "@codemirror/theme-one-dark";
  import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
  import type { Config } from "../types";
  import { toastError } from "../toast.svelte";

  let {
    config,
    onChange,
    onCursor,
  }: {
    config: Config;
    onChange: (content: string) => void;
    onCursor: (line: number, col: number) => void;
  } = $props();

  let host: HTMLDivElement;
  let view: EditorView;

  const themeCompartment = new Compartment();
  const wrapCompartment = new Compartment();
  const gutterCompartment = new Compartment();
  const fontCompartment = new Compartment();

  const fontTheme = (px: number) =>
    EditorView.theme({ "&": { fontSize: `${px}px` } });

  const editorTheme = (theme: "dark" | "light") =>
    theme === "dark" ? oneDark : [];

  function configured(c: Config) {
    return {
      theme: editorTheme(c.general.theme),
      wrap: c.editor.line_wrapping ? EditorView.lineWrapping : [],
      gutter: c.editor.line_numbers ? lineNumbers() : [],
      font: fontTheme(c.editor.font_size),
    };
  }

  onMount(() => {
    const init = configured(config);
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "",
        extensions: [
          basicSetup,
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          keymap.of([
            { key: "Mod-b", run: () => (wrapSelection("**", "**"), true) },
            { key: "Mod-i", run: () => (wrapSelection("*", "*"), true) },
            { key: "Mod-k", run: () => (insertLink(), true) },
          ]),
          themeCompartment.of(init.theme),
          wrapCompartment.of(init.wrap),
          gutterCompartment.of(init.gutter),
          fontCompartment.of(init.font),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChange(u.state.doc.toString());
            if (u.selectionSet || u.docChanged) {
              const head = u.state.selection.main.head;
              const line = u.state.doc.lineAt(head);
              onCursor(line.number, head - line.from + 1);
            }
          }),
        ],
      }),
    });
  });

  onDestroy(() => view?.destroy());

  // Live-apply settings changes without recreating the editor.
  $effect(() => {
    const next = configured(config);
    view?.dispatch({
      effects: [
        themeCompartment.reconfigure(next.theme),
        wrapCompartment.reconfigure(next.wrap),
        gutterCompartment.reconfigure(next.gutter),
        fontCompartment.reconfigure(next.font),
      ],
    });
  });

  export function getContent(): string {
    return view.state.doc.toString();
  }

  export function setContent(content: string) {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
      selection: EditorSelection.cursor(0),
    });
    view.focus();
  }

  export function focus() {
    view.focus();
  }

  /** Append text at the end of the buffer through the real CM update
   * pipeline, so the docChanged updateListener fires exactly as it does for
   * user typing (used by the E2E harness; the bridge cannot synthesize key
   * events into CodeMirror's contentEditable). */
  export function appendAtEnd(text: string) {
    const end = view.state.doc.length;
    view.dispatch({
      changes: { from: end, insert: text },
      selection: EditorSelection.cursor(end + text.length),
    });
    view.focus();
  }

  /** Wrap the current selection (or insert a placeholder) with markdown markers. */
  export function wrapSelection(before: string, after: string, placeholder = "text") {
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to) || placeholder;
    view.dispatch({
      changes: { from, to, insert: `${before}${selected}${after}` },
      selection: EditorSelection.range(from + before.length, from + before.length + selected.length),
    });
    view.focus();
  }

  /** Prefix every line of the current selection (headings, lists, quotes). */
  export function prefixLines(prefix: string) {
    const { from, to } = view.state.selection.main;
    const first = view.state.doc.lineAt(from).number;
    const last = view.state.doc.lineAt(to).number;
    const changes = [];
    for (let n = first; n <= last; n++) {
      changes.push({ from: view.state.doc.line(n).from, insert: prefix });
    }
    view.dispatch({ changes });
    view.focus();
  }

  export function insertLink() {
    wrapSelection("[", "](url)");
  }

  export function insertImage() {
    wrapSelection("![", "](path)", "alt");
  }

  export function insertCodeBlock() {
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to) || "code";
    view.dispatch({
      changes: { from, to, insert: "```\n" + selected + "\n```\n" },
    });
    view.focus();
  }

  /** Dispatch a named editor command coming from the native Edit menu. */
  export async function command(
    id: "undo" | "redo" | "cut" | "copy" | "paste" | "select_all" | "find",
  ) {
    switch (id) {
      case "undo":
        undo(view);
        break;
      case "redo":
        redo(view);
        break;
      case "select_all":
        selectAll(view);
        break;
      case "find":
        openSearchPanel(view);
        break;
      case "copy":
      case "cut": {
        const { from, to } = view.state.selection.main;
        if (from === to) break;
        await writeText(view.state.sliceDoc(from, to));
        if (id === "cut") view.dispatch({ changes: { from, to, insert: "" } });
        break;
      }
      case "paste": {
        try {
          const text = await readText();
          const { from, to } = view.state.selection.main;
          view.dispatch({
            changes: { from, to, insert: text },
            selection: EditorSelection.cursor(from + text.length),
          });
        } catch (e) {
          toastError(`Clipboard read failed: ${e}`);
        }
        break;
      }
    }
    view.focus();
  }
</script>

<div bind:this={host} class="cm-host bg-white dark:bg-[#282c34]"></div>
