import { test, expect } from '@playwright/test';
import { loadDoctorManifest } from './support/process-spec';
import { driveDev } from './support/setup-recovery';
import { recordObservation } from './support/observations';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// D7 — `just dev` routes a config-class doctor failure into recovery.
//
// Reported gap (2026-06-13): `just dev` is bare `bunx tauri dev`. With a stale
// config the app's startup doctor gate hard-fails (config-schema, see D4) and
// the dev flow dead-ends — no recovery, no hint. Only `just run`
// (scripts/launch.sh) recovers (D2/D3).
//
// Contract: `just dev` (scripts/dev.sh) must run the doctor gate and, on a
// config-class failure, route into the SAME gum recovery launch.sh uses (gum
// confirm -> first-run --force) BEFORE starting `tauri dev`. We drive dev.sh
// through scripts/drive-dev.py (real PTY) against a config-class-invalid
// config, accept the overwrite, answer the prompts, and require: dev.sh
// reaches the hand-off-to-`tauri dev` marker AND the on-disk config is the
// reconfigured valid one. The driver reaps the process session before
// `tauri dev` does real work; the GUI boot under a valid config is already
// proved by the P-series.
//
// Today scripts/dev.sh does not exist, so the PTY driver prints DEV_MISSING
// and exits nonzero — the contract red for D7.

test('just dev with an invalid config reconfigures it before starting tauri dev', () => {
  const manifest = loadDoctorManifest();
  const xdgConfigHome = `${manifest.runDir}/xdg-config`;
  const home = `${manifest.runDir}/home`;

  // Pre-state: a config-class-invalid config (carries the removed `math` key,
  // so config-schema fails — exactly what makes `just dev` dead-end today).
  expect(existsSync(manifest.configPath)).toBe(true);
  expect(readFileSync(manifest.configPath, 'utf-8').includes('math = "mathjax"')).toBe(true);

  const r = driveDev(xdgConfigHome, home);

  // The dev entry must exist and complete the recovery hand-off to `tauri dev`.
  expect(r.stdout.includes('DEV_MISSING')).toBe(false);
  expect(r.stdout.includes('DEV_HANDOFF_OK')).toBe(true);
  expect(r.status).toBe(0);

  // The invalid config was REPLACED before dev started: the stale key is gone,
  // the now-required shipped export plugins are present, and the gum-selected
  // values were written — read back by an independent process (tomllib).
  const after = readFileSync(manifest.configPath, 'utf-8');
  expect(after.includes('math = "mathjax"')).toBe(false);
  const cfg = JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        'import sys,tomllib,json;print(json.dumps(tomllib.load(open(sys.argv[1],"rb"))))',
        manifest.configPath,
      ],
      { encoding: 'utf-8' },
    ),
  ) as Record<string, Record<string, unknown>>;

  expect(cfg.general.theme).toBe('light');
  expect(cfg.editor.font_size).toBe(20);
  expect(cfg.preview.debounce_ms).toBe(350);
  // Export is entirely the pandoc plugin suite: the recovered config carries the
  // two shipped export-category plugins' config sections (no app-core [export.*]
  // table). Each [plugin.<id>].command is the raw pandoc command the plugin runs.
  const plugin = cfg.plugin as Record<string, Record<string, unknown>>;
  expect(cfg.export).toBeUndefined();
  expect((plugin['pandoc-html-export'].command as string).includes('--embed-resources')).toBe(true);
  expect((plugin['pandoc-pdf-export'].command as string).includes('--pdf-engine=lualatex')).toBe(true);

  recordObservation({ spec: manifest.spec, name: 'dev-recovery-exit', value: r.status ?? -1 });
});
