import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, previewQuery, waitForPreview } from './support/app';

// ── P89 — References sidebar reflects ONLY the document's cited keys, rendered
//          in the configured citation style ───────────────────────────────────
//
// THE OBLIGATION (proof-obligations.md, exact wording):
//   With the references sidebar tab active, the panel lists only the references
//   the current document actually cites — not the whole bibliography. Citing a
//   key in the buffer makes that key's reference APPEAR in the panel, rendered
//   with its bibliographic text (author/year/title), not as the bare cite key. A
//   key that exists in the active bibliography but is NOT cited anywhere in the
//   buffer does NOT appear in the panel — the panel lists what the document
//   cites, not the entire bibliography. The rendering uses the configured
//   citation style: the formatted reference the panel shows for a cited key
//   matches the preview's resolved bibliography (the `#refs` entry pandoc
//   citeproc produces for that same key — p27), so the panel cannot drift from
//   the preview.
//
// ── THE FIXTURE (what the active bibliography holds) ─────────────────────────
// This run uses the canonical witness config (provision-proof.sh default case),
// whose editor.bibliography is tests/proof/fixtures/references.bib — the SAME
// global config bibliography p27 cites against. That bib carries TWO entries:
//   @DM19 — Dolgachev & Mumford (2019), "Admissible roots …" — the key the
//           document WILL cite below.
//   @Vor08 — Voronoi (2008), "Recherches sur les paralleloedres primitifs" —
//            an entry the document NEVER cites, the cited-only discriminator.
//
// ── THE OBSERVABLE CONTRACT (driven through the SIDEBAR UI) ───────────────────
// This spec is BLIND to how the panel is built or how the cited-key set is
// extracted. It activates the references view through the activity bar (the
// data-view control, P18/P44 precedent), reads the references pane DOM under
// [data-pane="sidebar"] (the same pane every sidebar proof reads), appends a
// real citation through the editor pipeline (appendAtEnd), and cross-checks the
// panel's rendered DM19 text against the preview's resolved #refs entry for DM19
// (the p27 source of truth) — one source of truth for "what this key renders
// as", so the sidebar cannot drift from the preview.
//
// ── WHAT EACH ASSERTION KILLS ────────────────────────────────────────────────
//   (1) activate the references view: KILLS an app with no references tab.
//   (2) the uncited Vor08 is absent before any citation: KILLS a panel that
//       lists the WHOLE bibliography rather than only what the doc cites.
//   (3)+(4) after citing [@DM19], the panel shows a DM19 reference carrying
//       author/year/title text (Dolgachev / 2019 / the title) — NOT the bare key
//       "DM19": KILLS a static/empty panel (citing adds nothing) and a panel that
//       shows bare keys with no CSL rendering.
//   (5) the panel's DM19 text matches the preview's #refs DM19 entry: KILLS a
//       panel rendered by a bespoke formatter that drifts from the preview's
//       citeproc output.
//   (6) the uncited Vor08 STILL does not appear after the cite: KILLS a panel
//       that loads the entire bib once a single key is cited.
//
// ── WHY THE APP IS RED TODAY ─────────────────────────────────────────────────
// There is no references sidebar tab: the SIDEBAR_VIEWS extension point carries
// the Explorer (P18) and the Macros/Figures panes (P44), but no references view.
// The data-view="references" control does not exist, so the evaluate that clicks
// it returns false and the activation assertion (1) fails — there is no surface
// that reflects the document's cited keys at all.

const CITED_KEY = 'DM19';
const CITED_AUTHOR = 'Dolgachev'; // author surname of @DM19, absent from the key
const CITED_YEAR = '2019'; // issued year of @DM19, absent from the key
const CITED_TITLE = 'Admissible roots'; // a title fragment of @DM19
const UNCITED_KEY = 'Vor08'; // present in the bib, never cited by this document
const UNCITED_AUTHOR = 'Voronoi'; // author surname of the uncited entry

const WITNESS = `\n\nAs shown in [@${CITED_KEY}], the lattice is unimodular.\n`;

// Read the references pane's visible text from the live sidebar DOM.
const SIDEBAR_TEXT = `(document.querySelector('[data-pane="sidebar"]')?.textContent ?? '')`;

