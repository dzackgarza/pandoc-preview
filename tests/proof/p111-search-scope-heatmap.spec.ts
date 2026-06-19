import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openProject } from './support/app';

// ── P111 — P102: per-directory RESTRICTION and a relevancy HEATMAP ────────────
//          (refines the P101 Search view with scope + per-result heat class)
//
// THE OBLIGATION (proof-obligations.md, P102 — verbatim intent):
//   In the multi-file project, restrict a search to a chosen subdirectory and
//   query `Café`: only hits UNDER that subtree appear — a file matching `Café`
//   OUTSIDE the chosen subtree is ABSENT from the results; and each result file
//   carries a relevance weight rendered as a DISCRIMINABLE heat class — a file
//   with more / exact matches shows a HIGHER-heat class than a single-match file
//   (the two files are visibly distinguishable by heat class, not merely by list
//   order).
//
// ── THE WITNESS CORPUS (scripts/provision-proof.sh, the p111 case) ────────────
// Provisioning REBUILDS the hermetic project (the default fixture would confound
// the corpus) into a layout with a scoped subtree and one out-of-subtree match:
//   sections/intro.md — "Café" THREE times  → the HIGH-heat result.
//   sections/notes.md — "Café" ONCE          → the LOW-heat result.
//   chapter2.md       — "Café" ONCE, at the project ROOT (OUTSIDE sections/) →
//                       must be ABSENT under the sections/ restriction.
// The two in-subtree files differ ONLY by match count, so a flat single-class
// list cannot tell them apart — the heat class is the SOLE discriminator.
//
// ── THE OBSERVABLE CONTRACT (driven through the Search SIDEBAR view) ───────────
// BLIND to the search backend, the scope mechanism, and the scoring/heat-class
// computation. The search + scope are driven through harness hooks; the results,
// their scope-restriction, and their heat classes are read off the REAL rendered
// sidebar DOM (the P44/P89/P109/P110 click-free-observable discipline):
//
//   __PPE_E2E__.setSearchScope(subdir: string)   [NEW for P111 / E1]
//     Restricts the NEXT workspace search to the given project-relative
//     subdirectory (the chosen subtree the Search view's scope control selects).
//     Fire-and-forget; returns null. (BLIND to how the scope is applied.)
//   __PPE_E2E__.workspaceSearch(query: string)   [reused from P110 / E1]
//     Runs the content search (now scope-restricted) and renders the result list.
//
//   Each result renders under [data-pane="sidebar"] as an element carrying
//   data-search-result="<project-relative path>" (the P110 result identity) AND a
//   data-heat-rank="<integer>" — the per-file relevance RANK, a higher integer
//   for a higher-heat class (the discriminable heat the obligation requires,
//   surfaced as an ordered, machine-readable rank so "HIGHER" is decidable off the
//   DOM, not by guessing a colour vocabulary). The heat class itself MAY also be a
//   CSS class / colour; the rank is the stable observable this spec asserts.
//
// ── WHAT EACH ASSERTION KILLS ─────────────────────────────────────────────────
//   (ACTIVATE) The data-view="search" control exists and activates the view.
//        KILLS an app with no Search view.
//   (SCOPED)  The scoped `Café` search lists BOTH in-subtree files
//        (sections/intro.md AND sections/notes.md). KILLS a scope that finds
//        nothing under the subtree.
//   (OUT-ABSENT) The out-of-subtree chapter2.md (which DOES contain "Café") is
//        ABSENT. KILLS a restriction that searches the whole workspace anyway
//        (the out-of-subtree match wrongly appears).
//   (HEAT)    The HIGH-match file (sections/intro.md, three "Café") carries a
//        STRICTLY HIGHER data-heat-rank than the LOW-match file
//        (sections/notes.md, one "Café"). KILLS a flat single-class list where
//        every hit shares one heat regardless of match count (the two files would
//        carry EQUAL ranks, indistinguishable by heat).
//
// RED today: __PPE_E2E__.setSearchScope / workspaceSearch do NOT exist, there is
// no data-view="search" control, and no data-search-result / data-heat-rank DOM —
// there is no Search view, no scope control, and no per-result heat. The
// activation assertion (the control is absent) fails first; were the view present,
// the scope/search driver evaluate would throw (the hooks are absent). The
// faithful no-scope / no-heatmap RED state. The failure is the MISSING
// scope+heatmap, not a boot/setup error: app, project, and explorer come up first.

const SCOPE_SUBDIR = 'sections';
const QUERY = 'Café';
const HIGH_FILE = 'sections/intro.md'; // three "Café" matches → higher heat
const LOW_FILE = 'sections/notes.md'; // one "Café" match → lower heat
const OUT_FILE = 'chapter2.md'; // one "Café" match OUTSIDE sections/ → absent

