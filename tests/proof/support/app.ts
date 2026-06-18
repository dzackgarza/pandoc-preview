// Helpers that drive the REAL app through supported TauriPage transports:
// string-form evaluate against the live webview, and the app's test-gated
// harness (window.__PPE_E2E__, wired in src/App.svelte behind VITE_PPE_E2E).
//
// The harness exposes the SAME internal functions the menu/dialog callbacks
// invoke; it only bypasses the native OS file dialog the webview cannot drive.
// Everything else here reads the real rendered DOM.

interface EvaluatesScripts {
  evaluate(expression: string): Promise<unknown>;
}

// Node-side sleep (the test runner process), used for disk-artifact polling.
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${what} returned non-string: ${JSON.stringify(value)}`);
  }
  return value;
}

// The bridge's eval expects a synchronous return value; harness triggers are
// fire-and-forget and return null. Specs await the resulting observable state
// (sidebar element, currentFile, on-disk artifact) afterwards.

// Wait until the test harness has attached (App onMount completed with a
// valid config). Without this, an eval can race the app's mount.
export async function waitForHarness(page: WaitsForFunction): Promise<void> {
  await page.waitForFunction(`!!(window.__PPE_E2E__ && window.__PPE_E2E__.openProject)`, 20_000);
}

// ── Project open (P1/P5/P6/P11): real openProject path, no native dialog ──
export async function openProject(
  page: EvaluatesScripts & WaitsForFunction,
  dir: string,
): Promise<void> {
  await waitForHarness(page);
  await page.evaluate(
    `(() => { window.__PPE_E2E__.openProject(${JSON.stringify(dir)}); return null; })()`,
  );
}

// ── Plugin export by id, through the save-gate (P47) ───────────────────────
// Drive the REAL plugin export (the pandoc-html-export / pandoc-pdf-export
// export-category plugin) BY ID. This funnels through runPluginToPath →
// requireDurablePath() — the SAME save-gate every path-consuming action uses.
// On an identity-less buffer the gate resolves nothing and the export does NOT
// run. Fire-and-forget; the spec awaits the on-disk artifact + the marker.
export async function exportViaPluginById(
  page: EvaluatesScripts,
  pluginId: string,
  target: string,
): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.exportViaPluginById(${JSON.stringify(pluginId)}, ${JSON.stringify(target)}); return null; })()`,
  );
}

// Read the plugin-export state marker (window.__PPE_PLUGIN_EXPORT__) for the
// plugin export path: "pending" → "done" when the export ran, "gated" when the
// save-gate aborted it. A diagnostic pointer, never a substitute for the on-disk
// proof.
export async function pluginExportState(page: EvaluatesScripts): Promise<string> {
  return asString(
    await page.evaluate(`String(window.__PPE_PLUGIN_EXPORT__)`),
    'pluginExportState',
  );
}

// ── Run a generic plugin by id (A1/p19) ───────────────────────────────────
// The plugin firewall discovers plugins from the configured plugins dir and
// runs one by id against the REAL open buffer, returning a structured
// PluginResult. The harness hook fires the run (fire-and-forget) and stashes the
// resolved PluginResult on window.__PPE_PLUGIN_RESULT__. The on-disk artifact is
// the decisive proof; the structured result is asserted alongside it.
export async function runPluginById(
  page: EvaluatesScripts,
  pluginId: string,
  target: string,
): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.runPlugin(${JSON.stringify(pluginId)}, ${JSON.stringify(target)}); return null; })()`,
  );
}

// ── Configure a plugin by id (C1/p22) ─────────────────────────────────────
// Plugins own their configuration entirely (render-rebuild-plan.md, Milestone C):
// the manifest declares a [configure] command and the app's "Configure <name>"
// action merely SPAWNS it (detached, no TTY handling, no in-app config editor) so
// the plugin can bring its own config UI (e.g. pandoc opens a kitty popup running
// gum). The harness hook fires the spawn (fire-and-forget, like runPlugin); the
// proof is the observable effect of the spawned command on disk. RED today:
// __PPE_E2E__.configurePlugin does not exist — there is no [configure] manifest
// field, no configure_plugin command, and no bridge — so this evaluate throws.
export async function configurePluginById(
  page: EvaluatesScripts,
  pluginId: string,
): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.configurePlugin(${JSON.stringify(pluginId)}); return null; })()`,
  );
}

