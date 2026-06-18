import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  appendAtEnd,
  typeAutotrigger,
  completionLabels,
  editorText,
} from './support/app';

// ── P78 — Autotrigger space-expansion, re-arming for chains (Phase-B B2) ─────
//
// THE OBLIGATION (phase-b-snippet-engine.md, proposed P78, exact intent):
//   Config declares an AUTOTRIGGER entry. Typing the trigger followed by a SPACE
//   expands the body IN PLACE with NO completion popup and NO accept keypress
//   (the trigger text is GONE, the expansion is at the cursor). Immediately
//   typing a SECOND autotrigger + space expands AGAIN (the engine RE-ARMED —
//   chained expansion, two expansions in one fluid stroke).
//
//   Admissible because it FAILS on:
//     - a POPUP-ONLY engine (the trigger stays literal until an explicit accept):
//       the P52/P77 snippet source surfaces a completion in a tooltip and waits
//       for acceptCompletion — it never auto-expands on space, so after `tii `
//       the buffer holds the LITERAL `tii ` (assertions (1)/(2) fail);
//     - a ONE-SHOT engine (the first autotrigger fires but the second does not,
//       proving no re-arm): assertion (4) — the second body never appears;
//     - a NO-OP (the trigger + space leaves the literal trigger in the buffer):
//       on the current code the expansion is invoked ONLY from a self-driving
//       harness function — there is NO real CM6 input observer
//       (EditorView.inputHandler / transactionFilter / updateListener) that fires
//       it. So when the trigger arrives through the REAL input path (per-character
//       view.dispatch inserts, including the space) NOTHING expands: the literal
//       `tii ` stays inert and `\tilde{}` never appears — the faithful RED state
//       this spec exposes (missing real-input wiring).
//
// ── THE AUTOTRIGGER CONFIG CONTRACT (what the implementer must honor) ────────
// The dictionary is declared by the SAME config-owned path P52/P59/P77 read
// ([editor].snippet_dictionary). B2 extends the mode-tagged B-DESIGN-0 schema
// with a per-entry `auto: true` flag (LuaSnip autosnippet / UltiSnips `A`). This
// spec provisions, for THIS run, a hermetic copy of the committed fixture
// tests/proof/fixtures/snippets/p78-autotrigger-snippets.json — TWO autotrigger
// entries:
//
//   { "snippets": [
//       { "trigger": "tii", "mode": "both", "auto": true, "body": "\\tilde{$0}" },
//       { "trigger": "hii", "mode": "both", "auto": true, "body": "\\hat{$0}"   }
//     ] }
//
// and points [editor].snippet_dictionary at that copy (scripts/provision-proof.sh,
// the p78 case). TWO distinct autotriggers prove the engine RE-ARMS: the first
// expansion does not consume the engine — a second autotrigger + space fires
// immediately after it.
//
// ── THE OBSERVABLE CONTRACT (hooks + observables, BLIND to implementation) ────
//
//   appendAtEnd(text) [P53, reused] — append `text` at the buffer END through the
//     real docChanged pipeline; the cursor lands at the END of the appended text.
//     Used to place the cursor in a clean zone before the autotrigger fires.
//
//   typeAutotrigger(text) [P78] — drive `text` into the editor through the REAL
//     input driver (__PPE_E2E__.insertChars): per-character view.dispatch insert
//     transactions, including the terminating space, flowing through the editor's
//     real input path — NOT a call to any expansion function. So the autotrigger
//     fires ONLY if a REAL CM6 input observer the editor registers
//     (EditorView.inputHandler / transactionFilter / updateListener) sees the
//     inserted space, keys the on-space trigger condition + re-arm, and runs the
//     expansion through the shared `runSnippet` path. The driver itself never
//     calls startCompletion (an autotrigger fires WITHOUT a popup).
//
//   completionLabels() [P52, reused] — the labels in the live CM6 autocomplete
//     tooltip. Used here to PROVE NO POPUP opened (the autotrigger fires in
//     place, not through the popup-accept path).
//
//   getEditorText() [reused] — the live editor buffer text, to observe that the
//     literal trigger is GONE and the expanded body is in its place.
//
// ── WHAT EACH ASSERTION KILLS ────────────────────────────────────────────────
//   (1) After typing `tii ` (trigger + space) via the no-popup driving hook, the
//       expanded body `\tilde{}` is in the buffer.
//       KILLS: the NO-OP (no expansion happened) and the POPUP-ONLY engine (the
//       body never reaches the buffer without an explicit accept).
//   (2) The LITERAL trigger token `tii ` is GONE — the buffer does not contain
//       the literal `tii` followed by a space.
//       KILLS: a no-op that leaves `tii ` inert; a "surface a popup but also keep
//       the literal text" engine.
//   (3) NO completion popup is open after the autotrigger (completionLabels()
//       does not contain the trigger as an offered option).
//       KILLS: a popup-only engine masquerading as an autotrigger (it would
//       surface `tii` in the tooltip and wait for accept).
//   (4) Immediately typing a SECOND distinct autotrigger `hii ` expands AGAIN:
//       its body `\hat{}` is now ALSO in the buffer, alongside the first.
//       KILLS: a ONE-SHOT engine (the first fired but the engine did not re-arm,
//       so the second autotrigger + space leaves `hii ` literal).
//
// Together: the autotrigger expands on space with no popup and no accept (1)+(2)+(3),
// and the engine re-arms so a chained autotrigger fires immediately (4) — the full
// P78 autotrigger + re-arm obligation.

