import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, waitForPreview } from './support/app';
import { sidebarPresent } from './support/layout';

// P18 — The sidebar has a visible collapse control. There is a toolbar button
// (title beginning "Toggle Sidebar") that collapses and expands the file-tree
// sidebar — the sidebar must be collapsible from the UI, not only via the
// native View menu / F9. Clicking the control hides the sidebar; clicking it
// again restores it.
//
// Discriminator: the current app has NO such control (the sidebar toggles only
// through the menu event bus), so the click target does not exist and the
// sidebar never collapses from a UI affordance — this spec is RED until the
// control is added and wired to the same sidebar-visibility state. The
// assertion is the OBSERVED collapse/expand, not the mere presence of a button.

test('a toolbar control collapses and expands the file-tree sidebar', async ({ tauriPage }) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Sidebar starts visible.
  expect(await sidebarPresent(tauriPage)).toBe(true);

  // The visible collapse control exists and collapses the sidebar.
  await tauriPage.click('button[title^="Toggle Sidebar"]');
  await tauriPage.waitForFunction(
    `(() => { const e = document.querySelector('[data-pane="sidebar"]'); return !e || e.offsetParent === null || e.getBoundingClientRect().width === 0; })()`,
    5_000,
  );
  expect(await sidebarPresent(tauriPage)).toBe(false);

  // Clicking it again expands the sidebar back.
  await tauriPage.click('button[title^="Toggle Sidebar"]');
  await tauriPage.waitForFunction(
    `(() => { const e = document.querySelector('[data-pane="sidebar"]'); return !!e && e.offsetParent !== null && e.getBoundingClientRect().width > 0; })()`,
    5_000,
  );
  expect(await sidebarPresent(tauriPage)).toBe(true);

  recordObservation({ spec: manifest.spec, name: 'collapse-control', value: 'toggles-sidebar' });
});