export interface PluginResult {
  success: boolean;
  artifact: string | null;
  exit_code: number | null;
  stdout: string;
  stderr: string;
}

// Read the last plugin run's structured result (window.__PPE_PLUGIN_RESULT__),
// or null until the run has resolved. Polled by the spec after runPluginById.
export async function pluginResult(page: EvaluatesScripts): Promise<PluginResult | null> {
  const raw = await page.evaluate(
    `(() => { const r = window.__PPE_PLUGIN_RESULT__; return r === undefined || r === null ? null : JSON.stringify(r); })()`,
  );
  if (raw === null) return null;
  if (typeof raw !== 'string') {
    throw new Error(`pluginResult returned non-string: ${JSON.stringify(raw)}`);
  }
  return JSON.parse(raw) as PluginResult;
}

export async function editorText(page: EvaluatesScripts): Promise<string> {
  return asString(
    await page.evaluate(`window.__PPE_E2E__.getEditorText()`),
    'getEditorText',
  );
}

// The language-tree node names covering the first occurrence of `needle`,
// innermost first (e.g. ['tagName','Document','InlineMath','Paragraph',...]).
// Reads the editor's real parsed tree via the harness; used to prove that math
// regions are tokenized as embedded latex rather than plain paragraph text.
export async function syntaxAncestryAt(
  page: EvaluatesScripts,
  needle: string,
): Promise<string[]> {
  const raw = await page.evaluate(
    `JSON.stringify(window.__PPE_E2E__.syntaxAncestryAt(${JSON.stringify(needle)}))`,
  );
  if (typeof raw !== 'string') {
    throw new Error(`syntaxAncestryAt returned non-string: ${JSON.stringify(raw)}`);
  }
  return JSON.parse(raw) as string[];
}

// The rendered DOM element + computed color for the first occurrence of `needle`
// in the editor's content, plus the editor's base text color. A syntax-
// highlighted token is wrapped by CodeMirror in a <span> carrying a highlight
// class, so its computed color differs from the base; unhighlighted text is a
// bare text node whose parent is the .cm-line (base color). This is how we prove
// the user-visible payoff — actual color on screen — rather than mere parse-tree
// structure (which can be correct while nothing is colored).
export interface RenderedToken {
  tag: string;
  color: string;
  base: string;
  fontStyle: string;
  fontWeight: string;
  baseStyle: string;
  baseWeight: string;
  text: string;
}

// True when the token is visibly syntax-highlighted: CodeMirror wraps it in a
// <span> AND at least one visual property (colour, italic, or weight) differs
// from the editor's base prose styling. Robust across constructs that recolour
// (headings, code) and those that don't (emphasis→italic, strong→bold).
export function isHighlighted(t: RenderedToken): boolean {
  return (
    t.tag === 'SPAN' &&
    (t.color !== t.base || t.fontStyle !== t.baseStyle || t.fontWeight !== t.baseWeight)
  );
}

export async function renderedToken(
  page: EvaluatesScripts,
  needle: string,
): Promise<RenderedToken> {
  const raw = await page.evaluate(`(() => {
    const content = document.querySelector('.cm-editor .cm-content');
    if (!content) return null;
    const cs = getComputedStyle(content);
    const base = cs.color, baseStyle = cs.fontStyle, baseWeight = cs.fontWeight;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const i = node.nodeValue.indexOf(${JSON.stringify(needle)});
      if (i >= 0) {
        const el = node.parentElement;
        const es = getComputedStyle(el);
        return JSON.stringify({ tag: el.tagName, color: es.color, base, fontStyle: es.fontStyle, fontWeight: es.fontWeight, baseStyle, baseWeight, text: node.nodeValue });
      }
    }
    return null;
  })()`);
  if (raw === null) {
    throw new Error(`renderedToken: needle not found in cm-content: ${needle}`);
  }
  if (typeof raw !== 'string') {
    throw new Error(`renderedToken returned non-string: ${JSON.stringify(raw)}`);
  }
  return JSON.parse(raw) as RenderedToken;
}

