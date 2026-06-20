import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { parseTomlFile } from './support/toml';
import { openAndSelectDemo, sleep, waitForPreview, waitForHarness } from './support/app';
import {
  editorPaneRect,
  previewPaneRect,
  separatorRect,
  dividerCenterX,
  dragDividerTo,
} from './support/layout';

// P128 (Phase H / H.2) — THREE-WAY edit / preview / split VIEW-MODE TOGGLE.
//
// RESEARCH-FIRST: this is LAYOUT STATE over infrastructure that already ships,
// NOT a new layout engine. The editor|preview split is a horizontal dockview
// `SplitviewComponent` created by `createSplitLayout` (src/lib/dockview.ts —
// `addPanel` editor/preview, each exposing a `data-pane` element the Svelte
// editor/preview wrappers portal into). The three-way toggle is realized by
// SHOWING/HIDING the editor or preview panel through that SplitviewComponent's
// per-view VISIBILITY API plus a re-`layout()` — NEVER by tearing down and
// rebuilding the splitview (a rebuild would lose the P13/P15 editor:preview
// ratio and the portal mounts). The view mode is config-owned (`config.rs`
// Editor — a `view_mode` enum editor/preview/split, validated, round-tripped by
// `save_config`, the P9 invariant), restored at launch; an unknown `view_mode`
// is a LOUD config error, never silently coerced to a default.
//
// WHAT THIS SPEC PROVES (P121 observable clauses — nothing about wiring):
//   (1) HIDE-EDITOR. Setting the view mode to `preview` HIDES the editor pane —
//       the `data-pane="editor"` element measures ZERO width / is not laid out —
//       while the preview pane occupies the FULL width.
//   (2) HIDE-PREVIEW. Setting the view mode to `editor` HIDES the preview pane —
//       the `data-pane="preview"` element measures ZERO width — while the editor
//       pane occupies the FULL width.
//   (3) RATIO RETURN. Setting the mode back to `split` RESTORES BOTH panes at the
//       SAME non-50/50 ratio they held before the toggle (established here by a
//       prior REAL splitter drag to an off-center position), within a few px —
//       proving the toggle hid/showed panes rather than rebuilding the split (a
//       rebuild would reset to 50/50, the P15 regression).
//   (4) PERSIST. The chosen `view_mode` round-trips to the on-disk `config.toml`
//       under the hermetic XDG_CONFIG_HOME (the P9 class) — read back by an
//       INDEPENDENT process (python tomllib), so the mode survives persistence.
//
// Pane widths are measured by the SAME `tests/proof/support/layout.ts`
// measurement P13/P15 use, independently of the app's own report; the config is
// read independently of the app by `parseTomlFile`.
//
// ADMISSIBLE because it FAILS on a plausibly broken app:
//   - NO view toggle (both panes always show): `__PPE_E2E__.setViewMode` does not
//     exist -> the evaluate throws (clause 1); or it exists but never hides a pane
//     -> the `data-pane` widths stay non-zero in every mode (clauses 1/2).
//   - REBUILD-based toggle that loses the ratio: returning to `split` yields a
//     reset 50/50 instead of the prior off-center ratio (clause 3).
//   - NON-PERSISTED mode: the chosen `view_mode` never reaches the on-disk
//     `config.toml` (clause 4 — the P9 round-trip class).
//   - An existence-only `setViewMode`/`viewMode` symbol would pass none of
//     clauses 1–4, which measure the REAL pane geometry and the REAL on-disk
//     config — never the mere presence of a hook.
//
// RED EXPECTATION today: there is NO three-way view toggle. The app always shows
// BOTH the editor and preview panes (the 50/50 split), and exposes no
// `setViewMode`/`viewMode` on `__PPE_E2E__`. So clause (1)'s evaluate of
// `window.__PPE_E2E__.setViewMode('preview')` throws (the hook is absent) — the
// faithful "no view toggle surface" failure. The app BOOTS cleanly, the project
// opens, demo.md renders (its <h1> is present) and BOTH panes measure non-zero
// width BEFORE any toggle, so the failure is the MISSING toggle, never a boot or
// config-schema error.

const ZERO_WIDTH_TOLERANCE = 2; // px — a hidden/unlaid-out pane measures ~0.
const RATIO_TOLERANCE = 0.02; // the prior off-center split must recur this tight.

