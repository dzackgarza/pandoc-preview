// PTY-driver support for the re-setup recovery obligations D6 and D7.
//
// D6 exercises `just setup` (scripts/first-run.sh) run over an EXISTING
// config: it must offer a gum confirm to overwrite and reconfigure, not
// hard-fail. D7 exercises `just dev` (scripts/dev.sh): a config-class doctor
// failure must route into the same gum recovery BEFORE `tauri dev` starts.
//
// Both need a real TTY for gum, so the automation lives in PEP 723 + uv
// pexpect drivers (scripts/drive-first-run.py over-existing mode, and
// scripts/drive-dev.py), exactly like D2/D3's scripts/drive-launcher.py. This
// helper runs them and returns the outcome so the spec asserts the contract
// result; failures are never swallowed.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const firstRunDriver = join(repoRoot, 'scripts', 'drive-first-run.py');
const firstRun = join(repoRoot, 'scripts', 'first-run.sh');
const devDriver = join(repoRoot, 'scripts', 'drive-dev.py');
const devScript = join(repoRoot, 'scripts', 'dev.sh');

export interface DriverResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

// D6: drive `just setup` (first-run.sh, no --force) over an existing config.
export function driveSetupReconfigure(xdgConfigHome: string, home: string): DriverResult {
  const r = spawnSync(firstRunDriver, [firstRun, xdgConfigHome, home, 'over-existing'], {
    encoding: 'utf-8',
    timeout: 60_000,
  });
  return { status: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// D7: drive `just dev` (dev.sh) against a config-class-invalid config.
export function driveDev(xdgConfigHome: string, home: string): DriverResult {
  const r = spawnSync(devDriver, [devScript, xdgConfigHome, home], {
    encoding: 'utf-8',
    timeout: 60_000,
  });
  return { status: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export function devScriptPath(): string {
  return devScript;
}
