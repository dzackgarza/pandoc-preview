import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  appendAtEnd,
  typeInEditor,
  acceptCompletion,
  typeIntoSnippetField,
  editorText,
} from './support/app';

// ── P81 — Native quicktex two-map source consumed DIRECTLY ──────────────────
//
// THE OBLIGATION (phase-b-snippet-engine.md, proposed P81 / B5, exact intent):
//   The editor loads the user's REAL two-map quicktex source
//   (g:quicktex_prose + g:quicktex_math, vimscript dict literals) DIRECTLY — no
//   bespoke flattened intermediate. A short trigger present in BOTH maps offers
//   its PROSE body in prose and its MATH body in math (the prose/math mode-split
//   survived interop — the 281→262 flattening loss is gone). A discriminating
//   multi-tabstop entry (one that carried `<+++>` + `<++>` in the source) expands
//   with its ordered tabstops intact (the secondary `<++>` a real `${N}` slot,
//   not deleted).
//
//   Admissible because it FAILS on:
//     - a FLATTENING loader (the mode-split is gone — the SAME body appears in
//       both zones; e.g. the shipped flat quicktex.json lets the math definition
//       win the `st` collision, so `\st` would expand in prose too);
//     - a loader that DROPS one source map (the trigger is offered in only one
//       zone, or its prose/math body never appears);
//     - a LOSSY tabstop mapping (the multi-tabstop `frac` entry expands with its
//       secondary `<++>` slot DELETED — `body.replace("<++>", "")` is exactly what
//       the bespoke converter did — so the denominator group is gone);
//     - the CURRENT state: the loader (snippets.ts::parseSnippetDictionary) is a
//       JSON parser; JSON.parse on the vimscript source throws → hard toast → NO
//       snippet source registers → `st`/`frac` are offered in NEITHER zone. There
//       is no native-vim loader; the only consumption path is the flat json.
//
// ── THE NATIVE-SOURCE CONFIG CONTRACT (what the implementer must honor) ──────
// The dictionary is declared by the SAME config-owned path P52/P59/P77 read
// ([editor].snippet_dictionary), but it now points at the user's REAL quicktex
// SOURCE — a vimscript file declaring two global dicts, NOT a flattened JSON.
// This spec provisions, for THIS run, a BYTE-IDENTICAL copy of the user's real
// dict (tests/proof/fixtures/snippets/p81-quicktex-dict.vim, a verbatim copy of
// dzackgarza/dotfiles .config-sync/nvim/after/ftplugin/pandoc/quicktex_dict.vim)
// and points [editor].snippet_dictionary at that copy (scripts/provision-proof.sh,
// the p81 case). The relevant entries in that REAL source:
//
//   g:quicktex_prose = { … \'st' : 'such that ', … }
//   g:quicktex_math  = { … \'st' : '\st ', … \'frac' : '\frac{<+++>}{<++>} <++>', … }
//
// The SAME short trigger `st` carries a PROSE body (`such that`) in g:quicktex_prose
// and a DIFFERENT MATH body (`\st`) in g:quicktex_math — the mode-split the
// flattening destroyed. `frac` is a MATH entry whose body carries a `<+++>` primary
// jump-point AND `<++>` secondaries — the multi-tabstop entry the converter's
// `<++>` deletion mangled.
//
// The loader must read BOTH maps directly (mode = which map an entry came from),
// fail loud on an unparseable source (no silent flatten), and map quicktex jump
// markers to the standard TextMate tabstop syntax the CM6 snippet engine consumes
// (`<+++>` → primary landing `$0`; each `<++>` → an ordered `${N}` slot,
// PRESERVED, not deleted). This spec is BLIND to that loader and only observes the
// user-facing effect.
//
// ── THE OBSERVABLE CONTRACT (hooks + observables, BLIND to implementation) ────
//
//   appendAtEnd(text) [P53/P77, reused] — append `text` at the buffer END through
//     the real editor update pipeline; the cursor lands at the END of the appended
//     text. Used to place the cursor in a PROSE zone (a plain paragraph) or in a
//     MATH zone (a paragraph that OPENS inline math with `$ `, so the text before
//     the cursor has an unclosed `$` — the math-zone state isInMathMode detects).
//
//   typeInEditor(text) [P51/P52/P77, reused] — insert `text` at the cursor through
//     the real docChanged pipeline and explicitly open completion. The token before
//     the cursor is the typed trigger.
//
//   acceptCompletion() [P52/P77, reused] — accept the highlighted option through
//     CM6's real acceptCompletion command (the Enter path).
//
//   typeIntoSnippetField(text) [P80, reused] — type `text` into the ACTIVE CM6
//     snippet field (the first `${N}` tabstop selected after expansion) through the
//     real docChanged pipeline, WITHOUT opening completion. Used to fill the `frac`
//     numerator and observe the body's structure around it.
//
//   getEditorText() [reused] — the live editor buffer text, to observe which BODY
//     the expansion inserted and that the multi-tabstop structure survived.
//
// ── WHAT EACH ASSERTION KILLS ────────────────────────────────────────────────
//   (1) In PROSE, typing the both-maps trigger `st` and accepting inserts the
//       PROSE body (`such that`) and NOT the MATH body (`\st`).
//       KILLS: a flattening loader that kept only the math definition (`\st` would
//       expand in prose); the current JSON-only loader (the .vim throws → no source
//       → `st` offered in neither zone → never surfaces → this fails).
//   (2) In MATH, typing the SAME `st` and accepting inserts the MATH body (`\st`)
//       and NOT a SECOND prose body.
//       KILLS: a flattening loader that kept only the prose definition; a single-map
//       loader; any engine where the same body expands in both zones (the prose and
//       math bodies differ byte-for-byte, so a single-body engine cannot satisfy
//       both (1) and (2)).
//   (3) The multi-tabstop `frac` entry, expanded in MATH, yields a `\frac` with TWO
//       argument groups — after typing a unique token into the FIRST slot the buffer
//       holds `\frac{TOKEN}{` (numerator filled AND the denominator group opened).
//       KILLS: a lossy loader that DELETED the `<++>` secondaries (the converter's
//       `body.replace("<++>", "")`) — it would yield `\frac{TOKEN}` with NO second
//       brace group, so `\frac{TOKEN}{` never appears.
//   (4) The expanded `frac` body carries no surviving quicktex jump markers
//       (`<+++>`/`<++>`) and no literal LaTeX-less `\frac` placeholder — the markers
//       were translated to real tabstops, not pasted verbatim.
//       KILLS: a loader that copies the source body verbatim (the `<+++>`/`<++>`
//       markers survive as literal text instead of becoming tabstops).
//
// Together: the SAME trigger resolves to DIFFERENT bodies by zone (1)+(2) — the
// prose/math mode-split survived interop — and a multi-tabstop entry keeps its
// ordered slots (3) with its jump markers translated, not pasted or deleted (4):
// the full P81 native-interop obligation.

