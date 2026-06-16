import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, editorText } from './support/app';

// ── P61 — Insertion bar: footnote modal (marker + definition pair) ───────────
//
// THE OBLIGATION (proof-obligations.md, exact wording):
//   P61 — Footnote modal. A footnote action on the insertion bar opens a modal
//   in which the user types the footnote body; on confirm, a COMPLETE footnote
//   is inserted — a reference marker (`[^id]`) at the cursor AND a footnote
//   definition line (`[^id]: <body>`) whose body is exactly the text the user
//   typed. Admissible because it fails on a no-op insert (confirming the modal
//   leaves the buffer unchanged so neither marker nor definition appears), on a
//   marker-only insert with no definition (the reference marker is placed but
//   the typed body is lost because no `[^id]:` definition line is inserted), on
//   a plain-text insert (the typed body lands in the buffer as ordinary text
//   rather than as a footnote marker-plus-definition pair), and on a body
//   mismatch (the inserted definition's body is not byte-equal to what the user
//   typed in the modal).
//
// ── THE OBSERVABLE CONTRACT (hook + observables, BLIND to implementation) ────
// The implementer must expose ONE stable observable for "confirm the footnote
// modal with this body and insert the complete footnote at the cursor",
// parameterised by the typed BODY. This spec drives the hook form, NOT a DOM
// modal interaction — webview clicks/keystrokes into the bar/modal are flaky
// (the same reason p52/p53/p55/p56/p57/p58/p59/p60 drive
// completion / Emmet / env-insert / diagram-insert / matrix / table /
// snippet-dropdown / code-block-dropdown through harness hooks rather than
// synthetic key/click events). The contract the implementer must honor:
//
//   __PPE_E2E__.insertFootnote(body: string)   [NEW for P61]
//     Performs the SAME action the insertion bar's footnote modal performs on
//     CONFIRM with `body` typed into it: inserts a COMPLETE footnote into the
//     buffer — a reference marker `[^<id>]` at the cursor AND a definition line
//     `[^<id>]: <body>` whose `<id>` matches the marker's and whose body is
//     EXACTLY (byte-equal) `body`. The two pieces share the SAME generated id.
//     Fire-and-forget; returns null.
//
//   __PPE_E2E__.getEditorText()  [reused]  — the live editor buffer text.
//
// The bar control MAY also be a DOM control (a footnote button opening a modal,
// the pattern InsertionBar.svelte's other controls use); the hook is the
// stable, click-free surface this spec asserts against — the same choice
// P55–P60 made for the other bar controls.
//
// ── WHAT A COMPLETE FOOTNOTE MEANS IN TEXT (pandoc markdown) ──────────────────
// A pandoc footnote is a marker-plus-definition PAIR sharing one id:
//   …text[^id]…              <- the inline reference marker, at the cursor
//   [^id]: <body>            <- the matching definition line carrying the body
// The decisive markers this spec asserts on, by structure:
//   - A reference marker `[^<id>]` appears (a `[^` … `]` token NOT immediately
//     followed by `:` — distinguishing it from the definition's `[^id]:`).
//   - A definition line `[^<id>]:` appears whose id is the SAME `<id>`, and
//     whose remainder is byte-equal to the typed body.
//
// ── THE DISTINCTIVE BODY (kills body-loss / plain-text / mismatch) ────────────
// The typed body is a UNIQUE sentinel string chosen so that:
//   - it is NOT present in demo.md before the insert (so any occurrence is the
//     one this insert produced — kills a stale match);
//   - finding it ONLY as ordinary paragraph text (not after a `[^id]:` on its
//     own definition line) is exactly the plain-text failure mode;
//   - asserting the definition line's body is byte-equal to it kills the
//     body-mismatch failure mode (a definition carrying a truncated, escaped,
//     or otherwise altered body).
//
// ── WHAT EACH ASSERTION KILLS ─────────────────────────────────────────────────
//   (A) Before any insert, the buffer contains neither the `[^` footnote token
//       nor the distinctive body — the footnote this spec asserts is NEWLY
//       added, not pre-existing in demo.md.
//   (B) After insertFootnote(BODY), the buffer GAINS a reference marker `[^<id>]`
//       (a `[^` token closed by `]` and NOT immediately followed by `:`).
//       KILLS the NO-OP insert: a hook that leaves the buffer unchanged never
//       adds a marker, so no `[^<id>]` reference token appears and this fails.
//       (RED today: __PPE_E2E__.insertFootnote does not exist, so this evaluate
//       throws — there is no insertion-bar footnote surface at all.)
//   (C) After the insert, the buffer GAINS a definition line `[^<id>]:` whose id
//       is the SAME id as the reference marker's, AND whose body is byte-equal
//       to the typed BODY.
//       KILLS the MARKER-ONLY insert (body lost): a control that places `[^id]`
//       but inserts no `[^id]:` definition line has no definition match, so this
//       fails — the typed body is gone.
//       KILLS the PLAIN-TEXT insert: a control that drops BODY into the buffer
//       as ordinary text (no marker, no `[^id]:` definition) has no `[^<id>]:`
//       definition line carrying BODY, so this fails.
//       KILLS the BODY MISMATCH: a definition whose body is not byte-equal to
//       BODY (truncated/escaped/altered) fails the byte-equality check.
//   (D) The reference marker's id and the definition line's id are the SAME
//       string — the marker and the definition are a matched pair, not two
//       unrelated footnotes.
//       KILLS an id mismatch (a `[^1]` marker paired with a `[^2]:` definition):
//       the ids must be equal for the footnote to resolve.
//
// Together: confirming the modal with a distinctive body inserts a reference
// marker (B) AND a matching definition line carrying the EXACT typed body (C),
// the two sharing one id (D) — proving a COMPLETE footnote, not a no-op,
// marker-only, plain-text, or mismatched insert.

