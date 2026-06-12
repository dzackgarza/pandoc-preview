import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openProject, contextMenuAction, currentFile } from './support/app';

async function clickByText(
  page: { evaluate(expr: string): Promise<unknown> },
  text: string,
): Promise<void> {
  const ok = await page.evaluate(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === ${JSON.stringify(text)});
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (ok !== true) throw new Error(`button not found: ${text}`);
}

// P6 — File manager mutates the real directory.
// (a) Sidebar lists exactly the non-hidden entries, directories first.
// (b) Creating chapter2.md via the UI yields a real empty file and opens it.
// (c) Renaming to chapter-two.md makes the old path absent, the new present.
// All disk facts are read by this independent process, never the app report.

test('sidebar mirrors the directory and UI create/rename mutate real files', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openProject(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('.grow.overflow-auto.p-1 button span:last-child')).some((s) => s.textContent.trim() === 'demo.md')`,
    15_000,
  );

  // (a) The witness project root holds exactly fig/ (dir) and demo.md, in
  // that order: directories first, then files. Root-level tree buttons are
  // the depth-0 nodes (padding-left: 6px); deeper nodes indent further.
  const labels = (await tauriPage.evaluate(
    `Array.from(document.querySelectorAll('.grow.overflow-auto.p-1 button'))
       .filter((b) => b.style.paddingLeft === '6px')
       .map((b) => b.querySelector('span:last-child').textContent.trim())`,
  )) as string[];
  expect(labels).toEqual(['fig', 'demo.md']);

  // (b) Create chapter2.md via the real sidebar "+" affordance + prompt.
  await tauriPage.click('button[title="New file in project root"]');
  await tauriPage.fill('input', 'chapter2.md');
  await clickByText(tauriPage, 'OK');

  const created = join(manifest.project, 'chapter2.md');
  await tauriPage.waitForFunction(
    `(window.__PPE_E2E__.currentFile() ?? '') === ${JSON.stringify(created)}`,
    15_000,
  );
  expect(existsSync(created)).toBe(true);
  expect(readFileSync(created, 'utf-8')).toBe('');
  expect(await currentFile(tauriPage)).toBe(created);

  // (c) Rename chapter2.md -> chapter-two.md via the context menu + prompt.
  await contextMenuAction(tauriPage, 'chapter2.md', 'Rename…');
  await tauriPage.fill('input', 'chapter-two.md');
  await clickByText(tauriPage, 'OK');

  const renamed = join(manifest.project, 'chapter-two.md');
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('.grow.overflow-auto.p-1 button span:last-child'))
       .some((s) => s.textContent.trim() === 'chapter-two.md')`,
    15_000,
  );
  expect(existsSync(renamed)).toBe(true);
  expect(existsSync(created)).toBe(false);

  recordObservation({ spec: manifest.spec, name: 'renamed-path', value: renamed });
});
