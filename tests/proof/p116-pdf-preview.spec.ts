import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, waitForPreview, waitForHarness, sleep } from './support/app';

// P107 (Phase F / F1) — LIVE PDF PREVIEW renders a real compiled PDF in the
// embedded pdf.js viewer.
//
// This is the live-preview surface a one-shot export (P8) does NOT give: an
// embedded pdf.js viewer pane fed by a COMPILE-ON-IDLE scheduler — a debounce
// sibling of the HTML scheduleRender/doRender loop — that drives the configured
// [export.pdf] = pandoc -> lualatex command (the shipped pandoc-pdf-export
// plugin, provisioned into this spec's hermetic plugins dir exactly as P8) to a
// real .pdf on disk through the existing export boundary, then loads that PDF
// into the viewer via convertFileSrc. The app core grows a VIEWER and a
// SCHEDULER only; it never learns what lualatex is — the compile stays a
// configured command (the total-externality discipline B/C established).
//
// WHAT THIS SPEC PROVES (P107 observable clauses, nothing about wiring):
//   (1) After the PDF preview pane is active and the compile-on-idle debounce
//       elapses, a PDF is produced ON DISK. An INDEPENDENT process reads it: it
//       is a VALID PDF (the `%PDF-` magic header; pdfinfo parses a `Pages:` count
//       >= 1) whose pdftotext-extracted text carries BOTH witnesses
//       "Geometry of Numbers" AND "Minkowski bound" — so the PDF is the freshly
//       compiled demo.md, not a stale or unrelated artifact.
//   (2) The pdf.js viewer DOM shows a RENDERED PAGE CANVAS — a <canvas> with
//       non-zero dimensions inside the viewer — i.e. pdf.js produced actual
//       pixels for a page, not an empty pane or a placeholder.
//
// The produced PDF is read off disk by independent processes (pdfinfo/pdftotext),
// and the rendered canvas is read from the LIVE preview DOM — both independently
// of the app's own report (P107: not satisfied by an existence check on a viewer
// pane / a compilePdf/scheduler symbol). A mounted-but-unfed pane, a wired-but-
// idle scheduler, or a viewer fed a non-PDF would each fail a clause below.
//
// ADMISSIBLE because it FAILS on a plausibly broken app:
//   - a BLANK / FAKED viewer (no rendered page canvas in the DOM — the pane is
//     empty or shows a placeholder, so pdf.js never painted a page) -> clause (2);
//   - a STALE artifact (the PDF on disk lacks the witnesses — pdftotext does not
//     recover "Geometry of Numbers" / "Minkowski bound") -> clause (1);
//   - an UNWIRED compile (the compile-on-idle scheduler never fires, so NO PDF is
//     produced on disk after the debounce — the artifact accessor stays null and
//     the wait times out) -> clause (1);
//   - a viewer fed a NON-PDF blob (pdfinfo REFUSES the bytes / no `%PDF-`) ->
//     clause (1).
//
// RED today: there is NO PDF preview surface at all — no PDF preview pane/mode in
// PreviewPane, no compile-on-idle PDF scheduler in App.svelte, and no vendored
// pdf.js viewer (pdfjs-dist is not a dependency). The app exposes the HTML preview
// only. So activating the PDF preview mode through the harness throws (the hook
// does not exist), and no .pdf is ever produced by an in-app compile-on-idle path
// — the faithful no-PDF-preview / no-scheduler / no-viewer failure P107 names. The
// app BOOTS cleanly (the canonical config + the schema-valid [plugin.pandoc-pdf-
// export] section is all that is provisioned), so the failure is the MISSING PDF
// preview, never a boot or config-schema error.

const WITNESS_TITLE = 'Geometry of Numbers';
const WITNESS_BOUND = 'Minkowski bound';