export async function currentFile(page: EvaluatesScripts): Promise<string> {
  return asString(
    await page.evaluate(`(window.__PPE_E2E__.currentFile() ?? '')`),
    'currentFile',
  );
}

// ── Preview iframe (srcdoc) DOM access via the live page context ──────────
// The PreviewPane iframe is same-origin (srcdoc), so contentDocument is
// reachable. Queries run inside the real rendered preview document.
export async function previewQuery(page: EvaluatesScripts, js: string): Promise<unknown> {
  return page.evaluate(`(() => {
    const frame = document.querySelector('iframe[title="Rendered preview"]');
    if (!frame) throw new Error('preview iframe not present');
    const doc = frame.contentDocument;
    if (!doc) throw new Error('preview iframe contentDocument unreachable');
    return (function(d){ ${js} })(doc);
  })()`);
}

interface WaitsForFunction {
  // The tauri-plugin-playwright page: 2nd arg is the timeout in ms.
  waitForFunction(expr: string, timeoutMs?: number): Promise<unknown>;
}

// Wait until the preview iframe's document satisfies a predicate over its
// contentDocument. Polls the REAL rendered preview, not a mock.
export async function waitForPreview(
  page: WaitsForFunction,
  predicateBody: string,
  timeoutMs = 45_000,
): Promise<void> {
  await page.waitForFunction(
    `(() => {
      const frame = document.querySelector('iframe[title="Rendered preview"]');
      if (!frame || !frame.contentDocument) return false;
      const d = frame.contentDocument;
      return (function(d){ ${predicateBody} })(d);
    })()`,
    timeoutMs,
  );
}

// ── Click a sidebar file by exact label, through the real rendered DOM ─────
// The bridge's click() takes raw CSS selectors only (no Playwright text=
// engine), so file clicks dispatch a real click on the matching tree button.
export async function clickSidebarEntry(page: EvaluatesScripts, label: string): Promise<void> {
  const clicked = await page.evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('.grow.overflow-auto.p-1 button'));
    const btn = btns.find((b) => {
      const span = b.querySelector('span:last-child');
      return span && span.textContent.trim() === ${JSON.stringify(label)};
    });
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  if (clicked !== true) {
    throw new Error(`sidebar entry not found: ${label}`);
  }
}

// ── Open the sidebar context menu on an entry and run one of its items ─────
export async function contextMenuAction(
  page: EvaluatesScripts,
  entryLabel: string,
  itemLabel: string,
): Promise<void> {
  const ok = await page.evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('.grow.overflow-auto.p-1 button'));
    const btn = btns.find((b) => {
      const span = b.querySelector('span:last-child');
      return span && span.textContent.trim() === ${JSON.stringify(entryLabel)};
    });
    if (!btn) return 'no-entry';
    btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
    return true;
  })()`);
  if (ok !== true) {
    throw new Error(`context menu target not found: ${entryLabel} (${String(ok)})`);
  }
  const ran = await page.evaluate(`(() => {
    const items = Array.from(document.querySelectorAll('.fixed.z-50 button'));
    const item = items.find((b) => b.textContent.trim() === ${JSON.stringify(itemLabel)});
    if (!item) return false;
    item.click();
    return true;
  })()`);
  if (ran !== true) {
    throw new Error(`context menu item not found: ${itemLabel}`);
  }
}

// Open the witness project and select demo.md, waiting for the sidebar to
// populate. Shared prologue for the render/preview obligations.
export async function openAndSelectDemo(
  page: EvaluatesScripts & WaitsForFunction,
  project: string,
): Promise<void> {
  await openProject(page, project);
  await page.waitForFunction(
    `Array.from(document.querySelectorAll('.grow.overflow-auto.p-1 button span:last-child')).some((s) => s.textContent.trim() === 'demo.md')`,
    15_000,
  );
  await clickSidebarEntry(page, 'demo.md');
}

// Append text at the buffer end through the real editor update pipeline,
// firing the same docChanged path user typing fires (the bridge cannot
// synthesize key events into CodeMirror's contentEditable). The cursor lands
// at the END of the appended text, so the appended text is the abbreviation
// directly preceding the cursor that an Emmet expand acts on.
export async function appendAtEnd(page: EvaluatesScripts, text: string): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.appendAtEnd(${JSON.stringify(text)}); return null; })()`,
  );
}

