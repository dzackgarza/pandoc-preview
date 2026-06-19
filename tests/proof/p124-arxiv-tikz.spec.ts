import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

// P116 (Phase G / G3) — TikZ EXTERNALIZED TO A PRECOMPILED PDF FIGURE, WITH NO
// TIKZ SOURCE REMAINING IN THE BUNDLE.
//
// The arXiv target is the SAME vendored `arxiv-export` FIREWALL plugin P114/p122
// and P115/p123 drive — its `export.sh` orchestrating script, riding the SAME
// generic export firewall (run_plugin in plugins.rs) the shipped export plugins
// use; the app core is unchanged (the whole md→tex→flatten→materialize→tikz-
// externalize→latexmk-bake-`.bbl`→tar pipeline IS the plugin's script/argv). It
// is driven BY ID through that firewall exactly as p122/p123 drive it
// (runPluginById → window.__PPE_E2E__.runPlugin → discover → spawn the plugin's
// command with the real buffer; the chosen {artifact} is a `.tar.gz` path the
// plugin must write).
//
// G3 EXTENDS G1/G2: after G1's flatten + macro-materialization produce the self-
// contained bundle and BEFORE G2's `.bbl` bake, the plugin PRECOMPILES every
// `tikzpicture`/`tikzcd` in the emitted root `.tex` to a PDF figure written INTO
// the bundle and REWRITES the `.tex` so each diagram becomes a
// `\includegraphics{<fig>.pdf}` referencing that on-disk PDF. The compile is
// driven by the EXISTING tikzcd.lua filter's pdflatex compile core (the same
// per-figure standalone-tikz.tex compile the preview uses, emitting a PDF into
// the bundle instead of an SVG into the preview) — the plugin owns NO new tikz
// compiler. The bundle then ships NO tikz toolchain dependency to arXiv (in-
// browser TikZJax for the bundle is a BANNED non-goal — the figures are
// precompiled via the existing filter toolchain).
//
// WHY THIS WITNESS PROJECT: provision-proof.sh (case p124) provisions a witness
// whose demo.md carries (a) the shared P1 witnesses so the bundle is recognisably
// this document, (b) the SAME `\input{section-minkowski.tex}` + `\RR` flatten/
// materialize exercise p122 binds (so those legs stay alive), and (c) TWO raw-
// LaTeX tikz diagrams fenced as pandoc `{=latex}` raw blocks — a `tikzpicture`
// (two named nodes + an edge, the P100 tikz witness shape) and a `tikzcd` (the
// categorical-diagram form). `pandoc --to latex` passes each environment through
// verbatim, so the emitted root `.tex` carries a `\begin{tikzpicture}` AND a
// `\begin{tikzcd}` that G3 must externalize to a bundled PDF.
//
// INDEPENDENCE: every clause below is read off the REAL emitted tarball by an
// INDEPENDENT process — never the app's report:
//   - `tar` unpacks the bundle into a fresh temp dir;
//   - the ROOT main `.tex` is located (the shallowest `.tex` in the tree) and read
//     for a `\includegraphics` whose target is an on-disk PDF in the bundle;
//   - that referenced figure file is `pdfinfo`-validated as a NON-ZERO, valid PDF;
//   - an independent grep over EVERY `.tex` in the unpacked tree confirms NO
//     `\begin{tikzpicture}`/`\begin{tikzcd}` source survives anywhere.
//
// RED today (G3 not implemented): the G1/G2 arxiv-export plugin flattens +
// materializes (+ in p123, bakes the `.bbl`), but does NOT externalize tikz. So
// the unpacked bundle's root `.tex` STILL carries the inline `\begin{tikzpicture}`
// /`\begin{tikzcd}` environments verbatim, no precompiled figure PDF was written,
// and there is no `\includegraphics` to a bundled PDF. The no-inline-tikz clause
// (and the figure-PDF clause) fails on exactly that state. The app BOOTS cleanly
// (the canonical config + the schema-valid [plugin.arxiv-export] section is
// provisioned exactly as p122/p123) and the HTML preview renders FIRST below, so
// the failure is the MISSING tikz externalization, NOT a boot/open/render error.

const PLUGIN_ID = 'arxiv-export';

// A `\includegraphics[...]{path}` reference: capture the braced target path. The
// optional `[...]` options group is permitted (e.g. `[width=...]`). Used to read
// the figure the externalized `.tex` references off the root `.tex`.
const INCLUDEGRAPHICS_RE =
  /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;

