import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, waitForPreview } from './support/app';
import {
  dragDividerTo,
  dividerCenterX,
  separatorRect,
  previewPaneRect,
} from './support/layout';

// P13 — Splitter tracks the pointer. With the sidebar visible and a file open
// and rendered, drag the editor/preview divider with REAL PointerEvents: press
// on the separator, move in steps to a target X inside the preview region,
// release. The divider must land at the pointer (within a few px).
//
// Observed bug (proof-obligations.md P13): startSplitDrag in src/App.svelte
// computes splitRatio = (clientX - mainRect.left) / mainRect.width, where
// mainRect is the WHOLE main row INCLUDING the 240px file-tree sidebar. The
// editor pane width is then ratio*mainWidth, so the divider sits at
// sidebarWidth + ratio*mainWidth ≈ sidebarWidth + (clientX - mainLeft), i.e.
// offset to the RIGHT of the pointer by the sidebar's width. The divider does
// not land where the user pointed. This spec's tolerance is far tighter than
// that offset, so it fails on the current implementation and passes only when
// the ratio is computed against the editor+preview region (pointer-anchored).
//
// Harness note / proof debt: the second observed bug (no pointer capture, so
// the iframe swallows pointermove once the drag crosses it) cannot be
// reproduced by synthetic PointerEvents — a window.dispatchEvent reaches the
// window listener regardless of the iframe, bypassing the hit-test that the
// real OS pointer would fail. tauri-playwright's TauriMouse only emits
// MouseEvents, which the pointer-based handler ignores entirely. So this spec
// proves the pointer-anchoring obligation; the pointer-capture obligation is
// recorded as proof debt, not weakened into a passing assertion.

test('Dragging the divider lands it at the pointer position', async ({ tauriPage }) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Choose a target clearly inside the preview pane region, to the right of the
  // separator's current position, so the drag path crosses into the preview.
  const previewRect = await previewPaneRect(tauriPage);
  const startRect = await separatorRect(tauriPage);
  const startX = (startRect.left + startRect.right) / 2;
  // A target a third of the way into the preview pane: unambiguously right of
  // the separator and inside the preview region.
  const targetX = previewRect.left + previewRect.width / 3;
  expect(targetX).toBeGreaterThan(startX + 50);

  const samples = await dragDividerTo(tauriPage, targetX);
  const landedX = await dividerCenterX(tauriPage);

  // Primary discriminator: the divider lands AT the pointer, within a small
  // tolerance. The current ratio-against-the-whole-row bug offsets the divider
  // by ~240px (the sidebar width), far outside this tolerance.
  const tolerance = 6;
  expect(Math.abs(landedX - targetX)).toBeLessThanOrEqual(tolerance);

  // The divider actually moved toward the pointer (it was not frozen), and its
  // tracking is monotonic non-decreasing across the rightward drag (no
  // backward jumps). Starts at the press point, ends near the target.
  expect(landedX).toBeGreaterThan(startX + 50);
  for (let i = 1; i < samples.length; i++) {
    expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1] - tolerance);
  }

  recordObservation({ spec: manifest.spec, name: 'divider-target-x', value: Math.round(targetX) });
  recordObservation({ spec: manifest.spec, name: 'divider-landed-x', value: Math.round(landedX) });
});
