import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  appendAtEnd,
  typeInEditor,
  acceptCompletion,
  typeIntoSnippetField,
  insertSnippetByTrigger,
  seedSelection,
  completionLabels,
  editorText,
} from './support/app';

// ── P83 — Transform node + visual-selection wrap (Phase-B B7) ────────────────
//
// THE OBLIGATION (phase-b-snippet-engine.md, proposed P83, exact intent):
//   (a) An entry with a TRANSFORM MIRROR (`${1/regex/replace/flags}`) derives the
//       dependent slot from the source slot — typing into the source produces the
//       TRANSFORMED text in the dependent position (label from title; case
//       transform).
//   (b) With a REAL selection active, expanding a `${VISUAL}` entry WRAPS exactly
//       the selected text in the expansion (select `foo`, trigger → `\emph{foo}`).
//
//   Admissible because it FAILS on:
//     - a TRANSFORM-BLIND engine (the dependent slot shows the UNTRANSFORMED
//       source text, or the LITERAL `${1/.../.../}`). This is the CURRENT state:
//       normalizeTabstops (snippets.ts) rewrites only bare `$<digits>` → `${N}`,
//       so the mirror transform `${1/(.*)/\U$1/}` survives untouched and reaches
//       CM6's snippetCompletion, whose vendored TextMate parser does NOT implement
//       the mirror transform — the dependent occurrence renders as a plain
//       (untransformed) mirror or as the literal transform token.
//     - a WRAP that DISCARDS the selection (the expansion appears but the selected
//       text is GONE or not wrapped). This is the CURRENT state: runSnippet applies
//       the body at the bare cursor (`apply(view, completion, pos, pos)` — the
//       selection range is ignored), and `${VISUAL}` is not a recognised token, so
//       the selected text is dropped, not wrapped.
//     - a NO-OP (no surface to establish a selection / drive the field; the driver
//       throws — the faithful RED state).
//
// ── THE CONTRACT (standard TextMate/UltiSnips body grammar — HARD RULE #0) ───
// B7 adopts the established formats verbatim, never bespoke tokens: the transform
// mirror `${N/regex/replace/flags}` (standard TextMate/VSCode/UltiSnips
// mirror-transform) and `${VISUAL}` (UltiSnips' selection placeholder). The
// jonschlinkert/tabstops JS library implements exactly this TextMate body grammar
// (tabstops/placeholders/variables/transforms) and is the PORT/LEVERAGE candidate
// if CM6's built-in snippet parser does not cover transforms. Both resolve in the
// SHARED runSnippet expansion path P52/P59/P77/P78/P79/P80/P82 reuse — visual-wrap
// reuses CM6's existing selection state in runSnippet (the selection range the
// expansion replaces). This spec is BLIND to how either is implemented; it only
// observes the user-facing buffer effect.
//
// The dictionary is declared by the SAME config-owned path P52/P59 read
// ([editor].snippet_dictionary); provision-proof.sh (the p83 case) provisions a
// hermetic copy of the committed fixture
// tests/proof/fixtures/snippets/p83-transform-visual-snippets.json — two entries:
//   { "trigger": "sec", "mode": "both",
//     "body": "## ${1:title}\n\n\\label{sec:${1/(.*)/\\U$1/}}\n\n$0" }
//   { "trigger": "emph", "mode": "both",
//     "body": "\\emph{${VISUAL}}" }
// and points [editor].snippet_dictionary at that copy.
//
// ── THE OBSERVABLE CONTRACT (hooks + observables, BLIND to implementation) ────
//
//   typeInEditor(text) [P51/P52, reused] — insert at the cursor through the REAL
//     docChanged pipeline AND open completion, so typing the trigger surfaces the
//     popup offering it.
//   acceptCompletion() [P52, reused] — run CM6's REAL acceptCompletion command,
//     expanding the body and entering snippet-field mode with the FIRST `${1}`
//     tabstop as the live, selected field.
//   typeIntoSnippetField(text) [P80, reused] — type into the ACTIVE snippet field
//     through the SAME docChanged pipeline real typing fires, WITHOUT startCompletion,
//     so the typed text lands in the source slot and any mirror/transform updates live.
//   insertSnippetByTrigger(trigger) [P59, reused] — expand the named entry's BODY
//     at the cursor through the SHARED insertSnippet → runSnippet path. The
//     deterministic, popup-free expansion used for the visual-wrap entry.
//   seedSelection(text) [P83, NEW] — establish a REAL non-empty selection over the
//     first occurrence of `text` in the buffer (the SAME selection state a user's
//     drag/shift-select produces), so the subsequent `${VISUAL}` expansion has a
//     selection to wrap.
//   appendAtEnd(text) / getEditorText() [reused] — place the cursor / read the buffer.
//
// ── WHAT EACH ASSERTION KILLS ────────────────────────────────────────────────
//   PART A (transform):
//   (A1) After typing the trigger `sec`, the tooltip offers an option labeled `sec`.
//        KILLS the NO-OP / ignored-dict.
//   (A2) After accepting, the buffer holds the expanded source marker `## ` and the
//        dependent fence `\label{sec:`, and NOT the literal trigger `sec` left inert.
//        KILLS the literal-trigger insert.
//   (A3) Immediately after expansion, before typing the field, the dependent slot
//        carries no transformed text yet (baseline for A4).
//   (A4) After typing the LOWERCASE source name into the first `${1}` slot, the
//        dependent `\label{sec:...}` slot shows the UPPERCASE transform of that name
//        (`## intro` → `\label{sec:INTRO}`), with no second keystroke there.
//        KILLS the TRANSFORM-BLIND engine (the dependent slot shows the untransformed
//        lowercase mirror `\label{sec:intro}`) — the decisive transform kill.
//   (A5) No literal transform token (`${1/`) survives in the buffer.
//        KILLS the engine that pastes the transform verbatim.
//
//   PART B (visual wrap):
//   (B1) After expanding the `${VISUAL}` entry with `foo` selected, the buffer holds
//        `\emph{foo}` — the selected text WRAPPED by the body.
//        KILLS the wrap that DISCARDS the selection (the body appears but `foo` is
//        gone / unwrapped) and the no-op.
//   (B2) No literal `${VISUAL}` token survives in the buffer.
//        KILLS the engine that pastes `${VISUAL}` verbatim.

