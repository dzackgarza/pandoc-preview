import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

// P119 (Phase G / G6 — the CAPSTONE) — END-TO-END arXiv-READY TARBALL INTEGRITY:
// the ONE real bundle satisfies EVERY arXiv hard requirement, AND an over-size
// bundle FAILS LOUDLY with NO tarball.
//
// The arXiv target is the SAME vendored `arxiv-export` FIREWALL plugin p122–p126
// drive — its `export.sh` orchestrating script running the FULL pipeline
// (md->tex->flatten->materialize->tikz-externalize->figure-format-gate->latexmk-
// bake-`.bbl`->delete-`.bib`->cleaner->dot-file-sweep->tar), extended with a FINAL
// 50 MB SIZE-CAP check: the plugin packages the cleaned bundle with the REAL
// `tar`/gzip binary and gates on the bundle's total UNCOMPRESSED size; if the
// bundle exceeds arXiv's 50 MB cap the export FAILS LOUDLY (exits NON-ZERO, the
// measured size NAMED in the log) and NO tarball is shipped. The app core is
// unchanged (the same export firewall `run_plugin` in plugins.rs); it is driven BY
// ID through that firewall exactly as p122–p126 drive it (runPluginById →
// window.__PPE_E2E__.runPlugin → discover → spawn the plugin's command with the
// real buffer; the chosen {artifact} is a `.tar.gz` path the plugin must write).
//
// This capstone SUBSUMES the per-step properties (P114 self-contained compile,
// P115 `.bbl`/no-`.bib`, P117 figure formats, P118 dot-files) but asserts them ALL
// on the ONE real upload-ready tarball, plus the auxiliary-file and 50 MB-cap arXiv
// requirements the per-step proofs do not.
//
// TWO witness documents in ONE hermetic project (provision-proof.sh, p127 case),
// each exported in turn against the file the spec opens:
//
//   LEG 1 (ARXIV-READY) — demo.md. It exercises EVERY gate (the union of p124's
//     section/\RR/cite/tikz witness and p125's compliance lattice SVG), so the ONE
//     emitted tarball carries: the flattened self-contained root `.tex` + the
//     materialized `\RR` macro + the "Geometry of Numbers"/"Minkowski bound"
//     witnesses; a `<main>.bbl` named to the main `.tex` with NO `.bib`; the tikz
//     diagrams externalized to bundled PDF figures; the SVG converted to PDF (no
//     `.svg` anywhere); and a cleaned tree with NO auxiliaries and NO dot-files. An
//     INDEPENDENT process asserts, on the ONE real tarball, ALL of P119 clauses
//     (a)–(h) by INDEPENDENT processes only (`tar`, `find`, `file`/magic, `pdfinfo`,
//     `pdftotext`, `du`, byte/string reads) and NEVER the app's report.
//
//   LEG 2 (OVER-SIZE LOUD-FAIL) — oversize.md, referencing a >50 MB VALID PDF
//     figure (fig/oversize.pdf, an incompressible-payload PDF the provisioner built)
//     that PASSES the figure-format gate (PDF magic), is KEPT by the cleaner (it is
//     referenced), and is NOT raster-resized by the cleaner — so the >50 MB payload
//     survives the whole pipeline and the bundle's UNCOMPRESSED size exceeds arXiv's
//     50 MB cap. The export MUST FAIL LOUDLY: the structured PluginResult is NOT
//     success (success=false / non-zero exit_code), the measured over-cap size is
//     NAMED in the export log, and NO tarball is written at the target path.
//
// INDEPENDENCE: every Leg-1 clause is read off the REAL emitted tarball by an
// INDEPENDENT process (tar + Node fs + `find` + `file` + `pdfinfo`/`pdftotext` +
// `du`), never the app's report; every Leg-2 clause is read off the structured
// PluginResult the SAME firewall surfaces PLUS an independent on-disk check that NO
// tarball exists.
//
// RED today (G6 not implemented): G1–G5 (p122–p126) land the full pipeline, so
// LEG 1 SHOULD pass (the pipeline produces an arXiv-ready bundle). The RED is driven
// by LEG 2 — there is NO 50 MB size-cap check, so the over-size bundle is packaged
// and SHIPPED anyway: a tarball appears at the target, the export reports success
// with a zero exit, and the over-cap size is never named — exactly the fail-open
// state the cap forbids. LEG 1 runs FIRST and brings the app + project + HTML
// preview up, so a RED is the MISSING cap enforcement, NOT a boot/open/render error.

