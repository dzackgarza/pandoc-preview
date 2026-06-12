import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, exportTo, waitForPreview, sleep } from './support/app';

// P8 — Export PDF artifact (shipped default plugin). Export demo.md to PDF via
// the REAL export boundary, driving the configured [export.pdf] plugin
// (export-plugins-contract.md: command = pandoc ... --pdf-engine=lualatex ...).
// Provisioning writes that plugin table into the hermetic config. Assert a
// valid PDF whose extracted text contains the witnesses, AND whose pdfinfo
// Producer/Creator discriminates the configured engine: lualatex emits a
// "LuaTeX-..." Producer, pandoc's implicit pdflatex default emits "pdfTeX-...".
//
// Revised 2026-06-13: the original P8 never discriminated the engine — it
// passed because pdflatex was installed, even though the export command passed
// NO --pdf-engine and thus ran pandoc's implicit pdfTeX default. The Producer
// assertion is the discriminator that proves the CONFIGURED command ran. PDF
// validity, text extraction, and metadata are read by independent processes
// (pdfinfo, pdftotext). lualatex is a hard dependency — never skipped.

test('Export PDF runs the configured lualatex plugin and carries the witnesses', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  const target = join(manifest.runDir, 'export-witness.pdf');
  await exportTo(tauriPage, 'pdf', target);
  for (let i = 0; i < 160 && !existsSync(target); i++) {
    await sleep(250);
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
