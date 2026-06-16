import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, waitForPreview } from './support/app';
import { sidebarPresent, waitForSplitSettled } from './support/layout';

// P18 — VSCode-style activity bar + collapsible side bar. The left of the window
// is an always-visible activity bar (a vertical strip of view controls, built to
// hold more views later) plus a collapsible side bar that shows the ACTIVE
// view's content. Now there is one view, Explorer (the file tree). Its activity-
// bar control carries data-view="explorer"; the side bar carries
// data-pane="sidebar" and a header naming the active view.
//
// Observable behaviour proven here:
//   - the Explorer activity-bar control exists.
//   - the side bar starts open, showing the Explorer view (its header names it).
//   - clicking the active view's control COLLAPSES the side bar — but the
//     activity bar persists (the control is still there to reopen it), exactly
//     like VSCode. Clicking it again reopens the side bar.
//
// Discriminator: the current app has a single ☰ toggle button in the formatting
// toolbar and no activity bar — no data-view control, no view header, and the
// toggle disappears with the toolbar contents rather than persisting as an
// activity bar. So this spec is RED until the activity-bar + side-bar structure
// exists. The assertions are the OBSERVED collapse/persist behaviour and the
// view header, not the mere presence of a control.

test('the activity bar persists and its Explorer control collapses/expands the side bar', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // The Explorer activity-bar control exists (and is the extensible view strip).
  expect(await tauriPage.count('[data-view="explorer"]')).toBe(1);

  // The side bar starts open, showing the Explorer VIEW'S CONTENT — the file
  // tree, listing the open project's files. (Revised 2026-06-16, commit
  // 1dbc698: the side bar no longer carries a separate "Explorer" label header;
  // the file tree's own folder-name header now names the active view. The
  // obligation is that the active view's content renders in the side bar.)
  // Discriminator: a side bar that did not render the Explorer view would not
  // list demo.md (the file opened from the project) — this fails on a broken or
  // unwired file tree, not merely on a renamed label.
  expect(await sidebarPresent(tauriPage)).toBe(true);
  const sidebarText = await tauriPage.evaluate(
    `(document.querySelector('[data-pane="sidebar"]')?.textContent ?? '')`,
  );
  expect(typeof sidebarText).toBe('string');
  expect((sidebarText as string).includes('demo.md')).toBe(true);

  // Clicking the active view's control collapses the side bar.
  await tauriPage.click('[data-view="explorer"]');
  await tauriPage.waitForFunction(
    `(() => { const e = document.querySelector('[data-pane="sidebar"]'); return !e || e.offsetParent === null || e.getBoundingClientRect().width === 0; })()`,
    5_000,
  );
  await waitForSplitSettled(tauriPage);
  expect(await sidebarPresent(tauriPage)).toBe(false);

  // ...but the ACTIVITY BAR persists when collapsed (VSCode behaviour): the
  // Explorer control is still present to reopen the side bar.
  expect(await tauriPage.count('[data-view="explorer"]')).toBe(1);

  // Clicking it again reopens the side bar.
  await tauriPage.click('[data-view="explorer"]');
  await tauriPage.waitForFunction(
    `(() => { const e = document.querySelector('[data-pane="sidebar"]'); return !!e && e.offsetParent !== null && e.getBoundingClientRect().width > 0; })()`,
    5_000,
  );
  await waitForSplitSettled(tauriPage);
  expect(await sidebarPresent(tauriPage)).toBe(true);

  recordObservation({ spec: manifest.spec, name: 'activity-bar', value: 'explorer-collapses-sidebar' });
});
