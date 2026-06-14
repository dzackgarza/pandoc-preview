import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, previewQuery, waitForPreview } from './support/app';

// p27 — A pandoc citation is resolved against the configured bibliography. A
// `[@DM19]` reference should be processed by citeproc into an author-date citation
// plus a rendered bibliography entry (pandoc emits `<div id="refs">`). The
// configured renderer command carries the three lua filters but NO `--citeproc`
// and NO `--bibliography`, so the citation passes through as the literal text
// `[@DM19]` and no bibliography is produced.
//
// The fixture bibliography tests/proof/fixtures/references.bib supplies the @DM19
// entry the green path must resolve; greening requires wiring `--citeproc
// --bibliography=<that file>` into the renderer command (and provisioning it).
//
// RED today: no `#refs` bibliography is rendered, because the command does not run
// citeproc — the citation is never resolved.

const WITNESS = `\n\nAs shown in [@DM19], the lattice is unimodular.\n`;

test('a [@cite] is resolved into a rendered bibliography entry', async ({ tauriPage }) => {
  const manifest = loadRunManifest();
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  await appendAtEnd(tauriPage, WITNESS);

  // The citation span renders today (pandoc emits it regardless of citeproc) — wait
  // on it so the assertion below is about RESOLUTION, not about the edit arriving.
  await waitForPreview(
    tauriPage,
    `return d.querySelector('span.citation[data-cites="DM19"]') !== null;`,
  );

  const refsAuthor = await previewQuery(
    tauriPage,
    `return d.querySelector('#refs')?.textContent ?? null;`,
  );
  expect(typeof refsAuthor).toBe('string');
  expect(refsAuthor).toContain('Dolgachev');

  recordObservation({ spec: manifest.spec, name: 'refs-rendered', value: String(refsAuthor !== null) });
});
