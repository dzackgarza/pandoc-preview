import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  runPluginById,
  pluginResult,
  waitForPreview,
  sleep,
} from './support/app';

// P108 (Phase F / F2) — TEMP-DIRECTORY BUILD ISOLATION: a PDF compile must NOT
// scatter LaTeX intermediates (.aux/.log/.fls/.out/build .pdf) beside the user's
// thesis source.
//
// Today the export boundary spawns the export-plugin command with current_dir =
// the SOURCE FILE PARENT directory (render.rs export_sync / plugins.rs), so a
// LaTeX build driver writes its intermediates into the source tree D. F2 routes
// the build into an isolated temp/build directory (latexmk's native
// -output-directory/-jobname is the plugin's argv concern; the app supplies the
// path) so the intermediates land OUTSIDE D, while the user-chosen one-shot export
// {output} (P8) still lands at its chosen path with its witnesses + engine
// discrimination intact — only the intermediates move.
//
// WHY THE latexmk DRIVER (not the shipped bare-pandoc command): the obligation's
// observable is intermediates appearing beside the source. Bare pandoc
// (--pdf-engine=lualatex, the shipped pandoc-pdf-export command) self-isolates —
// it runs the engine in pandoc's OWN private temp dir — so it NEVER litters the
// source tree and the litter clause would be unobservable on a perfectly broken
// app. P108 names the "pandoc -> lualatex VIA latexmk" command; latexmk writes
// .aux/.fls/.log/.out/.fdb_latexmk/.pdf into its WORKING directory, so it surfaces
// the EXACT app-core seam P108 targets (the build's current_dir). The Phase F plan
// calls swapping to the latexmk command a "config swap, not new core code"; this
// spec provisions exactly that driver (the latexmk-pdf-export plugin) so the
// build's working-directory choice is observable.
//
// WHAT THIS SPEC PROVES (P108 observable clauses, nothing about wiring):
//   (1) NO-LITTER: an INDEPENDENT process (Node fs, not the app) lists D before
//       and after the compile; the set of files NEWLY created in D contains NO
//       *.aux, *.log, *.fls, *.out, *.fdb_latexmk, or build *.pdf — the
//       intermediates live in the isolated build/temp directory, not beside the
//       thesis source.
//   (2) P8 PRESERVED: the user-chosen one-shot export {output} (placed OUTSIDE D)
//       still lands at EXACTLY its chosen path — read off disk by INDEPENDENT
//       processes (pdfinfo validity + Pages:, pdftotext carrying BOTH witnesses
//       "Geometry of Numbers" + "Minkowski bound"). The isolation moves the
//       INTERMEDIATES only; it never relocates or drops the user-requested
//       artifact.
//
// ADMISSIBLE because it FAILS on a plausibly broken app:
//   - the CURRENT current_dir = source-parent behavior, where the latexmk driver
//     scatters .aux/.log/.fls/.out/build-.pdf into D -> clause (1) (the
//     before/after listing of D shows newly-created intermediate files);
//   - an isolation that ALSO misplaces the one-shot export artifact (the {output}
//     PDF missing from its chosen path, or no longer carrying the witnesses) ->
//     clause (2);
//   - an unresolvable build/temp dir treated silently so the compile proceeds
//     writing intermediates into D anyway (or produces no artifact) -> clause (1)
//     and/or the missing-artifact guard.
//
// It is NOT satisfied by an assertion that a {builddir}/temp-dir symbol or an
// -output-directory flag merely EXISTS in the configured command: a command that
// names a build dir but whose driver still writes intermediates beside the source
// would pass an existence check while failing clause (1). The proof lists D by an
// INDEPENDENT process before and after the compile and observes NO new
// intermediate files created in D.
//
// RED today: the build runs with current_dir = the source parent, so the latexmk
// driver scatters demo.aux/.fls/.log/.out/.fdb_latexmk/.pdf into D — clause (1)
// observes the newly-created intermediates and fails. The app BOOTS cleanly (the
// canonical config + the schema-valid [plugin.latexmk-pdf-export] section is all
// that is provisioned) and the HTML preview renders FIRST below, so the failure is
// the source-tree littering, NOT a boot/open/render error.

const WITNESS_TITLE = 'Geometry of Numbers';
const WITNESS_BOUND = 'Minkowski bound';

