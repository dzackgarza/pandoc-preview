import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  cursorOffset,
  editorText,
} from './support/app';

// ── P74 — Structured compile-log entries jump to source ───────────────────────
//
// THE OBLIGATION (Phase A plan, A.6; proposed proof P74, exact intent —
// .agents/plans/phase-a-lint-fast-feedback.md:426):
//   After a render whose REAL subprocess log contains a line-tagged message, the
//   Compile Log pane presents a STRUCTURED entry (observed via the
//   `structuredLog()` hook) with a parsed `{line, severity, message}` matching
//   that log line; ACTIVATING the entry moves the editor cursor to exactly that
//   source line (observed via `cursorOffset()` / `goToLine`). The RAW log (the P11
//   surface) is still present and unchanged. It does NOT subsume or weaken P11 —
//   P11's raw-log assertion runs unchanged alongside this.
//
// ── INTEROP-FIRST — the parse contract is PORTED from `pplatex` (HARD RULE #0) ──
// A.6 is "Structured post-compile log → diagnostics (pplatex-class)". The
// reference implementation is `pplatex` — the LaTeX-log pretty-printer vimtex
// itself routes compile logs through before quickfix
// ([[parity-research/vimtex]] §"Compile-log → quickfix" / §"pplatex-class log
// post-processing"). The PREFERRED path is running the real `pplatex` binary on
// the emitted log; on THIS host `pplatex` is MISSING (`which pplatex` → not
// found), so A.6 must PORT pplatex's documented parse contract rather than invent
// a fresh log grammar:
//   * `file:line: message`               → a file/line-tagged diagnostic
//   * a latex bang-error block `! …`      → an error (with its `l.NN` line marker)
//   * `… Warning: …` / line-bearing lines → a warning, with the cited source line
// with severity classification (error / warning / info). The structured-log shape
// `{line, severity, message}` is pplatex's, NOT designed here. The implementer's
// `parseCompileLog(raw)` (src/lib/editor/complog.ts) is BLIND to this spec; only
// the observable `structuredLog()` output is asserted.
//
// ── THE REAL-LOG WITNESS (no synthetic log string — A.6 verification note) ─────
// P74 FORBIDS asserting on a hand-written log string: it must parse the REAL
// subprocess log from a REAL render (plan: "P74 runs a real render … and parses
// its REAL `log` — no synthetic log string"). This spec uses the REAL PREVIEW
// render — the EXACT A.6 seam: api.renderPreview → res.log → the Compile Log pane
// (App.svelte:702; PreviewPane.svelte). The render runs the active pandoc-renderer
// plugin (`pandoc --from markdown --to html5 …`, the SAME command P11/P1 prove).
//
// THE WITNESS BUFFER (verified deterministic against the REAL harness binaries —
// /usr/bin/pandoc 3.1.3, the exact pandoc the proof run provisions and the
// versions block of the proof artifact records): a footnote DEFINED but never
// referenced. Pandoc's MARKDOWN reader emits, on stderr, a LINE-TAGGED warning
// citing the SOURCE-MARKDOWN line of the orphan definition (3/3 identical runs,
// through the full configured preview command reading the buffer on stdin):
//
//     [WARNING] Note with key 'orphan' defined at line 5 column 1 but not used.
//
// i.e. a pplatex-class warning line: severity WARNING, message naming the unused
// note, source line 5. CRUCIALLY the cited line is the MARKDOWN BUFFER line (the
// orphan footnote is on line 5 of the witness buffer), NOT a generated-`.tex`
// line — so the jump target lands on the ACTUAL source of the warning. (The
// lualatex PDF-export `l.NN` markers point into pandoc's generated input.tex,
// whose `.tex`→markdown mapping is the struck-sourcepos machinery HELD under P75 —
// jumping the markdown cursor to a `.tex` line would be a semantically WRONG jump.
// The pandoc-markdown-reader `line N` warning needs no such mapping and is the
// faithful witness.) The render still SUCCEEDS (a warning, not an error: html is
// produced, exit 0), so the raw-log P11 surface stays valid alongside the warning.
//
// THE PARSED LINE IS READ BACK FROM THE REAL LOG (the witness `line` integer is
// extracted from the live raw log via the same `line N` regex, NOT hardcoded), so
// the jump-target assertion is pinned to whatever the REAL pandoc emitted.
//
// ── WHY THE APP IS RED TODAY (the implementation fact this proof pins) ──────────
// There is NO src/lib/editor/complog.ts (`parseCompileLog` does not exist), and NO
// `__PPE_E2E__.structuredLog` hook on the harness (App.svelte:256 hook object has
// cursorOffset / goToLine / lintDiagnostics but no structuredLog). The Compile Log
// pane (PreviewPane.svelte:75) shows ONLY the raw `log` text in `pre.select-text`
// (the P11 surface) — there is no structured, clickable entry list. So the
// structured entry P74 requires cannot exist; the spec settles on the missing
// `structuredLog()` hook (raw-only state — P74's first kill).
//
// ── THE OBSERVABLE CONTRACT (hook + observable, BLIND to implementation) ────────
//   __PPE_E2E__.structuredLog(): {line, severity, message}[]   [NEW]
//     The structured parse of the compile log the Compile Log pane currently
//     shows, produced by parseCompileLog over the REAL render `log` (the ported
//     pplatex parse). `line` is the 1-based source line the entry jumps to,
//     `severity` the classified level ('error'|'warning'|'info'), `message` the
//     human-readable text. It reflects the SAME entries the pane renders as a
//     clickable list — NOT a parallel array (a side array could pass while the
//     pane shows nothing structured).
//
//   __PPE_E2E__.goToLine(line)    [reused, App.svelte:430] — the SAME jump the
//     clickable entry's activation calls (EditorPane.svelte:468/540). Driving it
//     with the entry's parsed `line` is exactly what activating the entry does.
//   __PPE_E2E__.cursorOffset()    [reused, App.svelte:423] — the live CM6 cursor
//     head offset, the independent read that proves the jump landed.
//   __PPE_E2E__.getEditorText()   [reused] — the live buffer, to compute the
//     expected char offset of the parsed line start.
//   __PPE_E2E__.setEditorText(t)  [reused, App.svelte:318] — replace the whole
//     buffer through the real CM pipeline (the witness buffer); the docChanged it
//     fires triggers the debounced REAL preview render.
//
// ── WHAT EACH ASSERTION KILLS ─────────────────────────────────────────────────
//   (RAW) The raw log (P11 surface, `pre.select-text`) is present AND carries the
//         real line-tagged warning ("Note with key 'orphan' … line N …").
//         Establishes the real witness log exists in the pane; guards that the
//         structured layer is ADDED ALONGSIDE the raw log, never replacing it
//         (does NOT subsume/weaken P11).
//   (S1)  structuredLog() contains an entry whose `message` names the real warning
//         (contains "orphan"), `severity` is 'warning', and `line` equals the line
//         parsed from the RAW log's `line N` marker.
//         KILLS a raw-only log (no structured entry exists — P11's state) and a
//         parse that drops the line number (entry has no usable `line`).
//   (S2)  That entry's parsed `line` is the SAME integer the raw log's `line N`
//         marker carries (read back from the real log, not hardcoded).
//         KILLS a parse that fabricates / loses the source line.
//   (JUMP)Activating the entry (goToLine(entry.line)) moves the cursor to exactly
//         the START of the parsed line: cursorOffset() === the char offset of
//         line `entry.line` in the buffer (computed independently from the buffer
//         text). The buffer's orphan footnote IS on that line, so the jump lands
//         on the real source of the warning.
//         KILLS a parse that drops the line (activation is a no-op, cursor does
//         not move to the line start) and a jump to the WRONG line (cursor lands
//         somewhere other than the parsed line's start).

