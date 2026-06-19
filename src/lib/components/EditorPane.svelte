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
  import type { ViewUpdate, Command } from "@codemirror/view";
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
  import { readTextFile, parseTikz, copySubgraphTikz } from "../api";
  import type { ParsedGraph } from "../types";
  import {
    parseSnippetDictionary,
    parseQuicktexSource,
    snippetCompletionSource,
    runSnippet,
    findAutoExpansion,
    findRegexExpansion,
    renderedSnippetLength,
    transformMirrorExtension,
    type SnippetMap,
  } from "../editor/snippets";
  import {
    parseTikzCommandDb,
    tikzCommandCompletionSource,
    tikzCommandSnippetBody,
    type TikzCommand,
  } from "../editor/tikz-commands";
  import {
    parseBibliography,
    citationCompletionSource,
    type CitationEntry,
  } from "../editor/citations";
  import {
    type LabelDef,
    labelCompletionSource,
  } from "../editor/labels";
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
    onTikzCommandsLoaded,
    onJumpToPreview,
    onResyncPreview,
    sourcePath,
  }: {
    config: Config;
    onChange: (content: string) => void;
    onCursor: (line: number, col: number) => void;
    // Fired once the config-owned snippet dictionary is parsed, handing the bar
    // its triggers so the dropdown can surface them (P59).
    onSnippetsLoaded: (triggers: string[]) => void;
    // Fired once the config-owned vendored QTikz tikz-command DB is parsed (P94),
    // handing the bar the command names so its tikz palette can surface them. The
    // SAME parsed list the CM6 completion source is built from.
    onTikzCommandsLoaded: (names: string[]) => void;
    // P109 / D-4: the TikzIt Ctrl+J jump-to-source action — fired when the
    // cursor sits on an owned-tikz node line and Ctrl+J is pressed, so the app
    // resolves the node (via the D-1 model) to its rendered preview target and
    // selects/scrolls to it.
    onJumpToPreview: () => void;
    // P109 / D-4: the TikzIt Ctrl+T re-parse action — fired on Ctrl+T so the app
    // re-parses the edited owned tikz source and re-syncs the preview model.
    onResyncPreview: () => void;
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

  // The currently-registered project-wide label source (P87/C3). App rebuilds the
  // cross-file label index on every project-open / file-tree refresh and calls
  // registerLabelSource; retaining the source here lets the re-registration
  // REPLACE it in-place rather than stacking a duplicate source per refresh.
  let labelSource: CompletionSource | null = null;

  // The currently-registered @-citation source (P85/P86/C2, P88/C4). The active
  // bibliography depends on the OPEN file: a document whose YAML frontmatter
  // declares `bibliography:` overrides the global config bibliography for the
  // duration it is open (pandoc's native per-file model), and a document without
  // it falls back to the global config bibliography. App re-resolves the entries
  // on every file open and calls registerCitationSource; retaining the source
  // here lets the re-registration REPLACE it in-place (mirroring the C3 label
  // source) rather than stacking a duplicate source per open.
  let citationSource: CompletionSource | null = null;

  // The parsed config-owned snippet dictionary (P52), RETAINED so the insertion
  // bar can surface its triggers in a dropdown (P59). It is the SAME map the
  // completion source is built from — both views of one config-owned dictionary,
  // so pointing config at a different dict changes both the popup completions and
  // the bar dropdown. Empty until the post-mount registration parses the dict
  // (absent path → stays empty).
  let snippetMap: SnippetMap = [];

  // The parsed config-owned vendored QTikz tikz-command DB (P94), RETAINED so the
  // insertion bar can surface its command names AND a choose-a-command action can
  // insert a named command's body. It is the SAME list the completion source is
  // built from — both views of one config-owned DB, so pointing config at a
  // different DB changes both the popup completions and the bar palette. Empty
  // until the post-mount registration parses the DB (absent path → stays empty).
  let tikzCommands: TikzCommand[] = [];

  // The currently-registered tikz-command completion source (P94). reloadTikzCommands
  // re-reads the DB from disk and REPLACES this source in-place (mirroring the
  // citation/label sources) rather than stacking a duplicate per reload, leaving
  // every other registered source untouched (P51 compose-don't-override).
  let tikzCommandSource: CompletionSource | null = null;

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
          // Standard transform mirrors `${N/regex/replace/flags}` (B7 / P83a):
          // tracks each dependent mirror range and rewrites it with the
          // transformed source-field text live, the substitution CM6's vendored
          // snippet parser does not cover.
          transformMirrorExtension,
          keymap.of([
            { key: "Mod-b", run: () => (wrapSelection("**", "**"), true) },
            { key: "Mod-i", run: () => (wrapSelection("*", "*"), true) },
            { key: "Mod-k", run: () => (insertLink(), true) },
            // Emmet's standard expand binding: Ctrl-e runs the plugin's
            // expandAbbreviation StateCommand on the abbreviation before the
            // cursor (P53). Composed alongside the existing bindings, never
            // replacing them; the same command expandEmmet() fires in-harness.
            { key: "Ctrl-e", run: expandAbbreviation },
            // P109 / D-4: the TikzIt jump-to-source / re-parse round-trip.
            // Ctrl-j jumps from the owned-tikz node line under the cursor to the
            // matching rendered preview element; Ctrl-t re-parses the edited
            // source and re-syncs the preview model. The app owns the preview
            // side, so these delegate to the App callbacks. The SAME actions the
            // harness hooks jumpSourceToPreview / resyncPreviewFromSource fire.
            { key: "Ctrl-j", run: () => (onJumpToPreview(), true) },
            { key: "Ctrl-t", run: () => (onResyncPreview(), true) },
          ]),
          // P103 / Phase E (E2): the structural-motion keymap, COMPOSED alongside
          // the bindings above (a SEPARATE keymap.of, never replacing them). Each
          // binding fires the SAME named Command runStructuralCommand exposes for
          // E3's palette. The chords are Ctrl-Alt-<letter> — clear of the CM6
          // defaults (defaultKeymap's Ctrl-Alt-h is the only Ctrl-Alt binding) and
          // of the app bindings above (Mod-b/i/k, Ctrl-e/j/t), the SAME
          // conflict-avoidance discipline the Ctrl-e Emmet note follows.
          keymap.of([
            { key: "Ctrl-Alt-n", run: structuralCommands["next-section"] },
            { key: "Ctrl-Alt-p", run: structuralCommands["prev-section"] },
            { key: "Ctrl-Alt-e", run: structuralCommands["next-environment"] },
            { key: "Ctrl-Alt-b", run: structuralCommands["prev-environment"] },
            { key: "Ctrl-Alt-m", run: structuralCommands["next-math-zone"] },
            { key: "Ctrl-Alt-w", run: structuralCommands["prev-math-zone"] },
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

    // Register the config-owned vendored QTikz tikz-command DB (P94). The path is
    // optional but, when declared, load-validated to exist by Rust; here we read,
    // parse, and seed BOTH the bar palette (via onTikzCommandsLoaded) and a
    // composable CM6 completion source. A declared-but-unreadable or parse-failing
    // DB fails loud (toast), never a silently-empty palette.
    registerTikzCommands(config).catch((e) =>
      toastError(`Tikz command DB failed to load: ${e}`),
    );

    // Register the config-owned bibliography as a composable @-citation
    // completion source (P85/P86). The path is required and validated to exist by
    // Rust; here we read and parse it (via the maintained @retorquere/bibtex-
    // parser) into citation entries and ADD the source to the delegating registry
    // — alongside the LaTeX and snippet sources, never as an override (P51). A
    // declared-but-unreadable or parse-failing bibliography fails loud (toast),
    // never a silently-empty source.
    registerBibliography(config).catch((e) =>
      toastError(`Bibliography failed to load: ${e}`),
    );

    // Build the spellchecker (vendored English base dictionary + the config-owned
    // custom math wordlist) and reconfigure it into the editor. A declared-but-
    // unreadable custom dictionary fails loud (toast); an absent path means only
    // the base English dictionary is in effect.
    installSpellcheck(config).catch((e) =>
      toastError(`Spellcheck failed to load: ${e}`),
    );
  });

  /** Read, parse, and register the config-owned bibliography as the @-citation
   *  completion source (P85/P86). editor.bibliography is a REQUIRED ExistingFile
   *  (P84/C1), so the path always resolves to a real file; the entries are parsed
   *  once here and registered as the active citation source, composing through the
   *  delegating registry alongside the LaTeX and snippet sources (P51). This is the
   *  GLOBAL bibliography (the source for files that declare no per-file override);
   *  App re-resolves the active bibliography per open file (P88/C4) and calls
   *  registerCitationSource directly when a document's frontmatter overrides it. */
  async function registerBibliography(c: Config) {
    const path = c.editor.bibliography;
    const file = await readTextFile(path);
    registerCitationSource(parseBibliography(file.content));
  }

  /** P88/C4: register the citation entries that govern the OPEN document as the
   *  active @-citation source, REPLACING the previously-registered citation source
   *  in-place (never stacking duplicates across file opens — mirrors the C3 label
   *  source). The entries come from the bibliography that governs the open file:
   *  the global config bibliography for a document without a per-file override, or
   *  the document's frontmatter-declared `bibliography:` when it has one (App
   *  resolves that path relative to the open file's directory, reads it, and parses
   *  it with the SAME C2 parser, then calls here). ADDED to the delegating registry
   *  (P51) alongside the LaTeX, snippet, and label sources — never an override of
   *  the LaTeX source. */
  export function registerCitationSource(entries: CitationEntry[]) {
    const next = citationCompletionSource(entries);
    if (citationSource) {
      appCompletionSources[appCompletionSources.indexOf(citationSource)] = next;
    } else {
      appCompletionSources.push(next);
    }
    citationSource = next;
  }

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
    appCompletionSources.push(snippetCompletionSource(map, clipboardText));
    onSnippetsLoaded(snippetTriggers());
  }

  /** Read, parse, and register the config-owned vendored QTikz tikz-command DB
   *  (P94). Reads the config-declared, load-validated DB file, parses it into the
   *  command list, RETAINS it for the insertion-bar palette, and ADDS (or, on a
   *  reload, REPLACES in-place) a composable CM6 completion source built from the
   *  SAME list — alongside the LaTeX/snippet/citation sources, never an override
   *  (P51). Absent path → no tikz palette. A declared-but-unreadable or
   *  parse-failing DB fails loud (the caller surfaces a toast), never a
   *  silently-empty palette. */
  async function registerTikzCommands(c: Config) {
    const path = c.editor.tikz_commands;
    if (!path) return;
    const file = await readTextFile(path);
    const commands = parseTikzCommandDb(file.content);
    tikzCommands = commands;
    const next = tikzCommandCompletionSource(commands);
    if (tikzCommandSource) {
      appCompletionSources[appCompletionSources.indexOf(tikzCommandSource)] = next;
    } else {
      appCompletionSources.push(next);
    }
    tikzCommandSource = next;
    onTikzCommandsLoaded(tikzCommands.map((cmd) => cmd.name));
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

  /** P87/C3: register the project-wide cross-file label index (harvested
   * App-side from every project markdown file — pandoc `{#id}` heading attrs,
   * `:::{#id}` fenced-div ids, and `\label{}` — once per project-open / file-tree
   * refresh, never per keystroke) as a composable cross-reference completion
   * source. It is ADDED to the delegating registry (P51) alongside the LaTeX,
   * snippet, and citation sources — never an override — so a `\cref{` reference
   * context offers a label defined in ANOTHER project file. App rebuilds the
   * index and re-registers on refresh; this REPLACES the prior label source
   * in-place (never stacking duplicates across refreshes), leaving every other
   * registered source untouched. */
  export function registerLabelSource(labels: LabelDef[]) {
    const next = labelCompletionSource(labels);
    if (labelSource) {
      appCompletionSources[appCompletionSources.indexOf(labelSource)] = next;
    } else {
      appCompletionSources.push(next);
    }
    labelSource = next;
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
    void runSnippet(view, hit.body, clipboardText).then(() => {
      view.dispatch({
        selection: EditorSelection.cursor(
          hit.from + renderedSnippetLength(hit.body),
        ),
      });
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
    void runSnippet(view, hit.body, clipboardText);
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

  /** E2E (P83): establish a REAL non-empty selection over the FIRST occurrence of
   * `text` already present in the buffer (appended via appendAtEnd) — the SAME
   * selection state a user's drag / shift-select produces — so the subsequent
   * `${VISUAL}` expansion has a selection to wrap. Dispatches a CM6
   * EditorSelection.range over that text's span, leaving selection.main non-empty
   * and spanning exactly `text`. The bridge cannot synthesize a drag selection
   * into CodeMirror's contentEditable, so this is the in-harness surface for a
   * real visual selection; it adds no behaviour beyond placing the selection. */
  export function seedSelection(text: string) {
    const doc = view.state.doc.toString();
    const idx = doc.indexOf(text);
    if (idx < 0) {
      throw new Error(`seedSelection: text not present in buffer: ${text}`);
    }
    view.dispatch({
      selection: EditorSelection.range(idx, idx + text.length),
    });
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

  /** The clipboard backend's documented "no text on the clipboard" signal:
   * arboard reports an empty / non-text clipboard as `ContentNotAvailable`,
   * surfaced through the clipboard-manager plugin as this exact Display string
   * (arboard 3.x). An empty clipboard is a VALID state — VSCode resolves
   * `$CLIPBOARD` to "" then — not a fault, so the reader maps THIS specific
   * documented signal (and ONLY this one) to empty text; any other clipboard
   * failure propagates loudly. */
  const CLIPBOARD_EMPTY_SIGNAL =
    "The clipboard contents were not available in the requested format or the clipboard is empty.";

  /** Read the system-clipboard text the snippet-variable `$CLIPBOARD` resolves
   * to (B6 / P82) — the SAME `readText` backend the P62 paste path reads images
   * through. If a clipboard text seed is in flight (E2E: `seedClipboardText`
   * fired just before this in a separate evaluate round-trip), await it first so
   * the read sees the seeded text — the sibling of P62's `__PPE_SEED__` await.
   * No-op wait in a user session (no seed promise is ever parked). An EMPTY
   * clipboard (the backend's documented `ContentNotAvailable` signal) resolves
   * to "" (the VSCode `$CLIPBOARD` semantic); any other read failure propagates. */
  async function clipboardText(): Promise<string> {
    const seed = (window as unknown as { __PPE_TEXT_SEED__?: Promise<void> })
      .__PPE_TEXT_SEED__;
    if (seed) await seed;
    try {
      return await readText();
    } catch (e) {
      if (String(e).includes(CLIPBOARD_EMPTY_SIGNAL)) return "";
      throw e;
    }
  }

  /** E2E (P82): seed KNOWN text onto the REAL system clipboard through the SAME
   * clipboard-manager `writeText` backend a user's copy lands on (the sibling of
   * P62's `seedClipboardImage`). Fire-and-forget: the seed's async write outlives
   * this call, so park the in-flight promise on a window global that
   * `clipboardText` awaits before reading — so `$CLIPBOARD` resolves to this exact
   * seeded text even though the seed and the expansion fire in separate evaluate
   * round-trips. */
  export function seedClipboardText(text: string) {
    (window as unknown as { __PPE_TEXT_SEED__: Promise<void> }).__PPE_TEXT_SEED__ =
      writeText(text);
  }

  /** The owned `\begin{tikzpicture}…\end{tikzpicture}` envelope the buffer
   * carries (D-8 / P97). A figure lives inside a `{=latex}` fence; the
   * copy-subgraph action parses the envelope itself, so this extracts EXACTLY
   * the envelope (begin marker through end marker, inclusive). Fails LOUDLY when
   * the buffer carries no tikzpicture — the copy action has nothing to copy and
   * must never guess. */
  function ownedTikzEnvelope(): string {
    const doc = view.state.doc.toString();
    const begin = doc.indexOf("\\begin{tikzpicture}");
    if (begin < 0) {
      throw new Error("copySelectedSubgraph: buffer carries no \\begin{tikzpicture}");
    }
    const endMarker = "\\end{tikzpicture}";
    const endAt = doc.indexOf(endMarker, begin);
    if (endAt < 0) {
      throw new Error("copySelectedSubgraph: buffer carries no \\end{tikzpicture}");
    }
    return doc.slice(begin, endAt + endMarker.length);
  }

  /** P109 / D-4: the owned `\begin{tikzpicture}…\end{tikzpicture}` envelope the
   * buffer carries, the SAME extract the copy-subgraph action parses — exported
   * so the source↔preview jump can re-parse it through the D-1 backend to build
   * the per-node preview target overlay. Fails LOUDLY when the buffer carries no
   * tikzpicture. */
  export function ownedTikzEnvelopeText(): string {
    return ownedTikzEnvelope();
  }

  /** E2E (P104 / D-8): the live editor selection's text — the contiguous source
   * span the user selected (the SAME `selection.main` range seedSelection sets).
   * The copy-subgraph action intersects this with the parsed picture to form the
   * induced subgraph. */
  function selectionText(): string {
    const sel = view.state.selection.main;
    return view.state.doc.sliceString(sel.from, sel.to);
  }

  /** E2E (P104 / D-8): the copy-selected-subgraph action — copy a SELECTED
   * subgraph of the buffer's owned tikz source to the REAL system clipboard as
   * deterministic CANONICAL tikz (the TikzIt "copy a region of nodes" model).
   *
   * Parses the owned tikzpicture envelope and the selected span through the D-1 /
   * P90 parser (the `copy_subgraph_tikz` backend), forms the induced subgraph
   * (the selected nodes + the edges whose BOTH endpoints are selected), and
   * serializes it with the SAME canonical Graph::to_tikz() serializer P90
   * round-trips — the backend writes that canonical tikz onto the system
   * clipboard via the clipboard-manager write_text path. A selection that is not
   * parseable tikz is a LOUD error there; the clipboard is never populated with a
   * raw-text guess.
   *
   * Fire-and-forget (like pasteImage): the async parse+serialize+clipboard-write
   * outlives this call. The in-flight promise is parked on `__PPE_SUBGRAPH_COPY__`
   * so the clipboard-read cache refreshes only after the write lands, and the
   * canonical text is parsed once and cached (keyed by the exact canonical string)
   * so the subsequent `parseTikz(clipboard)` re-parse resolves synchronously from
   * the SAME backend parser. */
  export function copySelectedSubgraphAsTikz() {
    const source = ownedTikzEnvelope();
    const selection = selectionText();
    const w = window as unknown as {
      __PPE_SUBGRAPH_COPY__: Promise<void>;
      __PPE_TIKZ_PARSE_CACHE__?: Record<string, ParsedGraph>;
      __PPE_CLIPBOARD_TEXT__?: string;
    };
    w.__PPE_SUBGRAPH_COPY__ = (async () => {
      const canonical = await copySubgraphTikz(source, selection);
      // Cache the backend re-parse of the exact canonical string the clipboard
      // now holds, so parseTikz(clipboard) — called once, not polled — resolves
      // synchronously from the SAME D-1 parser the obligation demands.
      const parsed = await parseTikz(canonical);
      w.__PPE_TIKZ_PARSE_CACHE__ = { ...(w.__PPE_TIKZ_PARSE_CACHE__ ?? {}), [canonical]: parsed };
      // Refresh the independent clipboard-read cache off the real clipboard.
      w.__PPE_CLIPBOARD_TEXT__ = await readText();
    })();
  }

  /** E2E (P104 / D-8): the INDEPENDENT system-clipboard read. Returns the last
   * cached clipboard text synchronously (so `waitForFunction` can compare it) and
   * kicks an async `readText()` to refresh the cache off the REAL clipboard — the
   * SAME clipboard-manager read path P82 reads through. Polling converges the
   * cache to the live clipboard bytes. Does NOT trust the copy action's report:
   * it observes the actual bytes on the system clipboard. */
  export function readClipboardText(): string {
    const w = window as unknown as {
      __PPE_TEXT_SEED__?: Promise<void>;
      __PPE_CLIPBOARD_TEXT__?: string;
    };
    void (async () => {
      if (w.__PPE_TEXT_SEED__) await w.__PPE_TEXT_SEED__;
      try {
        w.__PPE_CLIPBOARD_TEXT__ = await readText();
      } catch (e) {
        if (String(e).includes(CLIPBOARD_EMPTY_SIGNAL)) w.__PPE_CLIPBOARD_TEXT__ = "";
        else throw e;
      }
    })();
    return w.__PPE_CLIPBOARD_TEXT__ ?? "";
  }

  /** E2E (P104 / D-8): re-parse `src` through the app's OWN tikz parser (the D-1
   * / P90 `parse_tikz` backend) and return the structured graph. Returns the
   * cached parse (populated by copySelectedSubgraphAsTikz for the exact canonical
   * string it wrote) synchronously so the spec's single `parseTikz(clipboard)`
   * call resolves the SAME backend parser's result. A cache miss kicks an async
   * backend parse and throws LOUDLY — the harness never silently parses in JS. */
  export function parseTikz_(src: string): ParsedGraph {
    const w = window as unknown as { __PPE_TIKZ_PARSE_CACHE__?: Record<string, ParsedGraph> };
    const cached = w.__PPE_TIKZ_PARSE_CACHE__?.[src];
    if (cached) return cached;
    void (async () => {
      const parsed = await parseTikz(src);
      w.__PPE_TIKZ_PARSE_CACHE__ = { ...(w.__PPE_TIKZ_PARSE_CACHE__ ?? {}), [src]: parsed };
    })();
    throw new Error("parseTikz: source not yet parsed by the backend (no cached result)");
  }

  /** P109 / D-4: the owned tikzpicture envelope parsed through the D-1 / P90
   * `parse_tikz` backend into its authoritative node model. The envelope-extract
   * (ownedTikzEnvelope) + backend parse is the SAME source-side model P104's
   * copy-subgraph rides; the jump's per-node correspondence is keyed off the
   * node NAMES this model carries. Parked on a window global so the jump driver
   * (an async fire-and-forget evaluate) and the cursor-name read (a synchronous
   * evaluate) share one in-flight parse rather than each re-parsing. The async
   * parse outlives this call; callers await `__PPE_TIKZ_MODEL__`. */
  function refreshTikzModel(): void {
    const source = ownedTikzEnvelope();
    const w = window as unknown as {
      __PPE_TIKZ_MODEL__?: Promise<{ source: string; graph: ParsedGraph }>;
      __PPE_TIKZ_MODEL_RESOLVED__?: { source: string; graph: ParsedGraph };
    };
    w.__PPE_TIKZ_MODEL__ = (async () => {
      const graph = await parseTikz(source);
      const resolved = { source, graph };
      // Settle the resolved model where the synchronous cursor-name read sees it.
      w.__PPE_TIKZ_MODEL_RESOLVED__ = resolved;
      return resolved;
    })();
  }

  /** P109 / D-4: the line offset (0-based, into the buffer) where node `name`'s
   * `\node …(<name>)…;` definition begins, located by scanning the owned tikz
   * source for the node-definition line that names `name`. The match is the
   * `\node` line whose parenthesised identifier — the SAME `(name)` token the
   * D-1 parser's `paren_name` reads — equals `name`. Returns -1 when no such
   * line exists in the buffer. */
  function nodeDefinitionLineFrom(name: string): number {
    const doc = view.state.doc;
    const text = doc.toString();
    const lines = text.split("\n");
    let offset = 0;
    for (const line of lines) {
      if (line.includes("\\node")) {
        const m = line.match(/\(([^)]*)\)/);
        if (m && m[1].trim() === name) {
          return offset;
        }
      }
      offset += line.length + 1; // +1 for the consumed "\n"
    }
    return -1;
  }

  /** E2E (P109 / D-4): place the REAL CM6 cursor on the owned-tikz source line
   * that DEFINES the node named `name` — the `\node …(<name>) at (…)…;` line in
   * the open buffer. The node set is taken from the D-1 / P90 backend parse of
   * the owned envelope (so a name that names no PARSED node is a loud error, not
   * a raw substring coincidence); the line is then located by matching that
   * name's node-definition line. Fire-and-forget; the in-flight backend parse is
   * parked on `__PPE_TIKZ_MODEL__` (refreshTikzModel) so the subsequent
   * `cursorTikzNodeName()` read resolves against the SAME model. A name that
   * names no node in the open source is a LOUD error — never a silent no-jump. */
  export function placeCursorOnTikzNodeLine(name: string): void {
    refreshTikzModel();
    const lineStart = nodeDefinitionLineFrom(name);
    if (lineStart < 0) {
      throw new Error(
        `placeCursorOnTikzNodeLine: no \\node definition for "${name}" in the owned tikz source`,
      );
    }
    view.dispatch({
      selection: EditorSelection.cursor(lineStart),
      effects: EditorView.scrollIntoView(lineStart, { y: "center" }),
    });
    view.focus();
  }

  /** E2E (P109 / D-4): the NAME of the owned-tikz node whose `\node` source line
   * the cursor currently sits on, resolved against the D-1 / P90 backend model
   * (the cached `__PPE_TIKZ_MODEL__` parse refreshed by
   * placeCursorOnTikzNodeLine / refreshTikzModel) — null when the cursor is not
   * on a node line OR the model is not yet parsed. The jump driver reads this to
   * resolve the cursor to a node identity; matching against the parsed graph's
   * node set is what keeps the cursor-to-node resolution keyed on the OWNED
   * model rather than a bare buffer-line guess. */
  export function cursorTikzNodeName(): string | null {
    const w = window as unknown as {
      __PPE_TIKZ_MODEL_RESOLVED__?: { source: string; graph: ParsedGraph };
    };
    const model = w.__PPE_TIKZ_MODEL_RESOLVED__;
    if (!model) return null;
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    if (!line.text.includes("\\node")) return null;
    const m = line.text.match(/\(([^)]*)\)/);
    if (!m) return null;
    const name = m[1].trim();
    // Only a name the D-1 model actually parsed as a node is a valid jump target.
    return model.graph.nodes.some((n) => n.name === name) ? name : null;
  }

  /** Insert a snippet body at the cursor, expanding it through the SAME
   * snippetCompletion apply path completion acceptance uses (Milestone G's
   * insertion bar reuses this). The body's `$0` tabstop is honoured exactly as
   * on accept. */
  export async function insertSnippet(body: string) {
    await runSnippet(view, body, clipboardText);
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

  /** The command names the insertion bar's tikz palette surfaces (P94): the names
   * of the RETAINED config-owned vendored QTikz tikz-command DB (the SAME list the
   * popup completion source is built from). A different config DB surfaces a
   * different name set; an absent DB surfaces none. */
  export function tikzCommandNames(): string[] {
    return tikzCommands.map((cmd) => cmd.name);
  }

  /** Insert the BODY of the tikz command named `name` at the cursor, routing
   * through the SAME insertSnippet → runSnippet → snippetCompletion path the
   * env/diagram/matrix/table/snippet bar controls use. The body carries the
   * `${0}` tabstop injected at the command's declared `dx`/`dy` cursor offset
   * (tikzCommandSnippetBody), so the cursor lands strictly inside the inserted
   * body at the QTikz-declared offset — not a dumb paste at the body end (P94).
   * The choose-a-command action of the bar palette. An unknown name is a hard
   * error — the palette only offers retained command names. */
  export function insertTikzCommandByName(name: string) {
    const cmd = tikzCommands.find((c) => c.name === name);
    if (!cmd) {
      throw new Error(`unknown tikz command: ${JSON.stringify(name)}`);
    }
    // If the user has typed the command name immediately before the cursor (the
    // bar palette choose-after-type path), select that typed name so the
    // expansion REPLACES it — the chosen command does not leave its bare name in
    // the buffer alongside the inserted body. With no such prefix the body
    // expands in place at the cursor. Either way the expansion routes through the
    // SAME runSnippet path, honouring the injected ${0} cursor offset.
    const head = view.state.selection.main.head;
    const before = view.state.doc.sliceString(Math.max(0, head - name.length), head);
    if (before === name) {
      view.dispatch({
        selection: EditorSelection.range(head - name.length, head),
      });
    }
    insertSnippet(tikzCommandSnippetBody(cmd));
  }

  /** Re-read the config-owned tikz-command DB from disk and re-seed BOTH surfaces
   * (P94): the bar palette (via onTikzCommandsLoaded) and the CM6 completion
   * source (replaced in-place). The data-driven reload — pointing the configured
   * DB path at a different DB on disk and calling this surfaces THAT DB's
   * commands, proving the surfaces track the configured DB rather than a baked-in
   * list. A now-unreadable/malformed DB fails loud (toast), never a silent empty
   * palette. */
  export function reloadTikzCommands() {
    registerTikzCommands(config).catch((e) =>
      toastError(`Tikz command DB failed to reload: ${e}`),
    );
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

  // ── P103 / Phase E (E2): structural section / environment / math-zone MOTIONS ──
  // vimtex's `]]`/`[[` (section), `]m`/`[m` (env), and math-zone jumps, PORTED onto
  // the editor's existing structure primitives: markdownOutline (kind:heading →
  // section, kind:div → environment) for the prose structure, and the latexLanguage
  // syntax tree (DollarMath / DisplayMath via $…$, ParenMath via \(…\), BracketMath
  // via \[…\]) for math zones. Each motion is a CM6 `Command` ((view) => boolean)
  // computed RELATIVE to the cursor: next-* lands on the nearest matching structure
  // strictly after the cursor, prev-* on the nearest strictly before it — so prev-*
  // and next-* move in opposite directions from the same point (never a fixed
  // first/last jump). The commands are bound in a keymap block composed ALONGSIDE
  // the existing app bindings (below) AND exposed by name (runStructuralCommand) so
  // E3's command palette can invoke the SAME command the keybinding fires.

  /** The 1-based lines of the outline entries of `kind` (heading = section, div =
   * environment), in document order — the SAME markdownOutline the outline panel
   * (getOutline) renders, so a motion lands exactly on a panel-listed structure. */
  function outlineLines(kind: OutlineItem["kind"]): number[] {
    return markdownOutline(view.state.doc.toString())
      .filter((item) => item.kind === kind)
      .map((item) => item.line);
  }

  /** Move the cursor to the start of `line` (1-based) and scroll it into view —
   * the SAME dispatch goToLine performs, factored so the section/environment
   * motions and goToLine share one cursor-move primitive. */
  function moveCursorToLine(line: number) {
    const pos = view.state.doc.line(line).from;
    view.dispatch({
      selection: EditorSelection.cursor(pos),
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
    view.focus();
  }

  /** Move the cursor to character offset `pos` and scroll it into view — the
   * math-zone motions land the cursor INSIDE a span (an offset, not a line start),
   * so they dispatch through this rather than moveCursorToLine. */
  function moveCursorToOffset(pos: number) {
    view.dispatch({
      selection: EditorSelection.cursor(pos),
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
    view.focus();
  }

  /** A section/environment motion as a CM6 Command: jump to the nearest outline
   * entry of `kind` strictly after (forward) / before (backward) the cursor's
   * current line. Returns false (no-op, motion not consumed) when there is no such
   * entry in that direction, so the keypress falls through rather than silently
   * swallowing. */
  function outlineMotion(kind: OutlineItem["kind"], forward: boolean): Command {
    return (v: EditorView): boolean => {
      const cursorLine = v.state.doc.lineAt(v.state.selection.main.head).number;
      const lines = outlineLines(kind);
      const target = forward
        ? lines.find((l) => l > cursorLine)
        : [...lines].reverse().find((l) => l < cursorLine);
      if (target === undefined) return false;
      moveCursorToLine(target);
      return true;
    };
  }

  /** The math-zone spans in document order, each as the {from,to} char offsets of
   * a top-level math node in the latexLanguage syntax tree: DollarMath (`$…$` /
   * `$$…$$`), ParenMath (`\(…\)`), BracketMath (`\[…\]`). ensureSyntaxTree drives
   * the (mixed-language) parse across the whole buffer first — the SAME parse
   * syntaxAncestryAt reads — so a zone late in the buffer is not missed by a cached
   * partial tree; the tree is then iterated and every math container collected. */
  function mathZones(): Array<{ from: number; to: number }> {
    const tree = ensureSyntaxTree(view.state, view.state.doc.length, 5000);
    if (!tree) throw new Error("mathZones: parse did not complete");
    const zones: Array<{ from: number; to: number }> = [];
    tree.iterate({
      enter: (node) => {
        if (
          node.name === "DollarMath" ||
          node.name === "ParenMath" ||
          node.name === "BracketMath"
        ) {
          zones.push({ from: node.from, to: node.to });
        }
      },
    });
    return zones.sort((a, b) => a.from - b.from);
  }

  /** A math-zone motion as a CM6 Command: jump the cursor INSIDE the nearest math
   * span strictly after (forward) / before (backward) the cursor's current offset.
   * "Strictly after/before the cursor's span" so that, with the cursor inside one
   * span, prev/next move to the adjacent span rather than re-landing in place: a
   * forward zone is one whose open delimiter is past the cursor; a backward zone is
   * one whose close delimiter is before it. The cursor lands at zone.from + 1 — the
   * first character INSIDE the opening delimiter, not on it. Returns false when no
   * span lies in that direction. */
  function mathMotion(forward: boolean): Command {
    return (v: EditorView): boolean => {
      const head = v.state.selection.main.head;
      const zones = mathZones();
      const target = forward
        ? zones.find((z) => z.from > head)
        : [...zones].reverse().find((z) => z.to < head);
      if (!target) return false;
      moveCursorToOffset(target.from + 1);
      return true;
    };
  }

  /** The six named structural-motion commands (P103). The map is the single source
   * of truth for both the keymap block (below) and the named-command surface
   * (runStructuralCommand): each binding fires the SAME Command the palette would
   * invoke. */
  const structuralCommands: Record<string, Command> = {
    "next-section": outlineMotion("heading", true),
    "prev-section": outlineMotion("heading", false),
    "next-environment": outlineMotion("div", true),
    "prev-environment": outlineMotion("div", false),
    "next-math-zone": mathMotion(true),
    "prev-math-zone": mathMotion(false),
  };

  /** E2E (P112) / E3 command-palette surface: run the named structural-motion
   * command against the live view — the SAME CM6 Command ((view) => boolean) the
   * motion's keybinding fires. An unknown name is a hard error (the palette and the
   * keymap are both built from structuralCommands, so a name here that is not a
   * command is a wiring bug, never a user-reachable state). */
  export function runStructuralCommand(name: string) {
    const command = structuralCommands[name];
    if (!command) {
      throw new Error(`unknown structural-motion command: ${JSON.stringify(name)}`);
    }
    command(view);
  }

  /** Move the cursor to (and scroll to) the start of a 1-based line. */
  export function goToLine(line: number) {
    const n = Math.max(1, Math.min(line, view.state.doc.lines));
    moveCursorToLine(n);
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
