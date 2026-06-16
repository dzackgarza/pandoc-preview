<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    EditorView,
    keymap,
    lineNumbers,
    highlightActiveLineGutter,
    highlightSpecialChars,
    drawSelection,
    dropCursor,
    rectangularSelection,
    crosshairCursor,
    highlightActiveLine,
  } from "@codemirror/view";
  import { EditorState, Compartment, EditorSelection } from "@codemirror/state";
  import {
    foldGutter,
    codeFolding,
    foldKeymap,
    indentOnInput,
    syntaxHighlighting,
    defaultHighlightStyle,
    ensureSyntaxTree,
    unfoldAll as cmUnfoldAll,
    foldable,
    foldedRanges,
    foldEffect,
  } from "@codemirror/language";
  import type { SyntaxNode } from "@lezer/common";
  import { latex, latexLanguage, markdownOutline } from "codemirror-lang-latex";
  import type { OutlineItem } from "codemirror-lang-latex";
  import {
    history,
    historyKeymap,
    defaultKeymap,
    undo,
    redo,
    selectAll,
  } from "@codemirror/commands";
  import {
    completionKeymap,
    closeBracketsKeymap,
    startCompletion,
  } from "@codemirror/autocomplete";
  import type {
    CompletionSource,
    CompletionContext,
    CompletionResult,
  } from "@codemirror/autocomplete";
  import {
    openSearchPanel,
    searchKeymap,
    highlightSelectionMatches,
  } from "@codemirror/search";
  import { lintKeymap } from "@codemirror/lint";
  import { indentationMarkers } from "@replit/codemirror-indentation-markers";
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

  // App-owned completion sources, COMPOSED with the LaTeX command source rather
  // than overriding it. latex() folds a single delegating source (below) into
  // its autocomplete override; that delegate fans out to every source in this
  // mutable registry, so app sources can be added after mount without rebuilding
  // the editor. CM6 consults sources in order and merges their results, so a new
  // source surfaces alongside the LaTeX completions instead of displacing them.
  const appCompletionSources: CompletionSource[] = [];

  const delegatingCompletionSource: CompletionSource = (
    context: CompletionContext,
  ): CompletionResult | null => {
    for (const source of appCompletionSources) {
      const result = source(context);
      if (result instanceof Promise) {
        throw new Error(
          "EditorPane app completion sources must be synchronous",
        );
      }
      if (result) return result;
    }
    return null;
  };

  const fontTheme = (px: number) =>
    EditorView.theme({ "&": { fontSize: `${px}px` } });

  const editorTheme = (theme: "dark" | "light") =>
    theme === "dark" ? oneDark : [];

  // Explicit equivalent of codemirror's basicSetup MINUS lineNumbers(): line
  // numbers are owned solely by gutterCompartment so the line_numbers setting
  // can both add AND remove the gutter. basicSetup's lineNumbers lived outside
  // any compartment, which made the toggle inert (the gutter could never be
  // removed). Bracket matching, bracket-closing, and autocomplete are omitted
  // here because latex() provides latex-aware versions (latexBracketMatching,
  // closeBrackets, command completion); duplicating them would double-insert.
  const editorBasics = () => [
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    codeFolding(),
    indentationMarkers(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      ...lintKeymap,
    ]),
  ];

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
          // Line-number gutter first so it renders left of the fold gutter.
          gutterCompartment.of(init.gutter),
          ...editorBasics(),
          // codemirror-lang-latex is the editor's language: it highlights every
          // math mode ($ $$ \( \[ environments), folds, auto-closes envs/
          // brackets, completes commands, and lints. Only checkMissingDocumentEnv
          // is disabled — it fires on every markdown file (no \begin{document}).
          latex({
            linter: { checkMissingDocumentEnv: false },
            // The delegate composes app sources WITH the LaTeX source: both are
            // consulted on every completion query (P51).
            extraCompletionSources: [delegatingCompletionSource],
          }),
          // The buffer is a markdown document, so Ctrl+/ comments with <!-- -->
          // rather than the latex grammar's default '%' line comment.
          latexLanguage.data.of({
            commentTokens: { block: { open: "<!--", close: "-->" } },
          }),
          keymap.of([
            { key: "Mod-b", run: () => (wrapSelection("**", "**"), true) },
            { key: "Mod-i", run: () => (wrapSelection("*", "*"), true) },
            { key: "Mod-k", run: () => (insertLink(), true) },
          ]),
          themeCompartment.of(init.theme),
          wrapCompartment.of(init.wrap),
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

  /** E2E (P51): register a SENTINEL app completion source that COMPOSES with
   * the LaTeX source. Bound to the unique trigger `@@ppe`, it offers exactly one
   * option labelled `__PPE_SENTINEL__`. It is ADDED to the app-source registry
   * the delegate fans out to — never installed as an override — so the LaTeX
   * command completion still surfaces in the same buffer. */
  export function registerTestCompletionSource() {
    const sentinel: CompletionSource = (
      context: CompletionContext,
    ): CompletionResult | null => {
      const match = context.matchBefore(/@@ppe/);
      if (!match) return null;
      // `from` is the cursor (end of the trigger), so CM6 filters the option
      // against an EMPTY prefix and always shows it. Setting `from` to the
      // trigger start would filter `__PPE_SENTINEL__` against `@@ppe` (no fuzzy
      // match) and drop the option, leaving the tooltip empty.
      return {
        from: match.to,
        options: [{ label: "__PPE_SENTINEL__" }],
      };
    };
    appCompletionSources.push(sentinel);
  }

  /** E2E (P51): insert `text` at the cursor through the real CM update pipeline
   * (the docChanged path the completion machinery observes), then explicitly
   * open completion (CM6 startCompletion). The deterministic stand-in for
   * synthetic key events, which the bridge cannot send into contentEditable. */
  export function typeInEditor(text: string) {
    const pos = view.state.selection.main.head;
    view.dispatch({
      changes: { from: pos, insert: text },
      selection: EditorSelection.cursor(pos + text.length),
    });
    view.focus();
    startCompletion(view);
  }

  /** E2E introspection: the language-tree node names covering the first
   * occurrence of `needle`, innermost first. Used by the proof harness to
   * assert which grammar owns a span — e.g. that a $…$ region is carved as a
   * MathSpan node with a mounted latex sub-tree (a CtrlSeq token) strictly
   * inside it. Reads the real parsed tree, so it discriminates "math is
   * tokenized as latex" from "math is plain paragraph text". */
  export function syntaxAncestryAt(needle: string): string[] {
    const text = view.state.doc.toString();
    const idx = text.indexOf(needle);
    if (idx < 0) throw new Error(`syntaxAncestryAt: substring not found: ${needle}`);
    // Force a full parse: with a mixed-language parser the cached tree may not
    // yet reach the needle, so resolveInner would bottom out at the document
    // root. ensureSyntaxTree drives parsing (incl. mounted sub-parsers) to the
    // needle before we read it.
    const tree = ensureSyntaxTree(view.state, idx + needle.length + 1, 5000);
    if (!tree) throw new Error(`syntaxAncestryAt: parse did not reach ${needle}`);
    const node = tree.resolveInner(idx + 1, 1);
    const names: string[] = [];
    for (let x: SyntaxNode | null = node; x; x = x.parent) names.push(x.name);
    return names;
  }

  /** Fold every foldable range at EVERY nesting level (command palette: Fold
   * All). CodeMirror's foldAll only folds top-level ranges, so nested divs/math
   * inside a folded heading would stay open; instead we collect a fold for every
   * foldable line and dispatch them together. */
  export function foldAllFolds() {
    ensureSyntaxTree(view.state, view.state.doc.length, 5000);
    const doc = view.state.doc;
    const effects = [];
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      const r = foldable(view.state, line.from, line.to);
      if (r) effects.push(foldEffect.of(r));
    }
    if (effects.length) view.dispatch({ effects });
  }

  /** Unfold every folded range (command palette: Unfold All). */
  export function unfoldAllFolds() {
    cmUnfoldAll(view);
  }

  /** Document outline: headings and fenced divs, for the outline panel. */
  export function getOutline(): OutlineItem[] {
    return markdownOutline(view.state.doc.toString());
  }

  /** Move the cursor to (and scroll to) the start of a 1-based line. */
  export function goToLine(line: number) {
    const n = Math.max(1, Math.min(line, view.state.doc.lines));
    const pos = view.state.doc.line(n).from;
    view.dispatch({
      selection: EditorSelection.cursor(pos),
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
    view.focus();
  }

  /** The currently-collapsed fold ranges (char offsets), for persistence. */
  export function getFoldedRanges(): Array<{ from: number; to: number }> {
    const out: Array<{ from: number; to: number }> = [];
    foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
      out.push({ from, to });
    });
    return out;
  }

  /** Restore previously-collapsed fold ranges (no-op for ranges outside the doc). */
  export function setFoldedRanges(ranges: Array<{ from: number; to: number }>) {
    if (!ranges.length) return;
    ensureSyntaxTree(view.state, view.state.doc.length, 5000);
    const len = view.state.doc.length;
    const effects = ranges
      .filter((r) => r.from >= 0 && r.to <= len && r.from < r.to)
      .map((r) => foldEffect.of({ from: r.from, to: r.to }));
    if (effects.length) view.dispatch({ effects });
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
