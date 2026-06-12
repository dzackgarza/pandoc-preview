import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, exportByPlugin, exportState, waitForPreview, sleep } from './support/app';

// P12 — Custom export pipeline honored. The hermetic config carries a
// user-defined [export.witness] plugin whose `command` is an ARBITRARY
// executable (tests/proof/fixtures/plugins/witness-export.sh), NOT pandoc.
// Provisioning wires it in (scripts/provision-proof.sh emit_witness_export_table).
//
// Driving export by the plugin id "witness" through the same command path the
// menu uses, this spec proves the export surface is plugin-shaped, not
// pandoc-shaped (export-plugins-contract.md). The witness script derives its
// output from the REAL input file — the input's first heading line and the
// SHA-256 of the input's exact bytes — so an implementation that hard-codes a
// pandoc invocation, ignores the configured argv, or writes a fixed string
// cannot produce the asserted content.
//
// The expected oracle is computed INDEPENDENTLY here, in separate processes,
// from the real on-disk input the app rendered — never from the app's report.
//
// Proof debt (export-plugins-contract.md): native muda menus are unreachable
// from the webview DOM, so menu population itself is not asserted; the E2E hook
// drives the plugin by id through the same export command path. This is not a
// weakened assertion — the on-disk witness still proves the configured argv ran
// against the real source.

test('A custom [export.witness] plugin runs verbatim against the real source', async ({
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

  // Fire the real export by the configured plugin id and poll for the artifact
  // at exactly the chosen path.
  const target = join(manifest.runDir, 'witness-output.txt');
  await exportByPlugin(tauriPage, 'witness', target);
  for (let i = 0; i < 80 && !existsSync(target); i++) {
    await sleep(250);
  }
  if (!existsSync(target)) {
    const state = await exportState(tauriPage);
    throw new Error(
      `Custom witness export never appeared at ${target} (export state: ${state}). ` +
        `The export surface did not run the configured [export.witness] argv against the real source.`,
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

  recordObservation({ spec: manifest.spec, name: 'witness-sha256', value: expectedDigest });
});
