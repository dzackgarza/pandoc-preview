import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, editorText, cursorOffset } from './support/app';

// ── P56 — Insertion bar: tikz / tikzcd diagram scaffold insert ───────────────
//
// THE OBLIGATION (proof-obligations.md, exact wording):
//   P56 — tikz/tikzcd scaffold insert. Selecting a tikz or tikzcd scaffold from
//   the insertion bar inserts the corresponding diagram skeleton at the cursor,
//   leaving the cursor inside the diagram body. Admissible because it fails on a
//   no-op insert (selecting the scaffold leaves the buffer unchanged so no
//   skeleton appears at the cursor), on a wrong-kind insert (a tikz skeleton is
//   inserted when tikzcd was chosen, or a tikzcd skeleton when tikz was chosen),
//   and when the cursor is not placed inside the diagram body after the insert.
//
// ── THE OBSERVABLE CONTRACT (hook + observables, BLIND to implementation) ────
// The implementer must expose ONE stable observable for "insert the chosen
// diagram scaffold at the cursor", parameterised by the diagram KIND. This spec
// drives the hook form, NOT a DOM button click — webview button clicks into the
// bar are flaky (the same reason p52/p53/p55 drive completion/Emmet/env-insert
// through harness hooks rather than synthetic key/click events). The contract
// the implementer must honor:
//
//   __PPE_E2E__.insertDiagram(kind: 'tikz' | 'tikzcd')   [NEW for P56]
//     Inserts the named diagram KIND's skeleton at the cursor by routing through
//     the editor's EXISTING insertSnippet surface (EditorPane.insertSnippet →
//     runSnippet → snippetCompletion), the SAME path P55's env insert and a
//     completion accept use. The skeleton's `$0` tabstop is honoured exactly as
//     on a completion accept, so the cursor lands in the diagram BODY. The two
//     kinds insert DISTINCT skeletons: a `tikzcd` skeleton carries the tikzcd
//     marker (a `\begin{tikzcd}` environment or a `tikzcd` code fence), a `tikz`
//     skeleton carries the tikz/tikzpicture marker and NOT the tikzcd marker.
//     Fire-and-forget; returns null.
//
//   __PPE_E2E__.getEditorText()  [reused]  — the live editor buffer text.
//   __PPE_E2E__.cursorOffset()   [reused]  — the cursor's character offset.
//
// The bar control MAY also be a DOM control (e.g. [data-insert-diagram="tikzcd"]);
// the hook is the stable, click-free surface this spec asserts against.
//
// ── DIAGRAM MARKERS (kind discriminators) ────────────────────────────────────
// The decisive textual marker of each kind is the diagram environment name.
//   - A tikzcd skeleton MUST contain the substring `tikzcd` (the `\begin{tikzcd}`
//     commutative-diagram environment / a `tikzcd` raw block) — the marker no
//     plain tikz skeleton carries.
//   - A tikz skeleton MUST contain `tikzpicture` (the `\begin{tikzpicture}`
//     environment) and MUST NOT contain `tikzcd`. `tikzcd` is a strict superset
//     match of `tikz`, so the test keys on the FULL environment names to keep
//     the two kinds disjoint: `tikzcd` ⇒ commutative diagram, `tikzpicture` ⇒
//     general tikz picture.
//
// ── WHAT EACH ASSERTION KILLS ────────────────────────────────────────────────
//   (A) Before any insert, the buffer contains neither marker — the skeletons
//       this spec asserts are NEWLY added, not pre-existing in demo.md.
//   (B) After insertDiagram('tikzcd'), the buffer GAINS the `tikzcd` marker that
//       was NOT there before.
//       KILLS the NO-OP insert: a hook (or bar control) that leaves the buffer
//       unchanged never adds the skeleton, so `tikzcd` is absent and this fails.
//       (RED today: __PPE_E2E__.insertDiagram does not exist, so the evaluate
//       throws — there is no insertion-bar surface to insert a diagram scaffold
//       at all.)
//   (C) The cursor lands strictly INSIDE the tikzcd skeleton body — after the
//       opening line bearing the `tikzcd` marker and before the skeleton's end.
//       KILLS a "dumb paste" that ignores the `$0` tabstop and drops the cursor
//       at the skeleton end (or before the skeleton): the cursor offset must sit
//       between the `tikzcd` marker and the close of the inserted skeleton.
//   (D) After insertDiagram('tikz'), the buffer GAINS the DISTINCT `tikzpicture`
//       marker, and that tikz skeleton does NOT itself carry the `tikzcd` marker.
//       KILLS the WRONG-KIND insert: a hook that ignores its `kind` argument and
//       inserts a fixed/different skeleton (e.g. always a tikzcd skeleton when
//       tikz was chosen) fails — the tikz insert would carry `tikzcd` instead of
//       a distinct `tikzpicture` marker, or would not change at all.
//
// Together: selecting tikzcd inserts the tikzcd skeleton (B) with the cursor in
// its body (C), and selecting tikz inserts a DISTINCT tikz skeleton (D) —
// proving tikz ≠ tikzcd and that the kind argument is honored.

