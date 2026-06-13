import { test, expect, loadDoctorManifest, spawnDoctor } from './support/process-spec';
import { recordObservation } from './support/observations';

// A3 (d09) — A discovered plugin's declared doctor checks join the ONE battery
// in the existing [OK]/[FAIL]/[SKIP] format alongside the core checks, and each
// reflects its REAL condition (the doctor is a single framework that runs the
// core checks and aggregates each enabled plugin's contributed checks —
// doctor-contract.md ownership note).
//
// The provisioned config (scripts/provision-proof.sh, d09 branch) declares the
// plugins dir and the witness-tool fixture, whose manifest contributes two
// doctor checks:
//   witness-tool-runnable — `test -x {plugin_dir}/run.sh`  (run.sh IS executable -> OK)
//   witness-tool-marker   — `test -f {config_dir}/witness-tool.marker`
// Provisioning deliberately does NOT create the marker file, so the marker check
// FAILs on its real condition while the runnable check passes — proving both
// directions are driven by the real environment, not a hard-coded status. A
// failing contributed check fails the doctor (exit 1).
//
// RED today: the battery is six hardcoded core checks with no plugin discovery
// and no aggregation — the report carries no witness-tool-* rows at all.

test('a discovered plugin contributes doctor checks that join the battery and reflect real conditions', async () => {
  const manifest = loadDoctorManifest();
  const result = await spawnDoctor(manifest, ['--doctor']);

  // The doctor consumer must self-terminate, never linger as a window.
  expect(result.killedByTimeout).toBe(false);
  // A failing contributed check fails the doctor.
  expect(result.exitCode).toBe(1);

  const report = result.stdout.length > 0 ? result.stdout : result.stderr;

  // The report renders one line per check as `[MARKER] name: detail`, so the
  // status marker directly precedes the check name (see doctor.rs Report::render).
  //
  // The framework still runs the core checks: config-exists is present and OK
  // (the contributed rows join the battery, they do not replace it).
  expect(/\[OK\]\s+config-exists\b/.test(report)).toBe(true);

  // The contributed runnable check joined the battery and is OK on its real
  // condition (run.sh is executable).
  expect(/\[OK\]\s+witness-tool-runnable\b/.test(report)).toBe(true);

  // The contributed marker check joined the battery and is FAIL on its real
  // condition (the marker file was deliberately not created).
  expect(/\[FAIL\]\s+witness-tool-marker\b/.test(report)).toBe(true);

  recordObservation({ spec: manifest.spec, name: 'doctor-exit-code', value: result.exitCode ?? -1 });
});