// ── Save the active buffer (P03/P47 precedent) ──────────────────────────────
// Drives the SAME path the application's Save menu item fires: the 'menu'
// 'save' Tauri event, which App.svelte routes to saveCurrent(). For an
// already-durable file (one that has a path on disk) the write runs with NO
// resolution prompt and clears the dirty flag (App.svelte saveCurrent → dirty
// = false). This is the exact surface p03-save-exact-bytes and the p47 A4
// already-durable leg drive; no new product hook is invented here.
export async function saveCurrentFile(page: EvaluatesScripts): Promise<void> {
  await page.evaluate(`(() => { window.__TAURI__.event.emit('menu', 'save'); return null; })()`);
}

// ── Live dirty-flag observable (P48/P50 precedent) ──────────────────────────
// Reads the SAME __PPE_E2E__.isDirty() getter p48 (conflict gate) and p50
// (close guard) assert against — the live App.svelte `dirty` state. Used to
// confirm a save has cleared the buffer BEFORE switching files (so the switch
// is clean and raises no un-answerable native "Save changes?" dialog headless).
export async function bufferIsDirty(page: EvaluatesScripts): Promise<boolean> {
  return Boolean(await page.evaluate(`!!window.__PPE_E2E__.isDirty()`));
}

// ── Emmet abbreviation expansion (P53) ─────────────────────────────────────
// Emmet expands a terse abbreviation directly before the cursor into the real
// markup it denotes when its EXPAND ACTION is invoked. The action is a real
// editor command the implementer must (a) bind to a user-facing keybinding —
// Emmet's standard `Ctrl-e` for `expandAbbreviation` — and (b) expose through
// this harness hook so the spec can fire the SAME command deterministically.
// The bridge cannot synthesize the keystroke into CodeMirror's contentEditable
// (see appendAtEnd / typeInEditor), so `__PPE_E2E__.expandEmmet()` runs the
// Emmet plugin's expand command against the live view — exactly the path the
// `Ctrl-e` keybinding fires. Fire-and-forget; returns null. The observable
// afterwards is the editor buffer (getEditorText): the abbreviation is gone and
// the expanded markup is in its place. RED today: __PPE_E2E__.expandEmmet does
// not exist (there is no Emmet plugin, no expand command, and no keybinding), so
// this evaluate throws — there is no surface to expand an Emmet abbreviation.
export async function expandEmmet(page: EvaluatesScripts): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.expandEmmet(); return null; })()`,
  );
}

// ── Composable editor completion (P51) ─────────────────────────────────────
// The CM6 autocomplete is a COMPOSABLE surface: it must host more than one
// completion source at once. The current wiring installs autocompletion with
// `override: [latexCompletionSource(...)]` (vendor/codemirror-lang-latex/src/
// latex-language.ts), and `override` REPLACES the source list — it suppresses
// every other source — which is the exact monopoly P51 forbids.
//
// To drive composition deterministically in-harness, the implementer must
// expose two hooks (BLIND to how they are implemented; only the observable
// matters):
//
//   __PPE_E2E__.registerTestCompletionSource() — registers a SENTINEL app
//     completion source that COMPOSES with the LaTeX source. The sentinel is
//     bound to a unique trigger token `@@ppe` and offers exactly one option
//     whose label is the unique string `__PPE_SENTINEL__`. "Composes" means it
//     is ADDED alongside the existing sources, never installed as an `override`
//     that displaces them. Fire-and-forget; returns null.
//
//   __PPE_E2E__.typeInEditor(text) — inserts `text` at the cursor through the
//     REAL editor update pipeline (same docChanged path as user typing, the
//     pipeline the language/completion machinery observes) and then explicitly
//     drives the editor's completion to open (CM6 startCompletion). This is the
//     deterministic substitute for synthetic key events, which the bridge
//     cannot send into CodeMirror's contentEditable. Fire-and-forget; returns
//     null. The observable is the REAL `.cm-tooltip-autocomplete` popup DOM.
export async function registerTestCompletionSource(page: EvaluatesScripts): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.registerTestCompletionSource(); return null; })()`,
  );
}

