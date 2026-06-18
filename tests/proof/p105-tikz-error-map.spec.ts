import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  appendAtEnd,
  editorText,
  cursorOffset,
  waitForPreview,
} from './support/app';

// ── P105 — D-6: a tikz figure-compile error surfaces as a clickable TikZ-mode ──
//          log entry whose activation jumps the editor cursor to the offending
//          tikz SOURCE line.
//
// THE OBLIGATION (proof-obligations.md, P95 — exact behaviour, verbatim intent):
//   With a tikz figure open in the live preview, introducing an error into that
//   figure's tikz source — a MALFORMED tikz construct that makes the figure
//   compile FAIL — produces a compile-log ENTRY in a TikZ-mode log tab/panel: the
//   figure-compile diagnostic is surfaced to the user (the failure is VISIBLE in
//   the app, not dropped to stderr only), parsed from the `file:line:message`
//   LaTeX error the figure compile emits. ACTIVATING that log entry MOVES the
//   editor cursor to EXACTLY the offending tikz SOURCE line — the line carrying
//   the malformed construct — observed via the editor's cursor position (an
//   independent read of the cursor's line, e.g. cursorOffset() / the goto-line
//   surface), not merely a scroll.
//
// ── DISTINCT FROM P11 AND P74 (the frozen obligation is explicit) ─────────────
// P11 surfaces the PANDOC compile log (the render subprocess command + exit). P74
// parses the PANDOC-render structured log (the markdown-reader warning) and jumps
// to the markdown source line. P95/P105 is a THIRD, distinct surface: the
// FIGURE-compile log — the failure outcome of the SAME tikz→SVG figure compile
// P100 activates (tikzcd.lua → pdflatex -interaction=nonstopmode → pdf2svg). Per
// the D-3 design the figure compile, on FAILURE, currently DROPS that single
// figure and logs ONLY to stderr — the error is NOT user-visible. D-6 closes that
// gap: the figure-compile diagnostic must reach the app and surface as a
// clickable TikZ-mode log entry that maps back to the figure SOURCE line.
//
// ── INTEROP-FIRST — the parse contract is the STANDARD LaTeX error format ──────
// pdflatex `-interaction=nonstopmode` emits the standard `file:line: message`
// LaTeX error log (and a `l.NN` line marker on the bang-error block). The
// figure-compile diagnostic carries the line WITHIN the compiled figure body; the
// app maps that back to the corresponding tikz SOURCE line in the editor buffer
// (the figure source the user authored). The parse shape is LaTeX's, NOT designed
// here; the implementer's parse + line-mapping is BLIND to this spec — only the
// observable TikZ-mode log entry and the cursor landing are asserted.
//
// ── THE WITNESS FIGURE: a tikzpicture with a DELIBERATE error on a KNOWN line ──
// P100 already proves a well-formed tikzpicture compiles to an inline SVG through
// the now-active figure-compile seam. P105 appends a tikzpicture that is
// well-formed EXCEPT for one line carrying a MALFORMED construct: a `\draw`
// referencing an UNDEFINED tikz style. `\draw[ppe_no_such_style] (a) -- (b);`
// names a style `ppe_no_such_style` that is defined in NO preamble, NO shared
// palette, and NO template — so pdflatex aborts the figure compile with a
// "Package pgfkeys Error: I do not know the key '/tikz/ppe_no_such_style'"
// bang-error, citing the line of that `\draw`. The figure FAILS to compile (no
// SVG is produced for it) and the diagnostic names that source line.
//
// The malformed `\draw` is the LAST line of source before the environment close,
// at a KNOWN position in the appended block. The spec computes the absolute
// buffer line of that `\draw` from the live editor text (the index of the line
// that contains the unique malformed-style needle) — never hardcoded — so the
// jump-target assertion is pinned to where the malformed construct actually
// landed in the buffer.
//
// ── THE OBSERVABLE CONTRACT (hooks + observables, BLIND to implementation) ─────
// To drive this deterministically the harness must expose — BLIND to how the
// figure-compile diagnostic reaches the app, how the `file:line:message` records
// are parsed, and how the cursor jump is performed — these stable observables:
//
//   __PPE_E2E__.tikzFigureLog(): {line, message}[]   [NEW for P95]
//     The structured parse of the FIGURE-compile diagnostics the TikZ-mode log
//     tab/panel currently shows, produced over the REAL figure-compile error the
//     failed tikz compile emitted (the `file:line:message` LaTeX error). `line`
//     is the 1-based EDITOR-BUFFER source line the entry jumps to (the tikz
//     source line carrying the malformed construct), `message` the human-readable
//     LaTeX error text. It reflects the SAME entries the TikZ-mode panel renders
//     as a clickable list — NOT a parallel side array (a side array could pass
//     while the panel shows nothing). Empty ([]) iff no figure-compile error was
//     surfaced — exactly the D-3 stderr-only RED state.
//
//   __PPE_E2E__.activateTikzFigureLogEntry(index)   [NEW for P95]
//     Activates the figure-compile log entry at `index` — the SAME action the
//     clickable entry's activation performs — which jumps the editor cursor to
//     that entry's parsed source line (the existing goto-line / setCursor jump
//     surface, the P74/P75-class jump). Fire-and-forget; returns null. Activating
//     an entry whose parse carries no line is a no-op (no jump) — the UNPARSED
//     RED state P95 must reject.
//
//   __PPE_E2E__.cursorOffset()  [reused, the live CM6 cursor head offset] — the
//     independent read that proves the jump landed on the offending source line.
//   __PPE_E2E__.getEditorText() [reused] — the live buffer, to compute the
//     malformed line's absolute buffer line and its start char offset.
//
// ── WHAT EACH ASSERTION KILLS ──────────────────────────────────────────────────
//   (SURFACED) tikzFigureLog() contains at least one entry — the figure-compile
//         error is VISIBLE in the app. KILLS the D-3 drop-and-log-to-stderr state
//         (no entry exists for the user to see or click); this evaluate THROWS
//         today because __PPE_E2E__.tikzFigureLog does not exist (no TikZ-mode log
//         surface at all), which is itself the missing-error-surface RED.
//   (PARSED)  That entry carries a parsed `line` that EQUALS the absolute buffer
//         line of the malformed `\draw` (read back from the live buffer, not
//         hardcoded). KILLS an UNPARSED error (an entry with no usable line) and a
//         parse that maps to the WRONG line.
//   (JUMP)    ACTIVATING the entry moves the cursor to EXACTLY the START of that
//         offending source line: cursorOffset() === the char offset of that line
//         in the buffer (computed independently from the buffer text). KILLS a
//         no-op activation (cursor does not move to the line) and a jump to any
//         OTHER line.

