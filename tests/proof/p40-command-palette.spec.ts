import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openProject, clickSidebarEntry } from './support/app';

async function pressCtrlP(page: { evaluate(e: string): Promise<unknown> }) {
  await page.evaluate(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', ctrlKey: true, bubbles: true, cancelable: true }));
    return null;
  })()`);
}

async function clickPaletteCommand(
  page: { evaluate(e: string): Promise<unknown> },
  label: string,
) {
  const ok = await page.evaluate(`(() => {
    const b = Array.from(document.querySelectorAll('[data-testid="command-palette"] button'))
      .find((x) => x.textContent.trim() === ${JSON.stringify(label)});
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (ok !== true) throw new Error(`palette command not found: ${label}`);
}

async function foldCount(page: { evaluate(e: string): Promise<unknown> }): Promise<number> {
  const raw = await page.evaluate(`JSON.stringify(window.__PPE_E2E__.getFoldedRanges())`);
  return (JSON.parse(raw as string) as unknown[]).length;
}

// P40 — Ctrl-P command palette runs Fold All / Unfold All against the real
// editor. Ctrl-P (a real window keydown) opens the palette; clicking "Fold All"
// collapses every foldable range (getFoldedRanges becomes non-empty), and
// "Unfold All" expands them again (back to empty). Proves the palette is wired
// to the editor's fold commands, not just that a modal renders.

test('Ctrl-P palette: Fold All folds, Unfold All unfolds', async ({ tauriPage }) => {
  const manifest = loadRunManifest();
  await openProject(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('.grow.overflow-auto.p-1 button span:last-child')).some((s) => s.textContent.trim() === 'outline.md')`,
    15_000,
  );
  await clickSidebarEntry(tauriPage, 'outline.md');
  await tauriPage.waitForFunction(
    `(document.querySelector('.cm-editor .cm-content')?.textContent ?? '').includes('Section One')`,
    15_000,
  );

  expect(await foldCount(tauriPage)).toBe(0);

  await pressCtrlP(tauriPage);
  await tauriPage.waitForFunction(
    `!!document.querySelector('[data-testid="command-palette"]')`,
    10_000,
  );
  await clickPaletteCommand(tauriPage, 'Fold All');
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getFoldedRanges().length > 0`,
    10_000,
  );
  expect(await foldCount(tauriPage)).toBeGreaterThan(0);

  await pressCtrlP(tauriPage);
  await tauriPage.waitForFunction(
    `!!document.querySelector('[data-testid="command-palette"]')`,
    10_000,
  );
  await clickPaletteCommand(tauriPage, 'Unfold All');
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getFoldedRanges().length === 0`,
    10_000,
  );
  expect(await foldCount(tauriPage)).toBe(0);

  recordObservation({ spec: manifest.spec, name: 'command-palette-fold', value: 1 });
});
