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
  import type { ViewUpdate } from "@codemirror/view";
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
  import { expandAbbreviation } from "@emmetio/codemirror6-plugin";
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
    acceptCompletion as cmAcceptCompletion,
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
  import {
    lintKeymap,
    linter,
    lintGutter,
    forceLinting,
    forEachDiagnostic,
    diagnosticCount,
  } from "@codemirror/lint";
  import { indentationMarkers } from "@replit/codemirror-indentation-markers";
  import { oneDark } from "@codemirror/theme-one-dark";
  import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
  import type { Config } from "../types";
  import { toastError } from "../toast.svelte";
  import { readTextFile } from "../api";
  import {
    parseSnippetDictionary,
    parseQuicktexSource,
    snippetCompletionSource,
    runSnippet,
    findAutoExpansion,
    findRegexExpansion,
    renderedSnippetLength,
    type SnippetMap,
  } from "../editor/snippets";
  import {
    parseWordlist,
    buildSpellChecker,
    spellcheckExtension,
  } from "../editor/spellcheck";
  import { mdLintDiagnostics } from "../editor/lint";

  let {
    config,
    onChange,
    onCursor,
    onSnippetsLoaded,
    sourcePath,
  }: {
    config: Config;
    onChange: (content: string) => void;
    onCursor: (line: number, col: number) => void;
    // Fired once the config-owned snippet dictionary is parsed, handing the bar
    // its triggers so the dropdown can surface them (P59).
    onSnippetsLoaded: (triggers: string[]) => void;
    // The real on-disk path of the open buffer (or null for an identity-less
    // buffer). The static-lint source needs it to run the pandoc-md-lint plugin
    // through the generic firewall (which resolves the run's working directory
    // from it). A getter, so the live lint source always reads the CURRENT file.
    sourcePath: () => string | null;
  } = $props();

  let host: HTMLDivElement;
  let view: EditorView;

  const themeCompartment = new Compartment();
  const wrapCompartment = new Compartment();
  const gutterCompartment = new Compartment();
  const fontCompartment = new Compartment();
  // Spellcheck is installed after mount, once the config-owned custom dictionary
  // is read and the checker is built; this compartment carries the extension so
  // it can be reconfigured in without rebuilding the editor (mirrors the snippet
  // dictionary's post-mount registration).
  const spellCompartment = new Compartment();
  // The app-owned static lint source (P70): an async `linter()` that runs the
  // pandoc-md-lint firewall plugin (markdown-native $-balance + the real
  // chktex/lacheck via md->tex interop) plus its gutter. It is a SEPARATE
  // `linter()` extension from the fork's `latexLinter` (carried inside latex()
  // below) — CM6 merges the two diagnostic sets, so the fork's {}/\begin-\end
  // checks COMPOSE with the plugin's delimiter/math-mode balance rather than
  // either overriding the other (the P51 compose-don't-override lesson). A
  // compartment so A.2's config-driven class toggles can reconfigure it
  // post-mount, mirroring spellCompartment.
  const lintCompartment = new Compartment();

  // App-owned completion sources, COMPOSED with the LaTeX command source rather
  // than overriding it. latex() folds a single delegating source (below) into
  // its autocomplete override; that delegate fans out to every source in this
  // mutable registry, so app sources can be added after mount without rebuilding
  // the editor. CM6 consults sources in order and merges their results, so a new
  // source surfaces alongside the LaTeX completions instead of displacing them.
  const appCompletionSources: CompletionSource[] = [];

  // The parsed config-owned snippet dictionary (P52), RETAINED so the insertion
  // bar can surface its triggers in a dropdown (P59). It is the SAME map the
  // completion source is built from — both views of one config-owned dictionary,
  // so pointing config at a different dict changes both the popup completions and
  // the bar dropdown. Empty until the post-mount registration parses the dict
  // (absent path → stays empty).
  let snippetMap: SnippetMap = [];

  // Re-entrancy guard for the on-input snippet expansion (P78/P79). The
  // updateListener observes the REAL input transaction (a user-typed space) and
  // schedules the expansion; the expansion is itself a dispatch (delete the
  // trigger + run the body), which re-enters the updateListener. This flag stops
  // that follow-up dispatch from being treated as a fresh trigger keystroke, so
  // one space fires exactly one expansion (never a loop). CM6 forbids dispatching
  // synchronously inside an update, so the expansion is deferred to a microtask —
  // this flag spans that deferral.
  let expanding = false;

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
            // Emmet's standard expand binding: Ctrl-e runs the plugin's
            // expandAbbreviation StateCommand on the abbreviation before the
            // cursor (P53). Composed alongside the existing bindings, never
            // replacing them; the same command expandEmmet() fires in-harness.
            { key: "Ctrl-e", run: expandAbbreviation },
          ]),
          themeCompartment.of(init.theme),
          wrapCompartment.of(init.wrap),
          fontCompartment.of(init.font),
          // Empty until the spellchecker is built (post-mount, once the
          // config-owned custom dictionary is read); reconfigured in below.
          spellCompartment.of([]),
          // The app static lint source (P70) + its gutter, COMPOSED with the
          // fork's latexLinter (not routed through latex({linter})). The source
          // is async: it runs the pandoc-md-lint plugin through the generic
          // firewall (the app core owns no chktex/lint knowledge).
          lintCompartment.of([
            linter((view) => mdLintDiagnostics(view.state, sourcePath())),
            lintGutter(),
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChange(u.state.doc.toString());
            if (u.selectionSet || u.docChanged) {
              const head = u.state.selection.main.head;
              const line = u.state.doc.lineAt(head);
              onCursor(line.number, head - line.from + 1);
            }
            // The REAL on-type snippet-expansion observer (P78/P79). A genuine
            // user input — a typed character flowing through view.dispatch, the
            // same path real keystrokes and the insertChars driver take — that
            // inserted a space terminator arms the autotrigger / regex trigger.
            // CM6 forbids dispatching synchronously inside an update, so the
            // expansion is queued to a microtask and fires AFTER this update
            // settles (it re-reads the live state). This is the production wiring
            // that turns a typed `tii ` into `\tilde{}` with no popup and no
            // accept — not the test driver, which only produces the input.
            if (
              !expanding &&
              u.docChanged &&
              u.transactions.some((t) => t.isUserEvent("input")) &&
              insertedTerminatingSpace(u)
            ) {
              expanding = true;
              queueMicrotask(() => {
                try {
                  tryOnTypeExpansion();
                } finally {
                  expanding = false;
                }
              });
            }
          }),
        ],
      }),
    });

    // Register the config-owned user snippet dictionary as a composable
    // completion source (P52). The path is validated to exist by Rust; here we
    // read and parse it into trigger→body snippets and ADD the source to the
    // delegating registry — alongside the LaTeX source, never as an override.
    // Absent path → no user snippets. A declared-but-unparseable dictionary
    // fails loud (toast), never a silently-empty source.
    registerSnippetDictionary(config).catch((e) =>
      toastError(`Snippet dictionary failed to load: ${e}`),
    );

    // Build the spellchecker (vendored English base dictionary + the config-owned
    // custom math wordlist) and reconfigure it into the editor. A declared-but-
    // unreadable custom dictionary fails loud (toast); an absent path means only
    // the base English dictionary is in effect.
    installSpellcheck(config).catch((e) =>
      toastError(`Spellcheck failed to load: ${e}`),
    );
  });

  /** Read, parse, and register the config-owned snippet dictionary. */
  async function registerSnippetDictionary(c: Config) {
    const path = c.editor.snippet_dictionary;
    if (!path) return;
    const file = await readTextFile(path);
    // The dictionary is consumed in its NATIVE source format: a `.vim` file is the
    // standard quicktex two-map source (g:quicktex_prose + g:quicktex_math), parsed
    // directly into the mode-tagged map (P81); any other extension is the
    // mode-tagged JSON document (P52/P59/P77/P78/P79/P80).
    const map = path.endsWith(".vim")
      ? parseQuicktexSource(file.content)
      : parseSnippetDictionary(file.content);
    // Retain the parsed map for the bar dropdown (P59) AND build the popup
    // completion source from it (P52) — one config-owned dictionary, two views.
    snippetMap = map;
    appCompletionSources.push(snippetCompletionSource(map));
    onSnippetsLoaded(snippetTriggers());
  }

  /** Build the spellchecker over the vendored English base dictionary plus the
   *  config-owned custom math wordlist (read from disk; ExistingFile-validated by
   *  Rust), then reconfigure the live editor's spell compartment with the marking
   *  extension. Absent custom path → base English dictionary only. */
  async function installSpellcheck(c: Config) {
    const path = c.editor.spell_dictionary;
    const customWords = path
      ? parseWordlist((await readTextFile(path)).content)
      : [];
    const checker = buildSpellChecker(customWords);
    view.dispatch({
      effects: spellCompartment.reconfigure(spellcheckExtension(checker)),
    });
  }

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

  /** E2E (P78/P79): the REAL editor input driver. Feed `text` into the editor
   * character-by-character through `view.dispatch`, each character carrying the
   * `userEvent: "input.type"` annotation a genuine keystroke flowing through CM6's
   * contentEditable input pipeline carries — so each dispatch IS, byte-for-byte
   * and annotation-for-annotation, the transaction a real keypress produces. It
   * does NOT call `tryAutoExpand` / `tryRegexExpand` itself, and — UNLIKE
   * `typeInEditor` — does NOT call `startCompletion` (an autotrigger / regex
   * trigger fires WITHOUT a popup).
   *
   * The expansion fires because the production `updateListener` (the on-type
   * observer registered in `onMount`) sees each user-input transaction — the
   * terminating space in particular — and schedules `tryOnTypeExpansion`
   * (`findAutoExpansion` / `findRegexExpansion` + `runSnippet`) on a microtask
   * (CM6 forbids dispatching synchronously inside an update). This driver only
   * produces the genuine keystroke input; the wiring that observes it and fires
   * the expansion is the production behaviour under test. The deterministic
   * stand-in for synthetic key events the bridge cannot send into CodeMirror's
   * contentEditable. */
  export function insertChars(text: string) {
    for (const ch of text) {
      const pos = view.state.selection.main.head;
      view.dispatch({
        changes: { from: pos, insert: ch },
        selection: EditorSelection.cursor(pos + ch.length),
        userEvent: "input.type",
      });
    }
    view.focus();
  }

  /** Did this update's user-input transaction(s) insert a space terminator?
   * Scans the inserted text of every change in the update; the on-type expansion
   * observer keys on the trailing space the autotrigger / regex trigger needs.
   * Cheap pre-filter so the microtask is only scheduled for space insertions. */
  function insertedTerminatingSpace(u: ViewUpdate): boolean {
    let sawSpace = false;
    u.changes.iterChanges((_fa, _ta, _fb, _tb, inserted) => {
      if (inserted.toString().includes(" ")) sawSpace = true;
    });
    return sawSpace;
  }

  /** The on-type snippet expansion (P78/P79), fired from the production
   * `updateListener` after a user-typed space, on a microtask (CM6 forbids
   * dispatching inside an update). Re-reads the LIVE state and tries the
   * autotrigger first, then the regex trigger — each gated by the fork's
   * `inMathMode` zone check inside `findAutoExpansion` / `findRegexExpansion`. The
   * first match wins; expansion routes through the shared `runSnippet` path the
   * popup-accept and insertion bar reuse. No popup, no accept. */
  function tryOnTypeExpansion() {
    if (tryAutoExpand()) return;
    tryRegexExpand();
  }

  /** Autotrigger expansion (P78 / B2): if the bare word token before the just-typed
   * space is an `auto` dictionary entry live at the cursor's zone (the SAME
   * `inMathMode` gate the popup uses), expand its body IN PLACE with NO popup and
   * NO accept — delete the literal `trigger ` span, then run the body through the
   * shared `runSnippet` path. The expansion lands the cursor at the END of the
   * rendered body (not at `$0`), so the engine RE-ARMS outside the snippet field
   * and a chained autotrigger typed immediately after expands SEQUENTIALLY rather
   * than nesting inside the prior body's tabstop. Returns true if it fired. */
  function tryAutoExpand(): boolean {
    const pos = view.state.selection.main.head;
    const hit = findAutoExpansion(snippetMap, view.state, pos);
    if (!hit) return false;
    view.dispatch({
      changes: { from: hit.from, to: hit.to, insert: "" },
      selection: EditorSelection.cursor(hit.from),
    });
    runSnippet(view, hit.body);
    view.dispatch({
      selection: EditorSelection.cursor(hit.from + renderedSnippetLength(hit.body)),
    });
    return true;
  }

  /** Regex / postfix expansion (P79 / B3): if the bare token before the just-typed
   * space matches a `regex` dictionary entry's pattern live at the cursor's zone,
   * substitute the entry's capture groups into the body (`findRegexExpansion` does
   * the capture resolution — the LuaSnip `regTrig` / UltiSnips `r` model), delete
   * the literal matched-trigger span, and run the capture-substituted body through
   * the shared `runSnippet` path — IN PLACE, no popup, no accept. Returns true if
   * it fired. */
  function tryRegexExpand(): boolean {
    const pos = view.state.selection.main.head;
    const hit = findRegexExpansion(snippetMap, view.state, pos);
    if (!hit) return false;
    view.dispatch({
      changes: { from: hit.from, to: hit.to, insert: "" },
      selection: EditorSelection.cursor(hit.from),
    });
    runSnippet(view, hit.body);
    return true;
  }

  /** E2E (P52): accept the currently-highlighted completion through CM6's REAL
   * acceptCompletion command — the SAME path the Enter keybinding fires — so a
   * snippet completion's apply runs (expanding the body and landing the cursor
   * at the declared tabstop). The bridge cannot synthesize Enter into
   * CodeMirror's contentEditable, so this is the in-harness accept surface. */
  export function acceptCompletion() {
    cmAcceptCompletion(view);
  }

  /** E2E (P80): type `text` into the ACTIVE snippet field after a snippet has
   * expanded and CM6 is in snippet-field mode (the first `${N}` tabstop is the
   * live, selected range). Insert through the SAME docChanged pipeline real
   * typing fires — replacing the selected field range — and, UNLIKE
   * `typeInEditor`, do NOT call `startCompletion`, because typing into a snippet
   * field is plain editing (opening a popup would tear down the active field and
   * defeat the mirror). CM6's `snippetCompletion` machinery maps the change
   * through its snippet state and MIRRORS the typed text into every other
   * occurrence of the same `${N}` live (the established TextMate mirror
   * behaviour). The bridge cannot synthesize key events into CodeMirror's
   * contentEditable, so this is the in-harness surface for typing into a field. */
  export function typeIntoSnippetField(text: string) {
    view.dispatch(view.state.replaceSelection(text));
    view.focus();
  }

  /** E2E (P53): fire Emmet's expandAbbreviation StateCommand against the live
   * view — the SAME command the `Ctrl-e` keybinding fires. The bridge cannot
   * synthesize Ctrl-e into CodeMirror's contentEditable, so this is the
   * in-harness entry point for the expand action; it adds no behaviour. */
  export function expandEmmet() {
    expandAbbreviation(view);
    view.focus();
  }

  /** E2E (P52): the cursor's character offset in the buffer, read from the live
   * CM6 selection. Used to prove a snippet's `$0` tabstop is where the cursor
   * lands after expansion. */
  export function cursorOffset(): number {
    return view.state.selection.main.head;
  }

  /** E2E (P70): the live `@codemirror/lint` diagnostics — the SAME field the
   * gutter renders — flushed via `forceLinting` so the async ChkTeX source has
   * run for the current buffer, then read straight from the lint state via
   * `forEachDiagnostic`. NOT a parallel array: a side array could pass while the
   * gutter shows nothing. Mapped to a JSON-serializable shape (from/to char
   * offsets, severity, message, source = the ChkTeX rule id). */
  export function lintDiagnostics(): {
    from: number;
    to: number;
    severity: string;
    message: string;
    source: string;
  }[] {
    forceLinting(view);
    const out: {
      from: number;
      to: number;
      severity: string;
      message: string;
      source: string;
    }[] = [];
    forEachDiagnostic(view.state, (d, from, to) => {
      out.push({
        from,
        to,
        severity: d.severity,
        message: d.message,
        source: d.source ?? "",
      });
    });
    return out;
  }

  /** E2E (P70): the count of currently-active diagnostics in the SAME flushed
   * lint field `lintDiagnostics()` reads. */
  export function lintCount(): number {
    forceLinting(view);
    return diagnosticCount(view.state);
  }

  /** Insert a snippet body at the cursor, expanding it through the SAME
   * snippetCompletion apply path completion acceptance uses (Milestone G's
   * insertion bar reuses this). The body's `$0` tabstop is honoured exactly as
   * on accept. */
  export function insertSnippet(body: string) {
    runSnippet(view, body);
    view.focus();
  }

  /** The triggers the insertion bar's snippet dropdown surfaces (P59): the keys
   * of the RETAINED config-owned snippet dictionary (the SAME map P52's popup
   * completion source is built from). A different config dict surfaces a
   * different trigger set; an absent dict surfaces none. */
  export function snippetTriggers(): string[] {
    // The distinct trigger tokens across all mode-tagged entries, in first-seen
    // order. The SAME trigger may appear twice (prose + math, P77); the bar
    // dropdown surfaces it once.
    const seen = new Set<string>();
    const triggers: string[] = [];
    for (const entry of snippetMap) {
      if (!seen.has(entry.trigger)) {
        seen.add(entry.trigger);
        triggers.push(entry.trigger);
      }
    }
    return triggers;
  }

  /** Insert the expanded BODY of the dictionary entry named by `trigger` at the
   * cursor, routing through the SAME insertSnippet → runSnippet → snippetCompletion
   * path the env/diagram/matrix/table bar controls use, so the `$0` tabstop lands
   * the cursor in the body (P59). The choose-a-trigger action of the bar dropdown.
   * An unknown trigger is a hard error — the dropdown only offers retained keys. */
  export function insertSnippetByTrigger(trigger: string) {
    const entry = snippetMap.find((e) => e.trigger === trigger);
    if (!entry) {
      throw new Error(`unknown snippet trigger: ${JSON.stringify(trigger)}`);
    }
    insertSnippet(entry.body);
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

  /** Insert a markdown image reference `![](<path>)` at the cursor pointing at an
   * already-written on-disk file (P62: the insertion bar's paste-image action
   * wrote the clipboard image into the configured figures dir and now references
   * that exact file). `path` is the absolute path the backend returned; it is
   * inserted verbatim so the reference resolves to the real persisted file. The
   * cursor lands just after the inserted reference. */
  export function insertImageReference(path: string) {
    const ref = `![](${path})`;
    const cursor = view.state.selection.main.head;
    view.dispatch({
      changes: { from: cursor, insert: ref },
      selection: EditorSelection.cursor(cursor + ref.length),
    });
    view.focus();
  }

  /** Insert a fenced code block tagged with `lang` at the cursor, routing
   * through the SAME insertSnippet → runSnippet → snippetCompletion path the
   * env/diagram/matrix/table/snippet bar controls use (P60). The opening fence
   * carries the chosen language tag (```<lang>); the `${}` body tabstop lands the
   * cursor strictly inside the block, between the opening and matching closing
   * fence. The insertion bar's code-block-type dropdown and the E2E bridge both
   * route through here. */
  export function insertCodeBlock(lang: string) {
    insertSnippet("```" + lang + "\n${}\n```");
  }

  /** Insert a COMPLETE pandoc footnote (P61): a reference marker `[^<id>]` at the
   * cursor AND a matching definition line `[^<id>]: <body>` appended at the end of
   * the buffer, the two sharing the SAME generated id. The body is inserted
   * byte-for-byte — exactly the text the footnote modal's user typed. Both edits
   * ride a SINGLE dispatch so the footnote is one coherent insertion, and the
   * cursor lands just after the inserted reference marker. The id counts the
   * footnote definition lines already in the buffer so a second insert does not
   * collide with the first. The insertion bar's footnote modal and the E2E bridge
   * both route through here. */
  export function insertFootnote(body: string) {
    const doc = view.state.doc;
    const existing = doc.toString().match(/^\[\^\d+\]:/gm)?.length ?? 0;
    const id = String(existing + 1);
    const marker = `[^${id}]`;
    const end = doc.length;
    // A definition line must start a fresh line; prefix a newline when the buffer
    // does not already end with one so the `[^id]:` is at column 0 of its line.
    const endsWithNewline = end === 0 || doc.sliceString(end - 1, end) === "\n";
    const definition = `${endsWithNewline ? "" : "\n"}[^${id}]: ${body}\n`;
    const cursor = view.state.selection.main.head;
    view.dispatch({
      changes: [
        { from: cursor, insert: marker },
        { from: end, insert: definition },
      ],
      // The marker change shifts everything after `cursor`; the end-insert keeps
      // its mapped position. Land the cursor right after the inserted marker.
      selection: EditorSelection.cursor(cursor + marker.length),
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
