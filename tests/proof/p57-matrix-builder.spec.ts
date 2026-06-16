import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, editorText, cursorOffset } from './support/app';

// ── P57 — Insertion bar: matrix builder (rows × cols) ─────────────────────────
//
// THE OBLIGATION (proof-obligations.md, exact wording):
//   P57 — Matrix builder. Choosing matrix dimensions (rows×cols) on the
//   insertion bar inserts a LaTeX matrix environment of exactly that shape at
//   the cursor. Admissible because it fails on a no-op insert (choosing
//   dimensions leaves the buffer unchanged so no matrix appears at the cursor),
//   on a fixed-size insert that ignores the chosen dimensions (a different
//   rows×cols matrix is inserted than the one chosen), and on a malformed matrix
//   (the inserted environment has the wrong number of rows or columns for the
//   chosen shape).
//
// ── THE OBSERVABLE CONTRACT (hook + observables, BLIND to implementation) ────
// The implementer must expose ONE stable observable for "insert a matrix
// environment of the chosen shape at the cursor", parameterised by ROWS and
// COLS. This spec drives the hook form, NOT a DOM control interaction —
// webview clicks/keystrokes into the bar are flaky (the same reason
// p52/p53/p55/p56 drive completion/Emmet/env-insert/diagram-insert through
// harness hooks rather than synthetic key/click events). The contract the
// implementer must honor:
//
//   __PPE_E2E__.insertMatrix(rows: number, cols: number)   [NEW for P57]
//     Inserts a LaTeX matrix environment of EXACTLY `rows` × `cols` shape at the
//     cursor by routing through the editor's EXISTING insertSnippet surface
//     (EditorPane.insertSnippet → runSnippet → snippetCompletion), the SAME path
//     P55's env insert and P56's diagram insert use. The chosen `pmatrix`
//     environment carries a `$0`-style tabstop so the cursor lands INSIDE the
//     matrix body, honoured exactly as on a completion accept. Fire-and-forget;
//     returns null.
//
//   __PPE_E2E__.getEditorText()  [reused]  — the live editor buffer text.
//   __PPE_E2E__.cursorOffset()   [reused]  — the cursor's character offset.
//
// The bar control MAY also be a DOM control (e.g. dimension pickers feeding the
// same handler); the hook is the stable, click-free surface this spec asserts
// against.
//
// ── THE MATRIX SHAPE INVARIANT (what "exactly rows × cols" means in text) ─────
// The chosen environment is `pmatrix`. The decisive, count-based shape markers
// of a LaTeX matrix are:
//   - ROWS: rows are delimited by the `\\` row separator. A matrix of R rows is
//     written with EXACTLY R-1 `\\` separators between its R rows. This spec
//     counts the `\\` occurrences inside the inserted environment and requires
//     that count to equal R-1 — a count-based row assertion that is impossible
//     to satisfy by a fixed-size template of a different row count.
//   - COLS: within each row, the C column cells are delimited by the `&` column
//     separator. A row of C columns carries EXACTLY C-1 `&` separators. This
//     spec counts the `&` occurrences PER ROW and requires every row to carry
//     C-1 ampersands — a count-based column assertion that fails on any matrix
//     whose rows do not have the chosen column count.
//
// For the 2 × 3 shape this spec drives:  2 rows ⇒ exactly 1 `\\` separator;
// 3 columns ⇒ exactly 2 `&` separators in EACH of the 2 rows.
//
// ── WHAT EACH ASSERTION KILLS ────────────────────────────────────────────────
//   (A) Before any insert, the buffer contains no `\begin{pmatrix}` — the matrix
//       this spec asserts is NEWLY added, not pre-existing in demo.md.
//   (B) After insertMatrix(2, 3), the buffer GAINS a `\begin{pmatrix}` … with a
//       matching `\end{pmatrix}`.
//       KILLS the NO-OP insert: a hook (or bar control) that leaves the buffer
//       unchanged never adds the environment, so `\begin{pmatrix}` is absent and
//       this fails. (RED today: __PPE_E2E__.insertMatrix does not exist, so the
//       evaluate throws — there is no matrix-builder surface at all.)
//   (C) The inserted environment has EXACTLY 1 `\\` row separator (2 rows) and
//       EXACTLY 2 `&` column separators in EVERY row (3 columns).
//       KILLS the FIXED-SIZE insert that ignores the chosen dimensions: a hook
//       that always inserts e.g. a 2×2 matrix (1 `&` per row) or any other fixed
//       shape fails the column count; a hook that inserts a fixed row count other
//       than 2 fails the `\\` count.
//       KILLS the MALFORMED matrix: a matrix whose rows do not all carry the same
//       (C-1) ampersand count, or whose row-separator count does not match R-1,
//       fails this count-based shape check.
//   (D) The cursor lands strictly INSIDE the inserted matrix body — at or after
//       the `\begin{pmatrix}` line and strictly before the `\end{pmatrix}`.
//       KILLS a "dumb paste" that ignores the tabstop and drops the cursor at the
//       environment end (or before the environment).
//
// Together: choosing a 2 × 3 shape inserts a pmatrix of exactly that shape (B,C)
// with the cursor in its body (D) — proving the rows and cols arguments are
// honored, not a fixed template.