// A tikzpicture appended at the buffer end. It is well-formed EXCEPT for the
// `\draw[ppe_no_such_style] …` line, which references a tikz style defined
// NOWHERE — so pdflatex aborts the figure compile citing that line. The
// malformed-style token is unique in the buffer, so the spec can locate the
// offending line deterministically from the live editor text.
const MALFORMED_STYLE = 'ppe_no_such_style';
const MALFORMED_DRAW = `  \\draw[${MALFORMED_STYLE}] (a) -- (b);`;
const TIKZ_BLOCK = [
  '',
  '',
  '```{=latex}',
  '\\begin{tikzpicture}',
  '  \\node (a) at (0,0) {Aleph};',
  '  \\node (b) at (2,0) {Beth};',
  MALFORMED_DRAW,
  '\\end{tikzpicture}',
  '```',
  '',
].join('\n');

// The structured TikZ-mode figure-compile log entries, via the NEW hook. `line`
// is the 1-based editor-buffer source line the entry jumps to; `message` the
// LaTeX error text.
interface TikzFigureLogEntry {
  line: number;
  message: string;
}

async function tikzFigureLog(page: {
  evaluate(expr: string): Promise<unknown>;
}): Promise<TikzFigureLogEntry[]> {
  const raw = await page.evaluate(
    `JSON.stringify(window.__PPE_E2E__.tikzFigureLog())`,
  );
  if (typeof raw !== 'string') {
    throw new Error(`tikzFigureLog returned non-string: ${JSON.stringify(raw)}`);
  }
  return JSON.parse(raw) as TikzFigureLogEntry[];
}

