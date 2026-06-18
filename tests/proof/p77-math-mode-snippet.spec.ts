import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  appendAtEnd,
  typeInEditor,
  acceptCompletion,
  completionLabels,
  editorText,
} from './support/app';

// ── P77 — Math-mode-only snippet expansion (THE KEYSTONE) ───────────────────
//
// THE OBLIGATION (phase-b-snippet-engine.md, proposed P77, exact intent):
//   Config declares a snippet dictionary with the SAME trigger mapped to a PROSE
//   body and a MATH body (entries are MODE-TAGGED). With the cursor in PROSE,
//   typing the trigger and accepting expands the PROSE body. With the cursor
//   inside `$…$` (a math zone), typing the SAME trigger and accepting expands the
//   MATH body; the prose body never appears in math and vice versa. A MATH-ONLY
//   trigger is NOT offered at all in prose.
//
//   Admissible because it FAILS on:
//     - a MODE-BLIND engine (the same body expands in both zones, or a math-only
//       trigger fires in prose);
//     - an engine that DROPS one mode entirely (the trigger is offered in NEITHER
//       zone);
//     - a SCHEMA that cannot carry per-entry mode (the mode-tagged dictionary is
//       rejected at parse time → hard toast → no snippet source registers → the
//       trigger is offered in neither zone). This is the current state: the P52
//       dictionary parser (snippets.ts::parseSnippetDictionary) is a FLAT
//       Record<trigger,string>; an object-/list-valued mode-tagged entry is a
//       non-string body and is rejected, so no source loads.
//
// ── THE MODE-TAGGED CONFIG CONTRACT (what the implementer must honor) ────────
// The dictionary is declared by the SAME config-owned path P52/P59 read
// ([editor].snippet_dictionary), but its entries are MODE-TAGGED — the flat
// trigger→string shape of P52 CANNOT carry a per-entry prose|math|both mode, so
// B-DESIGN-0 replaces it with an object-valued schema (breaking change, fail loud
// on the old shape — fine, pre-launch). This spec provisions, for THIS run, a
// hermetic copy of the committed fixture
// tests/proof/fixtures/snippets/p77-math-mode-snippets.json — a mode-tagged
// dictionary whose entries are:
//
//   { "snippets": [
//       { "trigger": "st",   "mode": "prose", "body": "::: {.PPE-PROSE-STRUCTURE}\n$0\n:::" },
//       { "trigger": "st",   "mode": "math",  "body": "\\PPEmathstar{$0}" },
//       { "trigger": "mcal", "mode": "math",  "body": "\\mathcal{$0}" }
//     ] }
//
// and points [editor].snippet_dictionary at that copy (scripts/provision-proof.sh,
// the p77 case). The SAME short trigger `st` carries a PROSE body and a MATH body
// — a thing the flat dict literally cannot express — and `mcal` is a MATH-ONLY
// trigger.
//
// The math/prose predicate the gate MUST reuse already exists in the vendored
// fork (vendor/codemirror-lang-latex/src/completion.ts::isInMathMode, the same
// detector the LaTeX command completion gates on) — B1 EXPORTS and reuses it
// (OSOT); this spec is BLIND to that and only observes the user-facing effect.
//
// ── THE OBSERVABLE CONTRACT (hooks + observables, BLIND to implementation) ────
//
//   appendAtEnd(text) [P53, reused] — append `text` at the buffer END through the
//     real editor update pipeline; the cursor lands at the END of the appended
//     text. Used to place the cursor in a PROSE zone (append a plain paragraph)
//     or in a MATH zone (append a paragraph that OPENS inline math with `$ `, so
//     the text before the cursor has an unclosed `$` — exactly the math-zone state
//     isInMathMode detects).
//
//   typeInEditor(text) [P51/P52, reused] — insert `text` at the cursor through the
//     real docChanged pipeline and explicitly open completion (CM6
//     startCompletion). The token before the cursor is the typed trigger; the
//     deterministic stand-in for synthetic key events.
//
//   completionLabels() [P52, reused] — the labels in the live rendered CM6
//     autocomplete tooltip (`.cm-tooltip-autocomplete` → `.cm-completionLabel`).
//     The user-visible "what is offered" observable.
//
//   acceptCompletion() [P52, reused] — accept the highlighted option through CM6's
//     real acceptCompletion command (the Enter path).
//
//   getEditorText() [reused] — the live editor buffer text, to observe which BODY
//     the expansion inserted.
//
// ── WHAT EACH ASSERTION KILLS ────────────────────────────────────────────────
//   (1) In PROSE, typing `st` offers `st`, and accepting inserts the PROSE body
//       (`::: {.PPE-PROSE-STRUCTURE}`) and NOT the MATH body (`\PPEmathstar`).
//       KILLS: a mode-blind engine that would expand the math body (or both) in
//       prose; a schema that cannot carry mode (the entry is rejected → `st` is
//       offered in NEITHER zone → this assertion fails because the trigger never
//       surfaces). It passes only when the prose-mode `st` is the one that fires
//       in prose.
//   (2) In MATH (cursor after an unclosed `$ `), typing the SAME `st` offers `st`,
//       and accepting inserts the MATH body (`\PPEmathstar`) and NOT the PROSE
//       body (`::: {.PPE-PROSE-STRUCTURE}`).
//       KILLS: a mode-blind engine (it would insert the prose body, or the same
//       body as zone (1)); an engine that drops the math mode (the trigger is not
//       offered in math). The MATH body differs byte-for-byte from the PROSE body,
//       so a single-body engine cannot satisfy both (1) and (2).
//   (3) The math-only trigger `mcal`, typed in PROSE, is NOT offered in the
//       tooltip; typed in MATH, it IS offered.
//       KILLS: a mode-blind engine (a math-only trigger firing in prose); an
//       engine that drops the math mode (`mcal` offered in neither). It passes
//       only when the math-zone gate suppresses `mcal` in prose and admits it in
//       math.
//
// Together: the SAME trigger resolves to DIFFERENT bodies by zone (1)+(2), the
// prose body never appears in math and vice versa (the cross-checks in 1/2), and
// a math-only trigger is gated out of prose (3) — the full P77 keystone.

