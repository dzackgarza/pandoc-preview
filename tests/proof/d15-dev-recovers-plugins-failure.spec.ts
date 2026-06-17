import { test, expect } from '@playwright/test';
import { loadDoctorManifest } from './support/process-spec';
import { driveDev } from './support/setup-recovery';
import { recordObservation } from './support/observations';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// D15 — `just dev` must RECOVER a plugins-class doctor failure, not dead-end.
//
// Reported (2026-06-15): scripts/lib-recovery.sh classifies doctor failures into
// "config-class -> reconfigure" vs "other -> unrecoverable". It only treats
// config-exists/config-schema/config-values as config-class; a `[FAIL] plugins:`
// line falls through to the catch-all and is declared a "non-config failure that
// reconfiguration cannot fix" — so `just dev` exits with a MISLEADING
// "resolve the environment (pandoc / lualatex)" instead of routing into the gum
// recovery. But a plugins failure (the configured plugins dir is missing) is
// exactly what reconfiguration fixes: first-run.sh creates the plugins dir and
// installs the shipped renderer into it.
//
// This is the state the pre-fix first-run.sh left behind (valid config, no plugins
// dir): on such a machine `just dev` cannot self-heal.
//
// Contract: `just dev` against a valid-config-but-missing-plugins-dir must route
// into the SAME gum recovery (gum confirm -> first-run --force) and hand off to
// `tauri dev`, leaving a reconfigured config whose plugins dir now carries the
// shipped renderer. We drive dev.sh through scripts/drive-dev.py (real PTY).
//
// RED today: dev.sh dead-ends on the plugins failure, so the PTY driver never
// sees the overwrite confirm and exits without DEV_HANDOFF_OK.

test('just dev recovers a plugins-class doctor failure instead of dead-ending', () => {
  const manifest = loadDoctorManifest();
  const xdgConfigHome = `${manifest.runDir}/xdg-config`;
  const home = `${manifest.runDir}/home`;

  // Pre-state: a config that passes every config-class check but points
  // [plugins].dir at a directory that does not exist — so the ONLY failing
  // doctor check is `plugins`.
  expect(existsSync(manifest.configPath)).toBe(true);
  const pluginsDir = join(dirname(manifest.configPath), 'plugins');
  expect(existsSync(pluginsDir)).toBe(false);

  const r = driveDev(xdgConfigHome, home);

  // The misclassification's exact fingerprint: the gate calling a recoverable
  // plugins failure an unrecoverable environment problem. The fix routes into
  // reconfiguration instead, so this message must not appear.
  expect(r.stdout.includes('reconfiguration cannot fix')).toBe(false);
  // dev.sh routed into recovery and reached the hand-off to `tauri dev`.
  expect(r.stdout.includes('DEV_MISSING')).toBe(false);
  expect(r.stdout.includes('DEV_HANDOFF_OK')).toBe(true);
  expect(r.status).toBe(0);

  // Recovery actually fixed the original plugins failure: the reconfigured config
  // now has a real plugins dir carrying the shipped renderer (first-run.sh
  // installs it), read on disk by an independent process.
  const newPluginsDir = join(dirname(manifest.configPath), 'plugins');
  expect(existsSync(join(newPluginsDir, 'pandoc-renderer', 'plugin.toml'))).toBe(true);

  // The config was reconfigured (the gum-selected recovery values landed),
  // read back with tomllib in a separate process.
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

  recordObservation({ spec: manifest.spec, name: 'dev-plugins-recovery-exit', value: r.status ?? -1 });
});