const PLUGIN_ID = 'arxiv-export';
const ARXIV_CAP_BYTES = 50 * 1024 * 1024; // arXiv's 50 MB hard cap.

// The cited entry's distinctive author surname (references.bib DM19 = Dolgachev &
// Mumford) — appears in the baked `.bbl` ONLY if latexmk's BibTeX pass resolved the
// `\cite{DM19}` against the bundled bibliography.
const CITATION_AUTHOR = 'Dolgachev';

// The arXiv-acceptable raster/vector formats for the pdfLaTeX target, by MAGIC
// BYTES (not extension).
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
// for `.svg` extensions; the figure-format gate rewrites converted SVGs to
// `\includegraphics{...pdf}`. Enumerate BOTH so a surviving `\includesvg` SVG is
// caught.
const FIGURE_INCLUDE_RE = /\\include(?:graphics|svg)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// An independent `find … -name <pattern>` over the unpacked tree, returning the
// trimmed non-empty match lines. Used for the no-`.bib`, no-auxiliary, and no-dot-
// file clauses — each read by a fresh process, never the app's report.
function findByName(root: string, ...extraArgs: string[]): string[] {
  return execFileSync('find', [root, ...extraArgs], { encoding: 'utf-8' })
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// Poll the firewall for the result of the run that wrote (or failed to write)
// `target`. When a tarball is expected, wait for both the on-disk artifact and a
// non-null result; otherwise wait for a non-null result (the run may legitimately
// produce no tarball, e.g. the loud-fail leg).
async function pollResultFor(
  page: Parameters<typeof pluginResult>[0],
  target: string,
  expectTarball: boolean,
): Promise<PluginResult | null> {
  let result = await pluginResult(page);
  for (let i = 0; i < 600; i++) {
    result = await pluginResult(page);
    if (expectTarball ? existsSync(target) && result !== null : result !== null) break;
    await sleep(500);
  }
  return result;
}

test('the ONE arXiv bundle satisfies EVERY arXiv hard requirement, and an over-size bundle fails the export loudly with no tarball', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // ── Bring the app + project up FIRST, select the arXiv-ready witness demo.md,
  // and render its HTML preview — so a RED below is demonstrably the missing cap
  // enforcement, not a boot/open/render error.
  await openProject(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('.grow.overflow-auto.p-1 button span:last-child')).some((s) => s.textContent.trim() === 'demo.md')`,
    15_000,
  );
  await clickSidebarEntry(tauriPage, 'demo.md');
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // ─────────────────────────────────────────────────────────────────────────
  // LEG 1 — ARXIV-READY: every clause (a)–(h) of P119 asserted on the ONE real
  // emitted tarball by independent processes.
  // ─────────────────────────────────────────────────────────────────────────
  const tarball = join(manifest.runDir, 'arxiv-capstone-bundle.tar.gz');
  await runPluginById(tauriPage, PLUGIN_ID, tarball);

  const result = await pollResultFor(tauriPage, tarball, true);

  // ── Clause (a) — the tarball EXISTS at EXACTLY {output} and is a VALID gzip tar
  if (!existsSync(tarball)) {
    throw new Error(
      `arXiv bundle tarball never appeared at ${tarball} (result: ${JSON.stringify(result)}). ` +
        `The generic plugin firewall did not discover/run the vendored ${PLUGIN_ID} ` +
        `plugin to produce an arXiv-ready bundle from the real buffer.`,
    );
  }
  expect(existsSync(tarball)).toBe(true);

  // `file` reports a gzip-compressed tar, and `tar -tzf` lists members without
  // error (it throws loudly on a non-gzip / corrupt archive).
  const fileType = execFileSync('file', ['--brief', tarball], { encoding: 'utf-8' }).toLowerCase();
  if (!fileType.includes('gzip')) {
    throw new Error(`The emitted artifact at ${tarball} is not a gzip-compressed file: ${fileType}`);
  }
  const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf-8' })
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  expect(listing.length).toBeGreaterThan(0);

  // ── Independent process: unpack into a fresh empty dir ────────────────────
  const unpackDir = mkdtempSync(join(tmpdir(), 'ppe-arxiv-capstone-unpack-'));
  execFileSync('tar', ['-xzf', tarball, '-C', unpackDir]);
  const extracted = walk(unpackDir);

  const texFiles = extracted.filter((p) => p.endsWith('.tex'));
  expect(texFiles.length).toBeGreaterThan(0);
  const depthOf = (p: string): number =>
    p.slice(unpackDir.length).split('/').filter((s) => s.length > 0).length;
  const minDepth = Math.min(...texFiles.map(depthOf));
  const rootTexCandidates = texFiles.filter((p) => depthOf(p) === minDepth);
  expect(rootTexCandidates.length).toBe(1);
  const rootTex = rootTexCandidates[0];
  const rootTexName = rootTex.slice(rootTex.lastIndexOf('/') + 1);
  const mainStem = rootTexName.replace(/\.tex$/, '');
  const bundleRoot = rootTex.slice(0, rootTex.lastIndexOf('/'));

  // ── Clause (b) — the main `.tex` is at the ROOT of the archive ────────────
  // The root `.tex` is at minDepth ≤ 2 (either directly in the archive or under a
  // single top-level bundle folder), with no deeper nesting. There is exactly one
  // shallowest `.tex` (asserted above) — that is the root document.
  if (minDepth > 2) {
    throw new Error(
      `The main .tex is nested ${minDepth} levels deep (${rootTex.slice(unpackDir.length + 1)}); ` +
        `arXiv reads the main .tex from the archive root.`,
    );
  }

  // ── Clause (c) — a `<main>.bbl` named to the main `.tex` is present, and NO
  // `.bib` exists ANYWHERE in the tree ──────────────────────────────────────
  const bblFiles = extracted.filter((p) => p.endsWith('.bbl'));
  const mainBbl = bblFiles.find((p) => p.slice(p.lastIndexOf('/') + 1) === `${mainStem}.bbl`);
  if (mainBbl === undefined) {
    throw new Error(
      `No baked .bbl named to the main .tex (${mainStem}.bbl) in the bundle. Main .tex: ` +
        `${rootTexName}. .bbl files present: ` +
        `${bblFiles.map((p) => p.slice(p.lastIndexOf('/') + 1)).join(', ') || '(none)'}.`,
    );
  }
  const bblBody = readFileSync(mainBbl, 'utf-8');
  if (!bblBody.includes(CITATION_AUTHOR)) {
    throw new Error(
      `The baked .bbl (${mainStem}.bbl) does not contain the cited entry's reference ` +
        `(author "${CITATION_AUTHOR}") — the citation was never resolved into the bundle.`,
    );
  }
  const foundBibs = findByName(unpackDir, '-name', '*.bib');
  if (foundBibs.length > 0) {
    throw new Error(
      `The bundle ships ${foundBibs.length} .bib file(s) — arXiv's blocking case. Found: ` +
        `${foundBibs.map((p) => p.slice(unpackDir.length + 1)).join(', ')}.`,
    );
  }
  expect(foundBibs).toEqual([]);

  // ── Clause (d) — NO auxiliary files (`*.aux`, `*.log`, `*.out`, `*.dvi`) ───
  const auxOffenders = findByName(
    unpackDir,
    '(',
    '-name',
    '*.aux',
    '-o',
    '-name',
    '*.log',
    '-o',
    '-name',
    '*.out',
    '-o',
    '-name',
    '*.dvi',
    ')',
  );
  if (auxOffenders.length > 0) {
    throw new Error(
      `The bundle ships ${auxOffenders.length} auxiliary file(s) arXiv requirements forbid — ` +
        `the build intermediates were not cleaned. Found: ` +
        `${auxOffenders.map((p) => p.slice(unpackDir.length + 1)).join(', ')}.`,
    );
  }
  expect(auxOffenders).toEqual([]);

  // ── Clause (e) — NO hidden/dot-files and NO dot-prefixed directories ──────
  const dotPaths = findByName(unpackDir, '-name', '.*', '-not', '-name', '.', '-not', '-name', '..');
  if (dotPaths.length > 0) {
    throw new Error(
      `The bundle ships ${dotPaths.length} dot-file / dot-prefixed path(s) arXiv would reject. ` +
        `Found: ${dotPaths.map((p) => p.slice(unpackDir.length + 1)).join(', ')}.`,
    );
  }
  expect(dotPaths).toEqual([]);

  // ── Clause (f) — EVERY referenced figure is PDF/PNG/JPG by magic, NO `.svg` ─
  // No `.svg` referenced by any `.tex`, and no `.svg` bundled anywhere.
  const referencedFigures: { tex: string; target: string }[] = [];
  for (const tex of texFiles) {
    const body = readFileSync(tex, 'utf-8');
    for (const m of body.matchAll(FIGURE_INCLUDE_RE)) {
      referencedFigures.push({ tex: tex.slice(unpackDir.length + 1), target: m[1].trim() });
    }
  }
  expect(referencedFigures.length).toBeGreaterThan(0);
  const svgReferences = referencedFigures.filter((r) => r.target.toLowerCase().endsWith('.svg'));
  if (svgReferences.length > 0) {
    throw new Error(
      `The bundle still REFERENCES ${svgReferences.length} .svg figure(s) — the figure-format ` +
        `gate did not convert them. References: ` +
        `${svgReferences.map((r) => `${r.tex} → ${r.target}`).join('; ')}.`,
    );
  }
  expect(svgReferences).toEqual([]);
  const bundledSvgs = findByName(unpackDir, '-name', '*.svg');
  if (bundledSvgs.length > 0) {
    throw new Error(
      `The bundle ships ${bundledSvgs.length} .svg file(s) arXiv would reject. Found: ` +
        `${bundledSvgs.map((p) => p.slice(unpackDir.length + 1)).join(', ')}.`,
    );
  }
  expect(bundledSvgs).toEqual([]);

  // Resolve each referenced figure (bundle-root-relative, with or without
  // extension) to an on-disk file and assert its REAL format is PDF/PNG/JPG.
  const resolveFigure = (target: string): string | undefined => {
    const direct = join(bundleRoot, target);
    if (existsSync(direct) && statSync(direct).isFile()) return direct;
    for (const ext of ['.pdf', '.png', '.jpg', '.jpeg', '.PDF', '.PNG', '.JPG']) {
      const cand = join(bundleRoot, `${target.replace(/\.[^./]+$/, '')}${ext}`);
      if (existsSync(cand) && statSync(cand).isFile()) return cand;
    }
    return undefined;
  };
  const figureFormats: string[] = [];
  for (const ref of referencedFigures) {
    const onDisk = resolveFigure(ref.target);
    if (onDisk === undefined) {
      throw new Error(
        `Referenced figure ${ref.target} (in ${ref.tex}) resolves to no on-disk file in the ` +
          `bundle — a dangling figure reference.`,
      );
    }
    if (statSync(onDisk).size === 0) {
      throw new Error(`Referenced figure ${onDisk.slice(bundleRoot.length + 1)} is a ZERO-BYTE file.`);
    }
    const fmt = magicFormat(onDisk);
    if (fmt === null) {
      const ft = execFileSync('file', ['--brief', onDisk], { encoding: 'utf-8' }).trim();
      throw new Error(
        `Referenced figure ${onDisk.slice(bundleRoot.length + 1)} is NOT an arXiv-acceptable ` +
          `format (PDF/PNG/JPG) by magic bytes — file(1) reports: ${ft}.`,
      );
    }
    figureFormats.push(`${ref.target}=${fmt}`);
  }

  // ── Clause (g) — the TOTAL UNCOMPRESSED size of the bundle is UNDER 50 MB ──
  // Independent `du --bytes --summarize` over the unpacked tree.
  const duOut = execFileSync('du', ['--bytes', '--summarize', unpackDir], { encoding: 'utf-8' });
  const uncompressedBytes = Number.parseInt(duOut.split(/\s+/)[0] ?? '', 10);
  if (!Number.isFinite(uncompressedBytes)) {
    throw new Error(`du did not report a numeric size for the unpacked bundle: ${duOut}`);
  }
  if (uncompressedBytes >= ARXIV_CAP_BYTES) {
    throw new Error(
      `The arXiv-ready bundle is ${uncompressedBytes} bytes uncompressed — at/over the 50 MB cap.`,
    );
  }
  expect(uncompressedBytes).toBeLessThan(ARXIV_CAP_BYTES);

  // ── Clause (h) — a no-system-styles ROOT compile yields the witness PDF ───
  // TEXMFHOME → an EMPTY dir so the host's personal texmf cannot supply the
  // styles; latexmk drives pdflatex from the bundle root, so the materialized
  // macros, the flattened section, and the baked `.bbl` are the ONLY way the
  // witnesses resolve.
  const emptyTexmf = mkdtempSync(join(tmpdir(), 'ppe-capstone-empty-texmf-'));
  const compileEnv = {
    ...process.env,
    TEXMFHOME: emptyTexmf,
    TEXMFCONFIG: join(emptyTexmf, 'config'),
    TEXMFVAR: join(emptyTexmf, 'var'),
  };
  mkdirSync(compileEnv.TEXMFCONFIG, { recursive: true });
  mkdirSync(compileEnv.TEXMFVAR, { recursive: true });
  try {
    execFileSync(
      'latexmk',
      ['-pdf', '-interaction=nonstopmode', '-halt-on-error', rootTexName],
      { cwd: bundleRoot, env: compileEnv, encoding: 'utf-8' },
    );
  } catch (e) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string };
    const out = `${err.stdout?.toString() ?? ''}\n${err.stderr?.toString() ?? ''}`;
    throw new Error(
      `latexmk failed to compile the bundle from its root with an EMPTY TEXMFHOME — the ` +
        `bundle is NOT self-contained. Tail of the compile log:\n` +
        out.split('\n').slice(-40).join('\n'),
    );
  }
  const producedPdf = join(bundleRoot, `${mainStem}.pdf`);
  if (!existsSync(producedPdf)) {
    throw new Error(`No PDF produced by the no-system-styles compile at ${producedPdf}.`);
  }
  const head = readFileSync(producedPdf).subarray(0, 5).toString('latin1');
  expect(head).toBe('%PDF-');
  const info = execFileSync('pdfinfo', [producedPdf], { encoding: 'utf-8' });
  expect(/Pages:\s+\d+/.test(info)).toBe(true);
  const textOut = execFileSync('pdftotext', [producedPdf, '-'], { encoding: 'utf-8' });
  if (!textOut.includes('Geometry of Numbers') || !textOut.includes('Minkowski bound')) {
    throw new Error(
      `The compiled PDF does not carry both witnesses ("Geometry of Numbers" + "Minkowski ` +
        `bound"). Extracted head:\n${textOut.split('\n').slice(0, 30).join('\n')}`,
    );
  }

  // The structured PluginResult reports the real outcome of the arXiv-ready run
  // through the SAME firewall the menu uses (asserted alongside the on-disk proof).
  if (result === null) {
    throw new Error('arXiv-ready run produced a tarball but no structured PluginResult was surfaced');
  }
  expect(result.success).toBe(true);
  expect(result.exit_code).toBe(0);
  expect(result.artifact).toBe(tarball);

  recordObservation({ spec: manifest.spec, name: 'arxiv-capstone-uncompressed-bytes', value: uncompressedBytes });
  recordObservation({ spec: manifest.spec, name: 'arxiv-capstone-figure-formats', value: figureFormats.join(',') });
  recordObservation({ spec: manifest.spec, name: 'arxiv-capstone-bbl', value: `${mainStem}.bbl` });

  // ─────────────────────────────────────────────────────────────────────────
  // LEG 2 — OVER-SIZE LOUD-FAIL: a bundle whose uncompressed size exceeds the 50 MB
  // cap must fail the export loudly (non-zero, the measured size named) with NO
  // tarball. The app + firewall already ran a real export (Leg 1), so a RED here is
  // the missing cap enforcement, NOT a boot/open/render error.
  // ─────────────────────────────────────────────────────────────────────────
  await clickSidebarEntry(tauriPage, 'oversize.md');
  await tauriPage.waitForFunction(
    `(() => { try { return window.__PPE_E2E__.currentFile && String(window.__PPE_E2E__.currentFile()).endsWith('oversize.md'); } catch (e) { return false; } })()`,
    15_000,
  );

  // Reset the firewall's stashed result marker so we observe THIS run's outcome,
  // never the arXiv-ready leg's success.
  await tauriPage.evaluate(`(() => { window.__PPE_PLUGIN_RESULT__ = null; return null; })()`);

  const oversizeTarball = join(manifest.runDir, 'arxiv-capstone-oversize.tar.gz');
  expect(existsSync(oversizeTarball)).toBe(false);
  await runPluginById(tauriPage, PLUGIN_ID, oversizeTarball);

  // We do NOT expect a tarball; wait for a non-null structured result.
  const oversizeResult = await pollResultFor(tauriPage, oversizeTarball, false);
  if (oversizeResult === null) {
    throw new Error(
      `The over-size export never surfaced a structured PluginResult for oversize.md ` +
        `(figure fig/oversize.pdf > 50 MB). The firewall must report the over-cap failure outcome.`,
    );
  }
  const oversizeLog = `${oversizeResult.stdout}\n${oversizeResult.stderr}`;

  // ── Clause — the export FAILED LOUDLY (non-zero, not a success) ───────────
  if (oversizeResult.success !== false || oversizeResult.exit_code === 0) {
    throw new Error(
      `The export did NOT fail loudly on an over-size bundle: success=${oversizeResult.success}, ` +
        `exit_code=${oversizeResult.exit_code}. A bundle whose uncompressed size exceeds arXiv's ` +
        `50 MB cap must exit non-zero. Log tail:\n${oversizeLog.split('\n').slice(-30).join('\n')}`,
    );
  }
  expect(oversizeResult.success).toBe(false);
  expect(oversizeResult.exit_code).not.toBe(0);

  // ── Clause — the measured over-cap size is NAMED in the export log ────────
  // The failure must name the measured size so the user knows the bundle is over
  // budget. A bundle built from a >50 MB figure measures at least ~50 MB; the log
  // must report a size in the 50+ MB range (a "50"/"51"/"52"/"55" MB / "5N.M MB" /
  // a raw byte count over the cap). We assert the log mentions the cap (50) AND a
  // measured over-cap magnitude, rather than a bare "export failed".
  const mentionsCap = /\b50\s?MB\b/i.test(oversizeLog) || /\b50\s?M\b/.test(oversizeLog) ||
    /52428800/.test(oversizeLog);
  const namesMeasuredSize =
    // a megabyte figure at/over the cap, e.g. "55 MB", "55.0MB", "54.9 MiB"
    /\b(5[0-9]|[6-9][0-9]|[1-9][0-9]{2,})(?:\.[0-9]+)?\s?(?:MB|MiB|M)\b/i.test(oversizeLog) ||
    // or a raw byte count over the 50 MB cap
    [...oversizeLog.matchAll(/\b(\d{8,})\b/g)].some((m) => Number.parseInt(m[1], 10) > ARXIV_CAP_BYTES);
  if (!mentionsCap || !namesMeasuredSize) {
    throw new Error(
      `The over-size loud-fail export did not NAME the measured over-cap size and the 50 MB cap ` +
        `in its log (mentionsCap=${mentionsCap}, namesMeasuredSize=${namesMeasuredSize}). The ` +
        `failure must report the measured size against arXiv's 50 MB cap. Log tail:\n` +
        `${oversizeLog.split('\n').slice(-40).join('\n')}`,
    );
  }
  expect(mentionsCap).toBe(true);
  expect(namesMeasuredSize).toBe(true);

  // ── Clause — NO tarball was produced at the target path ───────────────────
  // The export must NEVER ship an over-size bundle. An independent on-disk check
  // confirms the target tarball does not exist.
  if (existsSync(oversizeTarball)) {
    throw new Error(
      `A tarball was written at ${oversizeTarball} despite the bundle exceeding arXiv's 50 MB ` +
        `cap — the export must produce NO tarball when the bundle is over budget.`,
    );
  }
  expect(existsSync(oversizeTarball)).toBe(false);

  recordObservation({
    spec: manifest.spec,
    name: 'arxiv-capstone-oversize-exit',
    value: String(oversizeResult.exit_code),
  });
});
