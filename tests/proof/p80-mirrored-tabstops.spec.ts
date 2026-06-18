import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  appendAtEnd,
  typeInEditor,
  acceptCompletion,
  typeIntoSnippetField,
  completionLabels,
  editorText,
} from './support/app';

// ── P80 — Mirrored tabstops (Phase-B B4) ─────────────────────────────────────
//
// THE OBLIGATION (phase-b-snippet-engine.md, proposed P80, exact intent):
//   Config declares an entry whose body REPEATS a tabstop number in TWO
//   positions (e.g. an environment whose name is mirrored into its closing
//   fence / `\end`). Expanding the entry and typing the environment name into
//   the FIRST slot makes the SAME text appear at the MIRRORED position LIVE,
//   without a second keystroke there.
//
//   This item OWNS no mirror engine. CM6's own `@codemirror/autocomplete`
//   `snippetCompletion` ALREADY mirrors repeated `${N}` tabstops natively (the
//   established TextMate mirror behaviour). B4 PROVES that vendored behaviour and
//   ensures the authoring/schema path EMITS repeated tabstop numbers for the
//   env-name -> `\end` case (the converter that previously DROPPED `<++>`
//   secondary tabstops is the data loss P80 catches).
//
//   Admissible because it FAILS on:
//     - a SINGLE-TABSTOP engine (the second position stays EMPTY or holds the
//       literal `${N}` / `$N` because the body never emitted a second tabstop):
//       assertion (4) fails — the typed name never reaches the `\end`, and (5)
//       fails — a literal `${1}`/`$1` survives in the closing fence;
//     - a NO-MIRROR engine (typing into the first slot does NOT update the
//       second — the two `${1}` are independent fields, not mirrors): the FIRST
//       slot shows the name but the SECOND does not — assertion (4) fails;
//     - a NO-OP (there is no surface to type into the active field at all): the
//       very FIRST typeIntoSnippetField throws (no __PPE_E2E__.typeIntoSnippetField
//       surface) — the faithful RED state. (And the prior converter dropped
//       `<++>` secondary tabstops, so the shipped dict carries no mirrored
//       entry — single-tabstop by construction.)
//
// ── THE MIRRORED-ENTRY CONFIG CONTRACT (what the implementer must honor) ─────
// The dictionary is declared by the SAME config-owned path P52/P59/P77/P78/P79
// read ([editor].snippet_dictionary). B4 needs no schema flag — it relies on the
// body carrying a REPEATED tabstop number. This spec provisions, for THIS run, a
// hermetic copy of the committed fixture
// tests/proof/fixtures/snippets/p80-mirrored-tabstops-snippets.json — ONE entry
// whose body repeats the `$1` tabstop in two positions:
//
//   { "snippets": [
//       { "trigger": "env", "mode": "both",
//         "body": "\\begin{$1}\n$0\n\\end{$1}" }
//     ] }
//
// and points [editor].snippet_dictionary at that copy (scripts/provision-proof.sh,
// the p80 case). The dictionary authoring convention writes bare `$N`; the
// snippets module's `normalizeTabstops` converts each bare `$1` to the `${1}`
// brace form CM6's snippet parser mirrors — so the env name typed into the first
// `${1}` (the `\begin{...}` slot) mirrors LIVE into the second `${1}` (the
// `\end{...}` slot). The `$0` between the fences is the final tabstop (where the
// cursor would ultimately rest); it is NOT mirrored.
//
// ── THE OBSERVABLE CONTRACT (hooks + observables, BLIND to implementation) ────
//
//   typeInEditor(text) [P51/P52, reused] — insert `text` at the cursor through
//     the REAL docChanged pipeline AND open completion (CM6 startCompletion), so
//     typing the trigger `env` surfaces the popup offering it.
//
//   acceptCompletion() [P52, reused] — run CM6's REAL acceptCompletion command to
//     accept the highlighted option, expanding the body and entering snippet-field
//     mode with the FIRST `${1}` tabstop as the live, selected field.
//
//   typeIntoSnippetField(text) [P80, NEW] — type `text` into the ACTIVE snippet
//     field through the SAME docChanged pipeline real typing fires — and, UNLIKE
//     typeInEditor, does NOT call startCompletion (typing into a snippet field is
//     plain editing; opening a popup would tear down the active field and defeat
//     the mirror). CM6's `snippetCompletion` mirrors the typed text into every
//     other occurrence of the same `${N}` LIVE. This is the driving hook the spec
//     uses so the env name lands in the first slot and the mirror updates.
//
//   completionLabels() [P52, reused] — the labels in the live CM6 autocomplete
//     tooltip, to confirm the trigger is offered and (after typing into the
//     field) that no popup re-surfaced.
//
//   getEditorText() [reused] — the live editor buffer text, to observe the
//     expanded `\begin{...}` / `\end{...}` fences and the mirrored env name in
//     BOTH.
//
// ── WHAT EACH ASSERTION KILLS ────────────────────────────────────────────────
//   (1) After typing the trigger `env`, the tooltip offers an option labeled
//       `env`. KILLS the NO-OP / IGNORED-dict (the config-owned mirrored entry is
//       never surfaced).
//   (2) After accepting, the buffer contains the expanded fences `\begin{` and a
//       matching `\end{` and NOT the literal trigger `env` left inert. KILLS the
//       LITERAL-TRIGGER insert (accepting leaves `env` rather than the body).
//   (3) Immediately after expansion, BEFORE typing the field, the second fence
//       holds NO env name yet (`\end{}` empty, or `\end{${1}}` literal) — the
//       slot is awaiting the mirror. (Baseline for (4): proves the name in (4)
//       arrived via the LIVE mirror, not because the body shipped it.)
//   (4) After typing the env name into the FIRST `${1}` slot via the no-popup
//       field hook, the SAME name appears at BOTH fences: `\begin{theorem}` AND
//       `\end{theorem}`, with NO second keystroke at the `\end`. KILLS the
//       SINGLE-TABSTOP engine (the `\end` slot stays empty/literal) and the
//       NO-MIRROR engine (only the first slot updates).
//   (5) The literal tabstop token (`${1}` or `$1`) is GONE from the buffer — the
//       authoring path emitted a real mirrored tabstop, not a literal `${N}`.
//       KILLS the engine that pastes the body verbatim (a literal `${1}`/`$1`
//       survives in the closing fence rather than mirroring the typed name).
//
// Together: the config-declared mirrored entry is offered (1) and expands (2);
// before typing, the mirror target is empty (3); typing the env name into the
// first slot mirrors it LIVE into the closing fence without a second keystroke
// (4); and no literal tabstop survives (5) — the full P80 mirrored-tabstop
// obligation.

