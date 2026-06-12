import { test, expect } from '@playwright/test';
import { loadDoctorManifest } from './support/process-spec';
import { driveLauncher } from './support/launcher';
import { recordObservation } from './support/observations';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// D3 — launcher, config containing the EXACT observed stale key
// (`math = "mathjax"`). Regression test for the real reported failure: a
// stale config key produced a dead-end in-app error screen instead of
// routing into reconfiguration.
//
// Contract (consumer 3 + obligation D3): the launcher's doctor sees
// config-schema fail (deny_unknown_fields rejects `math`), routes into gum
// reconfiguration (--force, guarded by gum confirm), the old config is
// REPLACED (the stale key is gone), and the app boots.
//
// The launcher (scripts/launch.sh) does not exist yet: the PTY driver exits
// with LAUNCHER_MISSING — the contract red for D3.

test('launcher with the stale math key reconfigures, removes it, and boots', () => {
  const manifest = loadDoctorManifest();
  const xdgConfigHome = `${manifest.runDir}/xdg-config`;
  const home = `${manifest.runDir}/home`;

  // Pre-state: the provisioned config carries the exact observed stale key.
  expect(existsSync(manifest.configPath)).toBe(true);
  expect(readFileSync(manifest.configPath, 'utf-8').includes('math = "mathjax"')).toBe(true);

  const r = driveLauncher(xdgConfigHome, home, 'stale-key');

  // The launcher must exist and complete the gum reconfiguration handoff.
  expect(r.stdout.includes('LAUNCHER_MISSING')).toBe(false);
  expect(r.stdout.includes('LAUNCHER_HANDOFF_OK')).toBe(true);
  expect(r.status).toBe(0);

  // The old config was REPLACED: the stale key is gone and the new selected
  // values are present, read back by an independent process.
  const rawAfter = readFileSync(manifest.configPath, 'utf-8');
  expect(rawAfter.includes('math = "mathjax"')).toBe(false);
  const cfg = JSON.parse(
    execFileSync(
      'python3',
      ['-c', 'import sys,tomllib,json;print(json.dumps(tomllib.load(open(sys.argv[1],"rb"))))', manifest.configPath],
      { encoding: 'utf-8' },
    ),
  ) as Record<string, Record<string, unknown>>;
  // The reconfigured config parses under the real schema (no stale key) and
  // carries the gum-selected values.
  expect(cfg.general.theme).toBe('light');
  expect(cfg.editor.font_size).toBe(20);
  expect(cfg.preview.debounce_ms).toBe(350);

  recordObservation({ spec: manifest.spec, name: 'launcher-exit', value: r.status ?? -1 });
});
