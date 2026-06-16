import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  registerTestCompletionSource,
  typeInEditor,
  completionLabels,
} from './support/app';

// ── P51 — Composable editor completion ──────────────────────────────────────
//
// THE OBLIGATION (proof-obligations.md, exact wording):
//   The editor's autocomplete hosts MULTIPLE completion sources that COMPOSE —
//   registering a new app completion source does not displace the completions
//   that were already there. Register a new app completion source bound to a
//   trigger, then drive the editor: typing that trigger opens the standard
//   autocomplete tooltip and the newly-registered source's option appears in
//   it, AND the pre-existing LaTeX completions still work in the same buffer —
//   typing a backslash command (e.g. \alpha) offers the LaTeX completion.
//   Admissible because it fails on a wiring that lets one source monopolize or
//   suppress the others, and on a wiring that drops the LaTeX completions
//   outright when a new source is added.
//
// ── WHY THE APP IS RED TODAY (the implementation fact this proof pins) ───────
// The editor installs autocompletion ONCE, in the vendored LaTeX language
// support (vendor/codemirror-lang-latex/src/latex-language.ts:335):
//
//     autocompletion({ override: [latexCompletionSource(...)], ... })
//
// In CM6, `override` REPLACES the entire source list: when present, NO other
// completion source — neither a `languageData.autocomplete` source nor a source
// from a second `autocompletion()` call — is ever consulted. The LaTeX source
// is therefore a MONOPOLY. There is also no app surface to register an
// additional source. So the very thing P51 requires (composition of a new app
// source WITH the LaTeX source) cannot happen with the current wiring.
//
// ── THE OBSERVABLE CONTRACT (the hooks + observable the implementer must give)
//
// To drive composition deterministically — and BLIND to how it is implemented —
// the implementer must provide a stable in-harness surface. The chosen surface
// (a SENTINEL registration hook) directly exercises the registration path P51
// names, with a label/trigger the test fully controls, so the observable is
// unambiguous:
//
//   __PPE_E2E__.registerTestCompletionSource()
//       Registers a SENTINEL app completion source that COMPOSES with the LaTeX
//       source. It is bound to the unique trigger token `@@ppe` and, when that
//       token is at the cursor, offers exactly ONE option whose label is the
//       unique string `__PPE_SENTINEL__`. "Composes" is the load-bearing word:
//       the source must be ADDED to the editor's set of completion sources, NOT
//       installed as an `override` (which would itself become a new monopoly).
//       Fire-and-forget; returns null.
//
//   __PPE_E2E__.typeInEditor(text)
//       Inserts `text` at the cursor through the REAL editor update pipeline
//       (the same docChanged path user typing fires — the path the completion
//       machinery observes) and then explicitly opens completion (CM6
//       startCompletion). This is the deterministic stand-in for synthetic key
//       events, which the bridge cannot send into CodeMirror's contentEditable.
//       Fire-and-forget; returns null.
//
//   OBSERVABLE: the REAL rendered CM6 autocomplete popup,
//   `.cm-tooltip-autocomplete`, whose options are `.cm-completionLabel`
//   elements. An option is "offered" iff its label text appears in the open
//   tooltip. completionLabels() reads exactly that DOM.
//
// ── WHAT EACH ASSERTION KILLS ────────────────────────────────────────────────
//   (1) Sentinel option present after registering + typing `@@ppe`
//       KILLS the override-monopoly: while latex installs
//       `override: [latexCompletionSource]`, no second source can EVER surface,
//       so a newly-registered app source is suppressed and `__PPE_SENTINEL__`
//       never appears in the tooltip. (Today this assertion is unreachable —
//       the registration hook does not exist — so the spec throws first; once
//       the hook exists but is wired as another override or as a non-composing
//       source, THIS assertion is the one that catches the monopoly.)
//   (2) `\alpha` still offered after typing `\al` in the SAME buffer
//       KILLS a wiring that "adds the new source" by DROPPING the LaTeX source
//       (e.g. swapping the latex override out, or replacing it with a combined
//       override that forgets the latex options). If composition were done by
//       clobbering the LaTeX source, the sentinel would appear but `\alpha`
//       would vanish — this assertion fails in that world and passes only when
//       BOTH sources coexist.
//
// Together the two assertions pin BIDIRECTIONAL composition: the new source
// surfaces AND the LaTeX source survives, in one buffer, at the same time.

const SENTINEL_TRIGGER = '@@ppe';
const SENTINEL_LABEL = '__PPE_SENTINEL__';

test('A registered app completion source composes with the LaTeX source (both surface)', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // Register the sentinel app source. RED today: registerTestCompletionSource
  // does not exist on __PPE_E2E__, so this evaluate throws — there is NO surface
  // to add a completion source alongside the LaTeX monopoly.
  await registerTestCompletionSource(tauriPage);

  // (1) The newly-registered source surfaces. Type its unique trigger; the
  // standard autocomplete tooltip opens and offers __PPE_SENTINEL__.
  await typeInEditor(tauriPage, SENTINEL_TRIGGER);
  await tauriPage.waitForFunction(
    `!!document.querySelector('.cm-tooltip-autocomplete')`,
    10_000,
  );
  const sentinelLabels = await completionLabels(tauriPage);
  expect(sentinelLabels).toContain(SENTINEL_LABEL);

  // (2) The pre-existing LaTeX source SURVIVES in the same buffer. Type a
  // backslash command fragment; \alpha (a LaTeX command completion) is still
  // offered — proving the new source did not displace LaTeX.
  await typeInEditor(tauriPage, '\\al');
  await tauriPage.waitForFunction(
    `!!document.querySelector('.cm-tooltip-autocomplete')`,
    10_000,
  );
  const latexLabels = await completionLabels(tauriPage);
  expect(latexLabels).toContain('\\alpha');

  recordObservation({ spec: manifest.spec, name: 'completion-sources-compose', value: 2 });
});
