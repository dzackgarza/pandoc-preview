import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, waitForPreview, previewQuery } from './support/app';

// D2 (p23) — the vendored required filters are actually IN the render pipeline,
// not merely present on disk (D1). The pandoc renderer's canonical command
// references the symlinked filters in ~/.pandoc/filters (Milestone D), so
// obsidian_callouts.lua transforms an Obsidian callout (`> [!NOTE] …`) in the
// witness doc into `<div class="callout" data-callout="note" title="…">`. A
// command that does not load the filter cannot produce that div — the callout
// stays a plain <blockquote>. obsidian_callouts is the deterministic,
// dependency-free witness; tikzcd/convert_amsthm_envs/obsidian are referenced
// alongside it (and must load — a missing filter would make the whole render
// fail, which the other preview specs would catch).
//
// RED today: the canonical command references NO filters, so the callout renders
// as a plain <blockquote> and div.callout is absent.

test('a vendored filter transforms the preview: the callout becomes a callout div', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  const calloutType = await previewQuery(
    tauriPage,
    `return d.querySelector('div.callout')?.getAttribute('data-callout') ?? null;`,
  );
  expect(calloutType).toBe('note');

  const calloutTitle = await previewQuery(
    tauriPage,
    `return d.querySelector('div.callout')?.getAttribute('title') ?? null;`,
  );
  expect(calloutTitle).toBe('Lattice note');

  // The callout body survived the transform.
  const bodyText = await previewQuery(
    tauriPage,
    `return d.querySelector('div.callout p')?.textContent ?? null;`,
  );
  expect(bodyText).toBe('Minkowski bounds the points.');

  recordObservation({ spec: manifest.spec, name: 'callout-type', value: String(calloutType) });
});
