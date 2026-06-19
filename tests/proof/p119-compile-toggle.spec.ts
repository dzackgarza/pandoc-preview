import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  waitForPreview,
  waitForHarness,
  appendAtEnd,
  sleep,
} from './support/app';

// P110 (Phase F / F4) — AUTO/MANUAL + FAST/FULL PDF-COMPILE CONTROLS are HONORED.
//
// The PDF preview pane (the F1 pdf.js viewer + compile-on-idle scheduler, P107)
// carries TWO config-persisted controls living in the [preview] config table next
// to debounce_ms (the F1 pdf-preview fields):
//   - an AUTO/MANUAL toggle that GATES whether the compile-on-idle scheduler fires
//     on an edit (MANUAL suppresses idle recompiles until an explicit Recompile);
//   - a FAST/FULL selection that picks WHICH of two CONFIGURED PDF command ids the
//     scheduler / the explicit Recompile runs:
//       FAST = the draft SINGLE-PASS command (pandoc md->latex + ONE lualatex pass,
//              the p118 single-pass baseline) — leaves a forward \ref / \cite
//              UNRESOLVED ((??) / [?]);
//       FULL = the F3 latexmk MULTI-PASS driver (P109, latexmk-pdf-export) — runs
//              as-many-passes-as-needed + auto-BibTeX, RESOLVING both.
// These are config-persisted STATE selecting between CONFIGURED commands — NOT new
// build machinery. RESEARCH-FIRST (HARD RULE #0).
//
// WHAT THIS SPEC PROVES (P110 observable clauses, nothing about wiring):
//   (a) MANUAL — with MANUAL set, an edit does NOT trigger a recompile: an
//       INDEPENDENT process reading the on-disk PDF finds it BYTE-UNCHANGED after
//       the compile-on-idle debounce window elapses (the scheduler did not fire).
//       Invoking the explicit "Recompile PDF" command (the buildCommands palette
//       entry) THEN produces a FRESH PDF on disk whose pdftotext text carries the
//       just-edited witness the pre-recompile PDF lacked.
//   (b) AUTO — with AUTO set, an edit DOES trigger a recompile within the debounce:
//       after the debounce an INDEPENDENT process reads a freshly-compiled on-disk
//       PDF whose pdftotext text carries the edit, with NO explicit Recompile.
//   (c) FAST->FULL — switching FAST->FULL changes WHICH configured command runs,
//       observable BOTH in the compile log (the logged command line differs — a
//       different argv[0]/flags between the single-pass draft and the latexmk
//       multi-pass driver, the P11 raw-log surface) AND in the produced artifact
//       (FULL resolves references P109-style — the forward \ref to a real number
//       and the \cite to its author/year, recovered by an INDEPENDENT pdftotext;
//       FAST does NOT — it leaves (??) / [?]).
//
// Every PDF is read off disk by INDEPENDENT processes (pdfinfo/pdftotext); the
// logged command line is read from the live Compile Log pane (the P11 surface).
// This is NOT satisfied by an existence check on a toggle symbol: a toggle whose
// state the scheduler ignores (MANUAL still auto-recompiles), a Recompile that is a
// no-op, or a fast/full selector that runs one hardcoded command regardless, would
// each pass an existence check while failing a clause below.
//
// ADMISSIBLE because it FAILS on a plausibly broken app:
//   - an IGNORED auto/manual toggle (MANUAL still auto-recompiles — the on-disk PDF
//     changes within the debounce window despite no Recompile) -> clause (a);
//   - a Recompile command that is a no-op (after MANUAL + Recompile no fresh PDF
//     carrying the edit appears on disk) -> clause (a);
//   - an AUTO mode that never fires (no freshly-compiled PDF after the debounce)
//     -> clause (b);
//   - an IGNORED fast/full selection (FAST and FULL run the SAME command — the
//     logged command line is identical and both artifacts resolve, or neither
//     resolves, the references) -> clause (c).
//
// RED today: there are NO auto/manual + fast/full PDF-compile controls. The
// [preview] config table carries only debounce_ms (F4's auto/manual + fast/full
// fields do not exist, and the schema is deny_unknown_fields), and the harness
// exposes no setPdfCompileMode / setPdfCompileSpeed / recompilePdf hooks. So the
// evaluate that sets MANUAL (or FAST/FULL, or fires Recompile) THROWS — the
// faithful "no compile-toggle surface" failure P110 names. The app BOOTS cleanly
// (the canonical config + the schema-valid FAST/FULL command sections provisioned)
// and the HTML preview renders FIRST below, so the failure is the MISSING controls,
// never a boot/config-schema error.
//
// PROVISIONING (scripts/provision-proof.sh, p119 case): demo.md is the p118
// multipass fixture (a forward \eqref to a LATER \label + a \cite against the
// config-declared bib) — a source a SINGLE pass leaves unresolved. The hermetic
// config installs TWO configured PDF command ids: the FAST single-pass draft
// (id `fast-pdf-export`, the p118 single-pass export.sh baseline) and the FULL
// latexmk multi-pass driver (id `latexmk-pdf-export`, P109). The luaotfload cache
// is warmed in provisioning so the in-app compiles land within the wait windows.

