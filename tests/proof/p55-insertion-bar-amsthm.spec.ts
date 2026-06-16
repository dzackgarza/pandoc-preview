import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, editorText, cursorOffset } from './support/app';

// ── P55 — Insertion bar replaces the formatting toolbar; amsthm env insert ──
//
// THE OBLIGATION (proof-obligations.md, exact wording):
//   The editor's top edit bar is a math-research INSERTION bar; the generic
//   H1/bold/italic formatting toolbar is gone. Selecting a named amsthm
//   environment (e.g. `theorem`) from the bar inserts that environment's
//   fenced-div scaffold (`:::{.theorem} … :::`) at the cursor, leaving the
//   cursor at the environment body. Admissible because it fails if the old
//   formatting toolbar is still present or its buttons insert markup like
//   `**bold**` (the bar is still a formatting toolbar, not an insertion bar),
//   on a no-op insert (selecting the environment leaves the buffer unchanged so
//   no scaffold appears at the cursor), and if the wrong environment is
//   inserted (selecting `theorem` inserts a fenced div whose class is not
//   `theorem`).
//
// ── THE OBSERVABLE CONTRACT (hook + observables, BLIND to implementation) ────
// The implementer must expose ONE stable observable for "insert the named
// amsthm environment at the cursor". This spec drives the hook form, NOT a DOM
// button click — webview button clicks into the bar are flaky (the same reason
// p52/p53 drive completion/Emmet through harness hooks rather than synthetic
// key/click events). The contract the implementer must honor:
//
//   __PPE_E2E__.insertEnvironment(env: string)  [NEW for P55]
//     Inserts the named amsthm environment's fenced-div scaffold at the cursor
//     by routing through the editor's EXISTING insertSnippet surface
//     (EditorPane.insertSnippet → runSnippet → snippetCompletion), expanding
//     divFenceSnippet(env) = `:::{.${env}}\n${0}\n:::`. The `$0` tabstop is
//     honoured exactly as on a completion accept, so the cursor lands in the
//     environment BODY between the fences. Fire-and-forget; returns null.
//     `env` MUST be one of pandocDivEnvironments (vendored pandoc-markdown.ts);
//     this spec uses `theorem`.
//
//   __PPE_E2E__.getEditorText()  [reused]  — the live editor buffer text.
//   __PPE_E2E__.cursorOffset()   [reused]  — the cursor's character offset.
//
// The bar control MAY also be a DOM control (e.g. [data-insert-env="theorem"]);
// the hook is the stable, click-free surface this spec asserts against.
//
// ── DISCRIMINATOR: the bar REPLACED the toolbar (old behavior is GONE) ───────
// The old generic formatting toolbar (Toolbar.svelte, driven by App.toolbarAction)
// rendered a Bold button as  <button title="Bold (Ctrl+B)">B</button>  whose
// click inserts `**bold**` markup via wrapSelection("**","**"). The insertion
// bar replaces the toolbar entirely (per Hard Rules: the old thing is gone, not
// gated/wrapped). The observable that the toolbar is gone is the ABSENCE of any
// control carrying that Bold-button behavior: no `button[title="Bold (Ctrl+B)"]`
// (the old toolbar's bold control) exists in the live DOM. This is an admissible
// discriminator: it is the exact control the obligation names ("its buttons
// insert markup like `**bold**`") and it can only be absent if the formatting
// toolbar was genuinely removed, not merely supplemented by a new bar.
//
// ── WHAT EACH ASSERTION KILLS ────────────────────────────────────────────────
//   (A) The old formatting toolbar's Bold control is ABSENT from the live DOM.
//       KILLS "toolbar still present": if the generic H1/bold/italic formatting
//       toolbar were still mounted (the bar merely added alongside it, or never
//       replaced it), `button[title="Bold (Ctrl+B)"]` would still be in the DOM
//       and this fails. It passes only when the formatting toolbar is gone.
//   (B) After insertEnvironment("theorem"), the buffer GAINS `:::{.theorem}` and
//       a closing `:::` that was NOT there before.
//       KILLS the NO-OP insert: a hook (or bar control) that leaves the buffer
//       unchanged never adds the scaffold, so `:::{.theorem}` is absent and this
//       fails. (RED today: __PPE_E2E__.insertEnvironment does not exist, so the
//       evaluate throws — there is no insertion-bar surface to insert an amsthm
//       environment at all.)
//   (C) The inserted fenced div's class is exactly `theorem` (`:::{.theorem}`),
//       NOT some other class.
//       KILLS the WRONG-ENV insert: a hook that ignores its `env` argument and
//       inserts a fixed/different environment (`:::{.lemma}`, `:::{.proof}`, …)
//       fails — `:::{.theorem}` is absent though some other `:::{.<class>}` may
//       be present.
//   (D) The cursor lands strictly INSIDE the scaffold body — after the opening
//       fence line and before the closing fence — i.e. the `$0` tabstop.
//       KILLS a "dumb paste" that ignores the snippet tabstop and drops the
//       cursor at the body end (or before the scaffold): the cursor offset must
//       sit between `:::{.theorem}\n` and the closing `:::`.
//
// Together: the toolbar is gone (A), selecting `theorem` inserts the theorem
// scaffold (B,C), and the cursor lands in the environment body (D).

