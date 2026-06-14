import { test, expect, loadDoctorManifest, spawnDoctor } from './support/process-spec';
import { recordObservation } from './support/observations';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// D14 — the REAL first-run.sh must leave a DOCTOR-CLEAN system.
//
// Reported bug (2026-06-15): on a real machine `just dev`/`just setup` writes the
// config via scripts/first-run.sh, then the very next gate — the doctor — fails:
//
//   [FAIL] plugins: plugin discovery failed: plugins dir
//   /home/dzack/.config/pandoc-preview/plugins is not a directory
//
// first-run.sh writes `[plugins] dir = "$CONFIG_DIR/plugins"` but never creates
// that directory nor installs the shipped pandoc renderer plugin into it (the
// plugin was never vendored for real install — it exists only as a test
// fixture). So a freshly configured system fails the doctor immediately.
//
// Why the suite stayed green: EVERY other proof path that runs the real
// first-run.sh (p10, d02, d03, d06, d07) injects the renderer fixture into the
// plugins dir out-of-band (provision-proof.sh `install_plugin_fixtures`), doing
// first-run.sh's job for it; and p10 asserts the app boots, never `--doctor`.
// No spec runs the REAL first-run.sh output through the doctor WITHOUT that
// harness injection. This spec is that missing test: its provisioning drives
// first-run.sh and deliberately injects nothing, so what the doctor sees is
// exactly what first-run.sh produced.
//
// Contract: after the real first-run.sh, `--doctor` exits 0 with no FAIL, the
// plugins directory and the shipped renderer exist on disk, and the renderer's
// contributed pandoc-executable/pandoc-invocation checks are in the battery
// (proving discovery actually found the renderer, not merely an empty dir).

test('the real first-run.sh leaves a system that passes --doctor', async () => {
  const manifest = loadDoctorManifest();

  // (1) Independent on-disk check: first-run.sh itself must have produced the
  // plugins directory it points the config at, populated with the shipped
  // pandoc renderer (a subdir carrying plugin.toml). This is the root artifact
  // the doctor's plugins check depends on.
  const pluginsDir = join(dirname(manifest.configPath), 'plugins');
  expect(existsSync(pluginsDir)).toBe(true);
  expect(statSync(pluginsDir).isDirectory()).toBe(true);
  const rendererManifest = join(pluginsDir, 'pandoc-renderer', 'plugin.toml');
  expect(existsSync(rendererManifest)).toBe(true);

  // (2) The doctor over that real first-run output exits clean.
  const result = await spawnDoctor(manifest, ['--doctor']);
  expect(result.killedByTimeout).toBe(false);

  const report = result.stdout;
  // The precise observed failure must be gone.
  expect(report.includes('plugin discovery failed')).toBe(false);
  expect(report.includes('is not a directory')).toBe(false);
  // No check fails.
  expect(/\bFAIL\b/.test(report)).toBe(false);
  // Discovery actually found the shipped renderer: its contributed checks are in
  // the battery (these only appear when the pandoc-renderer plugin is present —
  // an empty plugins dir would not satisfy this).
  expect(report.includes('pandoc-executable')).toBe(true);
  expect(report.includes('pandoc-invocation')).toBe(true);
  // The doctor consumer self-terminates with success.
  expect(result.exitCode).toBe(0);

  recordObservation({
    spec: manifest.spec,
    name: 'first-run-doctor-exit',
    value: result.exitCode ?? -1,
  });
  recordObservation({
    spec: manifest.spec,
    name: 'first-run-plugins-count',
    value: readdirSync(pluginsDir).length,
  });
});
