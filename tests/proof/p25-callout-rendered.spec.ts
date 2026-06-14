import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, previewQuery, waitForPreview } from './support/app';

// p25 — A vendored callout is not merely transformed into a <div class="callout">
// (p23 proves that), it is RENDERED: the callout's title is visible to the reader.
// obsidian_callouts.lua puts the title in an HTML `title=` attribute (a tooltip the
// reader never sees) and emits no title element; an Obsidian callout renders the
// title as a visible header (`.callout-title`). Without that, the user sees an
// unstyled blob with an invisible title — "callouts seem to not be rendered at all".
//
// The witness is a well-formed (blank-line) callout, so this isolates the RENDERING
// obligation from the Obsidian compact-form dialect gap (p28). The callout div
// itself renders today; the title does not.
//
// RED today: there is no `.callout-title` element — the title lives only in the
// `title=` attribute, so querying for the visible title element returns null.

const TITLE = 'Determinant caveat';
const WITNESS = `\n\n> [!warning] ${TITLE}\n>\n> The Gram determinant can be negative.\n`;

test('a callout renders its title as visible text, not just a tooltip attribute', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  await appendAtEnd(tauriPage, WITNESS);

  // The callout div itself does render today (the filter runs) — wait on it so the
  // assertion below is about the title's visibility, not about the edit arriving.
  await waitForPreview(
    tauriPage,
    `return d.querySelector('div.callout[data-callout="warning"]') !== null;`,
  );

  const visibleTitle = await previewQuery(
    tauriPage,
    `return d.querySelector('div.callout .callout-title')?.textContent?.trim() ?? null;`,
  );
  expect(visibleTitle).toBe(TITLE);

  recordObservation({ spec: manifest.spec, name: 'callout-visible-title', value: String(visibleTitle) });
});
