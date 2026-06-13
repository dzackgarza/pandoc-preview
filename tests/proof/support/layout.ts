// Layout-geometry primitives for the split/tab/sidebar obligations (P13–P15).
//
// The layout is owned by dockview-core's SplitviewComponent (fixed, resizable
// panes — no docking/float). These helpers read the REAL rendered layout
// (getBoundingClientRect on the actual editor/preview pane elements and the
// dockview sash) and drive the REAL sash drag with REAL PointerEvents.
//
// DOM contract the app must honour (src/App.svelte + the dockview Svelte
// adapter), kept stable so these helpers do not depend on dockview internals:
//   - each pane's content root carries data-pane="sidebar" | "editor" | "preview"
//   - the resize handles are dockview's `.dv-sash` elements
//   - the editor|preview sash is identified GEOMETRICALLY (the `.dv-sash` whose
//     center-x sits at the editor/preview boundary), so it is robust to whether
//     the sidebar is a third splitview panel or a sibling outside the splitview.
//
// Why synthetic PointerEvents, not tauriPage.mouse: dockview's sash listens for
// `pointerdown` on the sash, then `pointermove`/`pointerup` on `document` (no
// pointer capture — verified in dockview-core 6.6.1 splitview.js). tauri-
// playwright's TauriMouse only dispatches MouseEvents, which the sash ignores;
// we dispatch the exact PointerEvent sequence the sash consumes.

interface EvaluatesScripts {
  evaluate(expression: string): Promise<unknown>;
}

export interface Rect {
  left: number;
  right: number;
  width: number;
  top: number;
  bottom: number;
  height: number;
}

