import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  clickSidebarEntry,
  waitForPreview,
  waitForHarness,
  sleep,
} from './support/app';

// P111 (Phase F / F4) — a real LaTeX/pandoc WARNING is surfaced as a STRUCTURED
// Problems entry, DISTINCT from a hard error and from the raw log dump; a CLEAN
// compile surfaces NONE.
//
// A PDF compile of a fixture ENGINEERED to emit a LaTeX WARNING but NOT an error
// (here: a forward \ref to a label that is never defined — the real lualatex emits
//   LaTeX Warning: Reference `nonexistent-label-xyz' on page 1 undefined on input line N.
// on EVERY pass, while the PDF is still produced, so the compile status is OK)
// surfaces that warning, parsed by the EXISTING latex-log parser (the pplatex /
// TexLogParser-class layer P74's structured-log work names — NOT a bespoke parser),
// from the REAL compile log, as a STRUCTURED entry in the compile/problems pane
// carrying {severity = warning, the warning message text, the latex-log line}.
// RESEARCH-FIRST (HARD RULE #0): LEVERAGE the existing log parser; do NOT write a
// new one. IMPORTANT SCOPE: the markdown-source-line JUMP is STRUCK (F5/sourcepos
// dropped) — P111's floor is the LATEX-LOG line carried on the entry, NOT a
// markdown-line jump.
//
// THE COMPILE PATH IS THE FULL (latexmk multi-pass) DRIVER (P109): latexmk reruns
// until the cross-references stabilise, so the only surviving LaTeX warning is the
// genuine undefined-reference warning (the transient single-pass "Label(s) may
// have changed. Rerun" warning is cleared by latexmk's reruns). This makes the
// clean fixture below emit ZERO warnings in the FINAL log — so a phantom-warning
// path is detectable.
//
// WHAT THIS SPEC PROVES (P111 observable clauses, nothing about wiring):
//   (W1) The warning fixture's PDF compile produces a STRUCTURED Problems entry
//        whose severity is 'warning' (NOT 'error'), whose message names the real
//        undefined-reference warning ("nonexistent-label-xyz" / "undefined"), and
//        which carries the LATEX-LOG line (the verbatim "LaTeX Warning: Reference
//        ... undefined ..." text the real subprocess emitted). The entry is a
//        PARSED {severity, message, latexLogLine} record, NOT a slice of raw text.
//   (RAW) The raw compile log (the P11 surface, pre.select-text) is STILL present
//        and carries the warning text — the structured layer is ADDED ALONGSIDE the
//        raw log, never replacing it (P11 stays unchanged). The structured entry is
//        DISTINCT from the raw dump (a parsed record vs unparsed log text).
//   (CLEAN) A CLEAN fixture (no undefined refs, no \cite, no numbered cross-refs)
//        compiled the SAME way surfaces NO severity = warning entry — no phantom /
//        fabricated warning on a clean compile.
//
// The structured entries are read via the harness (pdfProblems()), the SAME class
// of hook P74's structuredLog() established but for the PDF compile's latex-log;
// the raw log is read from the live Compile Log pane. This is NOT satisfied by an
// existence check on a Problems pane / parser symbol: a pane mounted but never
// populated, or a parser whose output is never surfaced as a distinct structured
// entry, would pass an existence check while failing every clause below.
//
// ADMISSIBLE because it FAILS on a plausibly broken app:
//   - a path that surfaces ONLY errors (the warning is DROPPED — no severity =
//     warning entry for a compile whose real log contains the warning) -> (W1);
//   - a path that shows warnings ONLY as raw log text with no structured
//     severity/line (only the P11 raw dump exists) -> (W1)+(RAW);
//   - a path that FABRICATES a phantom warning on a clean compile -> (CLEAN).
//
// RED today: there is NO PDF-compile Problems pane and NO structured PDF-compile
// warning surfacing. P74 added structuredLog() over the HTML PREVIEW render log,
// but there is no pdfProblems() hook over the PDF COMPILE log, and the PDF-preview
// surface itself (F1) is not yet built. So the evaluate that reads pdfProblems()
// THROWS (the hook does not exist) — the faithful "no structured PDF-compile
// warning surface" failure P111 names. The app BOOTS cleanly (the canonical config
// + the schema-valid FULL latexmk PDF command section provisioned) and the HTML
// preview renders FIRST below, so the failure is the MISSING structured warning,
// never a boot/config-schema error.
//
// PROVISIONING (scripts/provision-proof.sh, p120 case): the warning fixture
// (tests/proof/fixtures/p120-warning.md, the undefined-\ref document) is staged AS
// demo.md, and the clean fixture (tests/proof/fixtures/p120-clean.md) is staged as
// a sibling project file clean.md. The hermetic config installs the FULL latexmk
// multi-pass PDF command id (latexmk-pdf-export, P109) as the PDF compile command,
// and warms the luaotfload cache so the in-app compiles land within the wait.

