// Launcher-driver support for the doctor obligations D2 and D3.
//
// D2/D3 exercise the `just run` launcher (contract path scripts/launch.sh),
// which runs the doctor battery, routes config-class failures into the gum
// first-run flow through a real PTY, then hands off to the app. gum needs a
// TTY, so the PTY automation lives in scripts/drive-launcher.py (pexpect,
// PEP 723 + uv), exactly like scripts/drive-first-run.py for P10.
//
// This helper runs that driver as a child process and returns its outcome so
// the spec can assert on the contract result: the launcher exists, the gum
// reconfiguration handoff completes, and the resulting config.toml on disk is
// the reconfigured one. The launcher does not exist yet, so today the driver
// exits with LAUNCHER_MISSING — the contract red for D2/D3.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const driver = join(repoRoot, 'scripts', 'drive-launcher.py');
const launcher = join(repoRoot, 'scripts', 'launch.sh');

export interface LauncherResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export type LauncherMode = 'no-config' | 'stale-key';

// Drive the launcher through the real PTY driver. xdgConfigHome/home are the
// hermetic dirs the spec was provisioned with. Returns the driver's full
// outcome; the spec asserts the contract result, never swallows failures.
export function driveLauncher(
  xdgConfigHome: string,
  home: string,
  mode: LauncherMode,
): LauncherResult {
  const r = spawnSync(driver, [launcher, xdgConfigHome, home, mode], {
    encoding: 'utf-8',
    timeout: 60_000,
  });
  return {
    status: r.status,
    signal: r.signal,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

export function launcherPath(): string {
  return launcher;
}
