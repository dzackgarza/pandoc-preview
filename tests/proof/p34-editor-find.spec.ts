import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, sleep } from './support/app';

async function pressKey(
  page: { evaluate(expr: string): Promise<unknown> },
  key: string,
  opts: { ctrl?: boolean; code?: string } = {},
): Promise<void> {
  const init = JSON.stringify({
    key,
    code: opts.code ?? "",
    ctrlKey: !!opts.ctrl,
    bubbles: true,
    cancelable: true,
  });
  const ok = await page.evaluate(`(() => {
    const el = document.querySelector('.cm-content');
    if (!el) return 'no-content';
    el.dispatchEvent(new KeyboardEvent('keydown', ${init}));
    return true;
  })()`);
  if (ok !== true) throw new Error(`keydown ${key} not dispatched: ${String(ok)}`);
}

async function searchPanelOpen(page: { evaluate(expr: string): Promise<unknown> }): Promise<boolean> {
  return (await page.evaluate(
    `!!document.querySelector('.cm-editor .cm-panel.cm-search')`,
  )) as boolean;
}

// P34 — Find wiring. The editor owns two routes to the search panel: the
// @codemirror/search keymap (Ctrl+F) included in the editor's keymap, and the
// native Edit > Find menu item routed through App's menu handler to
// editor.command('find') → openSearchPanel. The search ALGORITHM is the
// dependency's; what this repo owns is that both triggers open the panel and
// that Escape closes it. Each assertion fails on a distinct broken wiring
// (searchKeymap dropped, Escape unbound, or the menu route severed).

test('Ctrl+F and the native Find menu both open the search panel; Escape closes it', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  expect(await searchPanelOpen(tauriPage)).toBe(false);

  // Keyboard route: Ctrl+F opens the search panel.
  await pressKey(tauriPage, "f", { ctrl: true, code: "KeyF" });
  await tauriPage.waitForFunction(
    `!!document.querySelector('.cm-editor .cm-panel.cm-search')`,
    10_000,
  );

  // Escape closes it (the search keymap's close binding).
  await pressKey(tauriPage, "Escape", { code: "Escape" });
  await tauriPage.waitForFunction(
    `!document.querySelector('.cm-editor .cm-panel.cm-search')`,
    10_000,
  );

  // Native menu route: Edit > Find opens the same panel through App's handler.
  await tauriPage.evaluate(
    `(() => { window.__TAURI__.event.emit('menu', 'find'); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `!!document.querySelector('.cm-editor .cm-panel.cm-search')`,
    10_000,
  );
  await sleep(50);

  recordObservation({ spec: manifest.spec, name: 'find-panel-routes', value: 2 });
});