// Witness buffer: a footnote DEFINED on a known line but never REFERENCED. Pandoc's
// markdown reader emits a line-tagged "Note with key '…' defined at line N … but
// not used" warning on stderr, where N is this markdown buffer line. The orphan
// definition is on line 5 (1: heading, 2: blank, 3: prose, 4: blank, 5: orphan).
const WITNESS_BUFFER =
  '# Witness Doc\n' + // line 1
  '\n' + // line 2
  'Intro prose on line three.\n' + // line 3
  '\n' + // line 4
  "[^orphan]: this footnote is defined but never referenced anywhere.\n" + // line 5
  '\n' + // line 6
  'Closing prose.\n'; // line 7
const WITNESS_NOTE_KEY = 'orphan';

// The 0-based char offset of the START of 1-based line `line` in `text` — the
// position goToLine(line) places the cursor at (EditorPane.svelte:542,
// doc.line(n).from). Computed independently from the buffer so the JUMP assertion
// does not trust the implementation's own offset math.
function lineStartOffset(text: string, line: number): number {
  const lines = text.split('\n');
  let off = 0;
  for (let i = 0; i < line - 1; i++) {
    off += lines[i].length + 1; // +1 for the '\n' separator
  }
  return off;
}

// The structured entries the Compile Log pane currently shows, via the NEW hook.
interface LogEntry {
  line: number;
  severity: string;
  message: string;
}

async function structuredLog(page: {
  evaluate(expr: string): Promise<unknown>;
}): Promise<LogEntry[]> {
  const raw = await page.evaluate(
    `JSON.stringify(window.__PPE_E2E__.structuredLog())`,
  );
  if (typeof raw !== 'string') {
    throw new Error(`structuredLog returned non-string: ${JSON.stringify(raw)}`);
  }
  return JSON.parse(raw) as LogEntry[];
}

