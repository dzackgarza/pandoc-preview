import { test, expect, loadDoctorManifest, spawnDoctor } from './support/process-spec';
import { recordObservation } from './support/observations';
import { execFileSync } from 'node:child_process';

// D1 — `pandoc-preview --doctor` on a valid hermetic env.
//
// Contract (doctor-contract.md, consumer 1 + obligation D1): the --doctor
// consumer prints the full check report (each named check with OK/FAIL and
// detail), every check is OK, the report carries the REAL `pandoc --version`
// string captured by the pandoc-executable check, exit code 0, and it NEVER
// creates a window (it must terminate on its own).
//
// The valid config is provisioned by scripts/provision-proof.sh for this spec.
// Export is entirely the pandoc plugin suite (export-as-plugin migration): the
// shipped pandoc-html-export and pandoc-pdf-export export-category plugins are
// installed in the plugins dir, so the battery aggregates THEIR contributed
// doctor checks (html-export-executable, pdf-export-engine, …) and per-plugin
// config-schema rows — there is no app-core `export-plugins` check anymore. The
// independent oracle for the captured version is the real `pandoc --version`
// run here, in a separate process — not the app's report.

test('--doctor reports every check OK with the real pandoc version and exits 0', async () => {
  const manifest = loadDoctorManifest();
  const result = await spawnDoctor(manifest, ['--doctor']);

  // The doctor consumer must terminate on its own and never linger as a GUI.
  expect(result.killedByTimeout).toBe(false);
  // No window: a --doctor run is a headless report; it exits 0 on success.
  expect(result.exitCode).toBe(0);

  const report = result.stdout;

  // The full named check battery appears in the report. The renderer-agnostic
  // core checks, the active renderer plugin's contributed checks (pandoc-
  // executable, pandoc-invocation, pandoc-resource-path), and the export-category
  // plugins' contributed checks all appear in the one aggregated battery.
  for (const check of [
    'config-exists',
    'config-schema',
    'config-values',
    'pandoc-executable',
    'pandoc-invocation',
    'pandoc-resource-path',
    // Export is the pandoc plugin suite: the export targets' OWN contributed
    // doctor checks, not an app-core export check.
    'html-export-executable',
    'html-export-runnable',
    'pdf-export-executable',
    'pdf-export-engine',
  ]) {
    expect(report.includes(check)).toBe(true);
  }
  // The app-core export check is gone: export is entirely plugin-contributed.
  expect(report.includes('export-plugins')).toBe(false);
  // The old superseded check name must be gone too.
  expect(report.includes('pdf-engine')).toBe(false);

  // Every check is OK: the report contains no FAIL marker on a valid env.
  expect(/\bFAIL\b/.test(report)).toBe(false);

  // The pandoc-executable check captured the REAL version string. Independent
  // oracle: read pandoc's own version banner in a separate process and assert
  // the doctor report carries that exact version token.
  const realVersionLine = execFileSync('pandoc', ['--version'], { encoding: 'utf-8' })
    .split('\n')[0]
    .trim();
  const versionToken = realVersionLine.split(/\s+/)[1]; // e.g. "3.1.11" from "pandoc 3.1.11"
  expect(versionToken).toMatch(/^\d+\.\d+/);
  expect(report.includes(versionToken)).toBe(true);

  recordObservation({ spec: manifest.spec, name: 'doctor-exit-code', value: result.exitCode ?? -1 });
  recordObservation({ spec: manifest.spec, name: 'pandoc-version', value: versionToken });
});
