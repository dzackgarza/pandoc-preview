// Layout-geometry primitives for the split/tab/sidebar obligations (P13–P15).
//
// These read the REAL rendered layout of the running app (getBoundingClientRect
// on the actual editor pane, preview pane, and the divider separator) and drive
// the REAL split-drag handler with REAL PointerEvents on the live document.
//
// Why PointerEvents dispatched here, not tauriPage.mouse: the app's
// startSplitDrag (src/App.svelte) listens for `pointerdown` and adds
// `pointermove`/`pointerup` listeners. tauri-playwright's TauriMouse only
// dispatches MouseEvents (mousemove/mousedown), which never reach the pointer
// handlers, so it cannot exercise this drag at all. We dispatch the real
// PointerEvent sequence the app's own handler consumes.

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

// The editor pane: the App.svelte element whose inline width is the split
// percentage (the `style="width: {splitRatio*100}%"` div). It is the sibling
// immediately before the separator in the main row.
const EDITOR_PANE_SELECTOR = `document.querySelector('[role="separator"][aria-orientation="vertical"]')?.previousElementSibling`;
// The preview pane: the grow div immediately after the separator that hosts the
// PreviewPane (tabs + iframe).
const PREVIEW_PANE_SELECTOR = `document.querySelector('[role="separator"][aria-orientation="vertical"]')?.nextElementSibling`;
const SEPARATOR_SELECTOR = `document.querySelector('[role="separator"][aria-orientation="vertical"]')`;

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
  return asRect(await page.evaluate(rectExpr(SEPARATOR_SELECTOR, 'separator')), 'separatorRect');
}

// The horizontal center of the divider, in viewport px. This is the observable
// "where the divider landed" used by P13.
export async function dividerCenterX(page: EvaluatesScripts): Promise<number> {
  const r = await separatorRect(page);
  return (r.left + r.right) / 2;
}

// Drive the real split drag: pointerdown on the separator at its current
// center, then a sequence of pointermove events on window stepping toward
// targetX, then pointerup. Returns the divider center after each move so the
// caller can assert the divider tracks the pointer (P13). The whole sequence
// runs inside the live document in one evaluate so the synchronous pointermove
// handler observes each step.
export async function dragDividerTo(
  page: EvaluatesScripts,
  targetX: number,
  steps = 8,
): Promise<number[]> {
  const result = await page.evaluate(`(() => {
    const sep = ${SEPARATOR_SELECTOR};
    if (!sep) throw new Error('separator not found');
    const sr = sep.getBoundingClientRect();
    const startX = (sr.left + sr.right) / 2;
    const y = (sr.top + sr.bottom) / 2;
    const target = ${JSON.stringify(targetX)};
    const steps = ${JSON.stringify(steps)};
    const centerOf = () => {
      const r = sep.getBoundingClientRect();
      return (r.left + r.right) / 2;
    };
    const pe = (type, x) => new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
      isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y,
    });
    sep.dispatchEvent(pe('pointerdown', startX));
    const seen = [];
    for (let i = 1; i <= steps; i++) {
      const x = startX + ((target - startX) * i) / steps;
      window.dispatchEvent(pe('pointermove', x));
      seen.push(centerOf());
    }
    window.dispatchEvent(new PointerEvent('pointerup', {
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
// rendered DOM (the tab buttons carry onclick={() => activeTab = id}).
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

// Whether the file-tree sidebar is currently in the DOM. The sidebar is the
// w-60 column rendered only when sidebarVisible is true; its presence is the
// observable toggle state.
export async function sidebarPresent(page: EvaluatesScripts): Promise<boolean> {
  const present = await page.evaluate(
    `!!document.querySelector('.grow.overflow-auto.p-1')`,
  );
  if (typeof present !== 'boolean') {
    throw new Error(`sidebarPresent returned non-boolean: ${JSON.stringify(present)}`);
  }
  return present;
}

// Drive the View > Toggle Sidebar menu item through the same Tauri event bus
// the native menu uses (app.on_menu_event emits "menu" with the item id; the
// webview listens via listen("menu", ...)). P9 drives the Settings menu item
// the same way (window.__TAURI__.event.emit('menu', 'settings')). This is the
// only webview-reachable surface for the toggle: there is no DOM control.
export async function toggleSidebarViaMenu(page: EvaluatesScripts): Promise<void> {
  await page.evaluate(
    `(() => { window.__TAURI__.event.emit('menu', 'toggle_sidebar'); return null; })()`,
  );
}