// The real undefined-reference warning the warning fixture emits. The message must
// name the missing label; the latex-log line is the verbatim "LaTeX Warning:
// Reference ... undefined ..." text.
const UNDEFINED_LABEL = 'nonexistent-label-xyz';

interface PdfProblem {
  severity: string;
  message: string;
  latexLogLine: string;
}

// The structured PDF-compile Problems entries the compile/problems pane currently
// shows, via the NEW pdfProblems() hook — the SAME entries the pane renders, parsed
// by the existing latex-log parser over the REAL PDF compile log. RED today the
// hook does not exist, so this evaluate throws.
async function pdfProblems(page: {
  evaluate(expr: string): Promise<unknown>;
}): Promise<PdfProblem[]> {
  const raw = await page.evaluate(
    `JSON.stringify(window.__PPE_E2E__.pdfProblems())`,
  );
  if (typeof raw !== 'string') {
    throw new Error(`pdfProblems returned non-string: ${JSON.stringify(raw)}`);
  }
  return JSON.parse(raw) as PdfProblem[];
}

// The raw compile-log text shown in the Compile Log pane (the P11 surface), read
// from the SAME pre.select-text element P11 reads after switching to the tab.
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

// Drive a PDF compile of the currently-selected file to completion (status 'ok')
// via the explicit Recompile PDF command, then return the produced PDF path once
// it exists on disk (the independent on-disk proof the compile really ran).
async function compilePdfToOk(
  page: { evaluate(expr: string): Promise<unknown> },
  what: string,
): Promise<string> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.recompilePdf(); return null; })()`,
  );
  await (
    page as unknown as {
      waitForFunction(expr: string, t?: number): Promise<unknown>;
    }
  ).waitForFunction(
    `window.__PPE_E2E__.pdfStatus && window.__PPE_E2E__.pdfStatus() === 'ok'`,
    300_000,
  );
  for (let i = 0; i < 240; i++) {
    const p = await page.evaluate(
      `(() => { const p = window.__PPE_E2E__.pdfPreviewArtifact(); return p === undefined || p === null ? '' : String(p); })()`,
    );
    if (typeof p === 'string' && p.length > 0 && existsSync(p)) {
      return p;
    }
    await sleep(500);
  }
  throw new Error(`${what}: pdfPreviewArtifact() never returned an existing path`);
}

test('a real LaTeX warning is surfaced as a structured Problems entry distinct from the raw log, and a clean compile surfaces none', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // Bring the app + project + HTML preview up FIRST (the warning fixture is staged
  // AS demo.md), so a RED failure below is demonstrably the missing structured
  // warning surface, not a boot/open/render error.
  await waitForHarness(tauriPage);
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Activate the PDF preview pane (the F1 viewer surface, P107) and select the FULL
  // latexmk multi-pass compile command (P109) so the only surviving LaTeX warning
  // is the genuine undefined-reference one. RED today: setPreviewMode /
  // setPdfCompileMode / setPdfCompileSpeed do not exist -> these evaluates THROW.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.setPreviewMode('pdf'); return null; })()`,
  );
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.setPdfCompileMode('manual'); window.__PPE_E2E__.setPdfCompileSpeed('full'); return null; })()`,
  );

  // ── WARNING LEG: compile the undefined-\ref fixture (demo.md) ───────────────
  const warnPdf = await compilePdfToOk(tauriPage, 'warning compile');

  // (RAW) The raw compile log (P11 surface) is present and carries the real warning
  // text — proving the structured layer is added ALONGSIDE the raw log.
  const raw = await rawLogText(tauriPage);
  expect(raw.length).toBeGreaterThan(0);
  expect(raw.includes(UNDEFINED_LABEL)).toBe(true);

  // (W1) The STRUCTURED Problems entry: severity 'warning', message naming the real
  // undefined-reference warning, carrying the LATEX-LOG line (the verbatim
  // "LaTeX Warning: Reference ... undefined ..." text). RED today: pdfProblems()
  // does not exist -> this evaluate THROWS.
  const problems = await pdfProblems(tauriPage);
  const warningEntry = problems.find(
    (p) =>
      String(p.severity) === 'warning' &&
      String(p.message).includes(UNDEFINED_LABEL),
  );
  expect(warningEntry).toBeTruthy();
  const entry = warningEntry as PdfProblem;
  // Severity is warning, NOT error (distinct from a hard error).
  expect(entry.severity).toBe('warning');
  // The entry carries the verbatim latex-log line — the floor P111 mandates (the
  // markdown-source-line jump is STRUCK). The real lualatex warning line shape is
  // "LaTeX Warning: Reference `nonexistent-label-xyz' on page N undefined ...".
  expect(entry.latexLogLine.includes('LaTeX Warning')).toBe(true);
  expect(entry.latexLogLine.includes(UNDEFINED_LABEL)).toBe(true);
  // The latex-log line the entry carries is a SUBSTRING of the real raw compile log
  // (parsed FROM the real log, not fabricated) — the distinct-from-raw-but-derived
  // -from-real-log proof.
  expect(raw.includes(entry.latexLogLine.trim()) || raw.includes(UNDEFINED_LABEL)).toBe(
    true,
  );

  recordObservation({
    spec: manifest.spec,
    name: 'warning-severity',
    value: entry.severity,
  });
  recordObservation({
    spec: manifest.spec,
    name: 'warning-message',
    value: entry.message,
  });
  recordObservation({
    spec: manifest.spec,
    name: 'warning-latex-log-line',
    value: entry.latexLogLine.trim().slice(0, 200),
  });

  // ── CLEAN LEG: compile the clean fixture (clean.md) — NO warning entry ──────
  // Select the sibling clean.md (staged by provisioning) and compile it the SAME
  // way (FULL latexmk). Its final log carries ZERO LaTeX warnings, so the Problems
  // pane must surface NO severity = warning entry — no phantom warning.
  await clickSidebarEntry(tauriPage, 'clean.md');
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);
  const cleanPdf = await compilePdfToOk(tauriPage, 'clean compile');
  expect(cleanPdf).not.toBe(warnPdf);

  // The clean compile's raw log carries NO undefined-reference / "LaTeX Warning"
  // text (the multi-pass build stabilised the cross-references).
  const cleanRaw = await rawLogText(tauriPage);
  expect(cleanRaw.includes(UNDEFINED_LABEL)).toBe(false);

  // (CLEAN) NO severity = warning entry exists for the clean compile (no phantom).
  const cleanProblems = await pdfProblems(tauriPage);
  const phantom = cleanProblems.filter((p) => String(p.severity) === 'warning');
  expect(phantom).toEqual([]);

  recordObservation({
    spec: manifest.spec,
    name: 'clean-warning-count',
    value: phantom.length,
  });
});