export async function typeInEditor(page: EvaluatesScripts, text: string): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.typeInEditor(${JSON.stringify(text)}); return null; })()`,
  );
}

// ── Seed KNOWN text on the system clipboard (P82) ──────────────────────────
// A SNIPPET VARIABLE entry resolves the standard TextMate/VSCode variable
// `$CLIPBOARD` to the real system-clipboard text AT EXPANSION TIME — through the
// SAME clipboard backend the P62 paste-image path owns. To drive that
// deterministically the harness must put a KNOWN string on the REAL system
// clipboard (the SAME clipboard a user's copy lands on), the sibling of P62's
// seedClipboardImage. `seedClipboardText(text)` writes `text` through the
// clipboard-manager plugin's writeText path; the app's variable resolution later
// reads this exact string back off the clipboard. Fire-and-forget; the seed's
// async work outlives this call (like seedClipboardImage), so the implementer
// parks the in-flight promise where the expansion awaits it.
//
// RED today: __PPE_E2E__.seedClipboardText does not exist (there is no snippet
// variable resolution and so no need to seed clipboard text), so this evaluate
// throws — there is no surface to seed known clipboard text for $CLIPBOARD.
export async function seedClipboardText(page: EvaluatesScripts, text: string): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.seedClipboardText(${JSON.stringify(text)}); return null; })()`,
  );
}

// ── Establish a REAL non-empty selection in the editor (P83 visual-wrap) ───
// UltiSnips' `${VISUAL}` placeholder wraps the text the user had SELECTED at the
// moment the snippet expands (select `foo`, trigger an `\emph{${VISUAL}}` entry →
// `\emph{foo}`, the selected `foo` substituted into the body and the original
// selection consumed). To drive that deterministically the harness must put a
// REAL, non-empty selection on the live CM6 view — the SAME selection state a
// user dragging/shift-selecting produces — so the subsequent expansion sees a
// selection to wrap. `seedSelection(text)` selects the FIRST occurrence of
// `text` already present in the buffer (appended via appendAtEnd), through a real
// CM6 selection dispatch (EditorSelection.range over that text's span), so the
// editor's selection.main is non-empty and spans exactly `text`. Fire-and-forget;
// the observable afterwards is the buffer (getEditorText) after the visual-wrap
// expansion: `text` survives, WRAPPED by the body, not discarded.
//
// RED today: __PPE_E2E__.seedSelection does not exist (there is no `${VISUAL}`
// visual-wrap support and so no need to seed a selection), so this evaluate
// throws — there is no surface to establish a real selection for `${VISUAL}`.
export async function seedSelection(page: EvaluatesScripts, text: string): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.seedSelection(${JSON.stringify(text)}); return null; })()`,
  );
}

// ── REAL editor input driver (P78/P79) ─────────────────────────────────────
// `insertChars(text)` feeds `text` into the editor character-by-character
// through the editor's REAL input dispatch — a CM6 `view.dispatch` per-character
// text-insert transaction annotated `userEvent: "input.type"`, the SAME
// transaction (changes + annotation) a real keystroke flowing through CM6's
// contentEditable input pipeline produces — and NOTHING ELSE. It does NOT itself
// call the snippet-expansion functions (`tryAutoExpand` / `tryRegexExpand`) and —
// UNLIKE typeInEditor — does NOT call startCompletion (an autotrigger / regex
// trigger fires WITHOUT a popup). This is the deterministic stand-in for
// synthetic key events the bridge cannot send into CodeMirror's contentEditable.
// Fire-and-forget; returns null.
//
// The point: the spec drives GENUINE keystroke input here, never a self-executing
// expansion. The body expands because the PRODUCTION editor registers an on-type
// observer — the `updateListener` in EditorPane onMount — that sees each
// user-input transaction (the terminating space in particular) and schedules the
// expansion (`findAutoExpansion`/`findRegexExpansion` + `runSnippet`) on a
// microtask. The driver exercises that real production path; it never calls the
// expansion itself.
export async function insertChars(page: EvaluatesScripts, text: string): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.insertChars(${JSON.stringify(text)}); return null; })()`,
  );
}

