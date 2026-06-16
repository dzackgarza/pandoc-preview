import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, editorText, cursorOffset } from './support/app';

// ── P58 — Insertion bar: table builder (cols × body-rows) ─────────────────────
//
// THE OBLIGATION (proof-obligations.md, exact wording):
//   P58 — Table builder. Choosing table dimensions (cols×body-rows) on the
//   insertion bar inserts a pandoc pipe-table of exactly that shape at the
//   cursor: a header row, an alignment separator row, and the chosen number of
//   body rows, where every row carries the chosen number of `|`-delimited cells.
//
// ── THE OBSERVABLE CONTRACT (hook + observables, BLIND to implementation) ────
// The implementer must expose ONE stable observable for "insert a pandoc pipe
// table of the chosen shape at the cursor", parameterised by COLS and ROWS
// (body rows). This spec drives the hook form, NOT a DOM control interaction —
// webview clicks/keystrokes into the bar are flaky (the same reason
// p52/p53/p55/p56/p57 drive completion/Emmet/env-insert/diagram-insert/matrix
// through harness hooks rather than synthetic key/click events). The contract
// the implementer must honor:
//
//   __PPE_E2E__.insertTable(cols: number, rows: number)   [NEW for P58]
//     Inserts a pandoc pipe table of EXACTLY `cols` columns × `rows` body rows
//     at the cursor by routing through the editor's EXISTING insertSnippet
//     surface (EditorPane.insertSnippet → runSnippet → snippetCompletion), the
//     SAME path P55's env insert, P56's diagram insert, and P57's matrix insert
//     use. The inserted table carries a `$0`-style tabstop so the cursor lands
//     INSIDE the table body, honoured exactly as on a completion accept.
//     `cols` is the number of `|`-delimited cells per row; `rows` is the number
//     of BODY rows (the header row and the alignment separator row are in
//     addition to these). Fire-and-forget; returns null.
//
//   __PPE_E2E__.getEditorText()  [reused]  — the live editor buffer text.
//   __PPE_E2E__.cursorOffset()   [reused]  — the cursor's character offset.
//
// The bar control MAY also be a DOM control (e.g. dimension pickers feeding the
// same handler); the hook is the stable, click-free surface this spec asserts
// against.
//
// ── THE PIPE-TABLE SHAPE INVARIANT (what "exactly cols × rows" means in text) ─
// A pandoc pipe table is a sequence of newline-delimited rows. Each row is a
// `|`-delimited sequence of cells written with BOTH a leading and a trailing
// pipe, so a row of C columns carries EXACTLY C+1 pipe (`|`) characters. The
// table this spec asserts has, in order:
//   1. ONE header row              — C cells ⇒ C+1 pipes.
//   2. ONE alignment separator row — C cells, each cell a run of dashes
//      (`---`), used by pandoc to mark the header/body boundary. It carries
//      C+1 pipes AND C dash-runs (one `---`-style cell per column). Pipe tables
//      are INVALID without this separator row, so its presence (and matching
//      column count) is decisive.
//   3. EXACTLY `rows` BODY rows    — each C cells ⇒ each C+1 pipes.
// The decisive, count-based shape markers:
//   - COLS: each table row carries EXACTLY C+1 `|` characters (leading +
//     trailing + the C-1 interior separators). A count-based column assertion
//     that is impossible to satisfy by a fixed template of a different column
//     count.
//   - SEPARATOR: the second row is the alignment separator — it carries EXACTLY
//     C dash-runs (`---`), one per column. A count-based separator assertion
//     that fails on a table with a missing/wrong separator row.
//   - ROWS: after the header and the separator, EXACTLY `rows` body rows remain,
//     each with the C+1 pipe count. A count-based body-row assertion that fails
//     on a fixed body-row count other than the chosen one.
//
// For the 3 × 2 shape this spec drives (3 columns, 2 body rows): each row of
// the table carries 4 pipes; the separator row carries 3 dash-runs; exactly 2
// body rows follow the header and separator.
//
// ── WHAT EACH ASSERTION KILLS ────────────────────────────────────────────────
//   (A) Before any insert, the buffer contains no alignment separator row — the
//       table this spec asserts is NEWLY added, not pre-existing in demo.md.
//   (B) After insertTable(3, 2), the buffer GAINS a contiguous block of table
//       rows: a header row, an alignment separator row, and the body rows.
//       KILLS the NO-OP insert: a hook (or bar control) that leaves the buffer
//       unchanged never adds the table, so no separator row appears and this
//       fails. (RED today: __PPE_E2E__.insertTable does not exist, so the
//       evaluate throws — there is no table-builder surface at all.)
//   (C) Each of the table's rows carries EXACTLY C+1 `|` characters (3 columns ⇒
//       4 pipes per row), and the alignment separator row carries EXACTLY C
//       dash-runs (3 columns ⇒ 3 `---` cells).
//       KILLS the FIXED-SHAPE insert that ignores the chosen dimensions: a hook
//       that always inserts e.g. a 2-column table (3 pipes per row, 2 dash-runs)
//       or any other fixed column count fails the pipe/dash-run count.
//       KILLS the MISSING/WRONG SEPARATOR: a table with no alignment separator
//       row, or one whose column count differs from the header, fails the
//       dash-run count check — and a pipe table without a valid separator is not
//       a pipe table at all.
//   (D) EXACTLY `rows` body rows follow the header and separator (3 × 2 ⇒ 2 body
//       rows), each with the C+1 pipe count.
//       KILLS a fixed body-row count: a hook that always inserts e.g. 1 or 3
//       body rows fails this count.
//   (E) The cursor lands strictly INSIDE the table block: at or after the start
//       of the header row and at or before the end of the last body row.
//       KILLS a "dumb paste" that ignores the tabstop and drops the cursor
//       before the table or past its end.
//
// Together: choosing a 3 × 2 shape inserts a pandoc pipe table of exactly that
// shape (B,C,D) with a valid alignment separator (C) and the cursor in its body
// (E) — proving the cols and rows arguments are honored, not a fixed template.