const TRIGGER_A = 'tii';
const BODY_A = '\\tilde{}';
const TRIGGER_B = 'hii';
const BODY_B = '\\hat{}';

// A clean zone whose END places the cursor right after a space, so the typed
// trigger token (matchBefore-style boundary) is the bare trigger the autotrigger
// keys on.
const ZONE = '\n\nAuto zone here: ';

test('Typing an autotrigger followed by a space expands its body in place with no popup and no accept; a second autotrigger immediately expands again (re-armed chain)', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // Neither expanded body is present in the demo buffer to start.
  const initial = await editorText(tauriPage);
  expect(initial).not.toContain(BODY_A);
  expect(initial).not.toContain(BODY_B);

  // Place the cursor in a clean zone after a space.
  await appendAtEnd(tauriPage, ZONE);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(ZONE.trimEnd())})`,
    10_000,
  );

  // ── (1)+(2)+(3) Autotrigger `tii ` expands in place, no popup, no accept ──
  // Drive the trigger + its space terminator through the REAL input driver
  // (per-character view.dispatch inserts). RED on the current code: no real CM6
  // input observer fires the expansion, so the wait below for `\tilde{}` times
  // out — the literal `tii ` stays inert. The faithful missing-wiring state.
  await typeAutotrigger(tauriPage, TRIGGER_A + ' ');
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(BODY_A)})`,
    10_000,
  );
  const afterA = await editorText(tauriPage);
  // (1) the body expanded:
  expect(afterA).toContain(BODY_A);
  // (2) the literal trigger token is gone (no `tii ` left inert in the buffer):
  expect(afterA).not.toContain(TRIGGER_A + ' ');
  // (3) no popup surfaced the trigger — the autotrigger fired WITHOUT the popup:
  const popupAfterA = await completionLabels(tauriPage);
  expect(popupAfterA).not.toContain(TRIGGER_A);

  // ── (4) Re-arm: a SECOND distinct autotrigger `hii ` expands immediately ──
  // No accept, no reset — type the next trigger + space straight away. A one-shot
  // engine leaves `hii ` literal; a re-armed engine expands `\hat{}` too.
  await typeAutotrigger(tauriPage, TRIGGER_B + ' ');
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(BODY_B)})`,
    10_000,
  );
  const afterB = await editorText(tauriPage);
  // Both bodies now stand — the first survived and the second fired (re-arm):
  expect(afterB).toContain(BODY_A);
  expect(afterB).toContain(BODY_B);
  // The second literal trigger token is gone too:
  expect(afterB).not.toContain(TRIGGER_B + ' ');

  recordObservation({ spec: manifest.spec, name: 'p78-first-body', value: BODY_A });
  recordObservation({ spec: manifest.spec, name: 'p78-rearm-body', value: BODY_B });
});
