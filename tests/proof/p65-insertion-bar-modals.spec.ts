import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, editorText, cursorOffset } from './support/app';

// ── P65 — DOM-CLICK smoke proofs for the bar's modal-backed controls ─────────
//
// COVERAGE HARDENING (not a new feature). P57 (matrix), P58 (table), and P61
// (footnote) proved the insert BEHAVIOUR by driving the App's __PPE_E2E__ hooks
// (insertMatrix / insertTable / insertFootnote) directly. The insertion bar's
// REAL user-facing controls for these — a matrix builder, a table builder, and a
// footnote modal — are the affordances that invoke those SAME handlers. This
// spec drives the REAL controls (open the modal, set dims / type the body,
// confirm) and asserts the SAME inserted-content contract P57/P58/P61 assert.
//
// THE DOM CONTRACT the bar controls honour (BLIND to styling):
//   matrix : button[data-insert-matrix] opens a modal with
//            input[data-matrix-rows], input[data-matrix-cols],
//            button[data-matrix-confirm]; confirm fires App.insertMatrix(rows,cols).
//   table  : button[data-insert-table] opens a modal with
//            input[data-table-cols], input[data-table-rows],
//            button[data-table-confirm]; confirm fires App.insertTable(cols,rows).
//   footnote: button[data-insert-footnote] opens a modal with
//            textarea[data-footnote-body], button[data-footnote-confirm];
//            confirm fires App.insertFootnote(body). The body field is a
//            <textarea> (footnote bodies may span lines); since tauri-playwright's
//            `fill` only drives HTMLInputElement, the body is set on the REAL
//            textarea via the SAME native `input` event a keystroke fires (the
//            event Svelte's bind:value listens to) — still the real control, not
//            a hook.
//
// Each confirm routes through the EXACT handler the P57/P58/P61 hooks call, so
// the inserted content is identical; this spec proves the DOM path reaches it.

const MATRIX_ROWS = 2;
const MATRIX_COLS = 3;
const MATRIX_BEGIN = '\\begin{pmatrix}';
const MATRIX_END = '\\end{pmatrix}';
const ROW_SEP = '\\\\';
const COL_SEP = '&';

const TABLE_COLS = 3;
const TABLE_ROWS = 2;
const PIPE = '|';
const DASH_RUN = '---';
const PIPES_PER_ROW = TABLE_COLS + 1;

const FOOTNOTE_BODY = 'P65 distinctive footnote body sentinel 4d7e1b';
const REF_MARKER_RE = /\[\^([^\]]+)\](?!:)/;

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isTableRow(line: string): boolean {
  return line.includes(PIPE) && countOccurrences(line, PIPE) === PIPES_PER_ROW;
}

function isSeparatorRow(line: string): boolean {
  if (!isTableRow(line)) return false;
  const cells = line
    .split(PIPE)
    .slice(1, -1)
    .map((c) => c.trim());
  if (cells.length !== TABLE_COLS) return false;
  return cells.every((c) => /^:?-{2,}:?$/.test(c));
}

