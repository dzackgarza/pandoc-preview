import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, previewQuery, waitForPreview } from './support/app';

// P5 — Relative resource resolution. The witness references fig/plot.png, a
// real 64x48 PNG. The preview img[alt="scatter"] must decode to exactly those
// pixel dimensions — proving the asset-protocol <base href> chain resolved the
// relative path and the webview decoded real bytes (not a broken 0x0 image).

test('the scatter image decodes to exactly 64x48 real pixels', async ({ tauriPage }) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);

  // Wait for the real image to finish decoding inside the preview iframe.
  await waitForPreview(
    tauriPage,
    `const img = d.querySelector('img[alt="scatter"]');
     return img !== null && img.complete && img.naturalWidth > 0;`,
  );

  const width = await previewQuery(
    tauriPage,
    `return d.querySelector('img[alt="scatter"]')?.naturalWidth ?? -1;`,
  );
  const height = await previewQuery(
    tauriPage,
    `return d.querySelector('img[alt="scatter"]')?.naturalHeight ?? -1;`,
  );
  expect(width).toBe(64);
  expect(height).toBe(48);

  recordObservation({ spec: manifest.spec, name: 'naturalWidth', value: Number(width) });
  recordObservation({ spec: manifest.spec, name: 'naturalHeight', value: Number(height) });
});
