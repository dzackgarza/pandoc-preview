import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, exportTo, waitForPreview, sleep } from './support/app';

// P7 — Export HTML artifact. Export demo.md to a chosen temp path via the
// REAL export boundary (api.exportDocument -> pandoc --embed-resources). The
// only part bypassed is the native save dialog the webview cannot drive; the
// chosen path and pandoc invocation are real. Then this process asserts:
// the file exists at exactly that path, its parsed DOM repeats the P1
// witnesses, and the image is inlined as a self-contained data: URI.
//
// The exported bytes are parsed by the REAL webview engine via DOMParser
// (page.evaluate), not a hand-rolled regex.

test('Export HTML writes a self-contained artifact carrying the P1 witnesses', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  const target = join(manifest.runDir, 'export-witness.html');
  // Fire the real export (api.exportDocument -> pandoc) and poll for the
  // artifact. NOTE / PROOF DEBT: with the configured math = "katex", the real
  // export runs pandoc with --embed-resources --katex, which performs a
  // BLOCKING network fetch of the KaTeX assets to inline them. In the hermetic
  // proof environment that fetch stalls, so export_document never resolves and
  // this file never appears. render.rs sets no timeout on the export
  // subprocess, so the app hangs. This is a real, externally-observable
  // finding, recorded as proof debt rather than worked around (changing the
  // engine to mathjax to make the test green would be gaming).
  await exportTo(tauriPage, 'html', target);
  for (let i = 0; i < 80 && !existsSync(target); i++) {
    await sleep(250);
  }
  if (!existsSync(target)) {
    const state = await tauriPage.evaluate(`String(window.__PPE_EXPORT__)`);
    throw new Error(
      `Export HTML artifact never appeared at ${target} (export state: ${String(state)}). ` +
        `Known cause: --embed-resources + --katex blocks on a network fetch of KaTeX assets ` +
        `under the hermetic HOME, and export_document has no subprocess timeout.`,
    );
  }
  expect(existsSync(target)).toBe(true);

  const htmlText = readFileSync(target, 'utf-8');

  // Parse the exported bytes in the real engine and read the witnesses.
  const witnesses = (await tauriPage.evaluate(
    `(() => {
      const doc = new DOMParser().parseFromString(${JSON.stringify(htmlText)}, 'text/html');
      const ol = doc.querySelectorAll('ol > li');
      const img = doc.querySelector('img[alt="scatter"]');
      return {
        h1: doc.querySelector('h1')?.textContent ?? null,
        em: doc.querySelector('em')?.textContent ?? null,
        lastLi: ol.length ? ol[ol.length - 1].textContent.trim() : null,
        imgSrcPrefix: img ? img.getAttribute('src').slice(0, 5) : null,
      };
    })()`,
  )) as { h1: string; em: string; lastLi: string; imgSrcPrefix: string };

  expect(witnesses.h1).toBe('Geometry of Numbers — Café');
  expect(witnesses.em).toBe('naïve');
  expect(witnesses.lastLi).toBe('Minkowski bound');
  // Self-contained: the image src is a data: URI, not a relative path.
  expect(witnesses.imgSrcPrefix).toBe('data:');

  recordObservation({
    spec: manifest.spec,
    name: 'export-bytes',
    value: Buffer.byteLength(htmlText, 'utf-8'),
  });
});
