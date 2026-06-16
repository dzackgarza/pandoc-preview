import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openProject, clickSidebarEntry } from './support/app';

// P41 — Outline panel. For outline.md (a heading hierarchy plus two fenced divs,
// one with a title), the sidebar Outline lists: the headings by text, and each
// div by its class — `:::{.remark}` -> "Remark", `:::{.theorem title="Main
// Result"}` -> "Theorem: Main Result". Clicking an entry moves the editor cursor
// to that entry's line. Proves the outline is built from the real document and
// drives real navigation, not a static list.

test('Outline lists headings and divs (with titles); clicking navigates', async ({
  tauriPage,
}) => {
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
  await tauriPage.waitForFunction(
    `document.querySelectorAll('[data-testid="outline"] button').length === 4`,
    15_000,
  );

  const labels = JSON.parse(
    (await tauriPage.evaluate(
      `JSON.stringify(Array.from(document.querySelectorAll('[data-testid="outline"] button span:last-child')).map((s) => s.textContent.trim()))`,
    )) as string,
  );
  expect(labels).toEqual([
    'Section One',
    'Subsection',
    'Remark',
    'Theorem: Main Result',
  ]);

  // Click the titled div entry -> cursor lands on its line (line 13 of outline.md).
  const clicked = await tauriPage.evaluate(`(() => {
    const b = Array.from(document.querySelectorAll('[data-testid="outline"] button'))
      .find((x) => x.querySelector('span:last-child')?.textContent.trim() === 'Theorem: Main Result');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  expect(clicked).toBe(true);
  await tauriPage.waitForFunction(`window.__PPE_E2E__.cursorLine() === 13`, 10_000);

  // The outline is a collapsible section: its header toggles the list.
  await tauriPage.evaluate(
    `(() => { document.querySelector('[data-testid="outline-header"]').click(); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `!document.querySelector('[data-testid="outline"]')`,
    5_000,
  );
  await tauriPage.evaluate(
    `(() => { document.querySelector('[data-testid="outline-header"]').click(); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `!!document.querySelector('[data-testid="outline"]')`,
    5_000,
  );

  recordObservation({ spec: manifest.spec, name: 'outline-panel', value: labels.length });
});