const ROWS = 2;
const COLS = 3;
const MATRIX_BEGIN = '\\begin{pmatrix}';
const MATRIX_END = '\\end{pmatrix}';
const ROW_SEP = '\\\\';
const COL_SEP = '&';

// Count non-overlapping occurrences of `needle` within `haystack`.
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

test('The insertion bar matrix builder inserts a pmatrix of exactly the chosen rows × cols at the cursor, cursor in the body', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // (A) No matrix environment is present before the insert, so the environment
  // proven below is NEWLY added (not pre-existing in demo.md).
  const before = await editorText(tauriPage);
  expect(before).not.toContain(MATRIX_BEGIN);

  // Trigger the matrix insert through the insertion-bar hook. RED today:
  // __PPE_E2E__.insertMatrix does not exist, so this evaluate throws — there is
  // no matrix-builder surface to insert a shaped matrix at all.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.insertMatrix(${ROWS}, ${COLS}); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(MATRIX_BEGIN)})`,
    10_000,
  );

  const after = await editorText(tauriPage);

  // (B) The matrix environment was inserted: a `\begin{pmatrix}` opens it and a
  // matching `\end{pmatrix}` closes it.
  expect(after).toContain(MATRIX_BEGIN);
  expect(after).toContain(MATRIX_END);
  const beginIdx = after.indexOf(MATRIX_BEGIN);
  const endIdx = after.indexOf(MATRIX_END, beginIdx);
  expect(endIdx).toBeGreaterThan(beginIdx);

  // The environment body is the text strictly between the end of the
  // `\begin{pmatrix}` token and the start of the `\end{pmatrix}` token.
  const bodyStart = beginIdx + MATRIX_BEGIN.length;
  const body = after.slice(bodyStart, endIdx);

  // (C) Shape — EXACTLY the chosen rows × cols, by count.
  //   ROWS: R rows ⇒ exactly R-1 `\\` row separators inside the environment.
  const rowSeps = countOccurrences(body, ROW_SEP);
  expect(rowSeps).toBe(ROWS - 1);

  //   COLS: split the body into its R rows on the `\\` separator, and require
  //   EVERY row to carry exactly C-1 `&` column separators. A fixed-size or
  //   malformed matrix (wrong/ragged column count) fails here.
  const rows = body.split(ROW_SEP);
  expect(rows.length).toBe(ROWS);
  for (const row of rows) {
    expect(countOccurrences(row, COL_SEP)).toBe(COLS - 1);
  }

  // (D) The cursor lands strictly INSIDE the matrix body: at or after the start
  // of the body and strictly before the `\end{pmatrix}`.
  const cursor = await cursorOffset(tauriPage);
  expect(cursor).toBeGreaterThanOrEqual(bodyStart);
  expect(cursor).toBeLessThan(endIdx);

  recordObservation({ spec: manifest.spec, name: 'matrix-row-separators', value: rowSeps });
  recordObservation({ spec: manifest.spec, name: 'matrix-cursor-offset', value: cursor });
});
