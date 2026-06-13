import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, waitForPreview } from './support/app';
import {
  editorPaneRect,
  previewPaneRect,
  sidebarPresent,
  toggleSidebarViaMenu,
  waitForSplitSettled,
} from './support/layout';

// P15 — Sidebar toggle preserves the editor:preview ratio. Hiding/showing the
// file tree must keep the relative split of the two panes.
//
// Driveable surface: there is NO DOM control for the toggle. The only
// webview-reachable surface is the View > Toggle Sidebar menu item, driven
// through the same Tauri event bus the native menu uses
// (window.__TAURI__.event.emit('menu', 'toggle_sidebar')) — exactly how P9
// drives the Settings menu item. The native muda menu itself is unreachable
// from the webview DOM; that menu-population proof debt is recorded in the
// export/doctor contracts and is not in scope here.
//
// Observed bug (proof-obligations.md P15): the editor pane width is
// splitRatio * mainWidth, where mainWidth is the whole main row INCLUDING the
// sidebar. Hiding the sidebar frees ~240px that the `grow` preview pane
// absorbs while the editor pane keeps its px width, so the editor:preview ratio
// drops. The ratio is therefore NOT preserved across the toggle. This spec
// computes the ratio before and after and asserts it is preserved within a
// tight tolerance; the current implementation shifts it well outside that.

test('Hiding the file-tree sidebar preserves the editor:preview ratio', async ({ tauriPage }) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Sidebar starts visible (sidebarVisible defaults to true).
  expect(await sidebarPresent(tauriPage)).toBe(true);

  const ratioOf = async (): Promise<number> => {
    const editor = (await editorPaneRect(tauriPage)).width;
    const preview = (await previewPaneRect(tauriPage)).width;
    return editor / (editor + preview);
  };

  await waitForSplitSettled(tauriPage);
  const ratioBefore = await ratioOf();

  // Hide the sidebar via the menu event bus and wait for it to leave the DOM.
  await toggleSidebarViaMenu(tauriPage);
  await tauriPage.waitForFunction(
    `(() => { const e = document.querySelector('[data-pane="sidebar"]'); return !e || e.offsetParent === null || e.getBoundingClientRect().width === 0; })()`,
    5_000,
  );
  expect(await sidebarPresent(tauriPage)).toBe(false);

  // Wait for dockview's async relayout to settle before measuring (P15 flake).
  await waitForSplitSettled(tauriPage);
  const ratioHidden = await ratioOf();

  // The relative split of the two panes is preserved when the sidebar hides.
  // 0.02 is far tighter than the ~0.1+ drop the sidebar-width leak produces.
  expect(Math.abs(ratioHidden - ratioBefore)).toBeLessThanOrEqual(0.02);

  // Show it again and re-assert the ratio returns to the original split.
  await toggleSidebarViaMenu(tauriPage);
  await tauriPage.waitForFunction(
    `(() => { const e = document.querySelector('[data-pane="sidebar"]'); return !!e && e.offsetParent !== null && e.getBoundingClientRect().width > 0; })()`,
    5_000,
  );
  expect(await sidebarPresent(tauriPage)).toBe(true);

  await waitForSplitSettled(tauriPage);
  const ratioShownAgain = await ratioOf();
  expect(Math.abs(ratioShownAgain - ratioBefore)).toBeLessThanOrEqual(0.02);

  recordObservation({ spec: manifest.spec, name: 'ratio-sidebar-visible', value: Number(ratioBefore.toFixed(4)) });
  recordObservation({ spec: manifest.spec, name: 'ratio-sidebar-hidden', value: Number(ratioHidden.toFixed(4)) });
});
