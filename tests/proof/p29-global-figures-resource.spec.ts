import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, previewQuery, waitForPreview } from './support/app';

// P29 — Global figures-directory resolution. The witness references
// rendered/global.png, a real 80x32 PNG that exists ONLY in the global figures
// directory ($HOME/.pandoc/figures), NOT relative to the open document. The
// directory is advertised to the renderer through PANDOC_RESOURCE_PATH (set in
// the GUI session from ~/.pathrc, mirrored by the proof harness). The preview
// img[alt="globalfig"] must decode to exactly those pixel dimensions — proving
// the pandoc renderer layered PANDOC_RESOURCE_PATH onto --resource-path so a
// figure referenced relative to the global figures dir resolves and embeds.
//
// Distinct from P5 (fig/plot.png is relative to the document and resolves via
// --resource-path "$base_dir"): rendered/global.png is NOT under the project, so
// it can resolve ONLY through the global figures dir on the resource path.

test('the global-figures image decodes to exactly 80x32 real pixels', async ({ tauriPage }) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);

  // Wait for the real image to finish decoding inside the preview iframe.
  await waitForPreview(
    tauriPage,
    `const img = d.querySelector('img[alt="globalfig"]');
     return img !== null && img.complete && img.naturalWidth > 0;`,
  );

  const width = await previewQuery(
    tauriPage,
    `return d.querySelector('img[alt="globalfig"]')?.naturalWidth ?? -1;`,
  );
  const height = await previewQuery(
    tauriPage,
    `return d.querySelector('img[alt="globalfig"]')?.naturalHeight ?? -1;`,
  );
  expect(width).toBe(80);
  expect(height).toBe(32);

  recordObservation({ spec: manifest.spec, name: 'naturalWidth', value: Number(width) });
  recordObservation({ spec: manifest.spec, name: 'naturalHeight', value: Number(height) });
});
