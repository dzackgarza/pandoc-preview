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

// A1 (p19) — The generic plugin firewall discovers a committed fixture plugin
// from the plugins dir and runs it BY ID against the REAL open buffer, returning
// a structured PluginResult and producing the artifact the plugin wrote.
//
// This is the foundation obligation of Milestone A (render-rebuild-plan.md): the
// app core knows plugins generically — discover, run by id, surface a structured
// result — with no plugin specifics baked in. It is P12's shape generalized from
// the export surface to any [tools]-category plugin: the fixture plugin
// (tests/proof/fixtures/plugins/witness-tool) writes a witness DERIVED FROM THE
// REAL INPUT (its first heading line + the SHA-256 of its exact bytes), so an
// implementation that ignores the configured argv or writes a fixed string
// cannot produce the asserted content. Both the on-disk artifact and the
// structured PluginResult are asserted; the artifact is the decisive proof.
//
// The expected oracle is computed INDEPENDENTLY here, in separate processes,
// from the real on-disk input the app opened — never from the app's report.
//
// RED today: the generic run-plugin surface does not exist —
// window.__PPE_E2E__.runPlugin is undefined, so runPluginById throws. There is
// no plugin discovery, no run_plugin command, and no structured PluginResult.

test('A generic plugin runs by id against the real buffer and returns a structured result', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Independent oracle: recompute what the configured plugin MUST emit from the
  // exact bytes the app opened on disk.
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

  // Run the fixture plugin by its manifest id and poll for the artifact at the
  // chosen path AND for the resolved structured result.
  const target = join(manifest.runDir, 'witness-tool-output.txt');
  await runPluginById(tauriPage, 'witness-tool', target);

  let result = await pluginResult(tauriPage);
  for (let i = 0; i < 80 && (!existsSync(target) || result === null); i++) {
    await sleep(250);
    result = await pluginResult(tauriPage);
  }
  if (!existsSync(target)) {
    throw new Error(
      `witness-tool artifact never appeared at ${target} (result: ${JSON.stringify(result)}). ` +
        `The plugin firewall did not discover/run the configured plugin against the real buffer.`,
    );
  }

  const produced = readFileSync(target, 'utf-8');

  // The artifact proves the configured argv ran against the REAL input: it
  // carries the input's first heading line and the SHA-256 of its exact bytes,
  // both reconstructed independently above. It is the witness executable's
  // output, not a fabricated or fixed string.
  expect(produced.startsWith('WITNESS-TOOL v1')).toBe(true);
  expect(produced).toContain(`heading: ${expectedHeading}`);
  expect(produced).toContain(`sha256: ${expectedDigest}`);

  // The structured PluginResult reports the real outcome of the run.
  if (result === null) {
    throw new Error('plugin run produced an artifact but no structured PluginResult was surfaced');
  }
  expect(result.success).toBe(true);
  expect(result.exit_code).toBe(0);
  expect(result.artifact).toBe(target);
  expect(typeof result.stdout).toBe('string');
  expect(typeof result.stderr).toBe('string');

  recordObservation({ spec: manifest.spec, name: 'plugin-witness-sha256', value: expectedDigest });
});