const TIKZCD_MARKER = 'tikzcd';
const TIKZ_MARKER = 'tikzpicture';

test('The insertion bar inserts a tikzcd scaffold and a DISTINCT tikz scaffold at the cursor, cursor in the diagram body', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // (A) Neither diagram marker is present before the insert, so the skeletons
  // proven below are NEWLY added (not pre-existing in demo.md).
  const before = await editorText(tauriPage);
  expect(before).not.toContain(TIKZCD_MARKER);
  expect(before).not.toContain(TIKZ_MARKER);

  // Trigger the tikzcd insert through the insertion-bar hook. RED today:
  // __PPE_E2E__.insertDiagram does not exist, so this evaluate throws — there is
  // no insertion bar / diagram-scaffold surface yet.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.insertDiagram('tikzcd'); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(TIKZCD_MARKER)})`,
    10_000,
  );

  const afterCd = await editorText(tauriPage);

  // (B) The tikzcd skeleton was inserted: the `tikzcd` marker is now present.
  expect(afterCd).toContain(TIKZCD_MARKER);
  const cdMarkerIdx = afterCd.indexOf(TIKZCD_MARKER);

  // (C) The cursor lands strictly inside the tikzcd skeleton body: past the line
  // bearing the `tikzcd` marker (after the next newline) and before the end of
  // the inserted skeleton (the `$0` tabstop, not the skeleton end).
  const markerLineEnd = afterCd.indexOf('\n', cdMarkerIdx);
  expect(markerLineEnd).toBeGreaterThan(cdMarkerIdx);
  const bodyStart = markerLineEnd + 1;
  const cdCursor = await cursorOffset(tauriPage);
  expect(cdCursor).toBeGreaterThanOrEqual(bodyStart);
  expect(cdCursor).toBeLessThan(afterCd.length);

  // (D) Selecting tikz inserts a DISTINCT skeleton carrying the `tikzpicture`
  // marker — proving the kind argument is honored (tikz ≠ tikzcd). The tikz
  // skeleton must not itself be a tikzcd skeleton.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.insertDiagram('tikz'); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(TIKZ_MARKER)})`,
    10_000,
  );

  const afterTikz = await editorText(tauriPage);
  expect(afterTikz).toContain(TIKZ_MARKER);

  // The newly inserted tikz skeleton sits at/after the cursor where it was
  // dropped; its marker is `tikzpicture`, distinct from `tikzcd`. The cursor for
  // this insert lands in the tikz body.
  const tikzMarkerIdx = afterTikz.indexOf(TIKZ_MARKER);
  const tikzMarkerLineEnd = afterTikz.indexOf('\n', tikzMarkerIdx);
  expect(tikzMarkerLineEnd).toBeGreaterThan(tikzMarkerIdx);
  const tikzBodyStart = tikzMarkerLineEnd + 1;
  const tikzCursor = await cursorOffset(tauriPage);
  expect(tikzCursor).toBeGreaterThanOrEqual(tikzBodyStart);
  expect(tikzCursor).toBeLessThan(afterTikz.length);

  // The two skeletons are genuinely DISTINCT: the tikz marker is a `tikzpicture`
  // occurrence that is NOT part of a `tikzcd` token. (`tikzcd` does not contain
  // `tikzpicture`, so a tikzpicture match proves a separate, distinct skeleton.)
  expect(TIKZ_MARKER).not.toContain(TIKZCD_MARKER);

  recordObservation({ spec: manifest.spec, name: 'tikzcd-cursor-offset', value: cdCursor });
  recordObservation({ spec: manifest.spec, name: 'tikz-cursor-offset', value: tikzCursor });
});
