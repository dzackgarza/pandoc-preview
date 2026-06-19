import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
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

// P114 (Phase G / G1) — FLATTENED SELF-CONTAINED arXiv BUNDLE COMPILES WITH NO
// SYSTEM STYLES.
//
// The arXiv export target is a vendored `arxiv-export` FIREWALL plugin — an
// orchestrating script sibling to the shipped pandoc-pdf-export / pandoc-html-
// export plugins under src-tauri/resources/vendor/plugins/ — riding the SAME
// export firewall (run_plugin in plugins.rs) the shipped export plugins use; the
// app core is unchanged (the whole md→tex→flatten→materialize→tar pipeline IS
// the plugin's script/argv). Driven BY ID through that generic firewall exactly
// as P8 drives pandoc-pdf-export and P12 drives the witness plugin
// (runPluginById → window.__PPE_E2E__.runPlugin → discover → spawn the plugin's
// command with the real buffer on stdin, substituting {file}/{artifact}). The
// chosen {artifact} is a `.tar.gz` path; the plugin must write the bundle there.
//
// The G1 pipeline (the plugin's job, NOT asserted on directly here): emit the
// `.tex` via `pandoc … -t latex` (the app's owned renderer), FLATTEN every
// `\input`/`\include` into ONE root `.tex` following the canonical `latexpand`
// resolution algorithm (/usr/bin/latexpand — the established LaTeX flattener,
// leveraged, NOT a greenfield flattener), MATERIALIZE the dependent macros/`.sty`
// the preamble pulls in by COPYING the REAL `.sty`/macro files into the bundle
// dir, then `tar` the bundle to {output}.
//
// WHY THIS WITNESS PROJECT: provision-proof.sh (case p122) provisions a witness
// whose demo.md carries (a) the shared P1 witnesses "Geometry of Numbers" and
// "Minkowski bound" so the compiled PDF is recognisably this document, (b) a raw
// LaTeX `\input{section-minkowski.tex}` of a sibling section file (so the flatten
// step is genuinely exercised — an un-flattened bundle leaves a dangling `\input`
// to a file that is NOT in the bundle), and (c) a use of the custom macro `\RR`
// (defined in the real dzg macro tier the preamble pulls in — NOT a TeX builtin)
// so a bundle that fails to materialize the macros compiles to an "Undefined
// control sequence \RR" error under the empty TEXMFHOME. The `\input`-ed section
// file ALSO uses `\RR` and carries the "Minkowski bound" witness, so the witness
// only reaches the PDF if the section was flattened in AND the macro materialized.
//
// INDEPENDENCE: every clause below is read off the REAL emitted tarball by an
// INDEPENDENT process — never the app's report:
//   - `tar` unpacks the bundle into a fresh temp dir;
//   - the root `.tex` is read for the ABSENCE of any unresolved `\input`/
//     `\include` (the flatten clause);
//   - the bundle tree is scanned for the REAL materialized `.sty`/macro file the
//     document's `\RR` resolves to (the materialize clause);
//   - `latexmk`/`pdflatex` compiles FROM THE BUNDLE ROOT with `TEXMFHOME` pointed
//     at an EMPTY dir (so the host texmf cannot silently supply the styles), and
//   - `pdfinfo` validates the PDF and `pdftotext` reads back the witnesses.
//
// RED today: there is NO `arxiv-export` plugin in the plugins dir, so the generic
// firewall discovers no plugin with that id (run_plugin returns an error — "no
// plugin with id arxiv-export"), no `.tar.gz` is ever written, and this spec
// throws at the missing-tarball guard. Until the discovered arxiv-export plugin
// emits a flattened, macro-materialized, self-contained bundle, every clause
// below is unreachable.

const PLUGIN_ID = 'arxiv-export';

