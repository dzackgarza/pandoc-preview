import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, waitForPreview, waitForHarness, sleep } from './support/app';

// P130 (Phase H / H.3) — BATCH / MULTI-FORMAT EXPORT: ONE action exports the
// current document to ALL configured export targets, writing N real output files
// in ONE invocation.
//
// RESEARCH-FIRST (HARD RULE #0): this is NOT a new export mechanism. The single
// per-plugin export path already ships — every export-category plugin
// (pandoc-html-export, pandoc-pdf-export, the witness plugin in p12, the
// arxiv-export plugin in p122) is run BY ID through the generic plugin firewall
// (run_plugin → discover → spawn the plugin's command with the real buffer on
// stdin, substituting {file}/{artifact}), funneled through the SAME save-gate
// (P47) every path-consuming action uses. The batch action COMPOSES that exact
// per-plugin path in a LOOP over the discovered export-category plugins; it adds
// NO new export mechanism, NO new validation, NO new pandoc knowledge in core.
// Each loop iteration is the SAME single export p07/p08/p12 each drive once.
//
// THE OBLIGATION (Phase H / H.3): ONE batch-export action exports the open
// document to EVERY configured export target at once, writing N real, non-empty
// output files (one per discovered export-category plugin) into a chosen base
// directory in a SINGLE invocation, each named with that plugin's declared output
// extension (the GENERIC manifest `extension` field the menu populator already
// reads — "html" for pandoc-html-export, "pdf" for pandoc-pdf-export, P66), each
// holding REAL export bytes produced by that plugin's command against the real
// buffer. A failed target export is LOUD (single-user pre-launch: no silent
// partial run, no fallback) — the batch is NOT done until every target's artifact
// is on disk.
//
// ── THE OBSERVABLE CONTRACT (the bridge hook the implementer must provide) ──
//
//   __PPE_E2E__.exportAll(baseDir)
//       Fire the ONE batch-export action: for EVERY discovered export-category
//       plugin, run the SAME per-plugin export path (the runPluginToPath /
//       exportViaPluginById firewall p07/p08/p12 drive) against the REAL open
//       buffer, writing each plugin's artifact into `baseDir` named by that
//       plugin's declared extension. Fire-and-forget (mirrors runPlugin /
//       exportViaPluginById); the spec awaits the on-disk artifacts. The open
//       buffer here is demo.md — a buffer WITH durable file identity — so the
//       save-gate (P47) resolves each per-target destination under `baseDir` and
//       lets every export run (the gate only BLOCKS an identity-less buffer; it
//       does not re-prompt a durable one). (DEFINED HERE; implementer provides —
//       the SAME bridge idiom the per-plugin export hooks use, looping the
//       existing single-export path with NO new mechanism.)
//
//   Already present / reused from existing specs:
//       __PPE_E2E__.openProject(), the per-plugin export firewall the batch loops,
//       the [plugin.pandoc-html-export]/[plugin.pandoc-pdf-export] config sections
//       and the two discovered export-category plugins
//       provision-proof.sh installs.
//
// ── INDEPENDENCE ─────────────────────────────────────────────────────────────
// Every clause below is read off the REAL on-disk artifacts by THIS process (and
// independent processes pdfinfo/pdftotext for the PDF) — NEVER the app's report.
// The chosen baseDir is enumerated with readdirSync; the produced files are read
// with readFileSync. An implementation that runs only ONE target, writes zero
// files, or fabricates a report without bytes cannot pass.
//
// ── WHAT THIS SPEC PROVES (the H.3 observable clauses) ──────────────────────
//   (1) N FILES FOR N TARGETS. After ONE exportAll(baseDir), baseDir holds a real
//       NON-EMPTY file for EVERY configured export target — here BOTH the html
//       (pandoc-html-export) and the pdf (pandoc-pdf-export) targets — each named
//       with that plugin's declared extension. A single-target export (only .html
//       OR only .pdf, or zero files) fails this.
//   (2) HTML CARRIES THE WITNESS. The .html artifact, parsed in the real engine,
//       repeats the P1 witness ("Geometry of Numbers — Café") — proving the html
//       target's real export bytes, not an empty/placeholder file.
//   (3) PDF IS A VALID PDF CARRYING THE WITNESS. The .pdf artifact is a valid PDF
//       (pdfinfo parses it) whose extracted text (pdftotext) carries the P1
//       witnesses — proving the pdf target's real export bytes, produced by the
//       SAME pandoc→lualatex command p08 drives, in the SAME batch invocation.
//
// ── ADMISSIBLE because it FAILS on a plausibly broken app ───────────────────
//   - NO batch action: __PPE_E2E__.exportAll does not exist → the bridge eval
//     throws (the FAITHFUL RED today — there is no batch/multi-format export
//     surface; the export menu offers only per-target single exports).
//   - A batch that runs ONE target only: baseDir holds the .html OR the .pdf but
//     not BOTH (clause 1 — N files for N targets).
//   - A batch that writes empty/placeholder files: the witness assertions on the
//     real bytes (clauses 2/3) fail — an empty html has no H1, an empty/zero-byte
//     pdf fails the %PDF- magic + pdfinfo.
//   - A silent partial run (one target fails, batch "succeeds" with fewer files):
//     clause 1 catches the missing artifact — the batch is not done until every
//     target's real bytes are on disk.
//
// ── RED EXPECTATION today ───────────────────────────────────────────────────
// The batch / multi-format export action does not exist. The hook this spec
// needs, __PPE_E2E__.exportAll, is undefined, so the bridge eval throws (clause 1
// setup) — OR, if a partial wiring exists, baseDir holds fewer than N files. Either
// way no run produces BOTH the .html and the .pdf from a SINGLE action, which is
// the faithful absence of the batch surface.

