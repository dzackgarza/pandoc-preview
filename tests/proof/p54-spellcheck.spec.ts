import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, editorText } from './support/app';

// ── P54 — Spellcheck marks misspelled words, honoring a custom math dictionary ─
//
// THE OBLIGATION (proof-obligations.md, exact wording):
//   The editor marks misspelled words as spelling errors while respecting a
//   user-owned custom math dictionary, so that mathematical terms are not
//   flagged. Type a clearly-misspelled token (random gibberish): it is visibly
//   marked as a spelling error. Type an ordinary correctly-spelled English word:
//   it is NOT marked. Type a mathematical term that ordinary English spellcheck
//   would flag but which is present in the user's custom math dictionary: it is
//   NOT marked, proving the custom dictionary is in effect. Admissible because it
//   fails when there is no spellcheck (nothing is marked, so the gibberish token
//   is not flagged), on a checker that marks everything (the correctly-spelled
//   English word and the dictionary math term are both wrongly flagged), on a
//   checker that marks nothing (the gibberish token is never flagged), and on a
//   checker WITHOUT the custom math dictionary (the math term is wrongly marked
//   even though the dictionary lists it).
//
// ── THE MARK CONTRACT (what the implementer must wire — BLIND to how) ─────────
// A misspelled word is marked by wrapping it in a CodeMirror 6 decoration span
// carrying the STABLE contract class `cm-spellError`. This class is the spec's
// contract: the implementer is free to choose any spellcheck engine, any
// dictionary backend, and any decoration mechanism, but a word the checker
// considers misspelled MUST render in the live editor DOM inside an element of
// class `cm-spellError`, and a word the checker considers correct MUST NOT. The
// observable is the REAL rendered editor DOM (`.cm-editor .cm-content`), read by
// walking from the token's text node up its ancestor chain and asking whether any
// ancestor element carries the `cm-spellError` class. This is the user-visible
// payoff — an actual mark on screen — not a parse-tree or internal-state proxy.
//
// ── THE CUSTOM-MATH-DICTIONARY CONTRACT (config-owned, not hardcoded) ─────────
// The custom math dictionary is declared by a CONFIG-OWNED path, NOT a hardcoded
// list (the same discipline P52's snippet dictionary uses). The config surface
// the implementer must read:
//
//   [editor]
//   spell_dictionary = "<absolute path to a plain wordlist, one word per line>"
//
// This spec OWNS its fixture dictionary
// tests/proof/fixtures/dictionaries/p54-mathdict.txt — a real math wordlist whose
// first entry is `cohomology` (a distinctive algebraic-geometry term verified to
// be present, exactly once, in the user's real vim math wordlist
// dotfiles/dictionaries/mathdict.utf-8.add, and which standard English spellcheck
// flags). The implementer's provisioning must, for THIS spec only, copy that
// fixture into the hermetic home and point `[editor].spell_dictionary` at the
// copy (mirroring the p52 snippet_dictionary case in scripts/provision-proof.sh).
// Because the term comes from a config-declared dictionary, a checker that runs
// without that dictionary would wrongly flag `cohomology` — which the math-term
// assertion below catches.
//
// ── THE DISCRIMINATING TOKENS (three, on one freshly-typed line) ─────────────
//   GIBBERISH = "zzxqwbgg"   — clearly misspelled in every English dictionary;
//                              no dictionary (English or math) contains it. MUST
//                              be marked.
//   CORRECT   = "theorem"    — an ordinary correctly-spelled English word that
//                              standard spellcheck accepts. MUST NOT be marked.
//   MATHTERM  = "cohomology" — a mathematical term standard English spellcheck
//                              flags, but which IS in the config-owned custom math
//                              dictionary. MUST NOT be marked (proving the custom
//                              dictionary is loaded and consulted).
// None of these three tokens occurs in the witness demo.md, so the line typed
// below is the sole source of each token in the buffer — the DOM lookups are
// unambiguous.
//
// ── WHAT EACH ASSERTION KILLS ────────────────────────────────────────────────
//   (1) GIBBERISH is covered by a `cm-spellError` span.
//       KILLS the NO-SPELLCHECK app (today's state: there is no spellcheck
//       extension, no `cm-spellError` class is ever emitted, so the gibberish is a
//       bare text node at the base color) AND the MARK-NOTHING checker (a checker
//       wired but inert never flags the gibberish). It can pass only when a real
//       checker marks a genuinely-misspelled word.
//   (2) CORRECT ("theorem") is NOT covered by a `cm-spellError` span.
//       KILLS the MARK-EVERYTHING checker: a checker that blankets every word in
//       `cm-spellError` (or one whose dictionary is empty/unloaded so even common
//       English words miss) wrongly marks `theorem` and fails here. Passes only
//       when marking is SELECTIVE.
//   (3) MATHTERM ("cohomology") is NOT covered by a `cm-spellError` span.
//       KILLS the MISSING-CUSTOM-MATH-DICTIONARY checker: a correct English
//       spellchecker with NO custom math dictionary flags `cohomology` (English
//       does not contain it) and marks it, failing here. Passes only when the
//       config-owned math dictionary is loaded and `cohomology` is therefore
//       accepted — which is exactly the property the obligation demands.
//
// Together the three assertions pin the full obligation: a real checker marks the
// gibberish (not no-op, not nothing), leaves an ordinary correct word alone (not
// mark-everything), and leaves the dictionary math term alone (custom math
// dictionary in effect).
//
// RED TODAY: EditorPane.svelte installs no spellcheck extension and emits no
// `cm-spellError` class; there is no [editor].spell_dictionary config surface and
// no custom math dictionary is loaded. So assertion (1) fails on the real
// observable — the gibberish token is a bare unmarked text node and no
// `cm-spellError` element exists anywhere in the editor DOM.