// The 0-based char offset of the START of 1-based line `line` in `text` — the
// position the goto-line jump places the cursor at (doc.line(n).from). Computed
// independently from the buffer so the JUMP assertion does not trust the
// implementation's own offset math. (Same idiom as P74's lineStartOffset.)
function lineStartOffset(text: string, line: number): number {
  const lines = text.split('\n');
  let off = 0;
  for (let i = 0; i < line - 1; i++) {
    off += lines[i].length + 1; // +1 for the '\n' separator
  }
  return off;
}

// The absolute 1-based buffer line carrying the unique malformed-style needle,
// read from the live editor text. This is the offending tikz SOURCE line the
// figure-compile error must map back to.
function malformedLineNumber(text: string, needle: string): number {
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => l.includes(needle));
  if (idx < 0) {
    throw new Error(`malformed needle not found in buffer: ${needle}`);
  }
  return idx + 1; // 1-based
}

test('a tikz figure-compile error surfaces as a clickable TikZ-mode log entry whose activation jumps the editor cursor to the offending tikz source line', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // The app + preview must be alive first, so a later assertion failure is the
  // missing figure-compile error surface, not a boot/setup error.
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Append the malformed tikzpicture at the buffer end through the REAL editor
  // update pipeline — the SAME docChanged → scheduleRender(debounce) → real
  // pandoc → tikzcd.lua → pdflatex figure-compile path user typing fires. The
  // figure compile FAILS on the undefined-style `\draw` line.
  await appendAtEnd(tauriPage, TIKZ_BLOCK);

  // Wait for the editor to carry the malformed construct (the append landed), so
  // the offending source line can be located in the live buffer.
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(MALFORMED_STYLE)})`,
    10_000,
  );

  // The offending tikz SOURCE line: the absolute buffer line carrying the unique
  // malformed-style needle, read back from the live buffer (never hardcoded).
  const buffer = await editorText(tauriPage);
  const offendingLine = malformedLineNumber(buffer, MALFORMED_STYLE);
  expect(offendingLine).toBeGreaterThan(0);

  // (SURFACED) After the configured debounce + real render, the failed figure
  // compile's diagnostic must reach the app and surface as a TikZ-mode log entry.
  // RED today: __PPE_E2E__.tikzFigureLog does not exist (the figure-compile error
  // is DROPPED to stderr only — no TikZ-mode log tab, no clickable entry), so this
  // poll never sees a non-throwing, non-empty result. The waitForFunction body
  // tolerates the hook being absent (returns false) so the failure is the missing
  // error surface — not a thrown boot error.
  await tauriPage.waitForFunction(
    `(() => {
      const fn = window.__PPE_E2E__ && window.__PPE_E2E__.tikzFigureLog;
      if (!fn) return false;
      const es = fn();
      return Array.isArray(es) && es.length > 0;
    })()`,
    45_000,
  );

  const entries = await tikzFigureLog(tauriPage);
  expect(entries.length).toBeGreaterThan(0);

  // (PARSED) An entry maps to EXACTLY the offending tikz source line — the buffer
  // line carrying the malformed `\draw`. KILLS an unparsed error (no usable line)
  // and a parse that maps to the wrong line.
  const witnessEntry = entries.find((e) => e.line === offendingLine);
  expect(witnessEntry).toBeTruthy();
  const entry = witnessEntry as TikzFigureLogEntry;
  expect(entry.line).toBe(offendingLine);

  // (JUMP) ACTIVATING the entry (the SAME action the clickable entry performs)
  // moves the editor cursor to EXACTLY the START of the offending source line. The
  // expected offset is that line's start, computed independently from the live
  // buffer text — so a no-op activation (cursor does not move) or a jump to any
  // OTHER line lands the cursor at a DIFFERENT offset.
  const idx = entries.indexOf(entry);
  const expectedOffset = lineStartOffset(buffer, offendingLine);
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.activateTikzFigureLogEntry(${idx}); return null; })()`,
  );
  const landed = await cursorOffset(tauriPage);
  expect(landed).toBe(expectedOffset);

  recordObservation({
    spec: manifest.spec,
    name: 'figure-error-line',
    value: entry.line,
  });
  recordObservation({
    spec: manifest.spec,
    name: 'figure-error-message',
    value: entry.message,
  });
  recordObservation({
    spec: manifest.spec,
    name: 'cursor-landed-offset',
    value: landed,
  });
});