const TRIGGER = 'env';
// The expanded fences (post-normalizeTabstops `${1}` is the mirror target).
const BEGIN_FENCE = '\\begin{';
const END_FENCE = '\\end{';
// The env name typed into the FIRST `${1}` slot; it must mirror into the second.
const ENV_NAME = 'theorem';
const MIRRORED_BEGIN = '\\begin{theorem}';
const MIRRORED_END = '\\end{theorem}';
// The literal tabstop tokens a single-tabstop / verbatim-paste engine would leave
// behind in the closing fence instead of mirroring the typed name.
const LITERAL_TABSTOP_BRACE = '${1}';
const LITERAL_TABSTOP_BARE = '$1';

// A clean zone whose END places the cursor right after a space, so the typed
// trigger token (`env`) is the bare trigger the snippet source keys on.
const ZONE = '\n\nMirror zone here: ';

test('A snippet whose body repeats a tabstop number mirrors the text typed into the first slot into the second slot live, without a second keystroke there', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // Neither the expanded fences nor the mirrored name is present to start.
  const initial = await editorText(tauriPage);
  expect(initial).not.toContain(BEGIN_FENCE);
  expect(initial).not.toContain(MIRRORED_END);

  // Place the cursor in a clean zone after a space.
  await appendAtEnd(tauriPage, ZONE);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(ZONE.trimEnd())})`,
    10_000,
  );

  // (1) Type the trigger; the tooltip offers `env`.
  await typeInEditor(tauriPage, TRIGGER);
  await tauriPage.waitForFunction(
    `!!document.querySelector('.cm-tooltip-autocomplete')`,
    10_000,
  );
  const labels = await completionLabels(tauriPage);
  expect(labels).toContain(TRIGGER);

  // (2) Accept: the mirrored body expands and CM6 enters snippet-field mode with
  // the first `${1}` (the `\begin{...}` slot) as the live, selected field.
  await acceptCompletion(tauriPage);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(BEGIN_FENCE)})`,
    10_000,
  );
  const afterExpand = await editorText(tauriPage);
  expect(afterExpand).toContain(BEGIN_FENCE);
  expect(afterExpand).toContain(END_FENCE);
  // The literal trigger is gone (the body holds no `env`, so any surviving `env`
  // is the un-expanded literal trigger).
  expect(afterExpand).not.toContain(TRIGGER);

  // (3) Before typing the field, the mirror target carries NO env name yet — the
  // closing fence is awaiting the live mirror, not pre-filled by the body.
  expect(afterExpand).not.toContain(MIRRORED_END);

  // ── (4)+(5) Type the env name into the FIRST `${1}` slot; it mirrors LIVE ──
  // RED today: __PPE_E2E__.typeIntoSnippetField does not exist (there is no
  // surface to type into an active snippet field), so this throws here — the
  // faithful no-op state. Even past that, the shipped dict carries no mirrored
  // entry, so the closing fence would never mirror the typed name.
  await typeIntoSnippetField(tauriPage, ENV_NAME);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(MIRRORED_END)})`,
    10_000,
  );
  const afterField = await editorText(tauriPage);

  // (4) The typed name stands at BOTH fences — typed once into the first slot,
  // mirrored LIVE into the closing fence with no second keystroke there:
  expect(afterField).toContain(MIRRORED_BEGIN);
  expect(afterField).toContain(MIRRORED_END);

  // (5) No literal tabstop token survives in the buffer — the authoring path
  // emitted a real mirrored tabstop, not a literal `${N}` pasted verbatim:
  expect(afterField).not.toContain(LITERAL_TABSTOP_BRACE);
  expect(afterField).not.toContain(LITERAL_TABSTOP_BARE);

  // No popup re-surfaced (typing into the field is plain editing, not a query):
  const popup = await completionLabels(tauriPage);
  expect(popup).not.toContain(TRIGGER);

  recordObservation({ spec: manifest.spec, name: 'p80-mirrored-begin', value: MIRRORED_BEGIN });
  recordObservation({ spec: manifest.spec, name: 'p80-mirrored-end', value: MIRRORED_END });
});
