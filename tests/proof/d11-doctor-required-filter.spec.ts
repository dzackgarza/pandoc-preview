import { test, expect, loadDoctorManifest, spawnDoctor } from './support/process-spec';
import { recordObservation } from './support/observations';

// C4 / D3 (d11) — the pandoc renderer plugin contributes a required-filter doctor
// check: every REQUIRED HTML-preview filter must resolve in ~/.pandoc/filters; a
// missing one is a fatal validation failure (required-filter-set.md). Provisioning
// installs the filters (write_valid_config -> emit_pandoc_renderer -> install-assets)
// then removes tikzcd.lua — a required, vendored filter that is not yet referenced
// by the command (deferred to Milestone F) — so required-filter is the SOLE failing
// check: the command still runs (it does not reference tikzcd), only the required
// set is short.
//
// RED today: no required-filter check exists, so the doctor never notices the
// missing filter — it reports all-OK and exits 0.

test('--doctor fails required-filter when a required filter is missing', async () => {
  const manifest = loadDoctorManifest();
  const result = await spawnDoctor(manifest, ['--doctor']);

  // The doctor consumer must self-terminate, never linger as a window.
  expect(result.killedByTimeout).toBe(false);
  // A failing doctor report exits 1.
  expect(result.exitCode).toBe(1);

  const report = result.stdout.length > 0 ? result.stdout : result.stderr;

  // required-filter is FAIL and names the missing filter.
  expect(
    /required-filter[\s\S]{0,120}\bFAIL\b|\bFAIL\b[\s\S]{0,120}required-filter/.test(report),
  ).toBe(true);
  expect(report.includes('tikzcd.lua')).toBe(true);

  // The failure is the missing filter, not the config — config-class checks are OK.
  expect(
    /config-schema[\s\S]{0,80}\bFAIL\b|\bFAIL\b[\s\S]{0,80}config-schema/.test(report),
  ).toBe(false);

  recordObservation({ spec: manifest.spec, name: 'doctor-exit-code', value: result.exitCode ?? -1 });
});
