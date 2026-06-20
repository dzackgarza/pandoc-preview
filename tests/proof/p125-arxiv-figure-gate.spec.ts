import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openProject,
  clickSidebarEntry,
  runPluginById,
  pluginResult,
  waitForPreview,
  sleep,
} from './support/app';
import type { PluginResult } from './support/app';

// P117 (Phase G / G4) — EVERY BUNDLED FIGURE IS IN AN arXiv-ACCEPTABLE FORMAT; A
// NON-CONVERTIBLE FIGURE FAILS THE EXPORT LOUDLY WITH NO TARBALL.
//
// arXiv does NO on-the-fly conversion and the pdfLaTeX target accepts ONLY
// PDF/PNG/JPG, while this pipeline is SVG/tikz-centric. So after G3's tikz-
// externalization the arxiv-export plugin must ENUMERATE every figure REFERENCED
// by the emitted root `.tex`, check each figure's REAL format (file/magic bytes,
// NOT the filename extension), and for any figure that is NOT already PDF/PNG/JPG
// CONVERT it (an SVG via `cairosvg` run through the approved `uvx` runner —
// `inkscape`/`rsvg-convert` are not installed and `cairosvg` is not owned) and
// REWRITE the `.tex` reference to the converted file. If a referenced figure
// CANNOT be made compliant, the export FAILS LOUDLY: it exits NON-ZERO, NAMES the
// offending file in the log, and writes NO tarball — it NEVER silently ships a
// figure arXiv would reject.
//
// The arXiv target is the SAME vendored `arxiv-export` FIREWALL plugin p122/p123/
// p124 drive — its `export.sh` orchestrating script, riding the SAME generic
// export firewall (run_plugin in plugins.rs) the shipped export plugins use; the
// app core is unchanged (the whole md→tex→flatten→materialize→tikz-externalize→
// figure-format-gate→latexmk-bake-`.bbl`→tar pipeline IS the plugin's
// script/argv). It is driven BY ID through that firewall exactly as p122/p123/p124
// drive it (runPluginById → window.__PPE_E2E__.runPlugin → discover → spawn the
// plugin's command with the real buffer; the chosen {artifact} is a `.tar.gz` path
// the plugin must write).
//
// TWO witness documents in ONE hermetic project (provision-proof.sh, p125 case),
// each exported in turn against the file the spec opens:
//
//   LEG 1 (COMPLIANCE) — demo.md. It already carries the shared P1 witnesses and a
//     `![scatter](fig/plot.png)` (a PNG that must pass through untouched), and the
//     provisioner APPENDS `![lattice](fig/p125-lattice.svg)`, a markdown image
//     referencing a REAL, well-formed SVG (the committed p125-lattice.svg, a 3×3
//     lattice + bounding box that cairosvg converts to a valid PDF). pandoc
//     `--to latex` emits an SVG INCLUSION for the `.svg` extension
//     (`\includesvg{fig/p125-lattice.svg}`), so the emitted root `.tex` references
//     a `.svg` arXiv would reject. The compliance gate must CONVERT it to PDF and
//     rewrite the reference. An INDEPENDENT process unpacks the bundle, enumerates
//     EVERY figure the bundle `.tex` references (both `\includegraphics{...}` and
//     `\includesvg{...}`), and asserts each resolved on-disk figure is PDF/PNG/JPG
//     by MAGIC BYTES, and that NO `.svg` is referenced by any `.tex` OR bundled
//     anywhere in the tree.
//
//   LEG 2 (LOUD-FAIL) — badfig.md, referencing a ZERO-BYTE `.svg`
//     (`![broken](fig/p125-broken.svg)`) that CANNOT be made compliant (cairosvg
//     fails to parse an empty SVG — expat "no element found", exit 1, no PDF; and a
//     zero-byte file is not a valid PDF/PNG/JPG). The export must FAIL LOUDLY: the
//     structured PluginResult is NOT success (success=false / non-zero exit_code),
//     the offending filename `p125-broken.svg` appears in the export
//     stderr/stdout, and NO tarball is written at the target path.
//
// INDEPENDENCE: every Leg-1 clause is read off the REAL emitted tarball by an
// INDEPENDENT process (tar + Node fs + the `file` magic classifier), never the
// app's report; every Leg-2 clause is read off the structured PluginResult the
// SAME firewall surfaces PLUS an independent on-disk check that NO tarball exists.
//
// RED today (G4 not implemented): G1–G3 ship the SVG as-is — no figure-format
// gate. So for LEG 1 the unpacked bundle still references the `.svg` (via the
// emitted `\includesvg`) and/or ships the `.svg` file: the "every referenced
// figure is PDF/PNG/JPG" and "no `.svg` referenced or bundled" clauses fail. And
// for LEG 2 the plugin does NOT loud-fail on a non-convertible figure: with no gate
// it produces a tarball anyway (or fails for an unrelated reason), so the
// loud-fail leg's "export failed naming p125-broken.svg" + "no tarball" clauses
// fail. LEG 1 runs FIRST and brings the app + project + HTML preview up, so a RED
// is the MISSING figure-format gate, NOT a boot/open/render error.