test('the references sidebar lists only the cited keys, rendered in CSL style matching the preview', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // ── (1) Activate the references view via the activity bar ───────────────────
  // The activity-bar control carries data-view="references" (the FOURTH
  // SIDEBAR_VIEWS entry, sibling to explorer/macros/figures — P18/P44). Clicking
  // it shows the references view's content in the side bar. RED today: no such
  // control exists, so this returns false.
  const activated = await tauriPage.evaluate(
    `(() => { const c = document.querySelector('[data-view="references"]'); if (!c) return false; c.click(); return true; })()`,
  );
  expect(activated).toBe(true);

  // The side bar now renders the references view's content.
  await tauriPage.waitForFunction(
    `(() => { const e = document.querySelector('[data-pane="sidebar"]'); return !!e && e.offsetParent !== null && e.getBoundingClientRect().width > 0; })()`,
    10_000,
  );

  // ── (2) Before any citation: the uncited entry does NOT appear ──────────────
  // The document (demo.md) cites nothing yet, so the panel must list nothing from
  // the bibliography — in particular NOT the uncited Vor08/Voronoi entry. A panel
  // that dumps the whole bib would show Voronoi here.
  const beforeText = (await tauriPage.evaluate(SIDEBAR_TEXT)) as string;
  expect(typeof beforeText).toBe('string');
  expect(beforeText.includes(UNCITED_KEY)).toBe(false);
  expect(beforeText.includes(UNCITED_AUTHOR)).toBe(false);

  // ── (3) Cite [@DM19] in the buffer ──────────────────────────────────────────
  await appendAtEnd(tauriPage, WITNESS);

  // The preview resolves the citation (p27's source of truth) — wait for the
  // resolved #refs entry for DM19 to exist, so the cross-check below reads a
  // settled bibliography.
  await waitForPreview(
    tauriPage,
    `return d.querySelector('#ref-${CITED_KEY}') !== null;`,
  );

  // ── (4) The panel now shows a DM19 reference rendered with bibliographic text,
  //        NOT the bare key ─────────────────────────────────────────────────────
  // The panel must surface the entry's author surname, year, and a title fragment
  // (CSL-rendered text), proving it is not a static/empty panel and not a bare
  // key list.
  await tauriPage.waitForFunction(
    `${SIDEBAR_TEXT}.includes(${JSON.stringify(CITED_AUTHOR)})`,
    15_000,
  );
  const afterText = (await tauriPage.evaluate(SIDEBAR_TEXT)) as string;
  expect(afterText.includes(CITED_AUTHOR)).toBe(true);
  expect(afterText.includes(CITED_YEAR)).toBe(true);
  expect(afterText.includes(CITED_TITLE)).toBe(true);

  // ── (5) Cross-check: the panel's DM19 reference text matches the preview's
  //        resolved #refs DM19 entry (one source of truth) ─────────────────────
  // The preview's #ref-DM19 entry is pandoc citeproc's rendered bibliography
  // entry for DM19 (p27). The panel must render the SAME author/year/title text,
  // so the sidebar cannot drift from the preview. We compare on the discriminating
  // metadata tokens read from BOTH DOMs (whitespace-normalized): the author
  // surname, the year, and a title fragment present in the preview's #refs entry
  // are the SAME tokens present in the panel.
  const previewRefRaw = await previewQuery(
    tauriPage,
    `return d.querySelector('#ref-${CITED_KEY}')?.textContent ?? null;`,
  );
  expect(typeof previewRefRaw).toBe('string');
  const previewRef = (previewRefRaw as string).replace(/\s+/g, ' ').trim();
  // The preview's resolved entry carries the same discriminators…
  expect(previewRef).toContain(CITED_AUTHOR);
  expect(previewRef).toContain(CITED_YEAR);
  expect(previewRef).toContain(CITED_TITLE);
  // …and the panel reproduces every token the preview's #refs entry shows for the
  // same key (the panel rides the preview's citeproc output, not a parallel
  // formatter).
  const panelNormalized = afterText.replace(/\s+/g, ' ').trim();
  for (const token of [CITED_AUTHOR, CITED_YEAR, CITED_TITLE]) {
    expect(panelNormalized.includes(token)).toBe(true);
  }

  // ── (6) The uncited entry STILL does not appear after the cite ──────────────
  // Citing DM19 must NOT pull in the whole bibliography: Vor08/Voronoi, never
  // cited by the document, remains absent.
  expect(panelNormalized.includes(UNCITED_KEY)).toBe(false);
  expect(panelNormalized.includes(UNCITED_AUTHOR)).toBe(false);

  recordObservation({ spec: manifest.spec, name: 'references-sidebar-cited', value: CITED_KEY });
  recordObservation({ spec: manifest.spec, name: 'references-sidebar-uncited-absent', value: UNCITED_KEY });
});