const COLS = 3;
const ROWS = 2;
const PIPE = '|';
const DASH_RUN = '---';
// A row of C columns carries C+1 pipes (leading + trailing + C-1 interior).
const PIPES_PER_ROW = COLS + 1;

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

// True iff a line is a pipe-table row: it contains the pipe separator and
// carries the chosen per-row pipe count.
function isTableRow(line: string): boolean {
  return line.includes(PIPE) && countOccurrences(line, PIPE) === PIPES_PER_ROW;
}

// True iff a line is the alignment separator row: a table row whose every
// inter-pipe cell is a run of dashes (one `---`-style cell per column).
function isSeparatorRow(line: string): boolean {
  if (!isTableRow(line)) return false;
  // Interior cells are the segments strictly between the leading and trailing
  // pipes. A separator cell is non-empty and made only of dashes/whitespace and
  // (pandoc alignment colons), and contains at least one dash run.
  const cells = line
    .split(PIPE)
    .slice(1, -1) // drop the empty segments before the leading and after the trailing pipe
    .map((c) => c.trim());
  if (cells.length !== COLS) return false;
  return cells.every((c) => /^:?-{2,}:?$/.test(c));
}

test('The insertion bar table builder inserts a pandoc pipe table of exactly the chosen cols × body-rows at the cursor, cursor in the body', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // (A) No alignment separator row is present before the insert, so the table
  // proven below is NEWLY added (not pre-existing in demo.md).
  const before = await editorText(tauriPage);
  expect(before.split('\n').some(isSeparatorRow)).toBe(false);

  // Trigger the table insert through the insertion-bar hook. RED today:
  // __PPE_E2E__.insertTable does not exist, so this evaluate throws — there is
  // no table-builder surface to insert a shaped table at all.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.insertTable(${COLS}, ${ROWS}); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().split('\\n').some((l) => l.includes('${DASH_RUN}') && (l.match(/\\|/g) || []).length === ${PIPES_PER_ROW})`,
    10_000,
  );

  const after = await editorText(tauriPage);
  const lines = after.split('\n');

  // Locate the contiguous block of table rows: the header row is the first
  // table row immediately followed by an alignment separator row.
  const sepIdx = lines.findIndex(
    (l, i) => i > 0 && isSeparatorRow(l) && isTableRow(lines[i - 1]),
  );
  expect(sepIdx).toBeGreaterThan(0); // separator exists and has a header above it
  const headerIdx = sepIdx - 1;

  // (B) The table block is present: header row, then the alignment separator.
  expect(isTableRow(lines[headerIdx])).toBe(true);
  expect(isSeparatorRow(lines[sepIdx])).toBe(true);

  // (C) COLS — each table row carries EXACTLY C+1 pipes, and the separator row
  // carries EXACTLY C dash-run cells.
  expect(countOccurrences(lines[headerIdx], PIPE)).toBe(PIPES_PER_ROW);
  expect(countOccurrences(lines[sepIdx], PIPE)).toBe(PIPES_PER_ROW);
  const sepCells = lines[sepIdx]
    .split(PIPE)
    .slice(1, -1)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  expect(sepCells.length).toBe(COLS);
  for (const cell of sepCells) {
    expect(cell.includes(DASH_RUN)).toBe(true);
  }

  // (D) ROWS — exactly `ROWS` body rows follow the separator, each with C+1
  // pipes. Body rows are the contiguous table rows after the separator.
  let bodyCount = 0;
  for (let i = sepIdx + 1; i < lines.length && isTableRow(lines[i]); i += 1) {
    expect(countOccurrences(lines[i], PIPE)).toBe(PIPES_PER_ROW);
    bodyCount += 1;
  }
  expect(bodyCount).toBe(ROWS);

  // (E) The cursor lands strictly INSIDE the table block: at or after the start
  // of the header row and at or before the end of the last body row.
  const lastBodyIdx = sepIdx + ROWS;
  const headerStart =
    lines.slice(0, headerIdx).reduce((acc, l) => acc + l.length + 1, 0);
  const tableEnd =
    lines.slice(0, lastBodyIdx + 1).reduce((acc, l) => acc + l.length + 1, 0) - 1;
  const cursor = await cursorOffset(tauriPage);
  expect(cursor).toBeGreaterThanOrEqual(headerStart);
  expect(cursor).toBeLessThanOrEqual(tableEnd);

  recordObservation({ spec: manifest.spec, name: 'table-body-rows', value: bodyCount });
  recordObservation({ spec: manifest.spec, name: 'table-cursor-offset', value: cursor });
});