// ── PART A constants — the transform entry ──────────────────────────────────
const SEC_TRIGGER = 'sec';
const SOURCE_MARKER = '## ';
const LABEL_FENCE = '\\label{sec:';
// The LOWERCASE name typed into the FIRST `${1}` (the `## ...` source) slot.
const SECTION_NAME = 'intro';
// The UPPERCASE transform a real transform engine derives into the dependent slot.
const TRANSFORMED_LABEL = '\\label{sec:INTRO}';
// The UNTRANSFORMED lowercase mirror a transform-blind engine leaves instead.
const UNTRANSFORMED_LABEL = '\\label{sec:intro}';
// The literal transform token a verbatim-paste engine would leave behind.
const LITERAL_TRANSFORM = '${1/';

// ── PART B constants — the visual-wrap entry ────────────────────────────────
const EMPH_TRIGGER = 'emph';
// An unusual selection witness no incidental buffer text would carry, so its
// presence WRAPPED proves the REAL selected text (not a placeholder) was wrapped.
const SELECTION = 'PPE-VISUAL-Theta-8821';
const WRAPPED = `\\emph{${SELECTION}}`;
const LITERAL_VISUAL = '${VISUAL}';

// Clean zones whose END places the cursor at a fresh position.
const ZONE_A = '\n\nTransform zone here: ';
const ZONE_B = '\n\nVisual zone here: ';

