import { test, expect } from './fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openProject } from './support/app';

// ── P110 — P101: global full-text WORKSPACE content search ────────────────────
//          (a new `search` sidebar view; boolean grammar; click-to-open-at-line)
//
// THE OBLIGATION (proof-obligations.md, P101 — verbatim intent):
//   In a multi-file project where `chapter1.md` contains `Minkowski bound` and
//   `chapter2.md` contains `Minkowski lattice` and `Café`, open the Search view and
//   query `Minkowski !lattice`: the results list `chapter1.md` (AND `Minkowski`,
//   NOT `lattice`) and do NOT list `chapter2.md`; clicking the `chapter1.md` hit
//   opens that file in the editor with the cursor on the matched line — an
//   INDEPENDENT read of the editor cursor line equals the line containing
//   `Minkowski bound`. The boolean grammar is space=AND, `|`=OR, `!term`=NOT,
//   `"phrase"`=exact phrase; the search is over file CONTENT, not file names.
//
// ── THE WITNESS CORPUS (scripts/provision-proof.sh, the p110 case) ────────────
// The default fixture project (demo.md/outline.md) itself carries "Minkowski",
// "lattice", and "Café", which would CONFOUND the result set, so provisioning
// REBUILDS the hermetic project into a controlled two-chapter corpus:
//   chapter1.md — has "Minkowski bound"; has NO "lattice" anywhere.
//   chapter2.md — has "Minkowski lattice" (matches Minkowski, excluded by
//                 !lattice) and "Café" (the P102 discriminator, harmless here).
// So `Minkowski !lattice` matches chapter1.md and NOT chapter2.md on CONTENT.
//
// ── THE OBSERVABLE CONTRACT (driven through the Search SIDEBAR view) ───────────
// This spec is BLIND to the search backend (ripgrep, query translation, the
// firewall plugin) and to how results are rendered. Webview keystrokes into a
// search box are flaky (the reason P52–P62/P104/P105/P109 drive editor + figure
// actions through harness hooks), so the search is driven through a NEW harness
// hook and the results are read off the REAL rendered sidebar DOM:
//
//   __PPE_E2E__.workspaceSearch(query: string)   [NEW for P110 / E1]
//     Performs the SAME content search the Search view's query box fires: runs the
//     boolean-parsed query (space=AND, |=OR, !term=NOT, "phrase"=exact) over the
//     open project's file CONTENT and renders the matching files into the Search
//     view's result list. Fire-and-forget; returns null. (BLIND to the backend.)
//
//   The Search view is activated through the activity bar via the
//   data-view="search" control — the new SIDEBAR_VIEWS entry, sibling to
//   explorer/macros/figures/references (P18/P44/P89 precedent). Its result list
//   renders under [data-pane="sidebar"] (the same pane every sidebar proof reads),
//   one element per matched file carrying data-search-result="<project-relative
//   path>" — the stable, click-free observable this spec asserts against, the
//   SAME choice P44/P89/P109 made for sidebar/jump surfaces. Clicking a result
//   element opens that file in the editor at the matched line (the openFile +
//   editor.goToLine path, App.svelte).
//
//   __PPE_E2E__.cursorLine(): number   [reused, App.svelte:610; p41 precedent] —
//     the live, 1-based CM6 cursor line, read INDEPENDENTLY of the search/open
//     report. Used to prove the click opened the file AT the hit line, not line 1.
//   __PPE_E2E__.currentFile(): string  [reused] — the open file's absolute path,
//     to prove the click opened chapter1.md (not chapter2.md, not nothing).
//
// ── WHAT EACH ASSERTION KILLS ─────────────────────────────────────────────────
//   (ACTIVATE) The data-view="search" control exists and activates the view.
//        KILLS an app with no Search view at all.
//   (FOUND)   `Minkowski !lattice` lists chapter1.md.
//        KILLS a filename-only filter (content never searched, so the
//        "Minkowski bound" content match is missed) and an empty/never-listing
//        result list.
//   (NEGATED) The SAME query does NOT list chapter2.md.
//        KILLS a search that ignores `!`-negation (chapter2.md wrongly listed
//        despite containing "lattice") and a list-every-file view.
//   (OPEN-AT-LINE) Clicking the chapter1.md result opens chapter1.md AND the
//        INDEPENDENT cursorLine() equals the on-disk line carrying "Minkowski
//        bound" (computed by reading the file off disk, not a hardcoded constant).
//        KILLS a click that opens the file at line 1 (the cursor-line read does
//        not equal the hit line) and a click that opens the wrong file / nothing.
//
// RED today: __PPE_E2E__.workspaceSearch does NOT exist, and there is no
// data-view="search" control and no data-search-result DOM — there is no Search
// view, no workspace-search backend, and no result list at all. The activation
// assertion (the data-view="search" control is absent) fails first; were the view
// somehow present, the search driver evaluate would throw (the hook is absent).
// The faithful no-search RED state. The failure is the MISSING workspace search,
// not a boot/setup error: the app, project, and editor are all brought up first.

