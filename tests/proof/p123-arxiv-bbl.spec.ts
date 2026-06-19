import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
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

// P115 (Phase G / G2) — A BAKED `.bbl`, NAMED TO THE MAIN `.tex`, WITH NO `.bib`
// ANYWHERE IN THE BUNDLE.
//
// The arXiv target is the SAME vendored `arxiv-export` FIREWALL plugin P114/p122
// drives — its `export.sh` orchestrating script, riding the SAME generic export
// firewall (run_plugin in plugins.rs) the shipped export plugins use; the app
// core is unchanged (the whole md→tex→flatten→materialize→latexmk-bake-`.bbl`→
// delete-`.bib`→tar pipeline IS the plugin's script/argv). It is driven BY ID
// through that firewall exactly as p122 drives it (runPluginById →
// window.__PPE_E2E__.runPlugin → discover → spawn the plugin's command with the
// real buffer; the chosen {artifact} is a `.tar.gz` path the plugin must write).
//
// G2 EXTENDS G1: after G1's flatten + macro-materialization produce the self-
// contained bundle, the plugin runs the REAL /usr/bin/latexmk binary `-pdf`
// INSIDE the flattened bundle, so latexmk's OWN multi-pass BibTeX/biber build
// resolves the citations and PRODUCES the intermediate `.bbl`; the plugin then
// CAPTURES latexmk's own `.bbl` into the bundle RENAMED to the main `.tex`'s
// basename (`main.tex` → `main.bbl`, the ONLY name arXiv reads) and DELETES the
// `.bib` from the bundle. The plugin owns NO bibliography processing — it
// leverages latexmk's own intermediate `.bbl`; the `.bib` is removed because
// arXiv reads the `.bbl` directly and a leftover required `.bib` BLOCKS
// submission.
//
// WHY THIS WITNESS PROJECT: provision-proof.sh (case p123) appends to this spec's
// demo.md a pandoc citation `[@DM19]` (pandoc `--to latex` emits `\cite{DM19}`)
// PLUS the raw-LaTeX `\bibliographystyle{plain} \bibliography{references}`, and
// stages the config-declared bibliography (tests/proof/fixtures/references.bib,
// whose DM19 entry is Dolgachev & Mumford 2019 — the DISTINCTIVE author) as a
// project-relative `references.bib` so latexmk's BibTeX pass, run from the bundle
// root, resolves `\bibliography{references}` and the formatted reference (the
// surname "Dolgachev") lands in the produced `.bbl`. The citation only resolves
// into the `.bbl` if the plugin actually ran latexmk's multi-pass BibTeX build in
// the bundle — a plugin that never baked the `.bbl` leaves the citation unresolved
// and ships no `.bbl` at all.
//
// INDEPENDENCE: every clause below is read off the REAL emitted tarball by an
// INDEPENDENT process — never the app's report:
//   - `tar` unpacks the bundle into a fresh temp dir;
//   - the ROOT main `.tex` basename is read (the shallowest `.tex` in the tree);
//   - the bundle tree is scanned for a `<main>.bbl` whose BASENAME EQUALS the main
//     `.tex` basename (the only name arXiv reads);
//   - that `.bbl`'s CONTENTS are read for the cited entry's formatted reference
//     (the distinctive author "Dolgachev" the `\cite` resolves to), proving the
//     citation was actually resolved into the `.bbl`;
//   - an independent `find … -name '*.bib'` over the whole unpacked tree confirms
//     NO `.bib` file survives ANYWHERE.
//
// RED today (G2 not implemented): the G1 arxiv-export plugin (p122) flattens +
// materializes + tars, but does NOT run latexmk to bake a `.bbl`. So the unpacked
// bundle carries NO `<main>.bbl` (the citation was never resolved into the
// bundle) — the `<main>.bbl`-present clause fails. (And independently: if a future
// partial impl shipped the `.bib` instead, the no-`.bib`-anywhere clause fails;
// and a misnamed or empty `.bbl` fails the basename / contents clauses.) The app
// BOOTS cleanly (the canonical config + the schema-valid [plugin.arxiv-export]
// section is provisioned exactly as p122) and the HTML preview renders FIRST
// below, so the failure is the MISSING `.bbl` baking, NOT a boot/open/render
// error.

const PLUGIN_ID = 'arxiv-export';

// The cited entry's distinctive author surname (references.bib DM19 = Dolgachev &
// Mumford). It appears in the baked `.bbl` ONLY if latexmk's BibTeX pass resolved
// the `\cite{DM19}` against the bundled bibliography — i.e. the plugin baked the
// `.bbl`. A plugin that never ran latexmk ships no `.bbl`, so this surname is
// absent from any `.bbl` because there is no `.bbl`.
const CITATION_AUTHOR = 'Dolgachev';