test('live PDF preview compiles demo.md on idle and renders a real page canvas', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // Bring the app + project + HTML preview up FIRST, so a RED failure below is
  // demonstrably the missing PDF-preview surface, not a boot/open/render error:
  // the app booted, the project opened, demo.md is selected, and the existing
  // HTML preview rendered (its <h1> is present).
  await waitForHarness(tauriPage);
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Activate the PDF preview pane/mode (app-owned UI: the pdf.js viewer surface
  // in PreviewPane). Driven through the test harness, the SAME transport every
  // dynamic surface uses (window.__PPE_E2E__). RED today: setPreviewMode does not
  // exist -> this evaluate throws, which is the faithful "no PDF preview surface"
  // failure (the app has the HTML preview only).
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.setPreviewMode('pdf'); return null; })()`,
  );

  // The compile-on-idle scheduler (the debounce sibling of scheduleRender) fires
  // after the preview debounce and drives the configured pandoc -> lualatex
  // command to a .pdf on disk. Wait for its status cluster (the PDF compile's own
  // RenderStatus, the sibling of renderStatus() p43 reads) to reach 'ok'. A real
  // lualatex compile is heavy, so the wait is generous; the luaotfload font cache
  // is warmed in provisioning so the first in-app compile lands within it.
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.pdfStatus && window.__PPE_E2E__.pdfStatus() === 'ok'`,
    180_000,
  );

  // Learn the on-disk path of the PDF the scheduler produced (the artifact path
  // the export boundary returned, surfaced to the viewer — mirrors
  // PluginResult.artifact). Independent of how the path is chosen.
  let artifact = '';
  for (let i = 0; i < 240; i++) {
    const raw = await tauriPage.evaluate(
      `(() => { const p = window.__PPE_E2E__.pdfPreviewArtifact(); return p === undefined || p === null ? '' : String(p); })()`,
    );
    if (typeof raw === 'string' && raw.length > 0 && existsSync(raw)) {
      artifact = raw;
      break;
    }
    await sleep(500);
  }
  if (artifact.length === 0) {
    throw new Error(
      'compile-on-idle scheduler produced no PDF on disk after the debounce: ' +
        'pdfPreviewArtifact() never returned an existing path. The PDF preview ' +
        'compile is unwired (no .pdf reaches disk).',
    );
  }
  expect(existsSync(artifact)).toBe(true);

  // ── Clause (1): the produced PDF is a VALID, FRESH demo.md PDF (independent) ──
  // Valid PDF: magic header + pdfinfo parses it (independent process).
  const head = readFileSync(artifact).subarray(0, 5).toString('latin1');
  expect(head).toBe('%PDF-');
  const info = execFileSync('pdfinfo', [artifact], { encoding: 'utf-8' });
  const pagesMatch = info.match(/Pages:\s+(\d+)/);
  expect(pagesMatch).not.toBeNull();
  expect(Number((pagesMatch as RegExpMatchArray)[1])).toBeGreaterThanOrEqual(1);

  // Extracted text (independent process) carries BOTH witnesses, proving the PDF
  // is the freshly compiled demo.md — not a stale or unrelated artifact.
  const textOut = execFileSync('pdftotext', [artifact, '-'], { encoding: 'utf-8' });
  expect(textOut.includes(WITNESS_TITLE)).toBe(true);
  expect(textOut.includes(WITNESS_BOUND)).toBe(true);

  // ── Clause (2): the pdf.js viewer DOM shows a RENDERED PAGE CANVAS ──
  // pdf.js paints each page into a <canvas>; an empty/placeholder pane has none
  // with real pixel dimensions. Read the live preview DOM for a canvas inside the
  // PDF viewer whose intrinsic pixel size (canvas.width/height — the backing
  // bitmap pdf.js sized to the rendered page) is non-zero. RED today: no viewer,
  // so no such canvas exists.
  await tauriPage.waitForFunction(
    `(() => {
      const root = document.querySelector('[data-testid="pdf-viewer"]');
      if (!root) return false;
      const canvases = Array.from(root.querySelectorAll('canvas'));
      return canvases.some((c) => c.width > 0 && c.height > 0);
    })()`,
    60_000,
  );

  const canvasDims = await tauriPage.evaluate(`(() => {
    const root = document.querySelector('[data-testid="pdf-viewer"]');
    const canvases = Array.from(root.querySelectorAll('canvas'));
    const painted = canvases.filter((c) => c.width > 0 && c.height > 0);
    const c = painted[0];
    return JSON.stringify({ count: painted.length, width: c.width, height: c.height });
  })()`);
  const dims = JSON.parse(canvasDims as string) as {
    count: number;
    width: number;
    height: number;
  };
  expect(dims.count).toBeGreaterThanOrEqual(1);
  expect(dims.width).toBeGreaterThan(0);
  expect(dims.height).toBeGreaterThan(0);

  recordObservation({
    spec: manifest.spec,
    name: 'pdf-pages-info',
    value: info.trim().split('\n')[0] ?? '',
  });
  recordObservation({
    spec: manifest.spec,
    name: 'pdf-viewer-canvas',
    value: `${dims.count}@${dims.width}x${dims.height}`,
  });
});
