import { test, expect } from '@playwright/test';
import { loadDoctorManifest } from './support/process-spec';
import { driveLauncher } from './support/launcher';
import { recordObservation } from './support/observations';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// D2 — launcher, NO config.
//
// Contract (consumer 3 + obligation D2): `just run` invokes the launcher
// script; its doctor reports a config-class failure (config-exists), routes
// into the gum first-run flow in a real PTY, then the app boots to the editor
// UI. We drive the launcher through scripts/drive-launcher.py (pexpect PTY),
// answering the gum prompts with deterministic values, and require the
// launcher to complete the gum handoff AND write the reconfigured config.
//
// The launcher (scripts/launch.sh) does not exist yet, so the PTY driver
// exits with LAUNCHER_MISSING — the contract red for D2.

test('launcher with no config routes through gum first-run and boots the app', () => {
  const manifest = loadDoctorManifest();
  const xdgConfigHome = `${manifest.runDir}/xdg-config`;
  const home = `${manifest.runDir}/home`;

  // Pre-state: no config exists (provisioning leaves the config dir empty).
  expect(existsSync(manifest.configPath)).toBe(false);

  const r = driveLauncher(xdgConfigHome, home, 'no-config');

  // The launcher must exist and complete the gum first-run handoff to the app.
  expect(r.stdout.includes('LAUNCHER_MISSING')).toBe(false);
  expect(r.stdout.includes('LAUNCHER_HANDOFF_OK')).toBe(true);
  expect(r.status).toBe(0);

  // The gum flow wrote the reconfigured config to disk with the selected
  // values, read back by an independent process (python tomllib).
  expect(existsSync(manifest.configPath)).toBe(true);
  const cfg = JSON.parse(
    execFileSync(
      'python3',
      ['-c', 'import sys,tomllib,json;print(json.dumps(tomllib.load(open(sys.argv[1],"rb"))))', manifest.configPath],
      { encoding: 'utf-8' },
    ),
  ) as Record<string, Record<string, unknown>>;
  expect(cfg.general.theme).toBe('light');
  expect(cfg.editor.font_size).toBe(20);
  expect(cfg.preview.debounce_ms).toBe(350);

  recordObservation({ spec: manifest.spec, name: 'launcher-exit', value: r.status ?? -1 });
});