test('the arXiv bundle bakes a `.bbl` named to the main `.tex` carrying the cited reference, with no `.bib` present', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // Bring the app + project + HTML preview up FIRST, so a RED failure below is
  // demonstrably the missing `.bbl` baking, not a boot/open/render error.
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Fire the real export by running the arxiv-export PLUGIN by id through the
  // generic firewall; the chosen artifact is the bundle tarball.
  const tarball = join(manifest.runDir, 'arxiv-bbl-bundle.tar.gz');
  await runPluginById(tauriPage, PLUGIN_ID, tarball);

  let result = await pluginResult(tauriPage);
  // A bundle build runs pandoc + latexpand + a multi-pass latexmk BibTeX build
  // inside the plugin, so allow a generous artifact-poll window (heavier than the
  // p122 flatten-only bundle: latexmk drives as many LaTeX passes as needed plus
  // BibTeX on a cold cache).
  for (let i = 0; i < 480 && (!existsSync(tarball) || result === null); i++) {
    await sleep(500);
    result = await pluginResult(tauriPage);
  }
  if (!existsSync(tarball)) {
    throw new Error(
      `arXiv bundle tarball never appeared at ${tarball} (result: ${JSON.stringify(result)}). ` +
        `The generic plugin firewall did not discover/run the vendored ${PLUGIN_ID} ` +
        `plugin to produce a .bbl-baked bundle from the real buffer.`,
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
  const unpackDir = mkdtempSync(join(tmpdir(), 'ppe-arxiv-bbl-unpack-'));
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
  // shallowest `.tex` as the root document). Its BASENAME is the stem the baked
  // `.bbl` must match (`main.tex` ⇒ `main.bbl`).
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

  // ── Clause A — a `<main>.bbl` named to the main `.tex` is present ──────────
  // The baked `.bbl` must carry the main `.tex`'s basename (`main.tex` ⇒
  // `main.bbl`) — the ONLY name arXiv reads. A `.bbl` left at latexmk's jobname or
  // any other stem (basename ≠ the main tex basename) would not be read by arXiv,
  // so it is not accepted here.
  const bblFiles = extracted.filter((p) => p.endsWith('.bbl'));
  const mainBbl = bblFiles.find(
    (p) => p.slice(p.lastIndexOf('/') + 1) === `${mainStem}.bbl`,
  );
  if (mainBbl === undefined) {
    throw new Error(
      `No baked .bbl named to the main .tex (${mainStem}.bbl) in the bundle. ` +
        `Main .tex: ${rootTexName}. .bbl files present: ` +
        `${bblFiles.map((p) => p.slice(p.lastIndexOf('/') + 1)).join(', ') || '(none)'}. ` +
        `The plugin did not run latexmk to bake the .bbl named to the main .tex.`,
    );
  }

  // ── Clause B — the `.bbl`'s contents include the cited entry's reference ───
  // The baked `.bbl` must carry the formatted reference the `\cite{DM19}` resolves
  // to — the distinctive author surname "Dolgachev" from the bundled bibliography.
  // An empty `.bbl`, or one whose BibTeX pass never resolved the citation, would
  // NOT contain this surname — proving the citation was never resolved into the
  // bundle.
  const bblBody = readFileSync(mainBbl, 'utf-8');
  if (!bblBody.includes(CITATION_AUTHOR)) {
    throw new Error(
      `The baked .bbl (${mainStem}.bbl) does not contain the cited entry's ` +
        `formatted reference (author "${CITATION_AUTHOR}"). The citation was never ` +
        `resolved into the bundle by latexmk's BibTeX pass. .bbl head:\n` +
        bblBody.split('\n').slice(0, 20).join('\n'),
    );
  }

  // ── Clause C — NO `.bib` file survives ANYWHERE in the bundle ─────────────
  // arXiv reads the `.bbl` directly; a leftover required `.bib` BLOCKS submission,
  // so the plugin must DELETE every `.bib` from the bundle. An independent `find`
  // over the whole unpacked tree must return empty.
  const foundBibs = execFileSync('find', [unpackDir, '-name', '*.bib'], {
    encoding: 'utf-8',
  })
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (foundBibs.length > 0) {
    throw new Error(
      `The bundle ships ${foundBibs.length} .bib file(s) — arXiv's blocking case ` +
        `(a required .bib is present, the citation never baked). The plugin must ` +
        `DELETE the .bib after baking the .bbl. Found: ${foundBibs
          .map((p) => p.slice(unpackDir.length + 1))
          .join(', ')}.`,
    );
  }
  expect(foundBibs).toEqual([]);

  // The structured PluginResult reports the real outcome of the run through the
  // SAME firewall the menu uses (asserted alongside the on-disk proof, never in
  // place of it).
  if (result === null) {
    throw new Error('plugin run produced a tarball but no structured PluginResult was surfaced');
  }
  expect(result.success).toBe(true);
  expect(result.exit_code).toBe(0);
  expect(result.artifact).toBe(tarball);

  recordObservation({ spec: manifest.spec, name: 'arxiv-bbl-name', value: `${mainStem}.bbl` });
  recordObservation({
    spec: manifest.spec,
    name: 'arxiv-bbl-bytes',
    value: bblBody.length,
  });
});