function asRect(value: unknown, what: string): Rect {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${what} returned non-object: ${JSON.stringify(value)}`);
  }
  const r = value as Record<string, unknown>;
  for (const key of ['left', 'right', 'width', 'top', 'bottom', 'height']) {
    if (typeof r[key] !== 'number') {
      throw new Error(`${what} rect missing numeric field ${key}: ${JSON.stringify(value)}`);
    }
  }
  return r as unknown as Rect;
}

function asNumber(value: unknown, what: string): number {
  if (typeof value !== 'number') {
    throw new Error(`${what} returned non-number: ${JSON.stringify(value)}`);
  }
  return value;
}

const EDITOR_PANE_SELECTOR = `document.querySelector('[data-pane="editor"]')`;
const PREVIEW_PANE_SELECTOR = `document.querySelector('[data-pane="preview"]')`;

// The editor|preview divider: among dockview's `.dv-sash` handles, the one whose
// horizontal center is nearest the editor pane's right edge (the editor/preview
// boundary). Returned as a live-DOM expression so callers can rect/drag it.
const EDITOR_PREVIEW_SASH_EXPR = `(() => {
  const editor = document.querySelector('[data-pane="editor"]');
  if (!editor) throw new Error('editor pane not found');
  const boundary = editor.getBoundingClientRect().right;
  const sashes = Array.from(document.querySelectorAll('.dv-sash'));
  if (sashes.length === 0) throw new Error('no .dv-sash handles found');
  let best = null, bestDist = Infinity;
  for (const s of sashes) {
    const r = s.getBoundingClientRect();
    const cx = (r.left + r.right) / 2;
    const d = Math.abs(cx - boundary);
    if (d < bestDist) { bestDist = d; best = s; }
  }
  return best;
})()`;

function rectExpr(elExpr: string, what: string): string {
  return `(() => {
    const el = ${elExpr};
    if (!el) throw new Error('${what} element not found');
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, top: r.top, bottom: r.bottom, height: r.height };
  })()`;
}

export async function editorPaneRect(page: EvaluatesScripts): Promise<Rect> {
  return asRect(await page.evaluate(rectExpr(EDITOR_PANE_SELECTOR, 'editor pane')), 'editorPaneRect');
}

export async function previewPaneRect(page: EvaluatesScripts): Promise<Rect> {
  return asRect(await page.evaluate(rectExpr(PREVIEW_PANE_SELECTOR, 'preview pane')), 'previewPaneRect');
}

export async function separatorRect(page: EvaluatesScripts): Promise<Rect> {
  return asRect(await page.evaluate(rectExpr(EDITOR_PREVIEW_SASH_EXPR, 'editor/preview sash')), 'separatorRect');
}

// The horizontal center of the divider, in viewport px. This is the observable
// "where the divider landed" used by P13.
export async function dividerCenterX(page: EvaluatesScripts): Promise<number> {
  const r = await separatorRect(page);
  return (r.left + r.right) / 2;
}

// Drive the real sash drag: pointerdown on the editor|preview `.dv-sash` at its
// current center, then a sequence of pointermove events on `document` stepping
// toward targetX, then pointerup. dockview's sash adds its move/up listeners to
// `document`, so the events must be dispatched there. Returns the divider center
// after each move so the caller can assert the divider tracks the pointer (P13).
export async function dragDividerTo(
  page: EvaluatesScripts,
  targetX: number,
  steps = 8,
): Promise<number[]> {
  const result = await page.evaluate(`(() => {
    const sash = ${EDITOR_PREVIEW_SASH_EXPR};
    if (!sash) throw new Error('editor/preview sash not found');
    const sr = sash.getBoundingClientRect();
    const startX = (sr.left + sr.right) / 2;
    const y = (sr.top + sr.bottom) / 2;
    const target = ${JSON.stringify(targetX)};
    const steps = ${JSON.stringify(steps)};
    const centerOf = () => {
      const r = sash.getBoundingClientRect();
      return (r.left + r.right) / 2;
    };
    const pe = (type, x) => new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
      isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y,
    });
    sash.dispatchEvent(pe('pointerdown', startX));
    const seen = [];
    for (let i = 1; i <= steps; i++) {
      const x = startX + ((target - startX) * i) / steps;
      document.dispatchEvent(pe('pointermove', x));
      seen.push(centerOf());
    }
    document.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
      isPrimary: true, button: 0, buttons: 0, clientX: target, clientY: y,
    }));
    seen.push(centerOf());
    return seen;
  })()`);
  if (!Array.isArray(result)) {
    throw new Error(`dragDividerTo returned non-array: ${JSON.stringify(result)}`);
  }
  return result.map((v) => asNumber(v, 'divider sample'));
}

// Click the PreviewPane tab whose label matches exactly, through the real
// rendered DOM. The preview keeps its in-pane Preview/Compile-Log tab toggle
// (the tab buttons carry onclick={() => activeTab = id}) inside the dockview
// preview panel — unchanged by the splitview migration.
export async function clickPreviewTab(page: EvaluatesScripts, label: string): Promise<void> {
  const clicked = await page.evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find((b) => b.textContent.trim() === ${JSON.stringify(label)});
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  if (clicked !== true) {
    throw new Error(`preview tab not found: ${label}`);
  }
}

// Which tab is active, read from the real DOM: the Compile Log <pre> is present
// iff the log tab is active; the preview iframe is present iff the preview tab
// is active. (PreviewPane renders one or the other, never both.)
export async function activePreviewTab(page: EvaluatesScripts): Promise<'preview' | 'log'> {
  const which = await page.evaluate(`(() => {
    if (document.querySelector('iframe[title="Rendered preview"]')) return 'preview';
    if (document.querySelector('pre')) return 'log';
    return 'none';
  })()`);
  if (which !== 'preview' && which !== 'log') {
    throw new Error(`could not determine active tab: ${String(which)}`);
  }
  return which;
}

// Whether the file-tree sidebar is currently VISIBLE. The sidebar pane carries
// data-pane="sidebar"; toggling it hides it (removed from the splitview /
// display:none), so visibility — not mere DOM presence — is the observable
// toggle state. offsetParent is null for a display:none element, and a
// zero-width pane is also "not shown".
export async function sidebarPresent(page: EvaluatesScripts): Promise<boolean> {
  const present = await page.evaluate(`(() => {
    const el = document.querySelector('[data-pane="sidebar"]');
    if (!el) return false;
    if (el.offsetParent === null) return false;
    return el.getBoundingClientRect().width > 0;
  })()`);
  if (typeof present !== 'boolean') {
    throw new Error(`sidebarPresent returned non-boolean: ${JSON.stringify(present)}`);
  }
  return present;
}

// Drive the View > Toggle Sidebar menu item through the same Tauri event bus the
// native menu uses (app.on_menu_event emits "menu" with the item id; the webview
// listens via listen("menu", ...)). P9 drives the Settings menu item the same
// way. This is the only webview-reachable surface for the toggle; the app's
// handler flips the sidebar's splitview visibility.
export async function toggleSidebarViaMenu(page: EvaluatesScripts): Promise<void> {
  await page.evaluate(
    `(() => { window.__TAURI__.event.emit('menu', 'toggle_sidebar'); return null; })()`,
  );
}
