import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

// P8 — Export PDF artifact (shipped default export plugin), driven through the
// GENERIC plugin firewall (Milestone A, proven by p19), NOT through the app-core
// export_document / [export.pdf] config table. Export-as-plugin migration
// (export-plugins-contract.md; proof-obligations.md migration rulings 2026-06-17):
// the app core owns NO pandoc/export command knowledge — PDF export is a
// DISCOVERED export-category plugin in the pandoc suite, exactly as rendering
// already moved to the pandoc-renderer plugin and HTML export to pandoc-html-export.
// So this spec runs the shipped "pandoc-pdf-export" plugin BY ID against the REAL
// open buffer via window.__PPE_E2E__.runPlugin (the same firewall p19/p07 exercise):
// the backend discovers the plugin from [plugins].dir, substitutes {file}/{artifact},
// and spawns its command with the real buffer on stdin. The export flags
// (--pdf-engine=lualatex) live INSIDE that plugin, never in the app core.
//
// The P8 assertions are kept VERBATIM from the pre-migration spec: a valid PDF
// whose extracted text contains the witnesses, AND whose pdfinfo Producer/Creator
// discriminates the configured engine: lualatex emits a "LuaTeX-..." Producer,
// pandoc's implicit pdflatex default emits "pdfTeX-...".
//
// Revised 2026-06-13: the original P8 never discriminated the engine — it
// passed because pdflatex was installed, even though the export command passed
// NO --pdf-engine and thus ran pandoc's implicit pdfTeX default. The Producer
// assertion is the discriminator that proves the CONFIGURED command ran. PDF
// validity, text extraction, and metadata are read by independent processes
// (pdfinfo, pdftotext). lualatex is a hard dependency — never skipped.
//
// RED today (export-as-plugin-suite migration): the shipped pandoc-pdf-export
// plugin does not exist in the plugins dir, so the generic firewall discovers no
// plugin with that id (run_plugin returns Error::InvalidArgument "no plugin with
// id ... in the plugins dir"), no artifact is ever written, and this spec throws
// at the missing-artifact guard. The verbatim P8 assertions below are unreachable
// until the discovered pandoc-pdf-export plugin produces the LuaTeX PDF.

test('Export PDF runs the configured lualatex plugin and carries the witnesses', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  const target = join(manifest.runDir, 'export-witness.pdf');
  // Fire the real export by running the shipped PDF export PLUGIN by id through
  // the generic firewall (api.runPlugin -> discover -> spawn the plugin's command
  // with the real buffer on stdin), then poll for the artifact AND the structured
  // PluginResult — the same shape p19/p07 prove.
  await runPluginById(tauriPage, 'pandoc-pdf-export', target);

  let result = await pluginResult(tauriPage);
  for (let i = 0; i < 160 && (!existsSync(target) || result === null); i++) {
    await sleep(250);
    result = await pluginResult(tauriPage);
  }
  if (!existsSync(target)) {
    throw new Error(
      `Export PDF artifact never appeared at ${target} (result: ${JSON.stringify(result)}). ` +
        `The generic plugin firewall did not discover/run the shipped pandoc-pdf-export ` +
        `export plugin against the real buffer.`,
    );
  }
  expect(existsSync(target)).toBe(true);

  // Valid PDF: magic header + pdfinfo parses it (independent process).
  const head = readFileSync(target).subarray(0, 5).toString('latin1');
  expect(head).toBe('%PDF-');
  const info = execFileSync('pdfinfo', [target], { encoding: 'utf-8' });
  expect(/Pages:\s+\d+/.test(info)).toBe(true);

  // Extracted text (independent process) carries the witnesses.
  const textOut = execFileSync('pdftotext', [target, '-'], { encoding: 'utf-8' });
  expect(textOut.includes('Geometry of Numbers')).toBe(true);
  expect(textOut.includes('Minkowski bound')).toBe(true);

  // Engine discrimination: the configured [export.pdf] plugin runs
  // --pdf-engine=lualatex, so pdfinfo's Producer (and/or Creator) must identify
  // LuaTeX. pandoc's implicit default (pdflatex) stamps "pdfTeX-..." instead, so
  // this fails on an export that ignores the configured engine.
  const producerLine =
    info.split('\n').find((l) => /^Producer:/.test(l)) ?? '';
  const creatorLine = info.split('\n').find((l) => /^Creator:/.test(l)) ?? '';
  const engineMeta = `${producerLine}\n${creatorLine}`;
  expect(/LuaTeX/i.test(engineMeta)).toBe(true);
  // And specifically NOT the implicit pdflatex default the old command ran.
  expect(/pdfTeX/i.test(engineMeta)).toBe(false);

  recordObservation({ spec: manifest.spec, name: 'pdf-pages-info', value: info.trim().split('\n')[0] ?? '' });
  recordObservation({ spec: manifest.spec, name: 'pdf-producer', value: producerLine.trim() });
});