// The both-maps trigger (present in g:quicktex_prose AND g:quicktex_math).
const SHARED = 'st';
const PROSE_BODY = 'such that';
const MATH_BODY = '\\st';
// The multi-tabstop math entry: \frac{<+++>}{<++>} <++>.
const FRAC = 'frac';
// A unique token typed into the frac's FIRST tabstop slot, so the numerator is
// identifiable and the denominator group's opening `{` is observable right after.
const NUM_TOKEN = 'PPEnumerator';
const FRAC_WITH_DENOM = `\\frac{${NUM_TOKEN}}{`;
// Quicktex source jump markers that must NOT survive verbatim in the expansion.
const PRIMARY_MARKER = '<+++>';
const SECONDARY_MARKER = '<++>';

// A prose paragraph whose END places the cursor in PROSE (no unclosed `$`).
const PROSE_PREFIX = '\n\nProse zone here: ';
// A paragraph that OPENS inline math (unclosed `$` before the cursor) — the
// math-zone state isInMathMode reads. The space after `$` keeps the trigger token
// (matchBefore(/\S+/)) separate from the `$`.
const MATH_PREFIX = '\n\nMath zone here: $ ';

test('The editor loads the user real two-map quicktex source directly: the same trigger expands its prose body in prose and its math body in math, and a multi-tabstop entry keeps its ordered slots', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // None of the bodies, nor the frac structure, is present in the demo buffer.
  const initial = await editorText(tauriPage);
  expect(initial).not.toContain(PROSE_BODY);
  expect(initial).not.toContain(MATH_BODY);
  expect(initial).not.toContain(FRAC_WITH_DENOM);

  // ── (1) SHARED trigger in PROSE expands the PROSE body ───────────────────
  await appendAtEnd(tauriPage, PROSE_PREFIX);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(PROSE_PREFIX.trimEnd())})`,
    10_000,
  );
  await typeInEditor(tauriPage, SHARED);
  // RED: the native-vim source is JSON.parsed → throws → no snippet source loads,
  // so `st` is offered in NEITHER zone and this tooltip wait times out.
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
  // The PROSE body expanded; the MATH body did NOT (no flattening-collision bleed).
  expect(afterProse).toContain(PROSE_BODY);
  expect(afterProse).not.toContain(MATH_BODY);

  // ── (2) SAME trigger in MATH expands the MATH body ───────────────────────
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
  // The MATH body expanded in the math zone. The math zone must NOT have produced a
  // SECOND prose body: the prose `such that` count stays exactly one (the step-(1)
  // expansion), proving the math zone expanded the math body, not the prose body.
  expect(afterMath).toContain(MATH_BODY);
  const proseBodyCount = afterMath.split(PROSE_BODY).length - 1;
  expect(proseBodyCount).toBe(1);

  // ── (3)+(4) Multi-tabstop `frac` keeps its ordered slots ─────────────────
  // `frac` is a g:quicktex_math entry, so surface it in a MATH zone. Its source body
  // `\frac{<+++>}{<++>} <++>` must expand to a `\frac` with a primary slot and a
  // PRESERVED secondary denominator slot (the `<++>` translated to a real `${N}`,
  // not deleted), with the jump markers gone (translated, not pasted verbatim).
  await appendAtEnd(tauriPage, MATH_PREFIX);
  await typeInEditor(tauriPage, FRAC);
  await tauriPage.waitForFunction(
    `(() => {
      const tip = document.querySelector('.cm-tooltip-autocomplete');
      if (!tip) return false;
      return Array.from(tip.querySelectorAll('.cm-completionLabel'))
        .some((el) => el.textContent === ${JSON.stringify(FRAC)});
    })()`,
    10_000,
  );
  await acceptCompletion(tauriPage);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes('\\\\frac{')`,
    10_000,
  );
  // Type a unique token into the FIRST (active) tabstop slot — the numerator.
  await typeIntoSnippetField(tauriPage, NUM_TOKEN);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(FRAC_WITH_DENOM)})`,
    10_000,
  );
  const afterFrac = await editorText(tauriPage);
  // (3) The numerator holds the typed token AND the denominator group is opened
  // right after — the secondary `<++>` slot SURVIVED as a real second argument
  // group. A loader that deleted `<++>` would yield `\frac{PPEnumerator}` with NO
  // second brace group, so this substring would never appear.
  expect(afterFrac).toContain(FRAC_WITH_DENOM);
  // (4) The quicktex jump markers were TRANSLATED to tabstops, not pasted verbatim.
  expect(afterFrac).not.toContain(PRIMARY_MARKER);
  expect(afterFrac).not.toContain(SECONDARY_MARKER);

  recordObservation({ spec: manifest.spec, name: 'p81-prose-body-count', value: proseBodyCount });
  recordObservation({ spec: manifest.spec, name: 'p81-frac-denominator', value: FRAC_WITH_DENOM });
});
