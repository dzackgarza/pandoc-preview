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

// P7 — Export HTML artifact (shipped default export plugin), driven through the
// GENERIC plugin firewall (Milestone A, proven by p19), NOT through the app-core
// export_document / [export.html] config table. Export-as-plugin migration
// (export-plugins-contract.md; proof-obligations.md migration rulings 2026-06-17):
// the app core owns NO pandoc/export command knowledge — HTML export is a
// DISCOVERED export-category plugin in the pandoc suite, exactly as rendering
// already moved to the pandoc-renderer plugin. So this spec runs the shipped
// "pandoc-html-export" plugin BY ID against the REAL open buffer via
// window.__PPE_E2E__.runPlugin (the same firewall p19 exercises): the backend
// discovers the plugin from [plugins].dir, substitutes {file}/{artifact}, and
// spawns its command with the real buffer on stdin. The export flags
// (--embed-resources for a self-contained artifact; local MathJax) live INSIDE
// that plugin, never in the app core.
//
// Provisioning (scripts/provision-proof.sh, p07 branch) installs the
// pandoc-html-export plugin into this spec's hermetic plugins dir and writes its
// [plugin.pandoc-html-export] config section. The only bypassed surface is the
// native save dialog (the harness supplies the target path). Everything else
// reads the real produced artifact.
//
// Then this process asserts — VERBATIM the P7 obligation — that the file exists
// at exactly that path, its parsed DOM repeats the P1 witnesses, and the image is
// inlined as a self-contained data: URI.
//
// The exported bytes are parsed by the REAL webview engine via DOMParser
// (page.evaluate), not a hand-rolled regex.

test('Export HTML writes a self-contained artifact carrying the P1 witnesses', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  const target = join(manifest.runDir, 'export-witness.html');
  // Fire the real export by running the shipped HTML export PLUGIN by id through
  // the generic firewall (api.runPlugin -> discover -> spawn the plugin's command
  // with the real buffer on stdin), then poll for the artifact AND the structured
  // PluginResult — the same shape p19 proves.
  await runPluginById(tauriPage, 'pandoc-html-export', target);

  let result = await pluginResult(tauriPage);
  for (let i = 0; i < 80 && (!existsSync(target) || result === null); i++) {
    await sleep(250);
    result = await pluginResult(tauriPage);
  }
  if (!existsSync(target)) {
    throw new Error(
      `Export HTML artifact never appeared at ${target} (result: ${JSON.stringify(result)}). ` +
        `The generic plugin firewall did not discover/run the shipped pandoc-html-export ` +
        `export plugin against the real buffer.`,
    );
  }
  expect(existsSync(target)).toBe(true);

  const htmlText = readFileSync(target, 'utf-8');

  // Parse the exported bytes in the real engine and read the witnesses.
  const witnesses = (await tauriPage.evaluate(
    `(() => {
      const doc = new DOMParser().parseFromString(${JSON.stringify(htmlText)}, 'text/html');
      const ol = doc.querySelectorAll('ol > li');
      const img = doc.querySelector('img[alt="scatter"]');
      return {
        h1: doc.querySelector('h1')?.textContent ?? null,
        em: doc.querySelector('em')?.textContent ?? null,
        lastLi: ol.length ? ol[ol.length - 1].textContent.trim() : null,
        imgSrcPrefix: img ? img.getAttribute('src').slice(0, 5) : null,
      };
    })()`,
  )) as { h1: string; em: string; lastLi: string; imgSrcPrefix: string };

  expect(witnesses.h1).toBe('Geometry of Numbers — Café');
  expect(witnesses.em).toBe('naïve');
  expect(witnesses.lastLi).toBe('Minkowski bound');
  // Self-contained: the image src is a data: URI, not a relative path.
  expect(witnesses.imgSrcPrefix).toBe('data:');

  recordObservation({
    spec: manifest.spec,
    name: 'export-bytes',
    value: Buffer.byteLength(htmlText, 'utf-8'),
  });
});
