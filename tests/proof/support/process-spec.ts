// Process-level proof fixture for the doctor obligations (D1, D4, D5).
//
// Unlike the P-series, which drives the REAL webview through the plugin
// socket, the doctor obligations assert on the binary AS A PROCESS: its
// stdout/stderr text, exit code, and the requirement that no window lingers.
// There is no webview to connect to, so this fixture does NOT use
// @srsholmes/tauri-playwright; it spawns the real binary in a hermetic XDG
// environment and observes the OS-level result.
//
// The binary under test is the PLAIN debug build (no e2e-testing feature):
// the doctor report, startup gate, and exit codes are user-facing behavior,
// not test-bridge behavior. scripts/proof-run.sh builds it with `cargo build`
// and passes its absolute path in PROOF_DOCTOR_BIN.
//
// The doctor feature does not exist yet: today the binary launches the GUI
// and never exits. spawnDoctor bounds that with a process-group kill after a
// timeout and records the observed "never exited / GUI launched" outcome as
// the red evidence, so a hung GUI can never masquerade as a passing proof.

import { test as base } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

export interface ProcessResult {
  // Exit code if the process terminated on its own, else null.
  exitCode: number | null;
  // Signal the process died from (e.g. 'SIGKILL' when we had to kill it).
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  // True iff WE had to kill it because it never exited within the bound.
  // A doctor consumer must exit on its own; if this is true the process
  // lingered (the current GUI-launch behavior), which is the red.
  killedByTimeout: boolean;
}

export interface DoctorManifest {
  runId: string;
  spec: string;
  runDir: string;
  xdgConfigHome: string;
  configPath: string;
}

function requireString(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`doctor manifest field ${key} is missing or not a non-empty string`);
  }
  return value;
}

export function loadDoctorManifest(): DoctorManifest {
  const path = process.env.PROOF_RUN_MANIFEST;
  if (path === undefined || path.length === 0) {
    throw new Error('PROOF_RUN_MANIFEST is not set — proof specs only run under scripts/proof-run.sh');
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`doctor manifest at ${path} is not a JSON object`);
  }
  const raw = parsed as Record<keyof DoctorManifest, unknown>;
  return {
    runId: requireString(raw.runId, 'runId'),
    spec: requireString(raw.spec, 'spec'),
    runDir: requireString(raw.runDir, 'runDir'),
    xdgConfigHome: requireString(raw.xdgConfigHome, 'xdgConfigHome'),
    configPath: requireString(raw.configPath, 'configPath'),
  };
}

function doctorBin(): string {
  const bin = process.env.PROOF_DOCTOR_BIN;
  if (bin === undefined || bin.length === 0) {
    throw new Error('PROOF_DOCTOR_BIN is not set — process specs only run under scripts/proof-run.sh');
  }
  return bin;
}

// Spawn the real binary in its own process group, in a fully hermetic XDG
// environment, with the given args. Capture stdout/stderr. A doctor consumer
// is REQUIRED to terminate on its own; we bound the wait and, if it has not
// exited, kill the whole process group (SIGKILL on the negative pgid) so a
// lingering GUI window cannot survive. The returned killedByTimeout flag
// records whether self-termination happened.
export function spawnDoctor(
  manifest: DoctorManifest,
  args: string[],
  // The bound exists to catch a HUNG consumer (the original red: a GUI that
  // launches and never exits) — a hung process exits on no timeout, so the exact
  // value only needs headroom over a healthy run. 8s was too tight from-cold: in a
  // full run the two preceding cargo builds load the machine and a healthy doctor
  // (sub-second cached) could miss the bound and flake. 20s keeps the hung-process
  // signal while removing the load flake.
  timeoutMs = 20000,
): Promise<ProcessResult> {
  const child = spawn(doctorBin(), args, {
    // New session/process group so a kill on -pid reaps any window the
    // binary spawned, exactly like scripts/proof-run.sh group-kills the app.
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOME: `${manifest.runDir}/home`,
      XDG_CONFIG_HOME: `${manifest.runDir}/xdg-config`,
      XDG_CACHE_HOME: `${manifest.runDir}/xdg-cache`,
      XDG_STATE_HOME: `${manifest.runDir}/xdg-state`,
    },
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d: Buffer) => {
    stdout += d.toString();
  });
  child.stderr.on('data', (d: Buffer) => {
    stderr += d.toString();
  });

  return new Promise<ProcessResult>((resolve) => {
    let settled = false;
    let killedByTimeout = false;
    const timer = setTimeout(() => {
      if (settled) return;
      // Never exited on its own within the bound. Group-kill it.
      killedByTimeout = true;
      if (child.pid !== undefined) {
        process.kill(-child.pid, 'SIGKILL');
      }
      // 'exit' will still fire with signal SIGKILL; resolve there with the
      // killedByTimeout flag set.
    }, timeoutMs);

    child.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: code,
        signal,
        stdout,
        stderr,
        killedByTimeout,
      });
    });
  });
}

export const test = base;
export { expect } from '@playwright/test';