// ── Autotrigger / space-trigger auto-expansion (P78) ───────────────────────
// An AUTOTRIGGER entry expands the moment the user types the trigger followed by
// its terminator (a space) — IN PLACE, with NO completion popup and NO accept
// keypress (LuaSnip autosnippet / UltiSnips `A`). The trigger condition must be
// owned by a REAL CM6 INPUT OBSERVER the editor registers (an
// EditorView.inputHandler, a transactionFilter, or the existing updateListener),
// NOT by the test driver: the autotrigger fires WITHOUT a popup, and the
// expansion REUSES the shared `runSnippet` path. After one autotrigger fires, the
// engine RE-ARMS so a subsequent autotrigger + space fires immediately (chained
// expansion).
//
// `typeAutotrigger` drives the trigger through the REAL input driver
// (`insertChars`): per-character `view.dispatch` insert transactions annotated
// `userEvent: "input.type"`, including the terminating space, flowing through the
// editor's real input path — it does NOT call any expansion function itself. The
// observable afterwards is the editor buffer (getEditorText): the literal trigger
// text is GONE and the expanded body sits at the cursor. The production
// `updateListener` observes the user-input space and schedules the autotrigger
// expansion (`findAutoExpansion` + `runSnippet`) on a microtask — the real wiring
// this spec exercises.
export async function typeAutotrigger(page: EvaluatesScripts, text: string): Promise<void> {
  await insertChars(page, text);
}

// ── Regex / postfix capture triggers (P79) ─────────────────────────────────
// A REGEX entry matches its PATTERN against the text before the cursor and
// substitutes the matched CAPTURE GROUPS into the body — the LuaSnip `regTrig` /
// UltiSnips `r` capture-group model. The body's capture references (`$1`, `$2`,
// …) are resolved from the regex match FIRST, distinct from the TextMate
// tabstop `${1}`; the residual body (with its `${N}` tabstops intact) is then
// expanded through the shared `runSnippet` path P52/P77/P78 already reuse. A
// regex/postfix trigger fires WITHOUT a popup, and — like the autotrigger — its
// match condition must be owned by a REAL CM6 input observer the editor
// registers, NOT by the test driver.
//
// `typeRegexTrigger` drives the regex-matching token through the REAL input
// driver (`insertChars`): per-character `view.dispatch` insert transactions
// annotated `userEvent: "input.type"`, including the terminating space, flowing
// through the editor's real input path — it does NOT call any expansion function
// itself. The observable afterwards is the editor buffer (getEditorText): the
// literal matched trigger text is GONE and the capture-substituted body sits at
// the cursor (`pbar` → `\bar{p}`, the captured `p` in the body, NOT a literal
// `$1`). The production `updateListener` observes the user-input space and
// schedules the regex expansion (`findRegexExpansion` + `runSnippet`) on a
// microtask — the real wiring this spec exercises.
export async function typeRegexTrigger(page: EvaluatesScripts, text: string): Promise<void> {
  await insertChars(page, text);
}

// ── Accept the highlighted completion (P52) ────────────────────────────────
// CM6 accepts a completion via the Enter key / the `acceptCompletion` command,
// which the bridge cannot synthesize into CodeMirror's contentEditable. So the
// implementer must expose a harness hook that runs CM6's REAL acceptCompletion
// command against the live view — the SAME path the Enter keybinding fires — so
// the spec can accept the currently-highlighted option deterministically. This
// is the natural sibling of typeInEditor (which runs startCompletion): the
// observable afterwards is the editor buffer (getEditorText) and the cursor
// position the snippet's tabstop should land at. Fire-and-forget; returns null.
// RED today: __PPE_E2E__.acceptCompletion does not exist, so this evaluate
// throws — there is no surface to accept a completion in-harness.
export async function acceptCompletion(page: EvaluatesScripts): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.acceptCompletion(); return null; })()`,
  );
}

// ── Type into the ACTIVE snippet field (P80) ───────────────────────────────
// After a snippet expands and CM6 is in snippet-field mode (the first `${N}`
// tabstop is the live, selected field), the user types the field's content
// directly into that selected range. CM6's `snippetCompletion` machinery
// MIRRORS every other occurrence of the same `${N}` live as the user types into
// the active field (the established TextMate mirror behaviour). To drive that
// in-harness, the spec types into the LIVE field through the SAME docChanged
// pipeline real typing fires — and, UNLIKE typeInEditor, does NOT call
// startCompletion, because typing into a snippet field is plain editing, not a
// completion query (opening a popup would tear down the active field and defeat
// the mirror). The observable afterwards is getEditorText(): the typed text
// stands at BOTH the first slot and every mirrored occurrence, live, without a
// second keystroke at the mirrored position.
//
// RED today: __PPE_E2E__.typeIntoSnippetField does not exist — there is no
// surface to type into an active snippet field — so this evaluate throws. (And
// even were the typed text inserted, the shipped dictionary carries no mirrored
// entry, and the single-tabstop body would have no second `${N}` to mirror
// into.) The faithful no-mirror RED state.
export async function typeIntoSnippetField(
  page: EvaluatesScripts,
  text: string,
): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.typeIntoSnippetField(${JSON.stringify(text)}); return null; })()`,
  );
}