const GIBBERISH = 'zzxqwbgg';
const CORRECT = 'theorem';
const MATHTERM = 'cohomology';

// The stable contract class the implementer must put on the misspelling
// decoration span. ONE source of truth for this spec's mark contract.
const SPELL_ERROR_CLASS = 'cm-spellError';

// True iff the FIRST occurrence of `needle` in the rendered editor content is
// covered by an element carrying SPELL_ERROR_CLASS — read by walking up the
// ancestor chain of the token's text node. Reads the REAL CM6 DOM. Returns
// `false` (never throws on a missing class) so the assertions can distinguish
// "marked" from "not marked"; throws only if the token text is absent from the
// rendered content (a provisioning/typing failure, not a spellcheck verdict).
async function isMarkedMisspelled(
  page: { evaluate(expr: string): Promise<unknown> },
  needle: string,
): Promise<boolean> {
  const raw = await page.evaluate(`(() => {
    const content = document.querySelector('.cm-editor .cm-content');
    if (!content) return JSON.stringify({ found: false });
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const i = node.nodeValue.indexOf(${JSON.stringify(needle)});
      if (i >= 0) {
        let el = node.parentElement;
        let marked = false;
        while (el && el !== content) {
          if (el.classList && el.classList.contains(${JSON.stringify(SPELL_ERROR_CLASS)})) {
            marked = true;
            break;
          }
          el = el.parentElement;
        }
        return JSON.stringify({ found: true, marked });
      }
    }
    return JSON.stringify({ found: false });
  })()`);
  if (typeof raw !== 'string') {
    throw new Error(`isMarkedMisspelled returned non-string: ${JSON.stringify(raw)}`);
  }
  const parsed = JSON.parse(raw) as { found: boolean; marked?: boolean };
  if (!parsed.found) {
    throw new Error(`isMarkedMisspelled: token not found in cm-content: ${needle}`);
  }
  return parsed.marked === true;
}

test('Spellcheck marks misspelled words while honoring a custom math dictionary', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // Type the three discriminating tokens on a fresh line at the buffer end,
  // through the REAL editor update pipeline (the docChanged path user typing
  // fires). appendAtEnd does not open the completion tooltip, so the words sit in
  // the buffer for the spellchecker to inspect.
  const LINE = `${GIBBERISH} ${CORRECT} ${MATHTERM}`;
  await appendAtEnd(tauriPage, '\n\n' + LINE);

  // Sanity: all three tokens are really in the buffer (proves the assertions
  // below measure rendered marks on text that exists, not absent text).
  const buffer = await editorText(tauriPage);
  expect(buffer).toContain(GIBBERISH);
  expect(buffer).toContain(CORRECT);
  expect(buffer).toContain(MATHTERM);

  // Wait until the gibberish token is rendered as a `cm-spellError` mark in the
  // live editor DOM — the user-visible spellcheck verdict. RED today: no
  // spellcheck extension is installed, so this class never appears and the wait
  // times out — faithful evidence there is no spellcheck mark surface at all.
  await tauriPage.waitForFunction(
    `(() => {
      const content = document.querySelector('.cm-editor .cm-content');
      if (!content) return false;
      const marks = content.querySelectorAll('.${SPELL_ERROR_CLASS}');
      return Array.from(marks).some((m) => (m.textContent ?? '').includes(${JSON.stringify(GIBBERISH)}));
    })()`,
    15_000,
  );

  // (1) The gibberish token IS marked as a spelling error.
  expect(await isMarkedMisspelled(tauriPage, GIBBERISH)).toBe(true);

  // (2) The ordinary correct English word is NOT marked.
  expect(await isMarkedMisspelled(tauriPage, CORRECT)).toBe(false);

  // (3) The custom-dictionary math term is NOT marked (custom math dict loaded).
  expect(await isMarkedMisspelled(tauriPage, MATHTERM)).toBe(false);

  recordObservation({ spec: manifest.spec, name: 'spell-gibberish-marked', value: GIBBERISH });
  recordObservation({ spec: manifest.spec, name: 'spell-mathterm-allowed', value: MATHTERM });
});
