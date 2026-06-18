import { test, expect } from './fixtures';
import { execFileSync } from 'node:child_process';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, typeInEditor } from './support/app';

// ── P86 — Citation completion option previews the bib entry before insert ────
//
// THE OBLIGATION (proof-obligations.md, exact wording):
//   Each citation completion option carries an info tooltip whose rendered
//   content shows the entry's author, year, and title — the fields the user
//   verifies before inserting — sourced from the configured bibliography file.
//   Hovering/selecting an offered candidate surfaces that info tooltip, and the
//   previewed content is the entry's bibliographic metadata, so the user can
//   disambiguate among candidates without inserting first.
//
// ── THE CONFIG-OWNED SOURCE (what the preview content comes from) ────────────
// The preview content is the bibliographic metadata of the entry in the ONE
// config-declared bibliography P84/C1 established: editor.bibliography. This run
// (scripts/provision-proof.sh, the p85/p86 case) points that SAME config value
// at the committed fixture tests/proof/fixtures/p85-bib.bib, whose entry
//
//   @article{xq7,
//     author = {Grothendieck, Alexander and Serre, Jean-Pierre},
//     title  = {Crystalline cohomology of supersingular abelian varieties},
//     year   = {1977}, ... }
//
// carries author surnames and title words ABSENT from its key `xq7`. So a preview
// that shows "Grothendieck", "1977", and "Crystalline" is showing the entry's
// METADATA, content that cannot have come from the bare key.
//
// ── THE OBSERVABLE CONTRACT (driven through the EDITOR UI, parser-agnostic) ───
// This spec is BLIND to how the .bib is parsed. It drives only the editor UI and
// asserts on the REAL rendered CM6 completion DOM. CM6 renders the SELECTED
// option's info tooltip as a `.cm-tooltip.cm-completionInfo` pane (the standard
// `@codemirror/autocomplete` info-pane element; the first option is selected by
// default when the popup opens). The previewed content is that pane's text:
//
//   typeInEditor(text) — inserts `text` at the cursor through the real docChanged
//     pipeline and opens completion (CM6 startCompletion).
//   OBSERVABLE: the `.cm-tooltip.cm-completionInfo` pane that CM6 renders for the
//     selected option, whose textContent is the entry's previewed metadata.
//
// ── WHAT EACH ASSERTION KILLS ────────────────────────────────────────────────
//   (1) Typing the @-trigger + a title-word query (`@crystalline`) at a citation
//       trigger position opens the completion popup AND CM6 renders an info pane
//       (`.cm-tooltip.cm-completionInfo`) for the selected citation candidate.
//       KILLS the no-citation-source app (no popup candidate, hence no info pane)
//       and a bare-key option with no `info` field (CM6 renders NO info pane when
//       the option carries no info — the user gets nothing to verify).
//   (2) The rendered info pane's text contains the entry's AUTHOR surname
//       (`Grothendieck`), YEAR (`1977`), and a TITLE word (`Crystalline`) — the
//       three fields sourced from the configured bibliography, verified
//       independently off disk to be metadata ABSENT from the cite key.
//       KILLS a preview that shows only the bare key (no author/year/title), and
//       a hardcoded/placeholder info pane that is not this configured entry's
//       metadata: only a pane carrying all three real metadata fields passes.
//
// ── WHY THE APP IS RED TODAY ─────────────────────────────────────────────────
// No @-trigger citation completion source exists, so typing `@crystalline`
// surfaces no citation candidate and CM6 renders no `.cm-tooltip.cm-
// completionInfo` pane for one. Even were a bare-key completion offered, it would
// carry no `info` field, so no info pane would render. Assertion (1) fails
// behaviorally: there is no info pane previewing the configured entry's metadata.

const KEY = 'xq7';
const TITLE_QUERY = 'crystalline';
// The three metadata fields the info pane must preview, sourced from the
// configured bibliography — each chosen because it is ABSENT from the cite key.
const AUTHOR = 'Grothendieck';
const YEAR = '1977';
const TITLE_WORD = 'Crystalline';

function readFileIndependently(path: string): string {
  return execFileSync('cat', [path], { encoding: 'utf-8' });
}

test('the selected citation completion option renders an info tooltip previewing the configured entry author, year, and title', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // Independently confirm, off disk, that the three preview fields are genuine
  // metadata of the configured bibliography's entry AND are absent from its key —
  // so an info pane carrying them is previewing METADATA, not echoing the key.
  const bibPath = await tauriPage.evaluate(
    `(() => { const p = window.__PPE_E2E__.configBibliography(); return p === null || p === undefined ? null : String(p); })()`,
  );
  expect(typeof bibPath).toBe('string');
  const bibBytes = readFileIndependently(bibPath as string);
  expect(bibBytes).toContain(`{${KEY},`);
  expect(bibBytes).toContain(AUTHOR);
  expect(bibBytes).toContain(YEAR);
  expect(bibBytes).toContain(TITLE_WORD);
  // None of the three preview fields appears in the bare cite key token.
  for (const field of [AUTHOR, YEAR, TITLE_WORD]) {
    expect(KEY.toLowerCase().includes(field.toLowerCase())).toBe(false);
  }

  // Put the cursor at a citation trigger position (a fresh blank line / line
  // start) and type the @-trigger + a title-word query, opening completion.
  await appendAtEnd(tauriPage, '\n\n');
  await typeInEditor(tauriPage, `@${TITLE_QUERY}`);
  await tauriPage.waitForFunction(
    `!!document.querySelector('.cm-tooltip-autocomplete')`,
    10_000,
  );
  // The popup must offer the metadata-matched candidate for `xq7`.
  await tauriPage.waitForFunction(
    `(() => {
      const tip = document.querySelector('.cm-tooltip-autocomplete');
      if (!tip) return false;
      return Array.from(tip.querySelectorAll('.cm-completionLabel'))
        .some((el) => (el.textContent || '').includes(${JSON.stringify(KEY)}));
    })()`,
    10_000,
  );

  // (1) CM6 renders the SELECTED option's info pane. RED today: no citation
  // candidate, and no option carries an `info` field, so this pane never appears.
  await tauriPage.waitForFunction(
    `!!document.querySelector('.cm-tooltip.cm-completionInfo')`,
    10_000,
  );

  // (2) The info pane previews the configured entry's metadata: author, year, and
  // a title word — all three, all sourced from editor.bibliography.
  const infoText = await tauriPage.evaluate(`(() => {
    const info = document.querySelector('.cm-tooltip.cm-completionInfo');
    return info ? (info.textContent || '') : null;
  })()`);
  expect(typeof infoText).toBe('string');
  const info = infoText as string;
  expect(info).toContain(AUTHOR);
  expect(info).toContain(YEAR);
  expect(info).toContain(TITLE_WORD);

  recordObservation({ spec: manifest.spec, name: 'citation-tooltip-key', value: KEY });
  recordObservation({
    spec: manifest.spec,
    name: 'citation-tooltip-metadata',
    value: `${AUTHOR}|${YEAR}|${TITLE_WORD}`,
  });
});