// ── Expand a dictionary entry by trigger through the shared path (P59/P82) ──
// `insertSnippetByTrigger(trigger)` expands the BODY of the named dictionary
// entry at the cursor through the SAME shared expansion path the insertion-bar
// dropdown and completion-accept use (insertSnippet → runSnippet →
// snippetCompletion). P82 drives this path because B6 places snippet-variable
// resolution INSIDE that shared runSnippet body (so both the popup-accept path
// and the insertion-bar path get variables) — expanding `sig` here therefore
// exercises exactly the seam variable resolution must live in. Fire-and-forget;
// the observable afterwards is the editor buffer (getEditorText): the resolved
// body, with `$CLIPBOARD`/`$CURRENT_DATE` replaced by real values, sits at the
// cursor — never the literal tokens.
export async function insertSnippetByTrigger(
  page: EvaluatesScripts,
  trigger: string,
): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.insertSnippetByTrigger(${JSON.stringify(trigger)}); return null; })()`,
  );
}

// ── Config-declared tikz-command DB → bar palette + completion (P94 / D-5) ──
// The insertion-bar tikz surface and the CM6 editor completion are SEEDED from a
// config-declared, load-validated vendored tikz-command DB (the QTikz
// `tikzcommands.json` `{name, description, insert, dx, dy, type}` model), NOT
// from a hardcoded tikz/tikzcd scaffold list. Per the milestone-G discipline
// (P55–P59 drive bar controls through harness hooks, not flaky webview button
// clicks), the implementer must expose — BLIND to how the DB is loaded and the
// surfaces seeded — these stable, click-free observables:
//
//   __PPE_E2E__.tikzCommandNames(): string[]  [NEW for P94]
//     The array of tikz-command NAMES the insertion bar's tikz palette surfaces,
//     sourced from the RETAINED parsed config DB (the same corpus the CM6
//     completion source is built from). Synchronous; an array of strings. Empty
//     ([]) iff the palette is not seeded from the DB.
//
//   __PPE_E2E__.insertTikzCommandByName(name: string)  [NEW for P94]
//     Inserts, at the cursor, the DB-declared INSERT BODY of the command named by
//     `name` (the multi-character `insert` text, NOT the bare command name),
//     routing through the editor's EXISTING insertSnippet surface (insertSnippet →
//     runSnippet → snippetCompletion). The command's declared cursor OFFSET
//     (QTikz `dx`/`dy`) is honoured exactly as a `$0` tabstop is on a completion
//     accept, so the cursor lands at the declared offset within the inserted body.
//     Fire-and-forget; returns null. This is the bar palette's choose-a-command
//     action, click-free.
//
//   __PPE_E2E__.reloadTikzCommands()  [NEW for P94]
//     Re-reads the config-declared tikz-command DB path from disk and re-seeds
//     BOTH surfaces from it (the same load the app performs at startup). Lets the
//     spec swap the configured DB file on disk and prove the surfaces are
//     DATA-DRIVEN — pointing config at a different DB surfaces THAT DB's commands.
//     Fire-and-forget; returns null. A malformed/unreadable DB on reload is a HARD
//     VISIBLE error, never a silently-empty palette.
//
//   __PPE_E2E__.getEditorText() [reused] / cursorOffset() [reused].
//
// The bar MAY also render a real DOM palette; the hooks are the stable, click-free
// surface this spec asserts against, the same choice P55–P59 made for bar controls.
export async function tikzCommandNames(page: EvaluatesScripts): Promise<string[]> {
  const raw = await page.evaluate(
    `JSON.stringify(window.__PPE_E2E__.tikzCommandNames())`,
  );
  if (typeof raw !== 'string') {
    throw new Error(`tikzCommandNames returned non-string: ${JSON.stringify(raw)}`);
  }
  return JSON.parse(raw) as string[];
}

export async function insertTikzCommandByName(
  page: EvaluatesScripts,
  name: string,
): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.insertTikzCommandByName(${JSON.stringify(name)}); return null; })()`,
  );
}