const ENV = 'theorem';
const OPEN_FENCE = ':::{.theorem}';
const CLOSE_FENCE = ':::';

test('The insertion bar replaced the formatting toolbar and inserts the theorem amsthm environment at the cursor', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // (A) The old formatting toolbar's Bold control is GONE. If the generic
  // formatting toolbar were still mounted, this Bold button (title set in
  // Toolbar.svelte: "Bold (Ctrl+B)") would still be present. RED if the toolbar
  // was not replaced.
  const boldButtonCount = await tauriPage.evaluate(
    `document.querySelectorAll('button[title="Bold (Ctrl+B)"]').length`,
  );
  expect(boldButtonCount).toBe(0);

  // The buffer before the insert, so we can prove the scaffold is NEWLY added
  // (not pre-existing in demo.md).
  const before = await editorText(tauriPage);
  expect(before).not.toContain(OPEN_FENCE);

  // Trigger the theorem insert through the insertion-bar hook. RED today:
  // __PPE_E2E__.insertEnvironment does not exist, so this evaluate throws —
  // there is no insertion bar / amsthm-insert surface yet.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.insertEnvironment(${JSON.stringify(ENV)}); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(OPEN_FENCE)})`,
    10_000,
  );

  const after = await editorText(tauriPage);

  // (B) The scaffold was inserted: an opening `:::{.theorem}` fence and a
  // closing `:::` that were not there before.
  expect(after).toContain(OPEN_FENCE);
  const openIdx = after.indexOf(OPEN_FENCE);
  const closeIdx = after.indexOf(CLOSE_FENCE, openIdx + OPEN_FENCE.length);
  expect(closeIdx).toBeGreaterThan(openIdx);

  // (C) The inserted div's class is exactly `theorem` — the env argument was
  // honored, not ignored in favor of a fixed/different environment.
  const classMatch = after.slice(openIdx).match(/^:::\{\.([A-Za-z][\w-]*)\}/);
  expect(classMatch?.[1]).toBe(ENV);

  // (D) The cursor lands strictly inside the scaffold body: past the opening
  // fence line (`:::{.theorem}\n`) and before the closing fence — the `$0`
  // tabstop, not the body end.
  const bodyStart = openIdx + (OPEN_FENCE + '\n').length;
  const cursor = await cursorOffset(tauriPage);
  expect(cursor).toBeGreaterThanOrEqual(bodyStart);
  expect(cursor).toBeLessThan(closeIdx);

  recordObservation({ spec: manifest.spec, name: 'inserted-env-class', value: classMatch?.[1] ?? '' });
  recordObservation({ spec: manifest.spec, name: 'insert-cursor-offset', value: cursor });
});
