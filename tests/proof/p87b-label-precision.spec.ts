import { test, expect } from './fixtures';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  appendAtEnd,
  typeInEditor,
  completionLabels,
  editorText,
  currentFile,
} from './support/app';

// ── P87b — Label completion is precise: an anchor DEFINITION, not any #id ─────
//
// THE OBLIGATION (P87 precision strengthening):
//   A label is an anchor DEFINITION — a pandoc `{#id}` heading attribute, a
//   `:::{#id}` fenced-div id, or a `\label{}` — NOT an arbitrary `#id` token. The
//   project's cross-file label-completion source (labels.ts, harvested across
//   files App-side) must offer the REAL anchors and must NOT offer `#id`-looking
//   tokens that are not anchor definitions: a markdown LINK fragment
//   `[text](#frag)` and a bare PROSE `#word`. Offering those is over-harvesting.
//
// ── THE PROJECT-OWNED SOURCE (what the candidates come from) ──────────────────
// labels.ts's ATTR_ID regex `/[#]([A-Za-z][\w:.-]*)/g` claims (its own doc comment)
// to match an `#id` token INSIDE AN ATTRIBUTE BRACE — a pandoc heading attribute or
// a `:::{#id}` fenced-div id. But the regex enforces NO surrounding brace: it
// matches ANY `#id` token. So a markdown link fragment `[see here](#decoyfragment)`
// and a prose `#decoyprose` are wrongly harvested as label completions. This spec
// proves that over-harvest behaviorally, through the real editor completion UI.
//
// This run (scripts/provision-proof.sh, the p87b case) provisions ONE markdown
// file (file A, precision.md) in THIS spec's hermetic project copy only, carrying
// THREE distinctive tokens together — verified independently off disk below:
//
//   # Precision section {#sec:realprecision}      ← (a) REAL pandoc heading attr
//   A real lemma. \label{lem:realprecision}       ← (a) REAL \label{} definition
//   ...[see here](#decoyfragment)...              ← (b) DECOY link fragment
//   ...a bare prose hash like #decoyprose ...     ← (c) DECOY prose hash
//
// The tokens `realprecision`, `decoyfragment`, `decoyprose` appear in NEITHER
// demo.md (the open buffer, file B) nor outline.md, so a candidate surfaced for any
// of them while editing demo.md came ONLY from harvesting precision.md.
//
// ── THE OBSERVABLE CONTRACT (driven through the EDITOR UI, parser-agnostic) ───
// This spec is BLIND to how labels are harvested. It drives only the editor UI and
// asserts on the REAL rendered CM6 autocomplete DOM, the SAME surface P87 and every
// completion proof (P51/P52/P85) asserts against. Typing the cross-reference
// trigger `\cref{` (empty query) opens the popup holding EVERY harvested label;
// completionLabels() reads the `.cm-completionLabel` option texts. An option is
// "offered" iff its label text is present in the open tooltip.
//
// ── WHAT EACH ASSERTION KILLS ────────────────────────────────────────────────
//   (REAL)   `sec:realprecision` (or `lem:realprecision`) IS offered — the precise
//            harvester keeps the genuine anchor definitions. This is the
//            discriminator that the source is ALIVE and harvesting precision.md:
//            were nothing offered, a missing-decoy assertion would be vacuous.
//   (DECOY1) `decoyfragment` is NOT offered — a markdown link fragment is not an
//            anchor definition. RED today: ATTR_ID matches the `#decoyfragment` in
//            `(#decoyfragment)`, so it IS wrongly offered (over-harvest).
//   (DECOY2) `decoyprose` is NOT offered — a bare prose `#word` is not an anchor
//            definition. RED today: ATTR_ID matches the prose `#decoyprose`, so it
//            IS wrongly offered (over-harvest).
//
// ── WHY THE APP IS RED TODAY ─────────────────────────────────────────────────
// ATTR_ID enforces no attribute brace, so harvestFileLabels() over precision.md
// yields `sec:realprecision`, `lem:realprecision`, AND the decoys `decoyfragment`
// and `decoyprose`. Typing `\cref{` while editing demo.md opens the popup holding
// ALL of them; the DECOY-is-offered assertions therefore FAIL because the
// link-fragment / prose `#id` ARE currently offered as labels. The liveness guard
// (\alpha) and the REAL-anchor assertion together pin the failure to the
// over-harvest, never to dead wiring or a missing real anchor.

// The REAL anchors that MUST be offered.
const REAL_HEADING_ANCHOR = 'sec:realprecision';
const REAL_LABEL_ANCHOR = 'lem:realprecision';
// The DECOYS that MUST NOT be offered (link fragment + prose hash).
const DECOY_FRAGMENT = 'decoyfragment';
const DECOY_PROSE = 'decoyprose';
// A cross-reference trigger placing the cursor in a label-reference context. Empty
// query (just `\cref{`) so the popup holds EVERY harvested label, unfiltered — both
// the real anchors and the decoys, if harvested.
const REF_TRIGGER = '\\cref{';

// Read a file off disk in an INDEPENDENT process (never trusting the app's own
// report of its bytes), mirroring p85/p86/p87 independent-read discipline.
function readFileIndependently(path: string): string {
  return execFileSync('cat', [path], { encoding: 'utf-8' });
}