export async function reloadTikzCommands(page: EvaluatesScripts): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.reloadTikzCommands(); return null; })()`,
  );
}

// The cursor's character offset in the editor buffer, read straight from the
// REAL CM6 view state via the harness. Used by P52 to prove the snippet's
// declared tabstop ($0) is where the cursor lands after the expansion — not the
// end of the inserted body, and not the start of the literal trigger.
export async function cursorOffset(page: EvaluatesScripts): Promise<number> {
  const raw = await page.evaluate(`window.__PPE_E2E__.cursorOffset()`);
  if (typeof raw !== 'number') {
    throw new Error(`cursorOffset returned non-number: ${JSON.stringify(raw)}`);
  }
  return raw;
}

// ── Static lint diagnostics (P70) ──────────────────────────────────────────
// The editor's STATIC lint layer surfaces diagnostics through CM6's
// `@codemirror/lint` field — the SAME field `lintGutter` renders. To observe the
// produced diagnostics deterministically (and BLIND to how the lint source is
// built), the implementer must expose two harness hooks that read the editor's
// ACTUAL live lint state (the `lintState` field), flushed via `forceLinting`, NOT
// a parallel JS array. A side-array hook would be inadmissible: it could pass
// while the gutter shows nothing.
//
//   __PPE_E2E__.lintDiagnostics(): {from,to,severity,message,source}[]
//     The live, forceLinting-flushed @codemirror/lint diagnostics: `from`/`to`
//     are character offsets into the buffer (the range CM6 marks), `severity` is
//     the CM6 severity string, `message` the human-readable text, `source` the
//     producing linter / ChkTeX rule id.
//   __PPE_E2E__.lintCount(): number — the count of currently-active diagnostics
//     in that SAME flushed field.
export interface LintDiagnostic {
  from: number;
  to: number;
  severity: string;
  message: string;
  source: string;
}

export async function lintDiagnostics(page: EvaluatesScripts): Promise<LintDiagnostic[]> {
  const raw = await page.evaluate(
    `JSON.stringify(window.__PPE_E2E__.lintDiagnostics())`,
  );
  if (typeof raw !== 'string') {
    throw new Error(`lintDiagnostics returned non-string: ${JSON.stringify(raw)}`);
  }
  return JSON.parse(raw) as LintDiagnostic[];
}

export async function lintCount(page: EvaluatesScripts): Promise<number> {
  const raw = await page.evaluate(`window.__PPE_E2E__.lintCount()`);
  if (typeof raw !== 'number') {
    throw new Error(`lintCount returned non-number: ${JSON.stringify(raw)}`);
  }
  return raw;
}

// The set of completion-option labels currently shown in the live autocomplete
// popup, read straight from the REAL rendered CM6 tooltip DOM
// (`.cm-tooltip-autocomplete` → `.cm-completionLabel`). Returns [] when no
// popup is open. This is the user-visible observable: an option is "offered"
// iff its label text is present in the open tooltip.
export async function completionLabels(page: EvaluatesScripts): Promise<string[]> {
  const raw = await page.evaluate(`(() => {
    const tip = document.querySelector('.cm-tooltip-autocomplete');
    if (!tip) return JSON.stringify([]);
    const labels = Array.from(tip.querySelectorAll('.cm-completionLabel'))
      .map((el) => el.textContent ?? '');
    return JSON.stringify(labels);
  })()`);
  if (typeof raw !== 'string') {
    throw new Error(`completionLabels returned non-string: ${JSON.stringify(raw)}`);
  }
  return JSON.parse(raw) as string[];
}
