import { test, expect } from '@playwright/test';
import { loadDoctorManifest } from './support/process-spec';
import { driveSetupReconfigure } from './support/setup-recovery';
import { recordObservation } from './support/observations';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// D6 — `just setup` reconfigures an EXISTING config.
//
// Reported gap (2026-06-13): when the config schema evolves (e.g. [export]
// became required), a pre-existing config is now invalid, yet the only setup
// surface — `just setup` (scripts/first-run.sh, no --force) — hard-fails with
// "config already exists. Re-run with --force", and `just setup` exposes no
// way to pass --force. There is no path to re-run setup.
//
// Contract: `just setup` over an existing config must offer a gum confirm to
// OVERWRITE and reconfigure (mirroring launch.sh's confirm-then-force
// pattern), then write a fresh VALID config. We drive first-run.sh (no
// --force) through scripts/drive-first-run.py in over-existing mode (real
// PTY), accept the overwrite, answer the gum prompts, and require: the driver
// completes the reconfigure handoff AND the on-disk config is the new valid
// one, read back by an independent process.
//
// Today first-run.sh (no --force) hard-fails before any prompt, so the PTY
// driver never sees the overwrite confirm and exits nonzero — the contract
// red for D6.

test('just setup over an existing config reconfigures it to a valid config', () => {
  const manifest = loadDoctorManifest();
  const xdgConfigHome = `${manifest.runDir}/xdg-config`;
  const home = `${manifest.runDir}/home`;

  // Pre-state: a config already exists and is stale/invalid under the current
  // schema (carries the removed `math` key, lacks the now-required [export]).
  expect(existsSync(manifest.configPath)).toBe(true);
  const before = readFileSync(manifest.configPath, 'utf-8');
  expect(before.includes('math = "mathjax"')).toBe(true);
  expect(before.includes('[export.html]')).toBe(false);

  const r = driveSetupReconfigure(xdgConfigHome, home);

  // The setup surface must NOT dead-end on the existing config, and must reach
  // the reconfigure handoff. The dead-end's precise signature is the old
  // FATAL's actionless instruction — "Re-run with --force" — which `just setup`
  // gave no way to satisfy. The fix removes it (the gum confirm replaces it);
  // it must not appear. (Asserting the broader phrase "already exists" would be
  // non-discriminating: the new overwrite confirm legitimately contains it.)
  expect(r.stdout.includes('Re-run with --force')).toBe(false);
  expect(r.stdout.includes('SETUP_RECONFIGURE_OK')).toBe(true);
  expect(r.status).toBe(0);

  // The old config was REPLACED with a fresh valid one: the stale key is gone,
  // the now-required shipped export plugins are present, and the gum-selected
  // values were written — all read back by an independent process (tomllib).
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

  // gum-selected values landed.
  expect(cfg.general.theme).toBe('light');
  expect(cfg.editor.font_size).toBe(20);
  expect(cfg.preview.debounce_ms).toBe(350);

  // The reconfigured config carries the two shipped export plugins (required
  // by the current schema): the rewrite produced a real, schema-valid config,
  // not a partial one that would fail the doctor's config-schema check.
  const exp = cfg.export as Record<string, Record<string, unknown>>;
  expect(Array.isArray(exp.html.command)).toBe(true);
  expect((exp.html.command as string[]).includes('--embed-resources')).toBe(true);
  expect((exp.pdf.command as string[]).includes('--pdf-engine=lualatex')).toBe(true);

  recordObservation({ spec: manifest.spec, name: 'setup-reconfigure-exit', value: r.status ?? -1 });
});
