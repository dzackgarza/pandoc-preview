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