const QUERY = 'Minkowski !lattice';
const FOUND_FILE = 'chapter1.md'; // matches Minkowski, lacks lattice → listed
const NEGATED_FILE = 'chapter2.md'; // matches Minkowski lattice → excluded by !lattice
const HIT_TERM = 'Minkowski bound'; // the unique content match in chapter1.md

// The project-relative paths of the rendered search results, read off the REAL
// sidebar DOM (data-search-result), tolerating the absent view/hook so the
// failure is the missing search, not a thrown read.
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

// The 1-based line number of the FIRST line containing `term` in `file`, read
// INDEPENDENTLY off disk. This is the open-at-line target the cursor must land
// on — derived from the real file bytes, never hardcoded, so a layout change in
// the fixture cannot silently desync the assertion.
function lineOfTermOnDisk(file: string, term: string): number {
  const lines = readFileSync(file, 'utf-8').split('\n');
  const idx = lines.findIndex((l) => l.includes(term));
  if (idx < 0) throw new Error(`term ${JSON.stringify(term)} not found in ${file}`);
  return idx + 1; // 1-based, matching cursorLine()
}

test('the Search view finds Minkowski !lattice in chapter1.md (not chapter2.md) and clicking the hit opens chapter1.md at the Minkowski bound line', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();
  const ch1Path = join(manifest.project, FOUND_FILE);
  const expectedHitLine = lineOfTermOnDisk(ch1Path, HIT_TERM);

  // The app + project must be alive first, so a later failure is the missing
  // workspace search, not a boot/setup error. The controlled corpus is real
  // markdown the explorer lists.
  await openProject(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('.grow.overflow-auto.p-1 button span:last-child')).some((s) => s.textContent.trim() === ${JSON.stringify(FOUND_FILE)})`,
    15_000,
  );

  // (ACTIVATE) Activate the Search view via the activity bar (the new
  // data-view="search" SIDEBAR_VIEWS entry). RED today: no such control exists,
  // so this returns false.
  const activated = await tauriPage.evaluate(
    `(() => { const c = document.querySelector('[data-view="search"]'); if (!c) return false; c.click(); return true; })()`,
  );
  expect(activated).toBe(true);

  // The side bar now renders the Search view's content.
  await tauriPage.waitForFunction(
    `(() => { const e = document.querySelector('[data-pane="sidebar"]'); return !!e && e.offsetParent !== null && e.getBoundingClientRect().width > 0; })()`,
    10_000,
  );

  // Run the content query. RED today: __PPE_E2E__.workspaceSearch does not exist,
  // so this evaluate throws — the faithful no-search RED state.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.workspaceSearch(${JSON.stringify(QUERY)}); return null; })()`,
  );

  // (FOUND) The results list chapter1.md (content match: Minkowski, no lattice).
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('[data-pane="sidebar"] [data-search-result]'))
       .some((el) => el.getAttribute('data-search-result') === ${JSON.stringify(FOUND_FILE)})`,
    15_000,
  );
  const paths = await searchResultPaths(tauriPage);
  expect(paths).toContain(FOUND_FILE);

  // (NEGATED) The SAME query does NOT list chapter2.md — the !-negation removes
  // it despite its "Minkowski lattice" match. KILLS a negation-blind search.
  expect(paths).not.toContain(NEGATED_FILE);

  // (OPEN-AT-LINE) Click the chapter1.md result → it opens chapter1.md in the
  // editor with the cursor on the "Minkowski bound" line. The independent
  // cursor-line read must equal the on-disk hit line (NOT line 1).
  const clicked = await tauriPage.evaluate(`(() => {
    const el = Array.from(document.querySelectorAll('[data-pane="sidebar"] [data-search-result]'))
      .find((e) => e.getAttribute('data-search-result') === ${JSON.stringify(FOUND_FILE)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  expect(clicked).toBe(true);

  // The click opened chapter1.md (the real open path), confirmed independently.
  await tauriPage.waitForFunction(
    `(window.__PPE_E2E__.currentFile() ?? '').endsWith('/${FOUND_FILE}')`,
    15_000,
  );
  const openFile = (await tauriPage.evaluate(
    `(window.__PPE_E2E__.currentFile() ?? '')`,
  )) as string;
  expect(openFile.endsWith(`/${FOUND_FILE}`)).toBe(true);

  // The decisive open-at-line discriminator: the INDEPENDENT cursor line equals
  // the on-disk line carrying "Minkowski bound". KILLS open-at-line-1.
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.cursorLine() === ${expectedHitLine}`,
    10_000,
  );
  const cursorLine = (await tauriPage.evaluate(
    `window.__PPE_E2E__.cursorLine()`,
  )) as number;
  expect(cursorLine).toBe(expectedHitLine);

  recordObservation({ spec: manifest.spec, name: 'p110-found', value: FOUND_FILE });
  recordObservation({ spec: manifest.spec, name: 'p110-negated-absent', value: NEGATED_FILE });
  recordObservation({ spec: manifest.spec, name: 'p110-open-at-line', value: cursorLine });
});