test('label completion offers genuine anchor definitions but NOT a markdown link fragment nor a bare prose #id (no over-harvest)', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // Open file B (demo.md). file A (precision.md) carries the anchors + decoys and
  // is NOT opened — every candidate surfaced is therefore cross-file harvested.
  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  const openFile = await currentFile(tauriPage);
  expect(openFile.endsWith('/demo.md')).toBe(true);

  // The discriminator, verified independently off disk: file A (precision.md)
  // genuinely contains the real anchors AND the two decoy `#id` tokens, and the
  // open buffer file B (demo.md) contains NONE of these tokens — so any candidate
  // surfaced for them while editing demo.md was harvested from precision.md.
  const fileA = join(manifest.project, 'precision.md');
  const fileB = join(manifest.project, 'demo.md');
  const fileABytes = readFileIndependently(fileA);
  const fileBBytes = readFileIndependently(fileB);
  // (a) the real anchors are genuinely defined in file A as anchor definitions.
  expect(fileABytes).toContain(`{#${REAL_HEADING_ANCHOR}}`);
  expect(fileABytes).toContain(`\\label{${REAL_LABEL_ANCHOR}}`);
  // (b) the decoy link fragment is genuinely present in file A as a link target.
  expect(fileABytes).toContain(`(#${DECOY_FRAGMENT})`);
  // (c) the decoy prose hash is genuinely present in file A as a bare prose token.
  expect(fileABytes).toContain(`#${DECOY_PROSE}`);
  // None of the four tokens are in the open buffer — cross-file discriminator.
  expect(fileBBytes.includes(REAL_HEADING_ANCHOR)).toBe(false);
  expect(fileBBytes.includes(REAL_LABEL_ANCHOR)).toBe(false);
  expect(fileBBytes.includes(DECOY_FRAGMENT)).toBe(false);
  expect(fileBBytes.includes(DECOY_PROSE)).toBe(false);

  // The buffer before: none of the tokens are present as text.
  const before = await editorText(tauriPage);
  expect(before.includes(REAL_HEADING_ANCHOR)).toBe(false);
  expect(before.includes(DECOY_FRAGMENT)).toBe(false);
  expect(before.includes(DECOY_PROSE)).toBe(false);

  // Put the cursor on a fresh blank line.
  await appendAtEnd(tauriPage, '\n\n');

  // LIVENESS GUARD — prove the completion machinery is ALIVE in THIS exact buffer
  // and run, so a missed assertion below cannot be misread as "completion is dead /
  // the popup never opens." Typing a backslash-command fragment opens the standard
  // popup and offers a LaTeX command (\alpha), exactly as P51/P87 assert.
  await typeInEditor(tauriPage, '\\al');
  await tauriPage.waitForFunction(
    `(() => {
      const tip = document.querySelector('.cm-tooltip-autocomplete');
      if (!tip) return false;
      return Array.from(tip.querySelectorAll('.cm-completionLabel'))
        .some((el) => (el.textContent || '') === '\\\\alpha');
    })()`,
    10_000,
  );
  // Clear the liveness probe so it cannot leak into the cross-reference query.
  await appendAtEnd(tauriPage, '\n\n');

  // Type the cross-reference trigger in file B and wait for the popup to open
  // holding a REAL anchor — proving the cross-file label source is alive and
  // harvesting precision.md (so the missing-decoy assertions below are not
  // vacuous). The real heading anchor `sec:realprecision` is a genuine pandoc
  // attribute, so the precise harvester offers it.
  await typeInEditor(tauriPage, REF_TRIGGER);
  await tauriPage.waitForFunction(
    `(() => {
      const tip = document.querySelector('.cm-tooltip-autocomplete');
      if (!tip) return false;
      return Array.from(tip.querySelectorAll('.cm-completionLabel'))
        .some((el) => (el.textContent || '').includes(${JSON.stringify(REAL_HEADING_ANCHOR)}));
    })()`,
    10_000,
  );

  const labels = await completionLabels(tauriPage);

  // (REAL) the genuine anchor definitions are offered — the source is alive.
  expect(labels.some((l) => l.includes(REAL_HEADING_ANCHOR))).toBe(true);
  expect(labels.some((l) => l.includes(REAL_LABEL_ANCHOR))).toBe(true);

  // (DECOY1) a markdown link fragment is NOT an anchor definition — must NOT be
  // offered. RED today: ATTR_ID over-harvests the `#decoyfragment` in the link
  // target, so this candidate IS wrongly offered.
  expect(labels.some((l) => l.includes(DECOY_FRAGMENT))).toBe(false);

  // (DECOY2) a bare prose `#word` is NOT an anchor definition — must NOT be
  // offered. RED today: ATTR_ID over-harvests the prose `#decoyprose`, so this
  // candidate IS wrongly offered.
  expect(labels.some((l) => l.includes(DECOY_PROSE))).toBe(false);

  recordObservation({
    spec: manifest.spec,
    name: 'label-precision',
    value: `real=${REAL_HEADING_ANCHOR},${REAL_LABEL_ANCHOR} decoys-rejected=${DECOY_FRAGMENT},${DECOY_PROSE}`,
  });
});
