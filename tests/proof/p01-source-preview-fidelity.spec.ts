import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, previewQuery, waitForPreview } from './support/app';

// P1 — Source→preview fidelity. Open the witness project, click demo.md in
// the real sidebar, and assert the REAL pandoc-rendered preview iframe
// document carries the exact unicode/structure witnesses. These would fail
// on an unwired pandoc, a frozen preview, or junk HTML.

test('demo.md renders to the exact h1/em/ol witnesses in the preview iframe', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);

  // Wait for the REAL pandoc render to populate the preview iframe.
  await waitForPreview(
    tauriPage,
    `return d.querySelector('h1') !== null && d.querySelector('img') !== null;`,
  );

  const h1 = await previewQuery(
    tauriPage,
    `return d.querySelector('h1')?.textContent ?? null;`,
  );
  expect(h1).toBe('Geometry of Numbers — Café');

  const em = await previewQuery(
    tauriPage,
    `return d.querySelector('em')?.textContent ?? null;`,
  );
  expect(em).toBe('naïve');

  const lastLi = await previewQuery(
    tauriPage,
    `const items = d.querySelectorAll('ol > li');
     return items.length > 0 ? items[items.length - 1].textContent.trim() : null;`,
  );
  expect(lastLi).toBe('Minkowski bound');

  recordObservation({ spec: manifest.spec, name: 'h1', value: String(h1) });
  recordObservation({ spec: manifest.spec, name: 'em', value: String(em) });
});
