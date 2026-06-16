import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  typeInEditor,
  acceptCompletion,
  completionLabels,
  editorText,
  cursorOffset,
} from './support/app';

// ── P52 — User-defined snippet dictionary expands ───────────────────────────
//
// THE OBLIGATION (proof-obligations.md, exact wording):
//   A user-defined snippet dictionary, declared by a config-owned path (not a
//   hardcoded list), surfaces as editor completions: typing a snippet's trigger
//   opens the standard autocomplete tooltip offering a completion labeled by
//   that trigger; accepting it expands the snippet BODY at the cursor — the
//   inserted text is the snippet's expansion, not the literal trigger string,
//   and the cursor lands at the snippet's declared tabstop. The dictionary path
//   comes from config, so pointing config at a dictionary file makes those
//   snippets the ones offered. Admissible because it fails on a no-op source
//   (the trigger is typed but never offered in the tooltip), a source that
//   inserts the literal trigger text instead of the snippet body (accepting the
//   completion leaves the trigger in the buffer rather than the expansion, and
//   the cursor is not at the tabstop), and a dictionary that is ignored (config
//   points at a dictionary whose triggers are typed but none of its snippets are
//   ever offered).
//
// ── THE CONFIG-OWNED CONTRACT (what the implementer must honor) ──────────────
// The dictionary is declared by a CONFIG-OWNED path, NOT a hardcoded list. The
// chosen config surface (the key the implementer must read):
//
//   [editor]
//   snippet_dictionary = "<absolute path to a JSON snippet dict>"
//
// The dict file is a JSON object mapping TRIGGER -> SNIPPET BODY, where the body
// uses CM6 snippet syntax (`$0` marks the final tabstop). This spec provisions,
// for THIS run, a hermetic copy of the committed fixture
// tests/proof/fixtures/snippets/p52-snippets.json:
//
//   { "mthm": "::: {.theorem}\n$0\n:::" }
//
// and points [editor].snippet_dictionary at that copy
// (scripts/provision-proof.sh, the p52 case). The spec does NOT depend on the
// real quicktex dict — it owns its fixture, so a different dict file would offer
// different snippets, which is exactly the config-owned property the obligation
// names.
//
// ── THE OBSERVABLE CONTRACT (hooks + observables, BLIND to implementation) ────
//
//   __PPE_E2E__.typeInEditor(text) [P51, reused] — inserts `text` at the cursor
//     through the REAL editor update pipeline (the docChanged path the completion
//     machinery observes) and explicitly opens completion (CM6 startCompletion).
//     The deterministic stand-in for synthetic key events.
//
//   __PPE_E2E__.acceptCompletion() [NEW for P52] — runs CM6's REAL
//     acceptCompletion command against the live view (the SAME path the Enter
//     keybinding fires) to accept the currently-highlighted option. The bridge
//     cannot synthesize Enter into CodeMirror's contentEditable, so this is the
//     in-harness accept surface. Fire-and-forget; returns null.
//
//   __PPE_E2E__.getEditorText() [reused] — the live editor buffer text.
//   __PPE_E2E__.cursorOffset() [NEW for P52] — the cursor's character offset in
//     that buffer, used to prove the tabstop landing.
//
//   OBSERVABLE for the offer: the REAL rendered CM6 autocomplete popup,
//   `.cm-tooltip-autocomplete` -> `.cm-completionLabel` (completionLabels reads
//   exactly that DOM). OBSERVABLE for the expansion: getEditorText() +
//   cursorOffset() after acceptCompletion().
//
// ── WHAT EACH ASSERTION KILLS ────────────────────────────────────────────────
//   (1) Tooltip offers an option labeled `mthm` after typing the trigger.
//       KILLS the NO-OP source and the IGNORED dict: if no snippet source is
//       wired (or the config-owned path is never read / the dict never parsed
//       into a completion source), typing the trigger opens no relevant option
//       and `mthm` never appears in the tooltip. (Today this assertion is
//       unreachable: there is no [editor].snippet_dictionary config field, so
//       the provisioned config fails the strict schema and the app never boots —
//       the run fails before the editor is drivable, which is itself faithful
//       evidence that the config-owned snippet surface does not exist.)
//   (2) After accepting, the buffer contains the snippet BODY (`::: {.theorem}`
//       and the closing `:::`) and NOT the literal trigger token `mthm`.
//       KILLS the LITERAL-TRIGGER insert: a source that inserts the trigger
//       string (or a label-only completion that leaves `mthm` in the buffer)
//       fails here — the expansion `::: {.theorem} ... :::` is absent and `mthm`
//       survives. It passes only when accepting expands the declared body.
//   (3) The cursor lands at the declared tabstop (`$0`) — strictly INSIDE the
//       expansion, on the blank line between the fences, not at the end of the
//       inserted body and not at the trigger start.
//       KILLS a "dumb paste" that ignores the snippet tabstop syntax (inserting
//       the body verbatim incl. a literal `$0`, or dropping the cursor at the
//       body end): the cursor offset must sit at the position the `$0` marker
//       denoted, between `::: {.theorem}\n` and `\n:::`.
//
// Together the three assertions pin the full obligation: a config-declared dict
// surfaces its trigger, accepting expands the BODY (not the trigger), and the
// cursor honors the declared tabstop.

const TRIGGER = 'mthm';
const BODY_OPEN = '::: {.theorem}';
const BODY_CLOSE = ':::';

test('A config-declared snippet dictionary offers its trigger and expands the body at the tabstop', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // The buffer before the expansion, so we can prove the trigger is GONE after
  // accept (it must not survive as literal text).
  const before = await editorText(tauriPage);
  expect(before).not.toContain(BODY_OPEN);

  // (1) Type the fixture trigger; the standard autocomplete tooltip opens and
  // offers a completion labeled `mthm`. RED today: there is no config-owned
  // snippet source, so this never surfaces (and in fact the app does not boot
  // with the snippet_dictionary config key, so the run fails before here).
  await typeInEditor(tauriPage, TRIGGER);
  await tauriPage.waitForFunction(
    `!!document.querySelector('.cm-tooltip-autocomplete')`,
    10_000,
  );
  const labels = await completionLabels(tauriPage);
  expect(labels).toContain(TRIGGER);

  // Accept the highlighted option through CM6's real acceptCompletion command.
  await acceptCompletion(tauriPage);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(BODY_OPEN)})`,
    10_000,
  );

  const after = await editorText(tauriPage);

  // (2) The snippet BODY is now in the buffer; the literal trigger is NOT.
  expect(after).toContain(BODY_OPEN);
  expect(after).toContain(BODY_CLOSE);
  // The trigger must be gone: the fenced-div body itself contains no `mthm`, so
  // any surviving `mthm` is the un-expanded literal trigger.
  expect(after).not.toContain(TRIGGER);

  // (3) The cursor lands at the declared tabstop ($0): strictly inside the
  // expansion, after the opening fence line and before the closing fence. The
  // tabstop position is the index just past "::: {.theorem}\n" within the
  // inserted body — between the fences, not at the body end.
  const openIdx = after.indexOf(BODY_OPEN);
  const tabstop = openIdx + (BODY_OPEN + '\n').length;
  const closeIdx = after.indexOf(BODY_CLOSE, tabstop);
  const cursor = await cursorOffset(tauriPage);
  expect(cursor).toBeGreaterThanOrEqual(tabstop);
  expect(cursor).toBeLessThan(closeIdx);

  recordObservation({ spec: manifest.spec, name: 'snippet-trigger-offered', value: TRIGGER });
  recordObservation({ spec: manifest.spec, name: 'snippet-cursor-offset', value: cursor });
});
