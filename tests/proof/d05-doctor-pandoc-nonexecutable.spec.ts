import { test, expect, loadDoctorManifest, spawnDoctor } from './support/process-spec';
import { recordObservation } from './support/observations';

// D5 — `--doctor` with `pandoc.path` pointing at a NON-EXECUTABLE file.
//
// Contract (obligation D5): the report shows exactly `pandoc-executable`
// failing and the consumer exits 1. The provisioned config is schema-valid
// and value-valid, so the only failing check is pandoc-executable: its path
// resolves to a real file that is NOT executable, so the executable probe
// (and `pandoc --version` exit 0) cannot pass.
//
// "Exactly pandoc-executable failing" means the checks that precede it
// (config-exists, config-schema, config-values) are OK and the downstream
// pandoc-invocation is reported as a consequence/also-failing, but the
// distinguishing failure the report attributes is pandoc-executable. We
// assert pandoc-executable is FAIL and the config-class checks are not.
//
// Today --doctor does not exist: the GUI launches and never exits.
// spawnDoctor bounds it; killedByTimeout being true is the contract red.

test('--doctor with a non-executable pandoc path fails pandoc-executable and exits 1', async () => {
  const manifest = loadDoctorManifest();
  const result = await spawnDoctor(manifest, ['--doctor']);

  // The doctor consumer must self-terminate, never linger as a window.
  expect(result.killedByTimeout).toBe(false);
  // A failing doctor report exits 1.
  expect(result.exitCode).toBe(1);

  const report = result.stdout.length > 0 ? result.stdout : result.stderr;

  // pandoc-executable is the failing check.
  expect(
    /pandoc-executable[\s\S]{0,80}\bFAIL\b|\bFAIL\b[\s\S]{0,80}pandoc-executable/.test(report),
  ).toBe(true);

  // The config-class checks that precede it are OK (the config is valid):
  // the failure is localized to the pandoc executable, not the config.
  expect(
    /config-schema[\s\S]{0,80}\bFAIL\b|\bFAIL\b[\s\S]{0,80}config-schema/.test(report),
  ).toBe(false);

  recordObservation({ spec: manifest.spec, name: 'doctor-exit-code', value: result.exitCode ?? -1 });
});
