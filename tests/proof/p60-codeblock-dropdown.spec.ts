import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, editorText, cursorOffset } from './support/app';

// ── P60 — Insertion bar: code-block-type dropdown (language-tagged fence) ─────
//
// THE OBLIGATION (proof-obligations.md, exact wording):
//   P60 — Code-block-type dropdown. Choosing a language from the insertion bar's
//   code-block-type dropdown inserts a fenced code block tagged with that
//   language at the cursor: an opening fence carrying the chosen language tag
//   (```<lang>) and a matching closing fence, with the cursor placed inside the
//   block. Admissible because it fails on a no-op insert (choosing a language
//   leaves the buffer unchanged so no fenced block appears at the cursor), on an
//   untagged block that ignores the chosen language (the opening fence carries no
//   language tag), and on a wrong language tag (the inserted fence is tagged with
//   a language other than the one chosen).
//
// ── THE OBSERVABLE CONTRACT (hook + observables, BLIND to implementation) ─────
// The implementer must expose ONE stable observable for "insert a fenced code
// block tagged with the chosen language at the cursor", parameterised by LANG.
// This spec drives the hook form, NOT a DOM control interaction — webview
// clicks/keystrokes into the bar are flaky (the same reason
// p52/p53/p55/p56/p57/p58/p59 drive completion / Emmet / env-insert /
// diagram-insert / matrix / table / snippet-dropdown through harness hooks rather
// than synthetic key/click events). The contract the implementer must honor:
//
//   __PPE_E2E__.insertCodeBlockLang(lang: string)   [NEW for P60]
//     Inserts, at the cursor, a fenced code block whose OPENING fence carries the
//     chosen language tag (```<lang>) and whose CLOSING fence (```) matches it,
//     with the cursor placed strictly INSIDE the block body (between the two
//     fences). This generalises EditorPane.insertCodeBlock — which today inserts
//     only an UNTAGGED ``` fence (EditorPane.svelte ~530) — to honour a chosen
//     language tag, the same way P57's insertMatrix generalises a single shape
//     argument into the inserted text. Fire-and-forget; returns null.
//
//   __PPE_E2E__.getEditorText()  [reused]  — the live editor buffer text.
//   __PPE_E2E__.cursorOffset()   [reused]  — the cursor's character offset.
//
// The bar control MAY also be a DOM control (e.g. a language <select> feeding the
// same handler, the pattern InsertionBar.svelte's snippet <select> uses); the
// hook is the stable, click-free surface this spec asserts against — the same
// choice P55–P59 made for the other bar controls.
//
// ── WHAT THE LANGUAGE-TAGGED-FENCE INVARIANT MEANS IN TEXT ────────────────────
// A pandoc/CommonMark fenced code block is:
//   ```<lang>\n            <- opening fence + chosen language tag (info string)
//   <body>\n               <- the code body (cursor lands here)
//   ```                    <- matching closing fence (no info string)
// The decisive markers this spec asserts on, by exact text:
//   - The opening fence is the literal "```python" — three backticks IMMEDIATELY
//     followed by the chosen language tag. An untagged "```" opening fence (no
//     tag) does NOT contain this substring.
//   - A SECOND, matching closing-fence "```" exists strictly after the opening
//     fence, so the block is closed.
//   - The cursor offset sits strictly BETWEEN the end of the opening fence line
//     and the start of the closing fence — inside the block body.
//
// ── WHAT EACH ASSERTION KILLS ─────────────────────────────────────────────────
//   (A) Before any insert, the buffer contains no "```" fence — the code block
//       this spec asserts is NEWLY added, not pre-existing in demo.md (the demo
//       fixture has no fenced code blocks).
//   (B) After insertCodeBlockLang('python'), the buffer GAINS an opening fence
//       carrying the chosen language tag: the literal "```python".
//       KILLS the NO-OP insert: a hook (or bar control) that leaves the buffer
//       unchanged never adds a fence, so "```python" is absent and this fails.
//       (RED today: __PPE_E2E__.insertCodeBlockLang does not exist, so the
//       evaluate throws — there is no code-block-type dropdown surface at all.)
//       KILLS the UNTAGGED block: a control that inserts a bare "```" fence with
//       no language tag (as EditorPane.insertCodeBlock does today) never produces
//       the "```python" substring, so this fails.
//       KILLS the WRONG language tag: a fence tagged "```haskell" (or any tag
//       other than the chosen one) does not contain "```python", so this fails.
//   (C) A matching CLOSING fence "```" exists strictly after the opening fence,
//       so the inserted block is closed (not a dangling open fence).
//   (D) The cursor lands strictly INSIDE the block body — at or after the end of
//       the opening fence line ("```python\n") and strictly before the closing
//       fence.
//       KILLS a "dumb paste" that drops the cursor at the block end (after the
//       closing fence) or before the block, rather than in the body.
//
// Together: choosing 'python' inserts a fence tagged with EXACTLY that language
// (B) that is properly closed (C), with the cursor in the block body (D) —
// proving the chosen language is honoured, not a fixed/untagged template.

const LANG = 'python';
const OPEN_FENCE = '```' + LANG; // the opening fence + chosen language tag
const FENCE = '```'; // a bare fence (used to locate the closing fence)

test('The insertion bar code-block dropdown inserts a fence tagged with the chosen language at the cursor, cursor in the body', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // (A) No fenced code block is present before the insert, so the tagged fence
  // proven below is NEWLY added (not pre-existing in demo.md).
  const before = await editorText(tauriPage);
  expect(before).not.toContain(FENCE);

  // Trigger the code-block insert through the insertion-bar hook. RED today:
  // __PPE_E2E__.insertCodeBlockLang does not exist, so this evaluate throws —
  // there is no code-block-type dropdown surface to insert a language-tagged
  // fence at all.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.insertCodeBlockLang(${JSON.stringify(LANG)}); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(OPEN_FENCE)})`,
    10_000,
  );

  const after = await editorText(tauriPage);

  // (B) The opening fence carries the CHOSEN language tag: the literal
  // "```python". An untagged "```" fence or a fence tagged with a different
  // language does not contain this substring.
  expect(after).toContain(OPEN_FENCE);
  const openIdx = after.indexOf(OPEN_FENCE);

  // (C) A matching closing fence "```" exists strictly after the opening fence,
  // so the block is closed. We search for a bare fence starting AFTER the opening
  // fence's language tag, so the closing-fence match is not the opening fence
  // itself.
  const afterOpenFence = openIdx + OPEN_FENCE.length;
  const closeIdx = after.indexOf(FENCE, afterOpenFence);
  expect(closeIdx).toBeGreaterThan(openIdx);

  // (D) The cursor lands strictly INSIDE the block body: at or after the end of
  // the opening fence line ("```python\n") and strictly before the closing fence.
  const bodyStart = openIdx + (OPEN_FENCE + '\n').length;
  const cursor = await cursorOffset(tauriPage);
  expect(cursor).toBeGreaterThanOrEqual(bodyStart);
  expect(cursor).toBeLessThan(closeIdx);

  recordObservation({ spec: manifest.spec, name: 'codeblock-language-tag', value: LANG });
  recordObservation({ spec: manifest.spec, name: 'codeblock-cursor-offset', value: cursor });
});