// The forward equation cross-reference resolved to a real number (FULL only). A
// single pass renders (??).
const REF_RESOLVED = 'equation (1)';
const REF_UNRESOLVED = '(??)';
// The citation rendered to its bibliography entry (FULL only). A single pass (no
// BibTeX) renders the unresolved [?] marker.
const CITATION_AUTHOR = 'Dolgachev';
const CITATION_UNRESOLVED = '[?]';

// A distinctive edit witness the post-edit recompile must carry into the PDF, and
// the pre-edit PDF must lack. A plain prose sentence (no LaTeX structure) so it
// passes through pandoc md->latex verbatim and is recoverable by pdftotext.
const EDIT_WITNESS = 'Manual recompile witness sentinel 31415.';

// Read the on-disk PDF the PDF-preview compile produced, via the F1 artifact
// accessor, polling until an existing path is returned. The decisive on-disk
// proof; never a substitute is accepted.
async function waitForPdfArtifact(
  page: { evaluate(expr: string): Promise<unknown> },
  what: string,
): Promise<string> {
  for (let i = 0; i < 240; i++) {
    const raw = await page.evaluate(
      `(() => { const p = window.__PPE_E2E__.pdfPreviewArtifact(); return p === undefined || p === null ? '' : String(p); })()`,
    );
    if (typeof raw === 'string' && raw.length > 0 && existsSync(raw)) {
      return raw;
    }
    await sleep(500);
  }
  throw new Error(`${what}: pdfPreviewArtifact() never returned an existing path`);
}

function pdfText(path: string): string {
  return execFileSync('pdftotext', [path, '-'], { encoding: 'utf-8' });
}

// The raw compile-log text shown in the Compile Log pane (the P11 surface). Reads
// the SAME pre.select-text element P11 reads, after switching to the tab.
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

