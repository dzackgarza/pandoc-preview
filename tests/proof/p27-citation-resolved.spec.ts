import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, previewQuery, waitForPreview } from './support/app';

// p27 — A pandoc citation resolves into a preprint-style, hyperlinked citation
// plus a separated bibliography. The preview is meant to read like a slice of a
// preprint draft, so a `[@DM19]` reference must render as a bracketed alphabetic
// label (e.g. "[DM19]") that is a LINK to its bibliography entry — not Chicago
// author-date "(Dolgachev and Mumford 2019)" — and the bibliography must appear
// under a "References" heading (separated from the body), not dumped inline.
//
// This requires the renderer command to carry --csl=<alpha CSL> (alphabetic
// citation-label style), --metadata link-citations=true (hyperlinks), and
// --metadata reference-section-title=References (the heading), on top of the
// already-wired --citeproc --bibliography. The fixture tests/proof/fixtures/
// references.bib supplies the @DM19 entry (Dolgachev & Mumford).
//
// RED before the CSL/link/heading wiring: citeproc resolves the entry, but the
// citation is plain author-date text with no link and there is no References
// heading.

const WITNESS = `\n\nAs shown in [@DM19], the lattice is unimodular.\n`;

test('a [@cite] renders as a bracketed hyperlinked label under a References section', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  await appendAtEnd(tauriPage, WITNESS);

  await waitForPreview(
    tauriPage,
    `return d.querySelector('span.citation[data-cites="DM19"]') !== null;`,
  );

  // The bibliography entry resolved (citeproc) and carries the author.
  const refsText = await previewQuery(tauriPage, `return d.querySelector('#refs')?.textContent ?? null;`);
  expect(typeof refsText).toBe('string');
  expect(refsText).toContain('Dolgachev');

  // The citation is a hyperlink jumping to the bibliography entry.
  const href = await previewQuery(
    tauriPage,
    `return d.querySelector('span.citation[data-cites="DM19"] a')?.getAttribute('href') ?? null;`,
  );
  expect(href).toBe('#ref-DM19');

  // The rendered label is bracketed (alphabetic style), not "(Author Year)".
  const citationText = await previewQuery(
    tauriPage,
    `return d.querySelector('span.citation[data-cites="DM19"]')?.textContent?.trim() ?? null;`,
  );
  expect(citationText).toMatch(/^\[.+\]$/);

  // The bibliography is a separated section under a "References" heading.
  const hasHeading = await previewQuery(
    tauriPage,
    `return Array.from(d.querySelectorAll('h1,h2,h3')).some((h) => h.textContent.trim() === 'References');`,
  );
  expect(hasHeading).toBe(true);

  recordObservation({ spec: manifest.spec, name: 'citation-href', value: String(href) });
  recordObservation({ spec: manifest.spec, name: 'citation-label', value: String(citationText) });
});