test('The bar matrix builder modal inserts a pmatrix of exactly the chosen rows × cols at the cursor', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  const before = await editorText(tauriPage);
  expect(before).not.toContain(MATRIX_BEGIN);

  // Open the REAL matrix builder modal, set the dims in the REAL inputs, confirm.
  await tauriPage.click('button[data-insert-matrix]');
  await tauriPage.waitForFunction(
    `!!document.querySelector('input[data-matrix-rows]') && !!document.querySelector('input[data-matrix-cols]')`,
    10_000,
  );
  await tauriPage.fill('input[data-matrix-rows]', String(MATRIX_ROWS));
  await tauriPage.fill('input[data-matrix-cols]', String(MATRIX_COLS));
  await tauriPage.click('button[data-matrix-confirm]');

  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(MATRIX_BEGIN)})`,
    10_000,
  );

  const after = await editorText(tauriPage);
  // Inserted-content assertion (mirrors P57 B/C/D): exact shape by count, cursor
  // in the body.
  expect(after).toContain(MATRIX_BEGIN);
  expect(after).toContain(MATRIX_END);
  const beginIdx = after.indexOf(MATRIX_BEGIN);
  const endIdx = after.indexOf(MATRIX_END, beginIdx);
  expect(endIdx).toBeGreaterThan(beginIdx);
  const bodyStart = beginIdx + MATRIX_BEGIN.length;
  const body = after.slice(bodyStart, endIdx);

  expect(countOccurrences(body, ROW_SEP)).toBe(MATRIX_ROWS - 1);
  const rows = body.split(ROW_SEP);
  expect(rows.length).toBe(MATRIX_ROWS);
  for (const row of rows) {
    expect(countOccurrences(row, COL_SEP)).toBe(MATRIX_COLS - 1);
  }

  const cursor = await cursorOffset(tauriPage);
  expect(cursor).toBeGreaterThanOrEqual(bodyStart);
  expect(cursor).toBeLessThan(endIdx);

  recordObservation({ spec: manifest.spec, name: 'modal-matrix-shape', value: `${MATRIX_ROWS}x${MATRIX_COLS}` });
});

test('The bar table builder modal inserts a pandoc pipe table of exactly the chosen cols × body-rows at the cursor', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  const before = await editorText(tauriPage);
  expect(before.split('\n').some(isSeparatorRow)).toBe(false);

  // Open the REAL table builder modal, set the dims, confirm.
  await tauriPage.click('button[data-insert-table]');
  await tauriPage.waitForFunction(
    `!!document.querySelector('input[data-table-cols]') && !!document.querySelector('input[data-table-rows]')`,
    10_000,
  );
  await tauriPage.fill('input[data-table-cols]', String(TABLE_COLS));
  await tauriPage.fill('input[data-table-rows]', String(TABLE_ROWS));
  await tauriPage.click('button[data-table-confirm]');

  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().split('\\n').some((l) => l.includes('${DASH_RUN}') && (l.match(/\\|/g) || []).length === ${PIPES_PER_ROW})`,
    10_000,
  );

  const after = await editorText(tauriPage);
  const lines = after.split('\n');
  // Inserted-content assertion (mirrors P58 B/C/D/E).
  const sepIdx = lines.findIndex(
    (l, i) => i > 0 && isSeparatorRow(l) && isTableRow(lines[i - 1]),
  );
  expect(sepIdx).toBeGreaterThan(0);
  const headerIdx = sepIdx - 1;
  expect(isTableRow(lines[headerIdx])).toBe(true);
  expect(isSeparatorRow(lines[sepIdx])).toBe(true);
  expect(countOccurrences(lines[headerIdx], PIPE)).toBe(PIPES_PER_ROW);

  let bodyCount = 0;
  for (let i = sepIdx + 1; i < lines.length && isTableRow(lines[i]); i += 1) {
    expect(countOccurrences(lines[i], PIPE)).toBe(PIPES_PER_ROW);
    bodyCount += 1;
  }
  expect(bodyCount).toBe(TABLE_ROWS);

  const lastBodyIdx = sepIdx + TABLE_ROWS;
  const headerStart = lines.slice(0, headerIdx).reduce((acc, l) => acc + l.length + 1, 0);
  const tableEnd = lines.slice(0, lastBodyIdx + 1).reduce((acc, l) => acc + l.length + 1, 0) - 1;
  const cursor = await cursorOffset(tauriPage);
  expect(cursor).toBeGreaterThanOrEqual(headerStart);
  expect(cursor).toBeLessThanOrEqual(tableEnd);

  recordObservation({ spec: manifest.spec, name: 'modal-table-body-rows', value: bodyCount });
});

test('The bar footnote modal inserts a reference marker and a matching definition line carrying the exact typed body', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  const before = await editorText(tauriPage);
  expect(before).not.toContain('[^');
  expect(before).not.toContain(FOOTNOTE_BODY);

  // Open the REAL footnote modal, type the body in the REAL textarea, confirm.
  // The footnote body field is a <textarea> (pandoc footnote bodies may span
  // lines); the tauri-playwright `fill` convenience only drives HTMLInputElement,
  // so the body is set on the REAL textarea by dispatching the SAME native
  // `input` event a keystroke fires — the event Svelte's bind:value listens to.
  // This drives the real control (real textarea, real input event), not a hook.
  await tauriPage.click('button[data-insert-footnote]');
  await tauriPage.waitForFunction(
    `!!document.querySelector('textarea[data-footnote-body]')`,
    10_000,
  );
  await tauriPage.evaluate(`(() => {
    const ta = document.querySelector('textarea[data-footnote-body]');
    if (!ta) throw new Error('footnote textarea not present');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(FOOTNOTE_BODY)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return null;
  })()`);
  await tauriPage.waitForFunction(
    `document.querySelector('textarea[data-footnote-body]').value === ${JSON.stringify(FOOTNOTE_BODY)}`,
    10_000,
  );
  await tauriPage.click('button[data-footnote-confirm]');

  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(FOOTNOTE_BODY)})`,
    10_000,
  );

  const after = await editorText(tauriPage);
  // Inserted-content assertion (mirrors P61 B/C/D): marker + matching definition
  // carrying the byte-equal typed body, sharing one id.
  const refMatch = after.match(REF_MARKER_RE);
  expect(refMatch).not.toBeNull();
  const refId = refMatch![1];

  const defLineRe = new RegExp(`(?:^|\\n)\\[\\^${escapeRegExp(refId)}\\]:[ \\t]?(.*)`);
  const defMatch = after.match(defLineRe);
  expect(defMatch).not.toBeNull();
  expect(defMatch![1]).toBe(FOOTNOTE_BODY);

  const defIdMatch = after.match(/(?:^|\n)\[\^([^\]]+)\]:/);
  expect(defIdMatch).not.toBeNull();
  expect(defIdMatch![1]).toBe(refId);

  recordObservation({ spec: manifest.spec, name: 'modal-footnote-id', value: refId });
  recordObservation({ spec: manifest.spec, name: 'modal-footnote-body', value: defMatch![1] });
});