test('the auto/manual + fast/full PDF-compile controls gate idle recompiles and select different configured commands with different artifacts', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // Bring the app + project + HTML preview up FIRST, so a RED failure below is
  // demonstrably the missing compile-toggle surface, not a boot/open/render error.
  await waitForHarness(tauriPage);
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Activate the PDF preview pane (the F1 pdf.js viewer surface, P107).
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.setPreviewMode('pdf'); return null; })()`,
  );

  // ── Clause (c) groundwork: select FAST, do a baseline compile ──────────────
  // Select MANUAL so each compile is explicit and we control exactly which command
  // ran, then select FAST (the single-pass draft). RED today: setPdfCompileMode /
  // setPdfCompileSpeed do not exist -> this evaluate THROWS (the faithful no-toggle
  // failure P110 names).
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.setPdfCompileMode('manual'); window.__PPE_E2E__.setPdfCompileSpeed('fast'); return null; })()`,
  );

  // Fire the explicit Recompile PDF command (the buildCommands palette entry) under
  // FAST, and wait for the PDF compile's status cluster to reach 'ok'.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.recompilePdf(); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.pdfStatus && window.__PPE_E2E__.pdfStatus() === 'ok'`,
    180_000,
  );
  const fastArtifact = await waitForPdfArtifact(tauriPage, 'FAST compile');
  const fastHead = readFileSync(fastArtifact).subarray(0, 5).toString('latin1');
  expect(fastHead).toBe('%PDF-');
  const fastText = pdfText(fastArtifact);
  // The single-pass FAST artifact leaves BOTH references unresolved.
  expect(fastText.includes(REF_UNRESOLVED)).toBe(true);
  expect(fastText.includes(CITATION_UNRESOLVED)).toBe(true);
  expect(fastText.includes(REF_RESOLVED)).toBe(false);
  expect(fastText.includes(CITATION_AUTHOR)).toBe(false);
  // Capture the FAST command line from the P11 raw log.
  const fastLog = await rawLogText(tauriPage);
  expect(fastLog.length).toBeGreaterThan(0);

  // ── Clause (c): switch FAST -> FULL, recompile, observe a DIFFERENT command ──
  // and a DIFFERENT (reference-resolving) artifact.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.setPdfCompileSpeed('full'); return null; })()`,
  );
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.recompilePdf(); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.pdfStatus && window.__PPE_E2E__.pdfStatus() === 'ok'`,
    300_000,
  );
  const fullArtifact = await waitForPdfArtifact(tauriPage, 'FULL compile');
  const fullText = pdfText(fullArtifact);
  // The FULL (latexmk multi-pass) artifact RESOLVES both references (P109-style).
  expect(fullText.includes(REF_RESOLVED)).toBe(true);
  expect(fullText.includes(REF_UNRESOLVED)).toBe(false);
  expect(fullText.includes(CITATION_AUTHOR)).toBe(true);
  expect(fullText.includes(CITATION_UNRESOLVED)).toBe(false);
  // The logged command line DIFFERS between FAST and FULL (the selection picked a
  // different configured command — different argv[0]/flags).
  const fullLog = await rawLogText(tauriPage);
  expect(fullLog.length).toBeGreaterThan(0);
  expect(fullLog).not.toBe(fastLog);
  // The FULL command line names the latexmk multi-pass driver; the FAST one does
  // not (the single-pass draft). A shared-command (ignored selection) state would
  // make these identical, failing the previous assertion.
  expect(fullLog.includes('latexmk-pdf-export')).toBe(true);

  recordObservation({
    spec: manifest.spec,
    name: 'fast-vs-full-log-differ',
    value: fullLog !== fastLog,
  });

  // ── Clause (a): MANUAL suppresses idle recompiles until an explicit Recompile ─
  // Stay in MANUAL. Edit the buffer (the SAME real CM update pipeline P43 drives),
  // then wait LONGER than the compile-on-idle debounce window. Under MANUAL the
  // scheduler must NOT fire: the on-disk PDF must be BYTE-UNCHANGED, and it must
  // still LACK the just-typed edit witness.
  const beforeEdit = readFileSync(fullArtifact);
  await appendAtEnd(tauriPage, `\n\n${EDIT_WITNESS}\n`);
  // The configured debounce is 200ms (canonical witness config); wait an order of
  // magnitude longer so a firing scheduler would certainly have produced a fresh
  // PDF by now.
  await sleep(8000);
  const afterDebounce = readFileSync(fullArtifact);
  // BYTE-UNCHANGED: MANUAL did not auto-recompile.
  expect(Buffer.compare(beforeEdit, afterDebounce)).toBe(0);
  // And the edit witness is absent from the PDF (no recompile carried it in).
  expect(pdfText(fullArtifact).includes(EDIT_WITNESS)).toBe(false);

  // Now fire the explicit Recompile PDF command under FULL — a FRESH PDF carrying
  // the edit must appear on disk.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.recompilePdf(); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.pdfStatus && window.__PPE_E2E__.pdfStatus() === 'ok'`,
    300_000,
  );
  await tauriPage.waitForFunction(
    `(() => { const p = window.__PPE_E2E__.pdfPreviewArtifact(); return !!p; })()`,
    10_000,
  );
  // Poll the on-disk PDF until pdftotext recovers the edit witness the
  // pre-recompile PDF lacked (proving the Recompile produced a fresh artifact).
  let recompiledCarriesEdit = false;
  for (let i = 0; i < 240; i++) {
    const p = await tauriPage.evaluate(
      `(() => { const p = window.__PPE_E2E__.pdfPreviewArtifact(); return p === undefined || p === null ? '' : String(p); })()`,
    );
    if (typeof p === 'string' && p.length > 0 && existsSync(p)) {
      if (pdfText(p).includes(EDIT_WITNESS)) {
        recompiledCarriesEdit = true;
        break;
      }
    }
    await sleep(500);
  }
  expect(recompiledCarriesEdit).toBe(true);

  // ── Clause (b): AUTO recompiles within the debounce, no explicit Recompile ───
  // Switch to AUTO and FAST (FAST is faster; the AUTO clause only needs the edit
  // to land, not reference resolution). Edit the buffer with a SECOND distinctive
  // witness, then — with NO explicit Recompile invoked — observe a freshly-compiled
  // on-disk PDF carrying that witness within the debounce window.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.setPdfCompileMode('auto'); window.__PPE_E2E__.setPdfCompileSpeed('fast'); return null; })()`,
  );
  const AUTO_WITNESS = 'Auto recompile witness sentinel 27182.';
  await appendAtEnd(tauriPage, `\n\n${AUTO_WITNESS}\n`);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.pdfStatus && window.__PPE_E2E__.pdfStatus() === 'ok'`,
    300_000,
  );
  let autoCarriesEdit = false;
  for (let i = 0; i < 240; i++) {
    const p = await tauriPage.evaluate(
      `(() => { const p = window.__PPE_E2E__.pdfPreviewArtifact(); return p === undefined || p === null ? '' : String(p); })()`,
    );
    if (typeof p === 'string' && p.length > 0 && existsSync(p)) {
      if (pdfText(p).includes(AUTO_WITNESS)) {
        autoCarriesEdit = true;
        break;
      }
    }
    await sleep(500);
  }
  expect(autoCarriesEdit).toBe(true);

  recordObservation({
    spec: manifest.spec,
    name: 'manual-suppressed-then-recompiled',
    value: recompiledCarriesEdit,
  });
  recordObservation({
    spec: manifest.spec,
    name: 'auto-recompiled-on-edit',
    value: autoCarriesEdit,
  });
});
