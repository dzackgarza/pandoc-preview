import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
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

// P118 (Phase G / G5) — THE REAL google-research/arxiv-latex-cleaner PASS STRIPS
// COMMENTS, DRAFT COMMANDS, AND UNUSED ASSETS, AND THE BUNDLE CARRIES NO DOT-FILES;
// WITH THE CLEANER UNAVAILABLE THE EXPORT FAILS LOUDLY NAMING THE MISSING DEP.
//
// AFTER G4's figure-format gate and the G2 `.bbl` bake, and BEFORE the final `tar`,
// the arxiv-export plugin runs the REAL `arxiv_latex_cleaner` UNMODIFIED via the
// approved uvx runner (`uvx --from arxiv-latex-cleaner arxiv_latex_cleaner <bundle>
// …`) over the flattened bundle, so the REAL cleaner strips `%`-comments and
// `comment`/`iffalse` blocks, DELETES the configured draft commands (`\todo{}` via
// its `commands_to_delete`), PRUNES unused `.tex`/images, RESIZES images under the
// px cap, and REMOVES auxiliary/dot-files — producing the cleaned folder "ready to
// upload." The plugin OWNS NO comment-stripper / pruner / resizer / dot-file
// remover: it only INVOKES the real tool and VALIDATES its output; a hand-rolled
// cleaner is explicitly REJECTED and never substituted. The cleaner's config (image
// px cap, `commands_to_delete`, regex rules) is a SHIPPED asset vendored WITH the
// plugin (install_plugin_fixtures copies the whole vendor plugin dir verbatim),
// referenced from the plugin's argv — NOT app config.
//
// The arXiv target is the SAME vendored `arxiv-export` FIREWALL plugin p122/p123/
// p124/p125 drive — its `export.sh` orchestrating script, riding the SAME generic
// export firewall (run_plugin in plugins.rs) the shipped export plugins use; the app
// core is unchanged (the whole md→tex→flatten→materialize→tikz-externalize→figure-
// format-gate→latexmk-bake-`.bbl`→cleaner→tar pipeline IS the plugin's script/argv).
// It is driven BY ID through that firewall exactly as p122/p123/p124/p125 drive it
// (runPluginById → window.__PPE_E2E__.runPlugin → discover → spawn the plugin's
// command with the real buffer; the chosen {artifact} is a `.tar.gz` path the plugin
// must write).
//
// ONE hermetic project (provision-proof.sh, p126 case). Its demo.md already carries
// the shared P1 witnesses + a `![scatter](fig/plot.png)` (a referenced image the
// cleaner KEEPS). The provisioner makes the emitted `.tex` carry, POST md→tex
// emission AND — crucially — AFTER the G1 latexpand flatten step, STILL carry the
// four artifacts the REAL cleaner exists to remove. Each is forced to SURVIVE the
// builder so the cleaner is the ONLY remover (a clause the builder already satisfies
// would pass on a cleaner-absent app and prove nothing — VERIFIED on the real
// pre-G5 bundle: latexpand strips bare `%`-line comments and the builder copies only
// referenced resources, so a bare-comment / loose-unused-image / `.git`-dir clause
// would be vacuously green):
//
//   (a) a "SECRET COMMENT" sentinel inside a `\begin{comment}…\end{comment}` block
//       AND an `\iffalse … \fi` block. latexpand KEEPS comment/iffalse BLOCKS
//       (verified), so the sentinel survives the flatten into the bundled `.tex`;
//       ONLY the REAL cleaner (which strips comment/iffalse blocks) removes it. The
//       bundled `.tex` must carry NO "SECRET COMMENT".
//   (b) a `\todo{fix this}` draft command — latexpand does NOT delete it (verified);
//       ONLY the cleaner's commands_to_delete (`\todo`) does. The bundled `.tex` must
//       carry NO `\todo`.
//   (c) an UNUSED image (fig/p126-unused.png) REFERENCED only by an
//       `\includegraphics` INSIDE the comment block, so the builder copies it into
//       the bundle, but once the cleaner strips the comment block NO surviving
//       `\includegraphics` references it — the cleaner PRUNES the orphaned image. The
//       bundle must NOT ship p126-unused.png, while the genuinely-referenced
//       fig/plot.png MUST survive.
//   (d) a dot-prefixed image (fig/.p126-dot.png) REFERENCED by a surviving
//       `\includegraphics`, so the builder copies the dot-file into the bundle; arXiv
//       rejects dot-files and ONLY the cleaner removes them. The unpacked bundle must
//       carry NO dot-file / dot-prefixed path ANYWHERE.
//
// LEG 1 (CLEANED) — export demo.md and INDEPENDENTLY unpack + assert (by a fresh
//   `tar` + Node fs + `find`, never the app's report): NO "SECRET COMMENT" in any
//   bundled `.tex`, NO `\todo`, the unused image ABSENT, and NO dot-file / dot-
//   prefixed dir anywhere. The referenced image (plot.png) must SURVIVE — proving the
//   cleaner pruned the UNUSED image, not every image.
//
// LEG 2 (LOUD-FAIL IF THE CLEANER IS ABSENT) — `arxiv_latex_cleaner` is a HARD
//   dependency: when the export reaches the cleaner step it MUST either produce a
//   genuinely-cleaned bundle (the cleaner ran) OR FAIL LOUDLY naming the missing
//   `arxiv_latex_cleaner` dependency with NO tarball. The export must NEVER ship a
//   "cleaned" tarball that still carries the comment/draft/unused-asset debris — that
//   fail-open is exactly what the loud-dependency contract forbids. LEG 2 re-reads
//   the SAME emitted tarball and the structured PluginResult and asserts the export
//   landed in ONE of the two admissible states (cleaned, or loud-fail-named), NEVER
//   the fake-cleaned third state.
//
//   A per-leg uvx PATH-block is impractical for the blind proof author: the app's
//   plugin subprocess (plugins.rs Command spawn) inherits the process-global PATH the
//   proof run is launched with, which is shared across both legs, so uvx cannot be
//   present for the cleaned leg and absent for the loud-fail leg within one app
//   process. LEG 2 therefore asserts the loud-dependency CONTRACT as a required step
//   off the SAME real export: the only inadmissible outcome is a tarball that ships
//   the debris (a silently-skipped / faked cleaner). That outcome is exactly today's
//   RED.
//
// INDEPENDENCE: every Leg-1 clause is read off the REAL emitted tarball by an
// INDEPENDENT process (tar + Node fs + `find`), never the app's report; Leg 2 reads
// the SAME tarball plus the structured PluginResult the SAME firewall surfaces.
//
// RED today (G5 not implemented): G1–G4 run no cleaner over the bundle, so the
// emitted `.tex` still carries the `% SECRET COMMENT` line and the `\todo{fix this}`
// command, the bundle still ships the unused fig/p126-unused.png, and the `.git`
// dot-dir survives in the tree. LEG 1's four cleaner clauses fail. LEG 2's loud-
// dependency clause fails too: with no cleaner the plugin emits a tarball that STILL
// carries the debris (the forbidden fake-cleaned state) — neither a cleaned bundle
// nor a loud-fail naming the missing dependency. The export runs FIRST and brings the
// app + project + HTML preview up, so a RED is the MISSING cleaner pass, NOT a
// boot/open/render error.