test('Export to the arxiv plugin yields a flattened, self-contained bundle that compiles with no system styles', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Fire the real export by running the arxiv-export PLUGIN by id through the
  // generic firewall; the chosen artifact is the bundle tarball.
  const tarball = join(manifest.runDir, 'arxiv-bundle.tar.gz');
  await runPluginById(tauriPage, PLUGIN_ID, tarball);

  let result = await pluginResult(tauriPage);
  // A bundle build runs pandoc + latexpand + a self-contained compile inside the
  // plugin, so allow a generous artifact-poll window (heavier than the P8 PDF).
  for (let i = 0; i < 240 && (!existsSync(tarball) || result === null); i++) {
    await sleep(250);
    result = await pluginResult(tauriPage);
  }
  if (!existsSync(tarball)) {
    throw new Error(
      `arXiv bundle tarball never appeared at ${tarball} (result: ${JSON.stringify(result)}). ` +
        `The generic plugin firewall did not discover/run the vendored ${PLUGIN_ID} ` +
        `plugin to produce a flattened self-contained bundle from the real buffer.`,
    );
  }
  expect(existsSync(tarball)).toBe(true);

  // ── Independent process #1: it is a valid gzip tar ────────────────────────
  // `tar -tzf` lists the archive; it errors loudly on a non-gzip / corrupt tar.
  const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf-8' })
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  expect(listing.length).toBeGreaterThan(0);

  // ── Independent process #2: unpack into a fresh empty dir ─────────────────
  const unpackDir = mkdtempSync(join(tmpdir(), 'ppe-arxiv-unpack-'));
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

  // Locate the ROOT main `.tex` — a `.tex` at the top of the bundle (no nested
  // directory between it and the bundle root). The bundle may unpack either
  // directly into unpackDir or under a single top-level folder; accept the
  // shallowest `.tex` as the root document.
  const texFiles = extracted.filter((p) => p.endsWith('.tex'));
  expect(texFiles.length).toBeGreaterThan(0);
  const depthOf = (p: string): number =>
    p.slice(unpackDir.length).split('/').filter((s) => s.length > 0).length;
  const minDepth = Math.min(...texFiles.map(depthOf));
  const rootTexCandidates = texFiles.filter((p) => depthOf(p) === minDepth);
  expect(rootTexCandidates.length).toBe(1);
  const rootTex = rootTexCandidates[0];
  const bundleRoot = rootTex.slice(0, rootTex.lastIndexOf('/'));

  // ── Clause A — the root `.tex` has NO unresolved `\input`/`\include` ───────
  // latexpand flattens every `\input{...}`/`\include{...}` of a relative source
  // into the root, so a correctly-flattened bundle's root `.tex` carries none.
  // (`\usepackage`/`\RequirePackage` are NOT \input/\include and are allowed;
  // the materialized `.sty` files satisfy them under the empty TEXMFHOME.)
  const rootTexBody = readFileSync(rootTex, 'utf-8');
  const includeRe = /(?<!\\)\\(?:input|include)\b\s*\{[^}]+\}/g;
  const danglingIncludes = rootTexBody.match(includeRe) ?? [];
  expect(danglingIncludes).toEqual([]);

  // The flatten must have PULLED IN the section content, not dropped it: the
  // section file's UNIQUE sentinel (present ONLY in section-minkowski.tex, never
  // in demo.md) now lives inside the root `.tex`. A bundle that left the section
  // as a dangling `\input` would carry the include but NOT this inlined text.
  expect(rootTexBody.includes('PPE-FLATTENED-SECTION')).toBe(true);
  // And the document uses the custom macro that the bundle must materialize.
  expect(rootTexBody.includes('\\RR')).toBe(true);

  // ── Clause B — the custom macro `.sty`/macro file is materialized on disk ──
  // The document's `\RR` is defined in the real dzg macro tier the preamble
  // pulls in (tier1-mathjax-simple.tex: \newcommand{\RR}...), NOT a TeX builtin.
  // A correctly-materialized bundle copies the REAL `.sty`/macro file(s) defining
  // it into the bundle dir, so an independent grep over the bundle's own
  // `.sty`/`.tex` macro files (NEVER the host texmf) finds the `\RR` definition.
  const styAndMacroFiles = extracted.filter(
    (p) => p.endsWith('.sty') || (p.endsWith('.tex') && p !== rootTex),
  );
  const defowner = styAndMacroFiles.find((p) => {
    const body = readFileSync(p, 'utf-8');
    return /\\(?:newcommand|providecommand|def|DeclareMathOperator)\b[^\n]*\\?RR\b/.test(
      body,
    );
  });
  if (defowner === undefined) {
    throw new Error(
      `No materialized macro/.sty file in the bundle defines \\RR. ` +
        `Bundle files: ${styAndMacroFiles.map((p) => p.slice(bundleRoot.length + 1)).join(', ')}. ` +
        `The bundle relies on the host texmf for the macros instead of copying them in.`,
    );
  }

  // ── Independent process #3: compile from the bundle ROOT, NO system styles ─
  // TEXMFHOME → an EMPTY dir so the host's personal texmf tree cannot supply the
  // styles; the compile must succeed ONLY because the bundle is self-contained.
  // latexmk drives pdflatex as many passes as needed, in the bundle root, so the
  // materialized `.sty`/macros and the flattened section are the ONLY way the
  // custom macro `\RR` and the section witness resolve.
  const emptyTexmf = mkdtempSync(join(tmpdir(), 'ppe-empty-texmf-'));
  const compileEnv = {
    ...process.env,
    TEXMFHOME: emptyTexmf,
    // Deny any user-tree texmf as well, so ONLY the system trees (no dzg styles)
    // plus the bundle's own files are visible — the host's personal macros are
    // genuinely absent.
    TEXMFCONFIG: join(emptyTexmf, 'config'),
    TEXMFVAR: join(emptyTexmf, 'var'),
  };
  mkdirSync(compileEnv.TEXMFCONFIG, { recursive: true });
  mkdirSync(compileEnv.TEXMFVAR, { recursive: true });

  const rootTexName = rootTex.slice(rootTex.lastIndexOf('/') + 1);
  let compileLog = '';
  try {
    compileLog = execFileSync(
      'latexmk',
      ['-pdf', '-interaction=nonstopmode', '-halt-on-error', rootTexName],
      { cwd: bundleRoot, env: compileEnv, encoding: 'utf-8' },
    );
  } catch (e) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string };
    const out = `${err.stdout?.toString() ?? ''}\n${err.stderr?.toString() ?? ''}`;
    throw new Error(
      `latexmk failed to compile the bundle from its root with an EMPTY TEXMFHOME — ` +
        `the bundle is NOT self-contained. Tail of the compile log:\n` +
        out.split('\n').slice(-40).join('\n'),
    );
  }
  expect(compileLog.length).toBeGreaterThan(0);

  // The produced PDF sits beside the root `.tex` (latexmk names it <root>.pdf).
  const producedPdf = join(bundleRoot, rootTexName.replace(/\.tex$/, '.pdf'));
  if (!existsSync(producedPdf)) {
    throw new Error(
      `No PDF produced by the no-system-styles compile at ${producedPdf}.`,
    );
  }

  // ── Independent process #4: the PDF is valid and carries the witnesses ─────
  const head = readFileSync(producedPdf).subarray(0, 5).toString('latin1');
  expect(head).toBe('%PDF-');
  const info = execFileSync('pdfinfo', [producedPdf], { encoding: 'utf-8' });
  expect(/Pages:\s+\d+/.test(info)).toBe(true);

  const textOut = execFileSync('pdftotext', [producedPdf, '-'], { encoding: 'utf-8' });
  expect(textOut.includes('Geometry of Numbers')).toBe(true);
  expect(textOut.includes('Minkowski bound')).toBe(true);

  // The structured PluginResult reports the real outcome of the run through the
  // SAME firewall the menu uses (asserted alongside the on-disk proof, never in
  // place of it).
  if (result === null) {
    throw new Error('plugin run produced a tarball but no structured PluginResult was surfaced');
  }
  expect(result.success).toBe(true);
  expect(result.exit_code).toBe(0);
  expect(result.artifact).toBe(tarball);

  recordObservation({ spec: manifest.spec, name: 'arxiv-bundle-files', value: listing.length });
  recordObservation({
    spec: manifest.spec,
    name: 'arxiv-macro-owner',
    value: defowner.slice(bundleRoot.length + 1),
  });
  recordObservation({ spec: manifest.spec, name: 'arxiv-pdf-info', value: info.trim().split('\n')[0] ?? '' });
});