const PLUGIN_ID = 'arxiv-export';

// The arXiv-acceptable raster/vector formats for the pdfLaTeX target. A bundled
// figure's REAL format (by magic bytes, not extension) must be one of these.
const ACCEPTED_MAGIC: { name: string; ok: (buf: Buffer) => boolean }[] = [
  { name: 'PDF', ok: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  {
    name: 'PNG',
    ok: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  { name: 'JPEG', ok: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];

function magicFormat(file: string): string | null {
  const buf = readFileSync(file);
  const hit = ACCEPTED_MAGIC.find((m) => m.ok(buf));
  return hit ? hit.name : null;
}

// Figure-inclusion commands whose braced target is a figure the bundle ships.
// pandoc emits `\includegraphics{...}` for raster figures and `\includesvg{...}`
// for `.svg` extensions, and the gate rewrites converted SVGs to
// `\includegraphics{...pdf}`; enumerate BOTH so a surviving `\includesvg` SVG is
// caught.
const FIGURE_INCLUDE_RE =
  /\\include(?:graphics|svg)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// Poll the firewall for the result of the run that wrote (or failed to write)
// `target`, resetting the stashed marker before the run so we observe THIS run's
// outcome, never the previous leg's.
async function pollResultFor(
  page: Parameters<typeof pluginResult>[0],
  target: string,
  expectTarball: boolean,
): Promise<PluginResult | null> {
  let result = await pluginResult(page);
  for (let i = 0; i < 480; i++) {
    result = await pluginResult(page);
    const tarballReady = existsSync(target);
    if (expectTarball ? tarballReady && result !== null : result !== null) break;
    await sleep(500);
  }
  return result;
}

test('the arXiv bundle makes every figure arXiv-acceptable; a non-convertible figure fails the export loudly with no tarball', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // ── Bring the app + project up FIRST, select the compliance witness demo.md,
  // and render its HTML preview — so a RED below is demonstrably the missing
  // figure-format gate, not a boot/open/render error.
  await openProject(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('.grow.overflow-auto.p-1 button span:last-child')).some((s) => s.textContent.trim() === 'demo.md')`,
    15_000,
  );
  await clickSidebarEntry(tauriPage, 'demo.md');
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // ─────────────────────────────────────────────────────────────────────────
  // LEG 1 — COMPLIANCE: the SVG figure is converted; the bundle ships NO `.svg`,
  // and every referenced figure is PDF/PNG/JPG.
  // ─────────────────────────────────────────────────────────────────────────
  const compliantTarball = join(manifest.runDir, 'arxiv-figgate-bundle.tar.gz');
  await runPluginById(tauriPage, PLUGIN_ID, compliantTarball);

  const compliantResult = await pollResultFor(tauriPage, compliantTarball, true);
  if (!existsSync(compliantTarball)) {
    throw new Error(
      `arXiv bundle tarball never appeared at ${compliantTarball} (result: ${JSON.stringify(compliantResult)}). ` +
        `The generic plugin firewall did not discover/run the vendored ${PLUGIN_ID} ` +
        `plugin to produce a figure-gated bundle from the real buffer.`,
    );
  }
  expect(existsSync(compliantTarball)).toBe(true);

  // ── Independent process #1: it is a valid gzip tar ────────────────────────
  const listing = execFileSync('tar', ['-tzf', compliantTarball], { encoding: 'utf-8' })
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  expect(listing.length).toBeGreaterThan(0);

  // ── Independent process #2: unpack into a fresh empty dir ─────────────────
  const unpackDir = mkdtempSync(join(tmpdir(), 'ppe-arxiv-figgate-unpack-'));
  execFileSync('tar', ['-xzf', compliantTarball, '-C', unpackDir]);
  const extracted = walk(unpackDir);

  // Locate every bundled `.tex` and the bundle root (shallowest `.tex`'s dir).
  const texFiles = extracted.filter((p) => p.endsWith('.tex'));
  expect(texFiles.length).toBeGreaterThan(0);
  const depthOf = (p: string): number =>
    p.slice(unpackDir.length).split('/').filter((s) => s.length > 0).length;
  const minDepth = Math.min(...texFiles.map(depthOf));
  const rootTexCandidates = texFiles.filter((p) => depthOf(p) === minDepth);
  expect(rootTexCandidates.length).toBe(1);
  const rootTex = rootTexCandidates[0];
  const bundleRoot = rootTex.slice(0, rootTex.lastIndexOf('/'));

  // ── Clause A — NO `.svg` is REFERENCED by any bundled `.tex` ──────────────
  // pandoc emits `\includesvg{fig/p125-lattice.svg}` for the `.svg` extension; the
  // gate must convert it and REWRITE the reference to the converted PDF. An
  // independent scan over EVERY `.tex` enumerates every figure-inclusion target;
  // none may be a `.svg`. A bundle that left the SVG inclusion in place still
  // references `…/p125-lattice.svg`.
  const referencedFigures: { tex: string; target: string }[] = [];
  for (const tex of texFiles) {
    const body = readFileSync(tex, 'utf-8');
    for (const m of body.matchAll(FIGURE_INCLUDE_RE)) {
      referencedFigures.push({ tex: tex.slice(unpackDir.length + 1), target: m[1].trim() });
    }
  }
  const svgReferences = referencedFigures.filter((r) =>
    r.target.toLowerCase().endsWith('.svg'),
  );
  if (svgReferences.length > 0) {
    throw new Error(
      `The bundle still REFERENCES ${svgReferences.length} .svg figure(s) — the figure-` +
        `format gate did not convert them to an arXiv-acceptable format and rewrite ` +
        `the reference. References: ${svgReferences
          .map((r) => `${r.tex} → ${r.target}`)
          .join('; ')}.`,
    );
  }
  expect(svgReferences).toEqual([]);

  // ── Clause B — NO `.svg` file survives ANYWHERE in the bundle ─────────────
  // arXiv would reject an `.svg` it cannot convert; the gate must not ship one. An
  // independent `find` over the whole unpacked tree must return empty.
  const bundledSvgs = execFileSync('find', [unpackDir, '-name', '*.svg'], {
    encoding: 'utf-8',
  })
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (bundledSvgs.length > 0) {
    throw new Error(
      `The bundle ships ${bundledSvgs.length} .svg file(s) arXiv would reject — the ` +
        `figure-format gate must convert every SVG and remove the source. Found: ` +
        `${bundledSvgs.map((p) => p.slice(unpackDir.length + 1)).join(', ')}.`,
    );
  }
  expect(bundledSvgs).toEqual([]);

  // ── Clause C — EVERY referenced figure resolves to a PDF/PNG/JPG by magic ──
  // The witness referenced a PNG (pass-through) AND an SVG (must become a PDF).
  // Resolve each `\includegraphics`/`\includesvg` target (bundle-root-relative,
  // with or without extension) to an on-disk file and assert its REAL format (by
  // magic bytes, not extension) is one of the accepted formats. The converted SVG
  // proves the gate ran (the resolved figure is a real PDF, not the SVG bytes).
  const resolveFigure = (target: string): string | undefined => {
    const direct = join(bundleRoot, target);
    if (existsSync(direct) && statSync(direct).isFile()) return direct;
    // The reference may have been rewritten to an extensionless / `.pdf` target.
    for (const ext of ['.pdf', '.png', '.jpg', '.jpeg', '.PDF', '.PNG', '.JPG']) {
      const cand = join(bundleRoot, `${target.replace(/\.[^./]+$/, '')}${ext}`);
      if (existsSync(cand) && statSync(cand).isFile()) return cand;
    }
    return undefined;
  };

  expect(referencedFigures.length).toBeGreaterThan(0);
  const figureFormats: string[] = [];
  let sawConvertedPdf = false;
  for (const ref of referencedFigures) {
    const onDisk = resolveFigure(ref.target);
    if (onDisk === undefined) {
      throw new Error(
        `Referenced figure ${ref.target} (in ${ref.tex}) resolves to no on-disk file in ` +
          `the bundle — a dangling figure reference. Bundle files: ` +
          `${extracted.map((p) => p.slice(unpackDir.length + 1)).join(', ')}.`,
      );
    }
    if (statSync(onDisk).size === 0) {
      throw new Error(
        `Referenced figure ${onDisk.slice(bundleRoot.length + 1)} is a ZERO-BYTE file.`,
      );
    }
    const fmt = magicFormat(onDisk);
    if (fmt === null) {
      const fileType = execFileSync('file', ['--brief', onDisk], { encoding: 'utf-8' }).trim();
      throw new Error(
        `Referenced figure ${onDisk.slice(bundleRoot.length + 1)} is NOT an arXiv-acceptable ` +
          `format (PDF/PNG/JPG) by magic bytes — file(1) reports: ${fileType}. The ` +
          `figure-format gate did not make it compliant.`,
      );
    }
    figureFormats.push(`${ref.target}=${fmt}`);
    // The SVG-origin figure (the lattice diagram) must now be a PDF on disk.
    if (ref.target.toLowerCase().includes('lattice') && fmt === 'PDF') sawConvertedPdf = true;
  }
  if (!sawConvertedPdf) {
    throw new Error(
      `No converted PDF figure for the SVG-origin lattice diagram was found. Figure ` +
        `formats: ${figureFormats.join(', ')}. The gate did not convert the SVG to PDF.`,
    );
  }

  // The structured PluginResult reports the real outcome of the COMPLIANCE run
  // through the SAME firewall the menu uses (asserted alongside the on-disk proof).
  if (compliantResult === null) {
    throw new Error('compliance run produced a tarball but no structured PluginResult was surfaced');
  }
  expect(compliantResult.success).toBe(true);
  expect(compliantResult.exit_code).toBe(0);
  expect(compliantResult.artifact).toBe(compliantTarball);

  recordObservation({ spec: manifest.spec, name: 'arxiv-figure-formats', value: figureFormats.join(',') });

  // ─────────────────────────────────────────────────────────────────────────
  // LEG 2 — LOUD-FAIL: a figure that cannot be made compliant fails the export
  // loudly (non-zero, names the offending file), and NO tarball is produced.
  // ─────────────────────────────────────────────────────────────────────────

  // Switch the open buffer to the loud-fail witness (badfig.md → zero-byte SVG).
  // The app already booted and the firewall already ran a real export (Leg 1), so
  // a RED here is the missing loud-fail behaviour, NOT a boot/open/render error.
  await clickSidebarEntry(tauriPage, 'badfig.md');
  await tauriPage.waitForFunction(
    `(() => { try { return window.__PPE_E2E__.currentFile && String(window.__PPE_E2E__.currentFile()).endsWith('badfig.md'); } catch (e) { return false; } })()`,
    15_000,
  );

  // Reset the firewall's stashed result marker so we observe THIS run's outcome,
  // never the compliance leg's success.
  await tauriPage.evaluate(`(() => { window.__PPE_PLUGIN_RESULT__ = null; return null; })()`);

  const failTarball = join(manifest.runDir, 'arxiv-figgate-badfig.tar.gz');
  expect(existsSync(failTarball)).toBe(false);
  await runPluginById(tauriPage, PLUGIN_ID, failTarball);

  // Poll until the firewall surfaces the result of THIS run. We do NOT expect a
  // tarball; we wait for a non-null structured result.
  const failResult = await pollResultFor(tauriPage, failTarball, false);
  if (failResult === null) {
    throw new Error(
      `The loud-fail export never surfaced a structured PluginResult for badfig.md ` +
        `(figure p125-broken.svg). The firewall must report the non-convertible-figure ` +
        `failure outcome.`,
    );
  }

  const failLog = `${failResult.stdout}\n${failResult.stderr}`;

  // ── Clause D — the export FAILED LOUDLY ───────────────────────────────────
  // A non-convertible figure must make the export exit NON-ZERO and be reported as
  // a failure — never a silent success. RED today: with no gate the plugin either
  // succeeds (ships the bad figure) or never reports the figure failure.
  if (failResult.success !== false || failResult.exit_code === 0) {
    throw new Error(
      `The export did NOT fail loudly on a non-convertible figure: success=` +
        `${failResult.success}, exit_code=${failResult.exit_code}. A figure that cannot be ` +
        `made arXiv-compliant (the zero-byte p125-broken.svg) must exit non-zero. ` +
        `Log:\n${failLog.split('\n').slice(-30).join('\n')}`,
    );
  }
  expect(failResult.success).toBe(false);
  expect(failResult.exit_code).not.toBe(0);

  // ── Clause E — the offending filename is NAMED in the export log ──────────
  // The failure must name the figure that could not be converted, so the user can
  // fix it. A generic "export failed" with no filename is not loud enough.
  if (!failLog.includes('p125-broken.svg')) {
    throw new Error(
      `The loud-fail export did not NAME the offending figure (p125-broken.svg) in its ` +
        `log. The failure must identify which figure could not be made compliant. ` +
        `Log:\n${failLog.split('\n').slice(-30).join('\n')}`,
    );
  }
  expect(failLog.includes('p125-broken.svg')).toBe(true);

  // ── Clause F — NO tarball was produced at the target path ─────────────────
  // The export must NEVER ship a bundle arXiv would reject. An independent on-disk
  // check confirms the target tarball does not exist.
  if (existsSync(failTarball)) {
    throw new Error(
      `A tarball was written at ${failTarball} despite a non-convertible figure — the ` +
        `export must produce NO tarball when a figure cannot be made arXiv-compliant.`,
    );
  }
  expect(existsSync(failTarball)).toBe(false);

  recordObservation({
    spec: manifest.spec,
    name: 'arxiv-figure-loud-fail-exit',
    value: String(failResult.exit_code),
  });
});
