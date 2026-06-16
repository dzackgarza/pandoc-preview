import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { parseTomlFile } from './support/toml';
import { readFileSync } from 'node:fs';
import { openAndSelectDemo, editorText, cursorOffset } from './support/app';

// ── P59 — Snippet dropdown on the insertion bar ─────────────────────────────
//
// THE OBLIGATION (proof-obligations.md, exact wording):
//   The insertion bar surfaces the config-declared snippet dictionary's triggers
//   in a dropdown; choosing a trigger from that dropdown inserts the snippet's
//   expanded BODY (not its literal trigger string) at the cursor, with the cursor
//   landing at the snippet's declared tabstop. The dropdown's contents come from
//   the config-declared snippet dictionary, so pointing config at a different
//   dictionary makes the bar's dropdown surface that dictionary's triggers.
//   Admissible because it fails on an empty or hardcoded dropdown that ignores
//   the config dictionary (the dictionary's triggers never appear as dropdown
//   entries), on literal-trigger insertion (choosing the entry leaves the trigger
//   string in the buffer rather than the expanded body, and the cursor is not at
//   the tabstop), and on an ignored dictionary (config points at a dictionary
//   whose triggers are never surfaced in the dropdown). This is distinct from
//   P52, which proves the autocomplete-popup path (typing a trigger in the buffer
//   opens the completion tooltip); P59 proves the BAR-dropdown path (selecting a
//   trigger from the insertion bar's dropdown).
//
// ── THE CONFIG-OWNED CONTRACT (what the implementer must honor) ──────────────
// The bar's dropdown is populated from the SAME config-owned snippet dictionary
// P52 reads — [editor].snippet_dictionary, a JSON object mapping trigger → body
// (CM6 `$0`-tabstop syntax). This run provisions the committed fixture
// tests/proof/fixtures/snippets/p52-snippets.json:
//
//   { "mthm": "::: {.theorem}\n$0\n:::" }
//
// and points [editor].snippet_dictionary at a hermetic copy of it
// (scripts/provision-proof.sh, the shared p52/p59 case). The spec does NOT
// hardcode the trigger set: it reads [editor].snippet_dictionary back out of the
// app-written config.toml on disk, loads THAT dictionary file, and asserts the
// bar's surfaced triggers equal that file's keys. So a different dict file would
// make the bar surface a different trigger set — the config-owned property the
// obligation names — and a hardcoded list that ignored the config would fail.
//
// The map P52 parses (parseSnippetDictionary → SnippetMap) is, today, discarded
// after the completion source is built (EditorPane.svelte registerSnippetDictionary
// pushes snippetCompletionSource(map) and throws `map` away). To surface those
// triggers on the bar, the implementer must RETAIN that parsed map and expose it,
// reusing EditorPane.insertSnippet (→ runSnippet → snippetCompletion) for the
// insertion — the SAME path the amsthm/tikz/matrix bar controls use.
//
// ── THE OBSERVABLE CONTRACT (hooks + observables, BLIND to implementation) ────
// Per the milestone-G discipline (P55–P58 drive bar controls through harness
// hooks, not flaky webview button clicks), the implementer must expose:
//
//   __PPE_E2E__.snippetTriggers()  [NEW for P59]
//     Returns the array of trigger strings the bar's snippet dropdown surfaces,
//     sourced from the RETAINED parsed config dictionary (the same SnippetMap
//     P52's completion source is built from). Synchronous; an array of strings.
//
//   __PPE_E2E__.insertSnippetByTrigger(trigger: string)  [NEW for P59]
//     Inserts, at the cursor, the expanded BODY of the dictionary entry named by
//     `trigger`, routing through the editor's EXISTING insertSnippet surface
//     (EditorPane.insertSnippet → runSnippet → snippetCompletion). The body's `$0`
//     tabstop is honoured exactly as on a completion accept, so the cursor lands
//     in the snippet body. Fire-and-forget; returns null. This is the bar
//     dropdown's choose-a-trigger action, click-free.
//
//   __PPE_E2E__.getEditorText()  [reused]  — the live editor buffer text.
//   __PPE_E2E__.cursorOffset()   [reused]  — the cursor's character offset.
//
// The bar MAY also render a real DOM dropdown (e.g. a <select> / menu listing the
// triggers); the hooks are the stable, click-free surface this spec asserts
// against, the same choice P55–P58 made for the other bar controls.
//
// ── WHAT EACH ASSERTION KILLS ────────────────────────────────────────────────
//   (A) The bar's surfaced triggers (snippetTriggers()) equal EXACTLY the keys of
//       the config-declared dictionary file — read independently from the
//       app-written config.toml on disk, not hardcoded in the spec.
//       KILLS the EMPTY/HARDCODED dropdown and the IGNORED dict: an empty dropdown
//       surfaces no triggers (the set is []), a hardcoded dropdown surfaces a set
//       that does not track the config dict (so it would not equal the fixture's
//       keys for a different dict), and an ignored dict never reads the
//       config-owned path at all. Passes only when the surfaced set is exactly the
//       config dictionary's keys. (RED today: __PPE_E2E__.snippetTriggers does not
//       exist — the parsed SnippetMap is discarded after building the completion
//       source — so this evaluate throws; there is no bar dropdown surface.)
//   (B) After insertSnippetByTrigger('mthm'), the buffer GAINS the snippet BODY
//       (`::: {.theorem}` and a closing `:::`) and does NOT contain the literal
//       trigger token `mthm`.
//       KILLS the LITERAL-TRIGGER insert: a control that inserts the trigger
//       string (or a no-op) never adds the expansion — `::: {.theorem}` is absent
//       and `mthm` would survive. Passes only when choosing the trigger expands
//       its declared body.
//   (C) The cursor lands at the declared tabstop (`$0`) — strictly INSIDE the
//       expansion, after the opening fence line and before the closing fence.
//       KILLS a "dumb paste" that ignores the snippet tabstop (inserting the body
//       verbatim incl. a literal `$0`, or dropping the cursor at the body end):
//       the cursor offset must sit between `::: {.theorem}\n` and the closing
//       `:::`.
//
// Together: the bar surfaces exactly the config dictionary's triggers (A),
// choosing one expands its BODY not the trigger (B), and the cursor honors the
// declared tabstop (C).