const SHARED = 'st';
const MATH_ONLY = 'mcal';
const PROSE_BODY = '::: {.PPE-PROSE-STRUCTURE}';
const MATH_BODY = '\\PPEmathstar';
const MATH_ONLY_BODY = '\\mathcal';

// A prose paragraph whose END places the cursor in PROSE (no unclosed `$`).
const PROSE_PREFIX = '\n\nProse zone here: ';
// A paragraph that OPENS inline math, so the cursor at its END sits inside `$…$`
// (an unclosed `$` precedes the cursor) — the math-zone state isInMathMode reads.
// The space after `$` keeps the trigger token (matchBefore(/\S+/)) separate from
// the `$`, so the typed trigger is the bare token the dictionary keys on.
const MATH_PREFIX = '\n\nMath zone here: $ ';

test('The SAME snippet trigger expands its prose body in prose and its math body in math; a math-only trigger is gated out of prose', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // Neither body, nor the math-only macro, is present in the demo buffer to start.
  const initial = await editorText(tauriPage);
  expect(initial).not.toContain(PROSE_BODY);
  expect(initial).not.toContain(MATH_BODY);
  expect(initial).not.toContain(MATH_ONLY_BODY);

  // ── (3a) MATH-ONLY trigger is NOT offered in PROSE ───────────────────────
  // Place the cursor in a prose zone, type the math-only trigger, and read the
  // tooltip. A math-mode-gated engine must NOT offer `mcal` here.
  await appendAtEnd(tauriPage, PROSE_PREFIX);
  await typeInEditor(tauriPage, MATH_ONLY);
  // Give completion a chance to surface, then read whatever is offered. We do NOT
  // wait for the tooltip to be non-empty: the point is that this math-only
  // trigger produces NO offer in prose. Other prose/both sources may still open a
  // tooltip; this assertion only requires `mcal` to be absent from it.
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(PROSE_PREFIX.trimEnd())})`,
    10_000,
  );
  const proseMathOnlyLabels = await completionLabels(tauriPage);
  expect(proseMathOnlyLabels).not.toContain(MATH_ONLY);

  // ── (1) SHARED trigger in PROSE expands the PROSE body ───────────────────
  // Append a fresh prose zone (the previous typed `mcal` stays in the buffer as
  // inert prose), place the cursor there, type the shared trigger, and accept.
  await appendAtEnd(tauriPage, PROSE_PREFIX);
  await typeInEditor(tauriPage, SHARED);
  // The shared trigger MUST be offered in prose (the prose-mode entry). RED: the
  // mode-tagged dict is rejected by the flat parser, so no snippet source loads
  // and `st` is offered in NEITHER zone — this never surfaces.
  await tauriPage.waitForFunction(
    `(() => {
      const tip = document.querySelector('.cm-tooltip-autocomplete');
      if (!tip) return false;
      return Array.from(tip.querySelectorAll('.cm-completionLabel'))
        .some((el) => el.textContent === ${JSON.stringify(SHARED)});
    })()`,
    10_000,
  );
  await acceptCompletion(tauriPage);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(PROSE_BODY)})`,
    10_000,
  );
  const afterProse = await editorText(tauriPage);
  // The PROSE body expanded; the MATH body did NOT (no cross-mode bleed).
  expect(afterProse).toContain(PROSE_BODY);
  expect(afterProse).not.toContain(MATH_BODY);

  // ── (2) SAME trigger in MATH expands the MATH body ───────────────────────
  // Append a zone that opens inline math, place the cursor inside it, type the
  // SAME shared trigger, and accept. The MATH-mode entry must win here.
  await appendAtEnd(tauriPage, MATH_PREFIX);
  await typeInEditor(tauriPage, SHARED);
  await tauriPage.waitForFunction(
    `(() => {
      const tip = document.querySelector('.cm-tooltip-autocomplete');
      if (!tip) return false;
      return Array.from(tip.querySelectorAll('.cm-completionLabel'))
        .some((el) => el.textContent === ${JSON.stringify(SHARED)});
    })()`,
    10_000,
  );
  await acceptCompletion(tauriPage);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(MATH_BODY)})`,
    10_000,
  );
  const afterMath = await editorText(tauriPage);
  // The MATH body expanded in the math zone. The PROSE expansion from step (1)
  // still stands earlier in the buffer, but the math zone must NOT have produced
  // a SECOND prose body: count the prose bodies and require exactly one (the
  // step-(1) expansion), proving the math zone expanded the math body, not the
  // prose body again.
  expect(afterMath).toContain(MATH_BODY);
  const proseBodyCount = afterMath.split(PROSE_BODY).length - 1;
  expect(proseBodyCount).toBe(1);

  // ── (3b) MATH-ONLY trigger IS offered in MATH ────────────────────────────
  // Append another math zone, type the math-only trigger; it MUST be offered now
  // (the gate admits it in math), proving the gate did not simply DROP the
  // math-only entry (offered-in-neither would be a mode-dropping engine, equally
  // forbidden).
  await appendAtEnd(tauriPage, MATH_PREFIX);
  await typeInEditor(tauriPage, MATH_ONLY);
  await tauriPage.waitForFunction(
    `(() => {
      const tip = document.querySelector('.cm-tooltip-autocomplete');
      if (!tip) return false;
      return Array.from(tip.querySelectorAll('.cm-completionLabel'))
        .some((el) => el.textContent === ${JSON.stringify(MATH_ONLY)});
    })()`,
    10_000,
  );
  const mathMathOnlyLabels = await completionLabels(tauriPage);
  expect(mathMathOnlyLabels).toContain(MATH_ONLY);

  recordObservation({ spec: manifest.spec, name: 'p77-prose-body-count', value: proseBodyCount });
  recordObservation({ spec: manifest.spec, name: 'p77-math-only-gated-in-prose', value: 'true' });
});
