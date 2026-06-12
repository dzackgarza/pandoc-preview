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

export async function editorText(page: EvaluatesScripts): Promise<string> {
  return asString(
    await page.evaluate(`window.__PPE_E2E__.getEditorText()`),
    'getEditorText',
  );
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
