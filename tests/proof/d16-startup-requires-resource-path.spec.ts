import { test, expect, loadDoctorManifest, spawnDoctor } from './support/process-spec';
import { recordObservation } from './support/observations';

// D16 — bare binary (no --doctor) with a VALID config but PANDOC_RESOURCE_PATH
// UNSET.
//
// Contract (consumer 2, the startup gate): PANDOC_RESOURCE_PATH (the global
// figures resource dir, exported by ~/.pathrc) is required for app
// functionality — without it the renderer cannot resolve figures referenced
// relative to the global figures dir, and EVERY render fails. That failure must
// surface ONCE, at startup, as a refusal to boot — not silently, once per render,
// buried in each compile log. So the pandoc-renderer contributes a
// pandoc-resource-path doctor check, and the startup battery (which already
// refuses to boot on any FAIL) hard-fails before any window when the var is unset.
//
// The config here is otherwise VALID (write_valid_config): the ONLY failing
// check is pandoc-resource-path, isolating the obligation. spawnDoctor launches
// with the var explicitly unset (resourcePath: null).
//
// RED today: there is no pandoc-resource-path check, so an unset var passes the
// battery and the binary launches the GUI and never exits — spawnDoctor must
// group-kill it (killedByTimeout), the contract red.

test('bare binary with PANDOC_RESOURCE_PATH unset refuses to boot naming pandoc-resource-path, no window', async () => {
  const manifest = loadDoctorManifest();
  // Normal launch path (no --doctor), gated by the startup battery, with the
  // global figures resource var UNSET.
  const result = await spawnDoctor(manifest, [], { resourcePath: null });

  // The startup gate must hard-fail before any window: the process exits on its
  // own (we never had to kill a lingering GUI).
  expect(result.killedByTimeout).toBe(false);
  // Nonzero exit on a failed gate.
  expect(result.exitCode).not.toBe(0);
  expect(result.exitCode).not.toBe(null);

  // The report is on STDERR and names the specific failing check.
  expect(result.stderr.includes('pandoc-resource-path')).toBe(true);
  expect(
    /pandoc-resource-path[\s\S]{0,120}\bFAIL\b|\bFAIL\b[\s\S]{0,120}pandoc-resource-path/.test(
      result.stderr,
    ),
  ).toBe(true);
  // The config itself is valid: config-schema is NOT the failing check.
  expect(
    /config-schema[\s\S]{0,80}\bFAIL\b|\bFAIL\b[\s\S]{0,80}config-schema/.test(result.stderr),
  ).toBe(false);

  recordObservation({ spec: manifest.spec, name: 'gate-exit-code', value: result.exitCode ?? -1 });
});