// The inline tikz environments that MUST NOT survive in ANY bundled `.tex` once
// the diagrams are externalized to PDF figures.
const INLINE_TIKZ_RE = /\\begin\{(?:tikzpicture|tikzcd)\}/g;

test('the arXiv bundle externalizes every tikz diagram to a precompiled PDF figure, with no tikz source remaining', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // Bring the app + project + HTML preview up FIRST, so a RED failure below is
  // demonstrably the missing tikz externalization, not a boot/open/render error.
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Fire the real export by running the arxiv-export PLUGIN by id through the
  // generic firewall; the chosen artifact is the bundle tarball.
  const tarball = join(manifest.runDir, 'arxiv-tikz-bundle.tar.gz');
  await runPluginById(tauriPage, PLUGIN_ID, tarball);

  let result = await pluginResult(tauriPage);
  // A bundle build runs pandoc + latexpand + per-figure pdflatex tikz compiles +
  // (G2) a multi-pass latexmk BibTeX build inside the plugin, so allow a generous
  // artifact-poll window (heavier than the p123 bbl-only bundle: each diagram is a
  // separate cold-cache pdflatex compile on top of the latexmk passes).
  for (let i = 0; i < 480 && (!existsSync(tarball) || result === null); i++) {
    await sleep(500);
    result = await pluginResult(tauriPage);
  }
  if (!existsSync(tarball)) {
    throw new Error(
      `arXiv bundle tarball never appeared at ${tarball} (result: ${JSON.stringify(result)}). ` +
        `The generic plugin firewall did not discover/run the vendored ${PLUGIN_ID} ` +
        `plugin to produce a tikz-externalized bundle from the real buffer.`,
    );
  }
  expect(existsSync(tarball)).toBe(true);

  // ── Independent process #1: it is a valid gzip tar ────────────────────────
  const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf-8' })
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  expect(listing.length).toBeGreaterThan(0);

  // ── Independent process #2: unpack into a fresh empty dir ─────────────────
  const unpackDir = mkdtempSync(join(tmpdir(), 'ppe-arxiv-tikz-unpack-'));
  execFileSync('tar', ['-xzf', tarball, '-C', unpackDir]);

  // Recursively enumerate the extracted tree (independent of the app's report).
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) out.push(...walk(p));
      else out.push(p);
    }
    return out;
  };
  const extracted = walk(unpackDir);

  // Locate the ROOT main `.tex` — the shallowest `.tex` in the bundle (the bundle
  // may unpack directly into unpackDir or under one top-level folder; accept the
  // shallowest `.tex` as the root document).
  const texFiles = extracted.filter((p) => p.endsWith('.tex'));
  expect(texFiles.length).toBeGreaterThan(0);
  const depthOf = (p: string): number =>
    p.slice(unpackDir.length).split('/').filter((s) => s.length > 0).length;
  const minDepth = Math.min(...texFiles.map(depthOf));
  const rootTexCandidates = texFiles.filter((p) => depthOf(p) === minDepth);
  expect(rootTexCandidates.length).toBe(1);
  const rootTex = rootTexCandidates[0];
  const bundleRoot = rootTex.slice(0, rootTex.lastIndexOf('/'));

  // ── Clause A — NO inline tikz source survives in ANY `.tex` in the bundle ──
  // The witness emitted root `.tex` carried a `\begin{tikzpicture}` AND a
  // `\begin{tikzcd}` (the two raw-LaTeX diagrams the provisioner appended).
  // Externalization must REPLACE each environment with a `\includegraphics{<fig>}`,
  // so an independent grep over EVERY `.tex` in the unpacked tree finds NONE of
  // those environments. A bundle that left the diagrams INLINE (G1/G2-only, no G3)
  // still carries them — and would ship the tikz toolchain dependency to arXiv.
  const inlineTikzOffenders: { file: string; envs: string[] }[] = [];
  for (const tex of texFiles) {
    const body = readFileSync(tex, 'utf-8');
    const envs = body.match(INLINE_TIKZ_RE) ?? [];
    if (envs.length > 0) {
      inlineTikzOffenders.push({ file: tex.slice(unpackDir.length + 1), envs });
    }
  }
  if (inlineTikzOffenders.length > 0) {
    throw new Error(
      `Inline tikz source survives in ${inlineTikzOffenders.length} bundled .tex file(s) — ` +
        `the diagrams were NOT externalized to PDF figures, so the bundle ships the ` +
        `tikz toolchain dependency to arXiv (which does no tikz compilation). ` +
        `Offenders: ${inlineTikzOffenders
          .map((o) => `${o.file} [${o.envs.join(', ')}]`)
          .join('; ')}.`,
    );
  }
  expect(inlineTikzOffenders).toEqual([]);

  // ── Clause B — the root `.tex` references a precompiled figure via \includegraphics ─
  // Externalization rewrites each diagram to `\includegraphics{<fig>.pdf}`. Read
  // every `\includegraphics` target off the root `.tex` and resolve it to an on-
  // disk file in the bundle (a target may be written with or without the `.pdf`
  // extension; the resolved file must be a `.pdf`).
  const rootTexBody = readFileSync(rootTex, 'utf-8');
  const includeTargets: string[] = [];
  for (const m of rootTexBody.matchAll(INCLUDEGRAPHICS_RE)) {
    includeTargets.push(m[1].trim());
  }

  const resolveFigure = (target: string): string | undefined => {
    // Resolve a `\includegraphics` target (bundle-root-relative, no/with ext)
    // against the on-disk bundle, accepting an explicit `.pdf` or an extensionless
    // target that resolves to `<target>.pdf`.
    const candidates = target.toLowerCase().endsWith('.pdf')
      ? [join(bundleRoot, target)]
      : [join(bundleRoot, `${target}.pdf`), join(bundleRoot, target)];
    return candidates.find((c) => existsSync(c) && statSync(c).isFile());
  };

  const resolvedPdfFigures = includeTargets
    .map((t) => resolveFigure(t))
    .filter((p): p is string => p !== undefined && p.toLowerCase().endsWith('.pdf'));

  if (resolvedPdfFigures.length === 0) {
    throw new Error(
      `The root .tex references no precompiled PDF figure via \\includegraphics ` +
        `resolving to an on-disk bundle PDF. \\includegraphics targets found: ` +
        `${includeTargets.length > 0 ? includeTargets.join(', ') : '(none)'}. ` +
        `The plugin did not externalize the tikz diagrams to bundled PDF figures.`,
    );
  }

  // ── Clause C — each referenced figure is a NON-ZERO, VALID PDF per pdfinfo ──
  // A dangling `\includegraphics` whose target is absent / zero-byte / not a real
  // PDF is a broken reference that proves no real precompilation happened. Validate
  // each referenced figure independently with pdfinfo (errors loudly on a non-PDF).
  const figureInfos: string[] = [];
  for (const fig of resolvedPdfFigures) {
    const size = statSync(fig).size;
    if (size === 0) {
      throw new Error(
        `Referenced figure ${fig.slice(bundleRoot.length + 1)} is a ZERO-BYTE file — ` +
          `the \\includegraphics target was never really precompiled.`,
      );
    }
    const head = readFileSync(fig).subarray(0, 5).toString('latin1');
    if (head !== '%PDF-') {
      throw new Error(
        `Referenced figure ${fig.slice(bundleRoot.length + 1)} is not a PDF ` +
          `(header ${JSON.stringify(head)}).`,
      );
    }
    let info = '';
    try {
      info = execFileSync('pdfinfo', [fig], { encoding: 'utf-8' });
    } catch (e) {
      const err = e as { stdout?: Buffer | string; stderr?: Buffer | string };
      throw new Error(
        `pdfinfo rejected the referenced figure ${fig.slice(bundleRoot.length + 1)} — ` +
          `not a valid PDF: ${err.stderr?.toString() ?? ''}`,
      );
    }
    if (!/Pages:\s+\d+/.test(info)) {
      throw new Error(
        `pdfinfo on ${fig.slice(bundleRoot.length + 1)} reports no page count — ` +
          `not a valid PDF figure:\n${info}`,
      );
    }
    figureInfos.push(info.trim().split('\n')[0] ?? '');
  }

  // The structured PluginResult reports the real outcome of the run through the
  // SAME firewall the menu uses (asserted alongside the on-disk proof, never in
  // place of it).
  if (result === null) {
    throw new Error('plugin run produced a tarball but no structured PluginResult was surfaced');
  }
  expect(result.success).toBe(true);
  expect(result.exit_code).toBe(0);
  expect(result.artifact).toBe(tarball);

  recordObservation({
    spec: manifest.spec,
    name: 'arxiv-tikz-figures',
    value: resolvedPdfFigures.length,
  });
  recordObservation({
    spec: manifest.spec,
    name: 'arxiv-tikz-figure-info',
    value: figureInfos[0] ?? '',
  });
});
