import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, previewQuery, waitForPreview } from './support/app';

// p28 — Obsidian-interop fidelity (filter-owned). In an Obsidian vault a list may
// follow a paragraph with no intervening blank line; Obsidian renders it as a list.
// pandoc's markdown reader treats the un-separated `- item` lines as lazy
// continuation of the paragraph, collapsing the whole block into one <p> with
// literal "- " bullets — so the list "does not parse as a list at all". The app
// vends obsidian_callouts.lua / obsidian.lua precisely to preview Obsidian content,
// so Obsidian list fidelity is an owned obligation; greening it belongs to the
// Obsidian-interop filter group (a normalization pass), not a CSS/flag change.
//
// The witness is the user's compact form verbatim in shape (heading, paragraph, then
// an un-separated wikilink list).
//
// RED today: no <li> carrying the list content is rendered — the items are folded
// into a paragraph by the pandoc reader.

const WITNESS = `\n\n### Papers\nSummaries and OCR data.\n- [[Loo03]] - Looijenga 2003\n- [[Cob19]] - Coble 1919\n`;

test('an Obsidian compact list (no blank line) renders as a list', async ({ tauriPage }) => {
  const manifest = loadRunManifest();
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  await appendAtEnd(tauriPage, WITNESS);

  // The "Papers" heading renders regardless of the list-collapse bug — wait on it so
  // the assertion is about list structure, not about the edit arriving.
  await waitForPreview(
    tauriPage,
    `return Array.from(d.querySelectorAll('h3')).some((h) => h.textContent.includes('Papers'));`,
  );

  // demo.md already contains an ordered list, so scope to this witness's content.
  const looijengaInListItem = await previewQuery(
    tauriPage,
    `return Array.from(d.querySelectorAll('li')).some((li) => li.textContent.includes('Looijenga 2003'));`,
  );
  expect(looijengaInListItem).toBe(true);

  recordObservation({ spec: manifest.spec, name: 'list-item-rendered', value: String(looijengaInListItem) });
});