const TRIGGER = 'mthm';
const BODY_OPEN = '::: {.theorem}';
const BODY_CLOSE = ':::';

test('The insertion bar surfaces the config dictionary triggers and choosing one expands its body at the tabstop', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // The triggers the bar must surface are the keys of the dictionary the
  // app-written config.toml points at — read independently of the app, so a
  // hardcoded or ignored dropdown cannot pass. parseTomlFile parses the config
  // in an independent process (python tomllib); the snippet_dictionary value is
  // the path to the fixture dict provisioned for this run.
  const config = parseTomlFile(manifest.configPath);
  const editor = config.editor as { snippet_dictionary?: unknown } | undefined;
  const dictPath = editor?.snippet_dictionary;
  if (typeof dictPath !== 'string' || dictPath.length === 0) {
    throw new Error('config.editor.snippet_dictionary is missing — the p59 run must point config at the fixture dict');
  }
  const dictKeys = Object.keys(JSON.parse(readFileSync(dictPath, 'utf-8')) as Record<string, unknown>).sort();
  // Sanity: the shared fixture surfaces the mthm trigger this spec drives.
  expect(dictKeys).toContain(TRIGGER);

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // The buffer before the insert, so we can prove the scaffold is NEWLY added
  // (the demo fixture has no `::: {.theorem}` fence and no `mthm` token).
  const before = await editorText(tauriPage);
  expect(before).not.toContain(BODY_OPEN);
  expect(before).not.toContain(TRIGGER);

  // (A) The bar surfaces EXACTLY the config dictionary's triggers. RED today:
  // __PPE_E2E__.snippetTriggers does not exist (the parsed SnippetMap is
  // discarded after building the completion source), so this evaluate throws —
  // there is no bar snippet-dropdown surface at all.
  const surfacedRaw = await tauriPage.evaluate(
    `JSON.stringify(window.__PPE_E2E__.snippetTriggers())`,
  );
  if (typeof surfacedRaw !== 'string') {
    throw new Error(`snippetTriggers returned non-string: ${JSON.stringify(surfacedRaw)}`);
  }
  const surfaced = (JSON.parse(surfacedRaw) as string[]).slice().sort();
  expect(surfaced).toEqual(dictKeys);

  // Choose the `mthm` trigger from the bar dropdown (click-free hook). RED today:
  // __PPE_E2E__.insertSnippetByTrigger does not exist, so this evaluate throws.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.insertSnippetByTrigger(${JSON.stringify(TRIGGER)}); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(BODY_OPEN)})`,
    10_000,
  );

  const after = await editorText(tauriPage);

  // (B) The snippet BODY is now in the buffer; the literal trigger is NOT. The
  // fenced-div body itself contains no `mthm`, so any surviving `mthm` would be
  // the un-expanded literal trigger.
  expect(after).toContain(BODY_OPEN);
  const openIdx = after.indexOf(BODY_OPEN);
  const closeIdx = after.indexOf(BODY_CLOSE, openIdx + BODY_OPEN.length);
  expect(closeIdx).toBeGreaterThan(openIdx);
  expect(after).not.toContain(TRIGGER);

  // (C) The cursor lands at the declared tabstop ($0): strictly inside the
  // expansion, after the opening fence line (`::: {.theorem}\n`) and before the
  // closing fence — not at the body end and not at the trigger start.
  const tabstop = openIdx + (BODY_OPEN + '\n').length;
  const cursor = await cursorOffset(tauriPage);
  expect(cursor).toBeGreaterThanOrEqual(tabstop);
  expect(cursor).toBeLessThan(closeIdx);

  recordObservation({ spec: manifest.spec, name: 'bar-snippet-triggers', value: surfaced.join(',') });
  recordObservation({ spec: manifest.spec, name: 'bar-snippet-cursor-offset', value: cursor });
});