// A distinctive, single-line body: unique enough that it cannot pre-exist in
// demo.md, and free of `[`/`]`/newline so it cannot be confused with footnote
// syntax or split across lines. The exact bytes the modal "user" types.
const BODY = 'P61 distinctive footnote body sentinel 8f3a2c';

// A reference marker `[^<id>]`: `[^`, an id (no `]`), `]`, NOT followed by `:`.
const REF_MARKER_RE = /\[\^([^\]]+)\](?!:)/;

test('The insertion bar footnote modal inserts a reference marker and a matching definition line carrying the exact typed body', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // (A) Neither a footnote token nor the distinctive body is present before the
  // insert, so the marker/definition proven below are NEWLY added (not
  // pre-existing in demo.md).
  const before = await editorText(tauriPage);
  expect(before).not.toContain('[^');
  expect(before).not.toContain(BODY);

  // Confirm the footnote modal with the distinctive body through the
  // insertion-bar hook. RED today: __PPE_E2E__.insertFootnote does not exist, so
  // this evaluate throws — there is no insertion-bar footnote / modal surface to
  // insert a complete footnote at all.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.insertFootnote(${JSON.stringify(BODY)}); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(BODY)})`,
    10_000,
  );

  const after = await editorText(tauriPage);

  // (B) A reference marker `[^<id>]` (closed `[^…]` token NOT followed by `:`)
  // was inserted. KILLS the no-op insert.
  const refMatch = after.match(REF_MARKER_RE);
  expect(refMatch).not.toBeNull();
  const refId = refMatch![1];

  // (C) A definition line `[^<id>]:` carrying the EXACT typed body was inserted,
  // sharing the reference marker's id. The definition is the start of a line:
  // `[^<id>]: <BODY>`. We match against the SAME id captured from the marker, so
  // the pair is matched (D). The captured body is byte-compared to BODY.
  // KILLS marker-only (no definition match), plain-text (no `[^id]:` line),
  // and body-mismatch (captured body ≠ BODY).
  const defLineRe = new RegExp(
    `(?:^|\\n)\\[\\^${escapeRegExp(refId)}\\]:[ \\t]?(.*)`,
  );
  const defMatch = after.match(defLineRe);
  expect(defMatch).not.toBeNull();

  // (C) byte-equality: the definition line's body is exactly the typed body.
  const definedBody = defMatch![1];
  expect(definedBody).toBe(BODY);

  // (D) The marker id and the definition id are the SAME (already enforced by
  // reusing refId in defLineRe). Make the matched-pair invariant explicit: a
  // standalone re-scan for the definition's own id equals the marker id.
  const defIdMatch = after.match(/(?:^|\n)\[\^([^\]]+)\]:/);
  expect(defIdMatch).not.toBeNull();
  expect(defIdMatch![1]).toBe(refId);

  recordObservation({ spec: manifest.spec, name: 'footnote-id', value: refId });
  recordObservation({ spec: manifest.spec, name: 'footnote-body', value: definedBody });
});

// Escape a captured id for safe embedding in a RegExp (ids are short generated
// tokens; this guards against regex-special characters in an id).
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
