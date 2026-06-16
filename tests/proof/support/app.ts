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

// ── Real export path (P7/P8): real api.exportDocument, no native dialog ───
export async function exportTo(
  page: EvaluatesScripts,
  format: 'html' | 'pdf',
  target: string,
): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.exportTo(${JSON.stringify(format)}, ${JSON.stringify(target)}); return null; })()`,
  );
}

// ── Export by configured plugin id (P12) ──────────────────────────────────
// The export surface is plugin-shaped (export-plugins-contract.md): export
// targets are the [export.<id>] config entries, and the E2E hook drives them
// by id through the SAME command path the menu uses. A plugin id is an
// arbitrary user-defined string (e.g. "witness"), not the html/pdf literals,
// so this drives the real plugin dispatch rather than a fixed format switch.
export async function exportByPlugin(
  page: EvaluatesScripts,
  pluginId: string,
  target: string,
): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.exportTo(${JSON.stringify(pluginId)}, ${JSON.stringify(target)}); return null; })()`,
  );
}

// Read the hook's last-export state marker (window.__PPE_EXPORT__), used only
// to enrich the diagnostic when an expected artifact never appears. It is a
// pointer for the failure message, never a substitute for the on-disk proof.
export async function exportState(page: EvaluatesScripts): Promise<string> {
  return asString(
    await page.evaluate(`String(window.__PPE_EXPORT__)`),
    'exportState',
  );
}

// ── Run a generic plugin by id (A1/p19) ───────────────────────────────────
// The plugin firewall discovers plugins from the configured plugins dir and
// runs one by id against the REAL open buffer, returning a structured
// PluginResult. The harness hook fires the run (fire-and-forget, like exportTo)
// and stashes the resolved PluginResult on window.__PPE_PLUGIN_RESULT__ — the
// same pattern as __PPE_EXPORT__. The on-disk artifact is the decisive proof;
// the structured result is asserted alongside it. RED today: __PPE_E2E__.runPlugin
// does not exist, so this evaluate throws — the generic run-plugin surface is absent.
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
// synthesize key events into CodeMirror's contentEditable).
export async function appendAtEnd(page: EvaluatesScripts, text: string): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.appendAtEnd(${JSON.stringify(text)}); return null; })()`,
  );
}