// The raw compile-log text shown in the Compile Log pane (the P11 surface). Reads
// the SAME `pre.select-text` element the P11 spec reads, after switching tabs.
async function rawLogText(page: {
  evaluate(expr: string): Promise<unknown>;
}): Promise<string> {
  await page.evaluate(`(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === 'Compile Log');
    if (!b) throw new Error('Compile Log tab not found');
    b.click();
    return null;
  })()`);
  const t = await page.evaluate(
    `document.querySelector('pre.select-text')?.textContent ?? ''`,
  );
  if (typeof t !== 'string') {
    throw new Error(`rawLogText returned non-string: ${JSON.stringify(t)}`);
  }
  return t;
}

test('a structured compile-log entry parsed from the real preview-render warning jumps the editor to that source line, alongside the unchanged raw log', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // Install the WITNESS buffer through the real CM update pipeline. The docChanged
  // it fires triggers the app's debounced REAL preview render (api.renderPreview),
  // whose res.log feeds the Compile Log pane.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.setEditorText(${JSON.stringify(WITNESS_BUFFER)}); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(WITNESS_NOTE_KEY)})`,
    10_000,
  );

  // Wait for the REAL preview render to complete and its log to carry the
  // line-tagged orphan-note warning (the witness). Polling the raw log pane is the
  // deterministic signal the render's log is in the pane.
  await tauriPage.waitForFunction(
    `(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === 'Compile Log');
      if (b) b.click();
      const pre = document.querySelector('pre.select-text');
      const t = (pre && pre.textContent) || '';
      return /Note with key '${WITNESS_NOTE_KEY}'/.test(t) && /\\bline\\s+\\d+\\b/.test(t);
    })()`,
    45_000,
  );

  // (RAW) The raw log surface (P11) is present in the Compile Log pane AND carries
  // the real line-tagged warning. This is the SAME `pre.select-text` P11 reads —
  // proving the structured layer is added ALONGSIDE the raw log, not replacing it.
  const raw = await rawLogText(tauriPage);
  expect(raw.length).toBeGreaterThan(0);
  expect(new RegExp(`Note with key '${WITNESS_NOTE_KEY}'`).test(raw)).toBe(true);
  // Extract the SOURCE line the real warning cites — the jump target the parse
  // must recover. Read back from the REAL log, never hardcoded.
  const lnMatch = raw.match(
    new RegExp(`Note with key '${WITNESS_NOTE_KEY}'[^\\n]*?\\bline\\s+(\\d+)\\b`),
  );
  expect(lnMatch).not.toBeNull();
  const expectedLine = Number((lnMatch as RegExpMatchArray)[1]);
  expect(Number.isInteger(expectedLine)).toBe(true);
  expect(expectedLine).toBeGreaterThan(0);

  // (S1)+(S2) The STRUCTURED parse exposes an entry for the real warning with a
  // parsed {line, severity, message}. RED today: __PPE_E2E__.structuredLog does
  // not exist (no complog.ts, no hook) — this evaluate THROWS. Once the hook
  // exists, the entry must (S1) name the real warning and be severity 'warning',
  // and (S2) carry the SAME line the raw log's `line N` marker reported.
  await tauriPage.waitForFunction(
    `(() => {
      const fn = window.__PPE_E2E__ && window.__PPE_E2E__.structuredLog;
      if (!fn) return false;
      const es = fn();
      return Array.isArray(es) && es.some((e) =>
        e && e.line === ${expectedLine} &&
        String(e.severity) === 'warning' &&
        String(e.message).includes('${WITNESS_NOTE_KEY}'));
    })()`,
    20_000,
  );

  const entries = await structuredLog(tauriPage);
  const witnessEntry = entries.find(
    (e) =>
      e.line === expectedLine &&
      String(e.severity) === 'warning' &&
      String(e.message).includes(WITNESS_NOTE_KEY),
  );
  expect(witnessEntry).toBeTruthy();
  const entry = witnessEntry as LogEntry;

  // (S2) The parsed line is the SAME integer the real log's `line N` marker carries.
  expect(entry.line).toBe(expectedLine);

  // (JUMP) Activating the entry jumps the editor cursor to EXACTLY the parsed
  // source line. Activation calls the SAME goToLine the clickable entry invokes
  // (EditorPane.svelte:468/540). The expected offset is the parsed line's start,
  // computed independently from the live buffer text — so a jump to any OTHER line
  // (or a no-op when the line was dropped) lands the cursor at a DIFFERENT offset.
  const buffer = await editorText(tauriPage);
  const expectedOffset = lineStartOffset(buffer, entry.line);
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.goToLine(${entry.line}); return null; })()`,
  );
  const landed = await cursorOffset(tauriPage);
  expect(landed).toBe(expectedOffset);

  recordObservation({
    spec: manifest.spec,
    name: 'parsed-line',
    value: entry.line,
  });
  recordObservation({
    spec: manifest.spec,
    name: 'parsed-severity',
    value: entry.severity,
  });
  recordObservation({
    spec: manifest.spec,
    name: 'parsed-message',
    value: entry.message,
  });
  recordObservation({
    spec: manifest.spec,
    name: 'cursor-landed-offset',
    value: landed,
  });
});