// LaTeX build intermediates a driver scatters into its working directory. The
// build .pdf is included: the build driver's PDF lands beside the source too (the
// user-chosen {output} is a SEPARATE artifact, written OUTSIDE D).
const INTERMEDIATE_EXTS = ['.aux', '.log', '.fls', '.out', '.fdb_latexmk', '.pdf'];

function isIntermediate(name: string): boolean {
  return INTERMEDIATE_EXTS.some((ext) => name.endsWith(ext));
}

// Independent listing of D (Node fs in the test runner process — never the app's
// own report).
function listDir(dir: string): string[] {
  return readdirSync(dir).sort();
}

test('PDF build does not litter the source tree; the one-shot export still lands at its path', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // D = the directory the source file (demo.md) lives in: the hermetic project dir.
  const D = manifest.project;

  // Bring the app + project + HTML preview up FIRST, so a RED failure below is
  // demonstrably the source-tree littering, not a boot/open/render error: the app
  // booted, the project opened, demo.md is selected, and the existing HTML preview
  // rendered (its <h1> is present).
  await openAndSelectDemo(tauriPage, D);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Snapshot D BEFORE the compile (independent fs listing).
  const before = new Set(listDir(D));

  // The user-chosen one-shot export {output}: placed OUTSIDE D (at the run dir) so
  // D contains only the source + any build litter, and so clause (2) proves the
  // artifact lands at EXACTLY the user-chosen path.
  const output = join(manifest.runDir, 'export-witness.pdf');
  expect(existsSync(output)).toBe(false);

  // Fire the real one-shot export by running the PDF export plugin by id through
  // the generic firewall (P8 idiom): discover -> spawn the plugin's command with
  // the real source, build the PDF, write {output}. Then poll for the artifact AND
  // the structured PluginResult.
  await runPluginById(tauriPage, 'latexmk-pdf-export', output);

  let result = await pluginResult(tauriPage);
  for (let i = 0; i < 320 && (!existsSync(output) || result === null); i++) {
    await sleep(500);
    result = await pluginResult(tauriPage);
  }
  if (!existsSync(output)) {
    throw new Error(
      `One-shot export artifact never appeared at ${output} (result: ${JSON.stringify(result)}). ` +
        `The latexmk-pdf-export plugin did not produce the PDF — the failure must be the ` +
        `source-tree littering, not a missing artifact.`,
    );
  }

  // Snapshot D AFTER the compile (independent fs listing). The set of files NEWLY
  // created in D is the difference; the intermediates among them are the litter.
  const after = listDir(D);
  const created = after.filter((name) => !before.has(name));
  const litter = created.filter(isIntermediate);

  recordObservation({
    spec: manifest.spec,
    name: 'd-created-files',
    value: created.join(',') || '(none)',
  });
  recordObservation({
    spec: manifest.spec,
    name: 'd-litter',
    value: litter.join(',') || '(none)',
  });

  // ── Clause (1): NO new LaTeX intermediate appears in D ──────────────────────
  // RED today: current_dir = source parent, so the latexmk driver scatters
  // demo.aux/.fls/.log/.out/.fdb_latexmk/.pdf into D and this array is non-empty.
  expect(litter).toEqual([]);

  // ── Clause (2): the one-shot {output} still lands at its chosen path (P8) ────
  // Read the produced PDF off disk by INDEPENDENT processes.
  const head = readFileSync(output).subarray(0, 5).toString('latin1');
  expect(head).toBe('%PDF-');
  const info = execFileSync('pdfinfo', [output], { encoding: 'utf-8' });
  const pagesMatch = info.match(/Pages:\s+(\d+)/);
  expect(pagesMatch).not.toBeNull();
  expect(Number((pagesMatch as RegExpMatchArray)[1])).toBeGreaterThanOrEqual(1);

  // Extracted text (independent process) carries BOTH witnesses, proving the
  // {output} is the freshly compiled demo.md — not a stale or unrelated artifact.
  const textOut = execFileSync('pdftotext', [output, '-'], { encoding: 'utf-8' });
  expect(textOut.includes(WITNESS_TITLE)).toBe(true);
  expect(textOut.includes(WITNESS_BOUND)).toBe(true);

  recordObservation({
    spec: manifest.spec,
    name: 'output-pages-info',
    value: info.trim().split('\n')[0] ?? '',
  });
});
