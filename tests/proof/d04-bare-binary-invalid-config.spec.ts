import { test, expect, loadDoctorManifest, spawnDoctor } from './support/process-spec';
import { recordObservation } from './support/observations';

// D4 — bare binary (no --doctor) with an INVALID config.
//
// Contract (consumer 2, the startup gate + obligation D4): the check battery
// runs before the Tauri builder; any failure hard-fails with the report on
// stderr and a nonzero exit, and NO window is created. The in-app
// "Configuration required" screen is deleted (unreachable). The provisioned
// config carries a stale key removed from the schema, so config-schema is the
// failing check (deny_unknown_fields), and the stderr report must name it.
//
// Today there is no startup gate: the binary launches the GUI on any config
// and never exits; an invalid config only surfaces as an in-app error screen.
// spawnDoctor bounds the GUI and reports killedByTimeout — the contract red.

test('bare binary with invalid config hard-fails on stderr naming config-schema, no window', async () => {
  const manifest = loadDoctorManifest();
  // No --doctor: this is the normal launch path, gated by the startup battery.
  const result = await spawnDoctor(manifest, []);

  // The startup gate must hard-fail before any window: the process exits on
  // its own (we never had to kill a lingering GUI).
  expect(result.killedByTimeout).toBe(false);
  // Nonzero exit on a failed gate.
  expect(result.exitCode).not.toBe(0);
  expect(result.exitCode).not.toBe(null);

  // The report is on STDERR (the gate fails loudly to stderr), and it names
  // the specific failing check: config-schema (stale key rejected).
  expect(result.stderr.includes('config-schema')).toBe(true);
  // The failing check is marked FAIL in the stderr report.
  expect(/config-schema[\s\S]{0,80}\bFAIL\b|\bFAIL\b[\s\S]{0,80}config-schema/.test(result.stderr)).toBe(
    true,
  );

  recordObservation({ spec: manifest.spec, name: 'gate-exit-code', value: result.exitCode ?? -1 });
});
