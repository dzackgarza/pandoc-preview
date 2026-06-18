import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  appendAtEnd,
  typeRegexTrigger,
  completionLabels,
  editorText,
} from './support/app';

// ── P79 — Regex/postfix trigger with capture group (Phase-B B3) ─────────────
//
// THE OBLIGATION (phase-b-snippet-engine.md, proposed P79, exact intent):
//   Config declares a REGEX entry whose body references a CAPTURE GROUP (e.g.
//   `([a-z])bar` → `\bar{$1}`). Typing `pbar` and triggering expansion yields
//   `\bar{p}` at the cursor — the captured `p` SUBSTITUTED into the body — with
//   the matched trigger text GONE. Postfix is the regex case where the trigger
//   trails an operand. Capture-group `$1` in the body is DISTINCT from a tabstop
//   `${1}`: the matcher resolves captures FIRST, then the residual `${N}` are
//   tabstops (the standard TextMate / LuaSnip regTrig / UltiSnips `r` model).
//
//   Admissible because it FAILS on:
//     - a LITERAL-TRIGGER engine (no regex match — the trigger is treated as the
//       literal string `([a-z])bar`, which `pbar` is not, so nothing expands and
//       `pbar` stays in the buffer): assertions (1)/(2) fail;
//     - a CAPTURE-BLIND engine (it matches the regex but inserts the literal `$1`
//       instead of the captured `p` — body comes out as `\bar{$1}`): assertion
//       (3) fails (the buffer holds the literal `$1`, not the captured `p`);
//     - a NO-OP (the trigger leaves the literal text in the buffer): there is no
//       regex-trigger path at all today, so the very FIRST typeRegexTrigger throws
//       (no __PPE_E2E__.typeRegexTrigger surface) — the faithful RED state.
//
// ── THE REGEX CONFIG CONTRACT (what the implementer must honor) ──────────────
// The dictionary is declared by the SAME config-owned path P52/P59/P77/P78 read
// ([editor].snippet_dictionary). B3 extends the mode-tagged B-DESIGN-0 schema
// with a per-entry `regex: true` flag (LuaSnip regTrig / UltiSnips `r`). This
// spec provisions, for THIS run, a hermetic copy of the committed fixture
// tests/proof/fixtures/snippets/p79-regex-trigger-snippets.json — ONE regex
// entry whose body references a capture group:
//
//   { "snippets": [
//       { "trigger": "([a-z])bar", "mode": "both", "regex": true, "body": "\\bar{$1}" }
//     ] }
//
// and points [editor].snippet_dictionary at that copy (scripts/provision-proof.sh,
// the p79 case). The capture group `([a-z])` matches the single letter before
// `bar`; the body `\bar{$1}` references that captured letter — so typing `pbar`
// must yield `\bar{p}`, a thing only a capture-substituting regex engine produces.
//
// ── THE OBSERVABLE CONTRACT (hooks + observables, BLIND to implementation) ────
//
//   appendAtEnd(text) [P53, reused] — append `text` at the buffer END through the
//     real docChanged pipeline; the cursor lands at the END of the appended text.
//     Used to place the cursor in a clean zone before the regex trigger fires.
//
//   typeRegexTrigger(text) [P79, NEW] — feed `text` into the editor through the
//     SAME docChanged pipeline user typing fires, so the regex-trigger input
//     handler observes the keystrokes and matches its pattern against the text
//     before the cursor — and, UNLIKE typeInEditor, does NOT call startCompletion,
//     because a regex/postfix trigger fires WITHOUT a popup. The capture
//     substitution is owned by that path; the residual body REUSES the shared
//     `runSnippet` expansion. This is the driving hook the spec uses so the regex
//     path actually fires.
//
//   completionLabels() [P52, reused] — the labels in the live CM6 autocomplete
//     tooltip. Used here to PROVE NO POPUP opened (the regex trigger fires in
//     place, not through the popup-accept path).
//
//   getEditorText() [reused] — the live editor buffer text, to observe that the
//     literal matched trigger is GONE and the capture-substituted body is in its
//     place.
//
// ── WHAT EACH ASSERTION KILLS ────────────────────────────────────────────────
//   (1) After typing `pbar ` (the regex-matching token + a space terminator) via
//       the no-popup driving hook, the capture-substituted body `\bar{p}` is in
//       the buffer.
//       KILLS: the NO-OP (no expansion happened); the LITERAL-TRIGGER engine (it
//       looks for the literal string `([a-z])bar`, never matches `pbar`, so
//       nothing expands); the CAPTURE-BLIND engine (it would produce `\bar{$1}`,
//       not `\bar{p}`).
//   (2) The LITERAL matched trigger token `pbar` is GONE — the buffer does not
//       contain the literal `pbar`.
//       KILLS: a no-op / literal-trigger engine that leaves `pbar` inert.
//   (3) The literal capture reference `\bar{$1}` is NOT in the buffer (the capture
//       was substituted, not inserted verbatim).
//       KILLS: a CAPTURE-BLIND engine that matches the regex but inserts the body
//       with `$1` unresolved.
//   (4) NO completion popup is open after the regex trigger (completionLabels()
//       does not contain the matched token).
//       KILLS: a popup-only engine masquerading as a regex/postfix trigger.
//
// Together: the regex pattern matches the text before the cursor, the captured
// letter is substituted into the body (1)+(3), the literal matched trigger is
// gone (2), and the expansion fires with no popup (4) — the full P79 regex/postfix
// capture obligation.

