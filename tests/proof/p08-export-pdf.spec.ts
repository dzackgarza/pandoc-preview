import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, exportTo, waitForPreview, sleep } from './support/app';

// P8 — Export PDF artifact. Export demo.md to PDF via the REAL export
// boundary (api.exportDocument -> pandoc PDF). Assert a valid PDF whose
// extracted text contains the witnesses. PDF validity + text extraction are
// performed by independent processes (pdfinfo, pdftotext). The native save
// dialog is the only bypassed surface; the pandoc PDF pipeline is real.

test('Export PDF produces a valid PDF whose text carries the witnesses', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  const target = join(manifest.runDir, 'export-witness.pdf');
  await exportTo(tauriPage, 'pdf', target);
  for (let i = 0; i < 160 && !existsSync(target); i++) {
    await sleep(250);
  }
  expect(existsSync(target)).toBe(true);

  // Valid PDF: magic header + pdfinfo parses it (independent process).
  const head = readFileSync(target).subarray(0, 5).toString('latin1');
  expect(head).toBe('%PDF-');
  const info = execFileSync('pdfinfo', [target], { encoding: 'utf-8' });
  expect(/Pages:\s+\d+/.test(info)).toBe(true);

  // Extracted text (independent process) carries the witnesses.
  const textOut = execFileSync('pdftotext', [target, '-'], { encoding: 'utf-8' });
  expect(textOut.includes('Geometry of Numbers')).toBe(true);
  expect(textOut.includes('Minkowski bound')).toBe(true);

  recordObservation({ spec: manifest.spec, name: 'pdf-pages-info', value: info.trim().split('\n')[0] ?? '' });
});