// The two configured export targets this spec provisions, by declared extension
// (P66's GENERIC `extension` manifest field). The batch must write one real
// non-empty artifact per target, named with that extension.
const EXPECTED_EXTENSIONS = ['html', 'pdf'] as const;

test('One batch-export action writes a real artifact for every configured export target', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await waitForHarness(tauriPage);
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // A fresh, EMPTY base directory the batch writes all N artifacts into. The spec
  // enumerates exactly what the ONE action produced — nothing pre-seeds it.
  const baseDir = join(manifest.runDir, 'batch-export-out');
  mkdirSync(baseDir, { recursive: true });

  // Fire the ONE batch-export action: export the open buffer to ALL configured
  // export targets at once (the SAME per-plugin firewall path, looped over the
  // discovered export-category plugins). Fire-and-forget; poll the directory.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.exportAll(${JSON.stringify(baseDir)}); return null; })()`,
  );

  // Locate one real NON-EMPTY artifact per expected extension. A PDF target runs
  // pandoc→lualatex inside the same batch, so allow a generous poll window
  // (heavier than the HTML target; matches the P8 PDF poll budget).
  const artifactFor = (ext: string): string | undefined => {
    const matches = readdirSync(baseDir)
      .filter((name) => name.toLowerCase().endsWith(`.${ext}`))
      .map((name) => join(baseDir, name))
      .filter((p) => existsSync(p) && readFileSync(p).length > 0);
    return matches.length > 0 ? matches[0] : undefined;
  };
  const allPresent = (): boolean =>
    EXPECTED_EXTENSIONS.every((ext) => artifactFor(ext) !== undefined);

  for (let i = 0; i < 240 && !allPresent(); i++) {
    await sleep(250);
  }

  // ── Clause 1 — N files for N targets ───────────────────────────────────────
  if (!allPresent()) {
    const present = readdirSync(baseDir);
    throw new Error(
      `Batch export did not write one non-empty artifact per configured target into ${baseDir}. ` +
        `Expected extensions [${EXPECTED_EXTENSIONS.join(', ')}]; the directory holds: ` +
        `${JSON.stringify(present)}. There is no single batch / multi-format export action that ` +
        `loops the per-plugin export path over every discovered export-category plugin (H.3).`,
    );
  }
  for (const ext of EXPECTED_EXTENSIONS) {
    expect(artifactFor(ext)).toBeDefined();
  }

  const htmlPath = artifactFor('html') as string;
  const pdfPath = artifactFor('pdf') as string;

  // ── Clause 2 — the HTML target carries the P1 witness (real export bytes) ──
  const htmlText = readFileSync(htmlPath, 'utf-8');
  const h1 = (await tauriPage.evaluate(
    `(() => {
      const doc = new DOMParser().parseFromString(${JSON.stringify(htmlText)}, 'text/html');
      return doc.querySelector('h1')?.textContent ?? null;
    })()`,
  )) as string | null;
  expect(h1).toBe('Geometry of Numbers — Café');

  // ── Clause 3 — the PDF target is a valid PDF carrying the witnesses ────────
  const pdfHead = readFileSync(pdfPath).subarray(0, 5).toString('latin1');
  expect(pdfHead).toBe('%PDF-');
  const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf-8' });
  expect(/Pages:\s+\d+/.test(info)).toBe(true);
  const textOut = execFileSync('pdftotext', [pdfPath, '-'], { encoding: 'utf-8' });
  expect(textOut.includes('Geometry of Numbers')).toBe(true);
  expect(textOut.includes('Minkowski bound')).toBe(true);

  recordObservation({
    spec: manifest.spec,
    name: 'batch-export-files',
    value: readdirSync(baseDir).length,
  });
});