// The single letter the capture group `([a-z])` will match, and the matched
// trigger token it precedes (`p` + `bar` = `pbar`). A space terminator follows,
// postfix-style, so the matched token before the cursor is the bare `pbar`.
const MATCHED_TRIGGER = 'pbar';
// The capture-substituted body the regex engine must produce: the captured `p`
// in place of the body's `$1` reference.
const EXPANDED_BODY = '\\bar{p}';
// The capture-BLIND body — the literal `$1` left unresolved. A capture-blind
// engine produces this; a correct engine never does.
const CAPTURE_BLIND_BODY = '\\bar{$1}';

// A clean zone whose END places the cursor right after a space, so the typed
// regex token (`pbar`) is the bare text-before-cursor the regex matcher keys on.
const ZONE = '\n\nRegex zone here: ';

test('Typing a regex trigger substitutes its capture group into the body and expands in place with no popup; the matched trigger text is gone and the capture is the real matched letter, not a literal $1', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // Neither the expanded body nor the capture-blind body is present to start.
  const initial = await editorText(tauriPage);
  expect(initial).not.toContain(EXPANDED_BODY);
  expect(initial).not.toContain(CAPTURE_BLIND_BODY);
  expect(initial).not.toContain(MATCHED_TRIGGER);

  // Place the cursor in a clean zone after a space.
  await appendAtEnd(tauriPage, ZONE);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(ZONE.trimEnd())})`,
    10_000,
  );

  // ── (1)+(2)+(3)+(4) Regex trigger `pbar ` substitutes the capture, no popup ──
  // Type the regex-matching token followed by its space terminator through the
  // no-popup driving hook. RED: __PPE_E2E__.typeRegexTrigger does not exist (there
  // is no regex-trigger path), so this throws here — the faithful no-op state.
  await typeRegexTrigger(tauriPage, MATCHED_TRIGGER + ' ');
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(EXPANDED_BODY)})`,
    10_000,
  );
  const after = await editorText(tauriPage);
  // (1) the capture-substituted body expanded:
  expect(after).toContain(EXPANDED_BODY);
  // (2) the literal matched trigger token is gone (no `pbar` left inert):
  expect(after).not.toContain(MATCHED_TRIGGER);
  // (3) the capture was SUBSTITUTED, not inserted verbatim (no literal `$1`):
  expect(after).not.toContain(CAPTURE_BLIND_BODY);
  // (4) no popup surfaced the trigger — the regex/postfix trigger fired in place:
  const popup = await completionLabels(tauriPage);
  expect(popup).not.toContain(MATCHED_TRIGGER);

  recordObservation({ spec: manifest.spec, name: 'p79-expanded-body', value: EXPANDED_BODY });
  recordObservation({ spec: manifest.spec, name: 'p79-matched-trigger', value: MATCHED_TRIGGER });
});
