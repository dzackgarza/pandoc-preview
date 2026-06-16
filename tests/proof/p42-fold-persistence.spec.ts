import { test, expect } from './fixtures';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openProject, clickSidebarEntry, sleep } from './support/app';

async function foldCount(page: { evaluate(e: string): Promise<unknown> }): Promise<number> {
  const raw = await page.evaluate(`JSON.stringify(window.__PPE_E2E__.getFoldedRanges())`);
  return (JSON.parse(raw as string) as unknown[]).length;
}

// P42 — Per-file fold state persists and restores. Fold everything in outline.md,
// switch to demo.md (which persists outline.md's folds to fold-state.json), then
// reopen outline.md — its folds come back. The on-disk fold-state.json, read
// independently, records outline.md's ranges. Proves real cross-file persistence
// (disk write + restore), not just in-memory toggling.

test('Folds persist per file and restore on reopen', async ({ tauriPage }) => {
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

  await tauriPage.evaluate(`(() => { window.__PPE_E2E__.foldAll(); return null; })()`);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getFoldedRanges().length > 0`,
    10_000,
  );
  const folded = await foldCount(tauriPage);
  expect(folded).toBeGreaterThan(0);

  // Switch away (persists outline.md's folds), then back (restores them).
  await clickSidebarEntry(tauriPage, 'demo.md');
  await tauriPage.waitForFunction(
    `(document.querySelector('.cm-editor .cm-content')?.textContent ?? '').includes('Geometry of Numbers')`,
    15_000,
  );
  await clickSidebarEntry(tauriPage, 'outline.md');
  await tauriPage.waitForFunction(
    `(document.querySelector('.cm-editor .cm-content')?.textContent ?? '').includes('Section One')`,
    15_000,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getFoldedRanges().length > 0`,
    10_000,
  );
  expect(await foldCount(tauriPage)).toBe(folded);

  // fold-state.json (read independently) records outline.md's ranges.
  await sleep(300);
  const foldStatePath = join(dirname(manifest.configPath), 'fold-state.json');
  const onDisk = JSON.parse(readFileSync(foldStatePath, 'utf8')) as Record<
    string,
    unknown[]
  >;
  const outlinePath = join(manifest.project, 'outline.md');
  expect(onDisk[outlinePath]).toBeDefined();
  expect(onDisk[outlinePath].length).toBe(folded);

  recordObservation({ spec: manifest.spec, name: 'fold-persistence', value: folded });
});