test('A transform-mirror entry derives the dependent slot from the source slot, and a ${VISUAL} entry wraps a real selection', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // None of the witnesses is present to start.
  const initial = await editorText(tauriPage);
  expect(initial).not.toContain(LABEL_FENCE);
  expect(initial).not.toContain(TRANSFORMED_LABEL);
  expect(initial).not.toContain(WRAPPED);

  // ── PART A — TRANSFORM MIRROR ───────────────────────────────────────────────
  await appendAtEnd(tauriPage, ZONE_A);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(ZONE_A.trimEnd())})`,
    10_000,
  );

  // (A1) Type the trigger; the tooltip offers `sec`.
  await typeInEditor(tauriPage, SEC_TRIGGER);
  await tauriPage.waitForFunction(
    `!!document.querySelector('.cm-tooltip-autocomplete')`,
    10_000,
  );
  const labels = await completionLabels(tauriPage);
  expect(labels).toContain(SEC_TRIGGER);

  // (A2) Accept: the body expands and CM6 enters snippet-field mode with the first
  // `${1}` (the `## ...` source) slot as the live, selected field.
  await acceptCompletion(tauriPage);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(LABEL_FENCE)})`,
    10_000,
  );
  const afterExpand = await editorText(tauriPage);
  expect(afterExpand).toContain(SOURCE_MARKER);
  expect(afterExpand).toContain(LABEL_FENCE);
  // The literal trigger is gone (the body holds no `sec` outside the label fence;
  // the dependent fence `\label{sec:` carries `sec:`, not the inert trigger).
  expect(afterExpand).not.toContain(`${SEC_TRIGGER}\n`);

  // (A3) Before typing the source slot, the dependent slot carries no transformed
  // text yet — the baseline proving A4's text arrived via the live transform.
  expect(afterExpand).not.toContain(TRANSFORMED_LABEL);

  // (A4)+(A5) Type the LOWERCASE source name into the first `${1}` slot. A real
  // transform engine derives the UPPERCASE text into the dependent `\label{sec:...}`
  // slot, live, with no keystroke there.
  // RED today: seedSelection/typeIntoSnippetField aside, the transform token
  // `${1/(.*)/\U$1/}` survives normalizeTabstops untouched and CM6's snippet parser
  // does not implement it — the dependent slot shows the untransformed lowercase
  // mirror (or the literal transform token), so this wait never satisfies.
  await typeIntoSnippetField(tauriPage, SECTION_NAME);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(TRANSFORMED_LABEL)})`,
    10_000,
  );
  const afterField = await editorText(tauriPage);

  // (A4) The dependent slot shows the UPPERCASE transform, and NOT the untransformed
  // lowercase mirror — the decisive transform kill:
  expect(afterField).toContain(TRANSFORMED_LABEL);
  expect(afterField).not.toContain(UNTRANSFORMED_LABEL);
  // (A5) No literal transform token survives:
  expect(afterField).not.toContain(LITERAL_TRANSFORM);

  // ── PART B — VISUAL-SELECTION WRAP ──────────────────────────────────────────
  // Append the witness text, establish a REAL selection over it, then expand the
  // `${VISUAL}` entry through the shared runSnippet path; the selected text must be
  // WRAPPED by the body, not discarded.
  await appendAtEnd(tauriPage, ZONE_B + SELECTION);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(SELECTION)})`,
    10_000,
  );

  // RED today: __PPE_E2E__.seedSelection does not exist (no `${VISUAL}` support, no
  // need to seed a selection), so this throws — the faithful no-visual-wrap state.
  await seedSelection(tauriPage, SELECTION);
  await insertSnippetByTrigger(tauriPage, EMPH_TRIGGER);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(WRAPPED)})`,
    10_000,
  );
  const afterWrap = await editorText(tauriPage);

  // (B1) The selected text is WRAPPED by the body — `\emph{<selection>}`:
  expect(afterWrap).toContain(WRAPPED);
  // (B2) No literal `${VISUAL}` token survives:
  expect(afterWrap).not.toContain(LITERAL_VISUAL);

  recordObservation({ spec: manifest.spec, name: 'p83-transformed-label', value: TRANSFORMED_LABEL });
  recordObservation({ spec: manifest.spec, name: 'p83-visual-wrap', value: WRAPPED });
});
