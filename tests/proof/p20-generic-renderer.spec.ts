import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, waitForPreview, previewQuery } from './support/app';

// B1 (p20) — Renderer-as-plugin: the app core delegates buffer->preview-HTML to
// the ACTIVE renderer plugin, owning no renderer knowledge itself. This is the
// acceptance test of the whole renderer abstraction (renderer-plugin-architecture.md):
// a generic, NON-pandoc renderer — a committed script that takes markdown on stdin
// and emits HTML on stdout — is configured as the active renderer
// ([renderer].active = "generic-renderer"), and the live preview must show the
// witness rendered by THAT renderer.
//
// The discriminator is a marker only the generic renderer emits:
// <meta name="rendered-by" content="generic-renderer">. No pandoc invocation
// produces it, so its presence proves the active-renderer plugin ran — not the
// hardcoded pandoc path. The preview still shows a real rendering (the witness's
// <h1>), so waiting on <h1> succeeds under either renderer; the decisive
// assertion is the marker.
//
// Fails on a broken app where the preview render ignores the selected renderer and
// always runs pandoc: the preview would carry no rendered-by marker — the
// renderer abstraction (discovery-driven render target) would not exist.

test('the active generic renderer plugin renders the preview, not the hardcoded pandoc path', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  // A real rendering appears (the witness heading); true under either renderer.
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Decisive: the preview was produced by the active generic renderer plugin,
  // proven by the marker only it emits.
  const renderedBy = await previewQuery(
    tauriPage,
    `const m = d.querySelector('meta[name="rendered-by"]'); return m ? m.getAttribute('content') : null;`,
  );
  expect(renderedBy).toBe('generic-renderer');

  recordObservation({ spec: manifest.spec, name: 'rendered-by', value: String(renderedBy) });
});
