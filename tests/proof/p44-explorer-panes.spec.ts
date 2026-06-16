import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openProject, clickSidebarEntry, editorText } from './support/app';

// P44 — Alternative-explorer panes. The Macros pane is a file explorer fixed at
// the configured styles directory; the Figures pane is fixed at the configured
// figures directory. Switching to the Macros view lists the real .sty files
// installed under ~/.pandoc/styles, and opening one loads its real content into
// the editor (the same open path the project explorer uses). The Figures view
// is rooted at the figures directory. Proves the panes read config.directories
// and drive real navigation, not a hardcoded or empty list.

const SIDEBAR_HEADER = `document.querySelector('[data-pane="sidebar"] span.uppercase')?.textContent.trim()`;
const TREE_ENTRY = (name: string) =>
  `Array.from(document.querySelectorAll('.grow.overflow-auto.p-1 button span:last-child')).some((s) => s.textContent.trim() === ${JSON.stringify(name)})`;

test('Macros pane lists the styles dir and opens a .sty file; Figures pane roots at figures', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();
  await openProject(tauriPage, manifest.project);

  // Switch to the Macros view via the activity bar.
  await tauriPage.evaluate(
    `(() => { document.querySelector('[data-view="macros"]').click(); return null; })()`,
  );

  // The macros explorer is rooted at the styles dir (header = "styles") and lists
  // the real vendored macro file install-assets symlinked there.
  await tauriPage.waitForFunction(TREE_ENTRY('dzg-macros.sty'), 15_000);
  expect(await tauriPage.evaluate(SIDEBAR_HEADER)).toBe('styles');

  // Opening it loads its real content into the editor (the package it defines).
  await clickSidebarEntry(tauriPage, 'dzg-macros.sty');
  await tauriPage.waitForFunction(
    `(window.__PPE_E2E__.getEditorText() || '').includes('\\\\ProvidesPackage{dzg-macros}')`,
    15_000,
  );
  const text = await editorText(tauriPage);
  expect(text).toContain('\\ProvidesPackage{dzg-macros}');
  expect(await tauriPage.evaluate(`window.__PPE_E2E__.currentFile()`)).toContain(
    '/.pandoc/styles/dzg-macros.sty',
  );

  // Switch to the Figures view; its explorer is rooted at the figures dir.
  await tauriPage.evaluate(
    `(() => { document.querySelector('[data-view="figures"]').click(); return null; })()`,
  );
  await tauriPage.waitForFunction(`${SIDEBAR_HEADER} === 'figures'`, 10_000);

  recordObservation({ spec: manifest.spec, name: 'macros-file', value: 'dzg-macros.sty' });
});
