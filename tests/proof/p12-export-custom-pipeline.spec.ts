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

// P12 — Custom export pipeline honored. The hermetic plugins dir carries a
// USER-DEFINED export-category plugin (id "witness") whose [exec].command is an
// ARBITRARY executable (tests/proof/fixtures/plugins/witness/export.sh), NOT
// pandoc. Provisioning installs it into the [plugins].dir and writes its
// [plugin.witness] config section (scripts/provision-proof.sh) — there is NO
// app-core [export.witness] config table.
//
// Driving the plugin by id "witness" through the SAME generic plugin firewall the
// menu uses (plugins.rs run_plugin_sync), this spec proves the export surface is
// plugin-shaped, not pandoc-shaped (export-plugins-contract.md). The witness
// script derives its output from the REAL input file — the input's first heading
// line and the SHA-256 of the input's exact bytes — so an implementation that
// hard-codes a pandoc invocation, ignores the configured argv, or writes a fixed
// string cannot produce the asserted content.
//
// The expected oracle is computed INDEPENDENTLY here, in separate processes,
// from the real on-disk input the app rendered — never from the app's report.
//
// Proof debt (export-plugins-contract.md): native muda menus are unreachable
// from the webview DOM, so menu population itself is not asserted here (P66 owns
// the discovery/menu-population claim); the E2E hook drives the plugin by id
// through the same run_plugin command path the menu uses. This is not a weakened
// assertion — the on-disk witness still proves the configured argv ran against
// the real source.

test('A user-defined export-category plugin runs verbatim against the real source', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Independent oracle: the exact bytes the app is editing are on disk at the
  // hermetic demo file. Recompute what the configured plugin MUST emit.
  const inputBytes = readFileSync(manifest.demoFile);
  const expectedHeading = inputBytes
    .toString('utf-8')
    .split('\n')
    .find((line) => line.startsWith('# '));
  if (expectedHeading === undefined) {
    throw new Error(`demo input has no ATX heading: ${manifest.demoFile}`);
  }
  const expectedDigest = execFileSync('sha256sum', [manifest.demoFile], { encoding: 'utf-8' })
    .split(/\s+/)[0];
  expect(expectedDigest).toMatch(/^[0-9a-f]{64}$/);

  // Fire the real export by running the configured plugin BY ID through the
  // generic firewall, and poll for the artifact at exactly the chosen path AND
  // for the resolved structured result.
  const target = join(manifest.runDir, 'witness-output.txt');
  await runPluginById(tauriPage, 'witness', target);

  let result = await pluginResult(tauriPage);
  for (let i = 0; i < 80 && (!existsSync(target) || result === null); i++) {
    await sleep(250);
    result = await pluginResult(tauriPage);
  }
  if (!existsSync(target)) {
    throw new Error(
      `Custom witness export never appeared at ${target} (result: ${JSON.stringify(result)}). ` +
        `The export surface did not run the configured "witness" plugin argv against the real source.`,
    );
  }

  const produced = readFileSync(target, 'utf-8');

  // The witness file proves the configured argv ran against the REAL input:
  // it carries the input's first heading line and the SHA-256 of the input's
  // exact bytes, both reconstructed independently above.
  expect(produced).toContain(`heading: ${expectedHeading}`);
  expect(produced).toContain(`sha256: ${expectedDigest}`);
  // It is the witness executable's output, not a pandoc artifact.
  expect(produced.startsWith('WITNESS-EXPORT v1')).toBe(true);

  // The structured PluginResult reports the real outcome of the run through the
  // SAME firewall the menu uses.
  if (result === null) {
    throw new Error('plugin run produced an artifact but no structured PluginResult was surfaced');
  }
  expect(result.success).toBe(true);
  expect(result.exit_code).toBe(0);
  expect(result.artifact).toBe(target);

  recordObservation({ spec: manifest.spec, name: 'witness-sha256', value: expectedDigest });
});