const PLUGIN_ID = 'arxiv-export';

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
// `target`, resetting nothing — this spec runs ONE export and reads its outcome.
async function pollResultFor(
  page: Parameters<typeof pluginResult>[0],
  target: string,
): Promise<PluginResult | null> {
  let result = await pluginResult(page);
  for (let i = 0; i < 480; i++) {
    result = await pluginResult(page);
    if (existsSync(target) && result !== null) break;
    if (result !== null && result.success === false) break;
    await sleep(500);
  }
  return result;
}

test('the arXiv bundle is cleaned by the REAL arxiv_latex_cleaner — comments, draft commands, unused assets, and dot-files are gone; the cleaner is a required step (no fake-cleaned tarball)', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // ── Bring the app + project up FIRST, select the witness demo.md, and render
  // its HTML preview — so a RED below is demonstrably the missing cleaner pass, not
  // a boot/open/render error.
  await openProject(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('.grow.overflow-auto.p-1 button span:last-child')).some((s) => s.textContent.trim() === 'demo.md')`,
    15_000,
  );
  await clickSidebarEntry(tauriPage, 'demo.md');
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Fire the real export by running the arxiv-export PLUGIN by id through the
  // generic firewall; the chosen artifact is the cleaned bundle tarball.
  const tarball = join(manifest.runDir, 'arxiv-cleaner-bundle.tar.gz');
  await runPluginById(tauriPage, PLUGIN_ID, tarball);

  const result = await pollResultFor(tauriPage, tarball);

  // ─────────────────────────────────────────────────────────────────────────
  // LEG 2 (loud-dependency contract, evaluated on the SAME export) — the cleaner
  // is a HARD, REQUIRED step. The export must land in ONE of two admissible
  // states, NEVER the fake-cleaned third state (a tarball that still carries the
  // comment/draft/unused-asset debris). We classify the outcome first; the
  // detailed cleaned-bundle clauses (Leg 1) run only on the cleaned-tarball state.
  // ─────────────────────────────────────────────────────────────────────────
  const log = result === null ? '' : `${result.stdout}\n${result.stderr}`;
  const loudFailedNamingCleaner =
    result !== null &&
    result.success === false &&
    result.exit_code !== 0 &&
    /arxiv[_-]latex[_-]cleaner/i.test(log) &&
    !existsSync(tarball);

  if (loudFailedNamingCleaner) {
    // Admissible loud-fail state: the cleaner was unreachable and the export failed
    // loudly naming `arxiv_latex_cleaner`, writing NO tarball. The loud-dependency
    // clause is satisfied; there is no cleaned bundle to inspect.
    expect(existsSync(tarball)).toBe(false);
    expect(result?.success).toBe(false);
    expect(result?.exit_code).not.toBe(0);
    expect(/arxiv[_-]latex[_-]cleaner/i.test(log)).toBe(true);
    recordObservation({
      spec: manifest.spec,
      name: 'arxiv-cleaner-loud-fail',
      value: String(result?.exit_code ?? 'null'),
    });
    return;
  }

  // Not the loud-fail state ⇒ the export must have produced a CLEANED tarball. If it
  // produced NO tarball and did NOT loud-fail naming the cleaner, the cleaner step
  // never ran in either admissible form.
  if (!existsSync(tarball)) {
    throw new Error(
      `arXiv bundle tarball never appeared at ${tarball} and the export did NOT loud-fail ` +
        `naming arxiv_latex_cleaner (result: ${JSON.stringify(result)}). The generic plugin ` +
        `firewall did not discover/run the vendored ${PLUGIN_ID} plugin to produce a cleaned ` +
        `bundle, and did not surface the hard-dependency failure.`,
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
  const unpackDir = mkdtempSync(join(tmpdir(), 'ppe-arxiv-cleaner-unpack-'));
  execFileSync('tar', ['-xzf', tarball, '-C', unpackDir]);
  const extracted = walk(unpackDir);

  const texFiles = extracted.filter((p) => p.endsWith('.tex'));
  expect(texFiles.length).toBeGreaterThan(0);

  // ─────────────────────────────────────────────────────────────────────────
  // LEG 1 — CLEANED: the four cleaner clauses, each read off the unpacked bundle
  // by an independent process.
  // ─────────────────────────────────────────────────────────────────────────

  // ── Clause A — NO `% SECRET COMMENT` comment line survives in ANY `.tex` ───
  // The REAL cleaner strips `%`-comments. The emitted `.tex` carried a raw-LaTeX
  // `% SECRET COMMENT` line (pandoc passes the raw block through verbatim); the
  // cleaned bundle's `.tex` files must contain NO "SECRET COMMENT". An independent
  // scan over every bundled `.tex` enumerates the offenders.
  const commentOffenders = texFiles.filter((p) =>
    readFileSync(p, 'utf-8').includes('SECRET COMMENT'),
  );
  if (commentOffenders.length > 0) {
    throw new Error(
      `The bundle still carries the "SECRET COMMENT" comment in ${commentOffenders.length} ` +
        `.tex file(s) — the REAL arxiv_latex_cleaner did not strip the %-comment. Offenders: ` +
        `${commentOffenders.map((p) => p.slice(unpackDir.length + 1)).join(', ')}.`,
    );
  }
  expect(commentOffenders).toEqual([]);

  // ── Clause B — NO `\todo` draft command survives in ANY `.tex` ─────────────
  // The cleaner's commands_to_delete removes `\todo{}`. The emitted `.tex` carried
  // `\todo{fix this}`; the cleaned bundle must carry no `\todo`.
  const TODO_RE = /\\todo\b/;
  const todoOffenders = texFiles.filter((p) => TODO_RE.test(readFileSync(p, 'utf-8')));
  if (todoOffenders.length > 0) {
    throw new Error(
      `The bundle still carries the \\todo draft command in ${todoOffenders.length} .tex ` +
        `file(s) — the cleaner did not delete the configured draft command. Offenders: ` +
        `${todoOffenders.map((p) => p.slice(unpackDir.length + 1)).join(', ')}.`,
    );
  }
  expect(todoOffenders).toEqual([]);

  // ── Clause C — the UNUSED image is pruned; the REFERENCED image survives ───
  // fig/p126-unused.png is referenced ONLY inside the comment block, so once the
  // cleaner strips the block it is referenced by no surviving `\includegraphics` and
  // the cleaner prunes it; fig/plot.png is referenced OUTSIDE any comment, so it MUST
  // survive (proving the cleaner pruned the UNUSED image, not every image). An
  // independent `find` enumerates the bundled images by basename.
  const bundledImageBasenames = extracted
    .filter((p) => /\.(?:png|jpg|jpeg|pdf)$/i.test(p))
    .map((p) => p.slice(p.lastIndexOf('/') + 1));
  if (bundledImageBasenames.includes('p126-unused.png')) {
    throw new Error(
      `The bundle still ships the UNUSED image p126-unused.png — the cleaner did not prune ` +
        `the image referenced only inside the stripped comment block. Bundled images: ` +
        `${bundledImageBasenames.join(', ')}.`,
    );
  }
  expect(bundledImageBasenames.includes('p126-unused.png')).toBe(false);

  // The genuinely-referenced image (plot.png, referenced outside any comment) must
  // SURVIVE — the cleaner kept the asset the document uses, proving it pruned the
  // UNUSED image specifically, not every image.
  if (!bundledImageBasenames.includes('plot.png')) {
    throw new Error(
      `The genuinely-referenced image plot.png is ABSENT from the bundle — the cleaner pruned ` +
        `an asset the document uses. Bundled images: ${bundledImageBasenames.join(', ')}.`,
    );
  }
  expect(bundledImageBasenames.includes('plot.png')).toBe(true);

  // ── Clause D — NO dot-file / dot-prefixed path survives ANYWHERE ───────────
  // arXiv rejects dot-files / dot-prefixed dirs; the cleaner removes them. The
  // witness referenced fig/.p126-dot.png, so the builder copied that dot-file into
  // the bundle; the cleaner must remove it. An independent `find` over the whole
  // unpacked tree for any path component beginning with a dot must return empty.
  const dotPaths = execFileSync(
    'find',
    [unpackDir, '-name', '.*', '-not', '-name', '.', '-not', '-name', '..'],
    { encoding: 'utf-8' },
  )
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (dotPaths.length > 0) {
    throw new Error(
      `The bundle ships ${dotPaths.length} dot-file / dot-prefixed path(s) arXiv would reject — ` +
        `the cleaner did not remove them. Found: ` +
        `${dotPaths.map((p) => p.slice(unpackDir.length + 1)).join(', ')}.`,
    );
  }
  expect(dotPaths).toEqual([]);

  // The structured PluginResult reports the real outcome of the run through the SAME
  // firewall the menu uses (asserted alongside the on-disk proof, never in place of
  // it). A cleaned tarball at the target with a zero exit is the success contract.
  if (result === null) {
    throw new Error('export produced a tarball but no structured PluginResult was surfaced');
  }
  expect(result.success).toBe(true);
  expect(result.exit_code).toBe(0);
  expect(result.artifact).toBe(tarball);

  recordObservation({ spec: manifest.spec, name: 'arxiv-cleaner-bundle-files', value: listing.length });
  recordObservation({
    spec: manifest.spec,
    name: 'arxiv-cleaner-bundled-images',
    value: bundledImageBasenames.join(','),
  });
});
