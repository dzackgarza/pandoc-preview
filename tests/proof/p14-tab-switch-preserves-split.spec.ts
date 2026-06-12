import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, waitForPreview } from './support/app';
import {
  editorPaneRect,
  previewPaneRect,
  clickPreviewTab,
  activePreviewTab,
} from './support/layout';

// P14 — Tab switch preserves the split. After a render, switching the right
// pane between Preview and Compile Log must change neither pane's width.
//
// Observed bug (proof-obligations.md P14): clicking the Compile Log tab makes
// the pane sizes jump. This spec measures both pane widths in the REAL layout,
// clicks the Compile Log tab, re-measures, and asserts both widths are
// unchanged (px-exact within 1px). It then switches back to Preview and
// re-asserts, so the invariant holds in both directions.

test('Switching Preview <-> Compile Log does not move either pane', async ({ tauriPage }) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Baseline: Preview tab active, both panes measured in the real layout.
  expect(await activePreviewTab(tauriPage)).toBe('preview');
  const editorBefore = (await editorPaneRect(tauriPage)).width;
  const previewBefore = (await previewPaneRect(tauriPage)).width;

  // Switch to Compile Log via the real tab button.
  await clickPreviewTab(tauriPage, 'Compile Log');
  await tauriPage.waitForFunction(`!!document.querySelector('pre')`, 5_000);
  expect(await activePreviewTab(tauriPage)).toBe('log');

  const editorLog = (await editorPaneRect(tauriPage)).width;
  const previewLog = (await previewPaneRect(tauriPage)).width;

  // Neither pane width changed when the tab switched.
  expect(Math.abs(editorLog - editorBefore)).toBeLessThanOrEqual(1);
  expect(Math.abs(previewLog - previewBefore)).toBeLessThanOrEqual(1);

  // Switch back to Preview and re-assert the original widths are restored.
  await clickPreviewTab(tauriPage, 'Preview');
  await tauriPage.waitForFunction(
    `!!document.querySelector('iframe[title="Rendered preview"]')`,
    5_000,
  );
  expect(await activePreviewTab(tauriPage)).toBe('preview');

  const editorBack = (await editorPaneRect(tauriPage)).width;
  const previewBack = (await previewPaneRect(tauriPage)).width;
  expect(Math.abs(editorBack - editorBefore)).toBeLessThanOrEqual(1);
  expect(Math.abs(previewBack - previewBefore)).toBeLessThanOrEqual(1);

  recordObservation({ spec: manifest.spec, name: 'editor-width-preview', value: Math.round(editorBefore) });
  recordObservation({ spec: manifest.spec, name: 'editor-width-log', value: Math.round(editorLog) });
});
