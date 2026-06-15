import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, previewQuery, waitForPreview } from './support/app';

// P31 — Config-exposed figure width. Diagrams render full-width by default
// (img { max-width:100% }), which the user found too wide. The figure width is
// exposed as a config knob ([plugin.pandoc-renderer.style].figure_width) that
// render.sh layers onto the render as --variable=figure-width, which the template
// applies to `img { max-width: <figure-width> }`. The provisioned config sets it
// to "75%", so the preview's scatter image must report a 75% max-width.
//
// Proves the config value flows config -> render.sh -> pandoc variable -> rendered
// CSS, governing the actual image element in the preview.

test('the preview image max-width reflects the configured figure width (75%)', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();
  await openAndSelectDemo(tauriPage, manifest.project);

  await waitForPreview(
    tauriPage,
    `const img = d.querySelector('img[alt="scatter"]');
     return img !== null && img.complete && img.naturalWidth > 0;`,
  );

  const maxWidth = await previewQuery(
    tauriPage,
    `const img = d.querySelector('img[alt="scatter"]');
     return getComputedStyle(img).maxWidth;`,
  );
  expect(maxWidth).toBe('75%');

  recordObservation({ spec: manifest.spec, name: 'img-max-width', value: String(maxWidth) });
});