// The project-relative paths of the rendered results, read off the REAL sidebar
// DOM (data-search-result), tolerating the absent view/hook.
async function searchResultPaths(page: {
  evaluate(expr: string): Promise<unknown>;
}): Promise<string[]> {
  const raw = await page.evaluate(
    `JSON.stringify(Array.from(
       document.querySelectorAll('[data-pane="sidebar"] [data-search-result]')
     ).map((el) => el.getAttribute('data-search-result')))`,
  );
  if (typeof raw !== 'string') {
    throw new Error(`searchResultPaths returned non-string: ${JSON.stringify(raw)}`);
  }
  return JSON.parse(raw) as string[];
}

// The per-file heat RANK read off the result element's data-heat-rank, or null
// when the file is not listed / carries no rank. The discriminable-heat
// observable: the higher-match file's rank must strictly exceed the lower's.
async function heatRankOf(
  page: { evaluate(expr: string): Promise<unknown> },
  relPath: string,
): Promise<number | null> {
  const raw = await page.evaluate(`(() => {
    const el = Array.from(document.querySelectorAll('[data-pane="sidebar"] [data-search-result]'))
      .find((e) => e.getAttribute('data-search-result') === ${JSON.stringify(relPath)});
    if (!el) return JSON.stringify(null);
    const r = el.getAttribute('data-heat-rank');
    if (r === null) return JSON.stringify(null);
    const n = Number(r);
    return JSON.stringify(Number.isFinite(n) ? n : null);
  })()`);
  if (typeof raw !== 'string') {
    throw new Error(`heatRankOf returned non-string: ${JSON.stringify(raw)}`);
  }
  return JSON.parse(raw) as number | null;
}

test('a search restricted to sections/ for Café lists only the in-subtree files (chapter2.md absent) and the three-match file carries a higher heat rank than the one-match file', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // The app + project must be alive first, so a later failure is the missing
  // scope+heatmap, not a boot/setup error. The controlled corpus is real markdown
  // the explorer lists (chapter2.md sits at the project root).
  await openProject(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('.grow.overflow-auto.p-1 button span:last-child')).some((s) => s.textContent.trim() === ${JSON.stringify(OUT_FILE)})`,
    15_000,
  );

  // (ACTIVATE) Activate the Search view via the activity bar. RED today: no such
  // control exists, so this returns false.
  const activated = await tauriPage.evaluate(
    `(() => { const c = document.querySelector('[data-view="search"]'); if (!c) return false; c.click(); return true; })()`,
  );
  expect(activated).toBe(true);
  await tauriPage.waitForFunction(
    `(() => { const e = document.querySelector('[data-pane="sidebar"]'); return !!e && e.offsetParent !== null && e.getBoundingClientRect().width > 0; })()`,
    10_000,
  );

  // Restrict the search to the sections/ subtree, then run the Café query. RED
  // today: __PPE_E2E__.setSearchScope does not exist, so this evaluate throws —
  // the faithful no-scope RED state.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.setSearchScope(${JSON.stringify(SCOPE_SUBDIR)}); return null; })()`,
  );
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.workspaceSearch(${JSON.stringify(QUERY)}); return null; })()`,
  );

  // (SCOPED) Both in-subtree files appear.
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('[data-pane="sidebar"] [data-search-result]'))
       .some((el) => el.getAttribute('data-search-result') === ${JSON.stringify(HIGH_FILE)})`,
    15_000,
  );
  const paths = await searchResultPaths(tauriPage);
  expect(paths).toContain(HIGH_FILE);
  expect(paths).toContain(LOW_FILE);

  // (OUT-ABSENT) The out-of-subtree chapter2.md — which DOES contain "Café" — is
  // ABSENT under the sections/ restriction. KILLS a restriction that searches the
  // whole workspace anyway.
  expect(paths).not.toContain(OUT_FILE);

  // (HEAT) The three-match file carries a STRICTLY HIGHER heat rank than the
  // one-match file. KILLS a flat list where every hit shares one heat class
  // (equal ranks → indistinguishable by heat).
  const highRank = await heatRankOf(tauriPage, HIGH_FILE);
  const lowRank = await heatRankOf(tauriPage, LOW_FILE);
  expect(typeof highRank).toBe('number');
  expect(typeof lowRank).toBe('number');
  expect(highRank as number).toBeGreaterThan(lowRank as number);

  recordObservation({ spec: manifest.spec, name: 'p111-scoped-high', value: HIGH_FILE });
  recordObservation({ spec: manifest.spec, name: 'p111-out-absent', value: OUT_FILE });
  recordObservation({ spec: manifest.spec, name: 'p111-high-rank', value: String(highRank) });
  recordObservation({ spec: manifest.spec, name: 'p111-low-rank', value: String(lowRank) });
});
