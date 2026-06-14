import { test, expect } from '@playwright/test';
import { loadDoctorManifest } from './support/process-spec';
import { spawnSync, execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// C3 (d13) — the pandoc renderer's configuration manager is its own gum wizard
// (launched by the app in a kitty popup; render-rebuild-plan.md). It edits the raw
// pandoc command and LOCKS the required filters in: re-running it must produce a
// command that contains the required filters even though the starting config's
// command lacked them and the operator added nothing. Driven directly through a
// real PTY (the kitty popup is just a wrapper around this wizard).
//
// RED today: the wizard (configure-wizard.sh) does not exist, so the PTY driver
// cannot run it and exits nonzero.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const driver = join(repoRoot, 'scripts', 'drive-configure.py');
const wizard = join(
  repoRoot,
  'tests',
  'proof',
  'fixtures',
  'plugins',
  'pandoc-renderer',
  'configure-wizard.sh',
);

const REQUIRED = ['convert_amsthm_envs.lua', 'obsidian_callouts.lua', 'obsidian.lua'];

test('the pandoc gum configurator writes a valid command with the required filters locked in', () => {
  const manifest = loadDoctorManifest();
  const home = join(manifest.runDir, 'home');
  const configDir = dirname(manifest.configPath);

  // Pre-state: the command lacks the required filters (provisioning wrote a bare one).
  const before = JSON.parse(
    execFileSync(
      'python3',
      ['-c', 'import sys,tomllib,json;print(json.dumps(tomllib.load(open(sys.argv[1],"rb"))))', manifest.configPath],
      { encoding: 'utf-8' },
    ),
  ) as { plugin: Record<string, { command: string }> };
  expect(before.plugin['pandoc-renderer'].command.includes('--lua-filter')).toBe(false);

  const r = spawnSync(driver, [wizard, configDir, home], { encoding: 'utf-8', timeout: 60_000 });
  expect(r.stdout.includes('CONFIGURE_DRIVE_OK')).toBe(true);
  expect(r.status).toBe(0);

  // The wizard wrote a valid config (independent tomllib read) whose command now
  // carries every required filter — locked in despite the operator adding nothing.
  const after = JSON.parse(
    execFileSync(
      'python3',
      ['-c', 'import sys,tomllib,json;print(json.dumps(tomllib.load(open(sys.argv[1],"rb"))))', manifest.configPath],
      { encoding: 'utf-8' },
    ),
  ) as { plugin: Record<string, { command: string }> };
  const command = after.plugin['pandoc-renderer'].command;
  for (const f of REQUIRED) {
    expect(command).toContain(`--lua-filter=`);
    expect(command).toContain(f);
  }
  expect(command).toContain('--embed-resources');
});