async function setViewMode(
  page: { evaluate(expr: string): Promise<unknown> },
  mode: 'editor' | 'preview' | 'split',
): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.setViewMode(${JSON.stringify(mode)}); return null; })()`,
  );
}

test('three-way view toggle hides a pane and preserves the split ratio on return, persisting the mode', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // Bring the app + project + HTML preview up FIRST, so a RED failure below is
  // demonstrably the missing VIEW-MODE toggle, not a boot/open/render error.
  await waitForHarness(tauriPage);
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Baseline: BOTH panes laid out in the real split (the default split mode).
  const editorStart = (await editorPaneRect(tauriPage)).width;
  const previewStart = (await previewPaneRect(tauriPage)).width;
  expect(editorStart).toBeGreaterThan(ZERO_WIDTH_TOLERANCE);
  expect(previewStart).toBeGreaterThan(ZERO_WIDTH_TOLERANCE);

  // Establish a DISTINCTIVE, off-center split by dragging the divider with REAL
  // PointerEvents (P13's surface). A non-50/50 ratio makes clause (3) discriminate
  // a rebuild (which would snap back to 50/50) from a genuine show/hide.
  const previewRect = await previewPaneRect(tauriPage);
  const startRect = await separatorRect(tauriPage);
  const startX = (startRect.left + startRect.right) / 2;
  // Drag right, deep into the preview region, so the editor pane grows clearly
  // wider than the preview pane (an unambiguous off-center ratio).
  const targetX = previewRect.left + previewRect.width * 0.55;
  expect(targetX).toBeGreaterThan(startX + 50);
  await dragDividerTo(tauriPage, targetX);
  const landedX = await dividerCenterX(tauriPage);
  expect(Math.abs(landedX - targetX)).toBeLessThanOrEqual(6);

  const ratioOf = async (): Promise<number> => {
    const editor = (await editorPaneRect(tauriPage)).width;
    const preview = (await previewPaneRect(tauriPage)).width;
    return editor / (editor + preview);
  };
  const ratioBefore = await ratioOf();
  // The drag established a genuinely off-center split (not the 50/50 a rebuild
  // would reset to), so clause (3) below has discriminating power.
  expect(Math.abs(ratioBefore - 0.5)).toBeGreaterThan(0.05);

  // ── Clause (1): PREVIEW mode HIDES the editor, preview goes full-width ──
  await setViewMode(tauriPage, 'preview');
  await tauriPage.waitForFunction(
    `(() => { const e = document.querySelector('[data-pane="editor"]'); return !e || e.offsetParent === null || e.getBoundingClientRect().width <= ${ZERO_WIDTH_TOLERANCE}; })()`,
    5_000,
  );
  const editorHidden = (await editorPaneRect(tauriPage)).width;
  const previewFull = (await previewPaneRect(tauriPage)).width;
  expect(editorHidden).toBeLessThanOrEqual(ZERO_WIDTH_TOLERANCE);
  // The preview now occupies (essentially) the full split width the two panes
  // shared before — it absorbed the hidden editor's space.
  expect(previewFull).toBeGreaterThanOrEqual(editorStart + previewStart - 4);

  // ── Clause (2): EDITOR mode HIDES the preview, editor goes full-width ──
  await setViewMode(tauriPage, 'editor');
  await tauriPage.waitForFunction(
    `(() => { const e = document.querySelector('[data-pane="preview"]'); return !e || e.offsetParent === null || e.getBoundingClientRect().width <= ${ZERO_WIDTH_TOLERANCE}; })()`,
    5_000,
  );
  const previewHidden = (await previewPaneRect(tauriPage)).width;
  const editorFull = (await editorPaneRect(tauriPage)).width;
  expect(previewHidden).toBeLessThanOrEqual(ZERO_WIDTH_TOLERANCE);
  expect(editorFull).toBeGreaterThanOrEqual(editorStart + previewStart - 4);

  // ── Clause (3): SPLIT mode RESTORES BOTH panes at the PRIOR off-center ratio ──
  await setViewMode(tauriPage, 'split');
  await tauriPage.waitForFunction(
    `(() => {
       const ed = document.querySelector('[data-pane="editor"]');
       const pv = document.querySelector('[data-pane="preview"]');
       return ed && pv
         && ed.getBoundingClientRect().width > ${ZERO_WIDTH_TOLERANCE}
         && pv.getBoundingClientRect().width > ${ZERO_WIDTH_TOLERANCE};
     })()`,
    5_000,
  );
  const ratioAfter = await ratioOf();
  // The surviving split's proportions are preserved across the round-trip: the
  // restored ratio equals the off-center ratio established by the drag, NOT a
  // reset 50/50 (which a teardown/rebuild of the splitview would produce).
  expect(Math.abs(ratioAfter - ratioBefore)).toBeLessThanOrEqual(RATIO_TOLERANCE);

  // ── Clause (4): the chosen view_mode PERSISTS to the on-disk config.toml ──
  // Set a distinctive mode and assert it round-trips to disk under the hermetic
  // XDG_CONFIG_HOME (the P9 class), read back by an INDEPENDENT process. Choose
  // `preview` (≠ the default `split`) so a non-persisting / default-only config
  // is observably wrong.
  await setViewMode(tauriPage, 'preview');
  let persisted: unknown = undefined;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const cfg = parseTomlFile(manifest.configPath);
    persisted = (cfg.editor as Record<string, unknown> | undefined)?.view_mode;
    if (persisted === 'preview') break;
    await sleep(250);
  }
  expect(persisted).toBe('preview');

  recordObservation({ spec: manifest.spec, name: 'ratio-before-toggle', value: Number(ratioBefore.toFixed(4)) });
  recordObservation({ spec: manifest.spec, name: 'ratio-after-return', value: Number(ratioAfter.toFixed(4)) });
  recordObservation({ spec: manifest.spec, name: 'editor-width-preview-mode', value: Math.round(editorHidden) });
  recordObservation({ spec: manifest.spec, name: 'preview-width-editor-mode', value: Math.round(previewHidden) });
});
