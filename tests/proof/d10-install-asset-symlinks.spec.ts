import { test, expect } from '@playwright/test';
import { loadDoctorManifest } from './support/process-spec';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// D1 (d10) — the asset installer SYMLINKS the vendored required filters into
// ~/.pandoc/filters (render-rebuild-plan.md, Milestone D / Fork 3: symlink from a
// vendor dir). The app keeps canonical copies of its shipped filters in a vendor
// dir and symlinks them into ~/.pandoc/filters: the app is the source of truth,
// updates are atomic, and the user overrides any component by replacing its
// symlink with a real file (D4). This proves the install places SYMLINKS (not
// copies) that resolve to the vendored canonical content, in a hermetic $HOME
// (never the real ~/.pandoc).
//
// RED today: scripts/install-assets.sh does not exist (and there is no vendor
// dir), so the install cannot run — spawnSync returns a nonzero status and no
// symlinks appear.

const REQUIRED_FILTERS = [
  'tikzcd.lua',
  'convert_amsthm_envs.lua',
  'obsidian_callouts.lua',
  'obsidian.lua',
];

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..'); // tests/proof -> repo root
const installScript = join(repoRoot, 'scripts', 'install-assets.sh');
const vendorFilters = join(repoRoot, 'src-tauri', 'resources', 'vendor', 'filters');

test('install-assets symlinks the vendored required filters into ~/.pandoc/filters', () => {
  const manifest = loadDoctorManifest();
  const home = join(manifest.runDir, 'home');

  const r = spawnSync('bash', [installScript], {
    env: { ...process.env, HOME: home },
    encoding: 'utf-8',
  });
  expect(r.status).toBe(0);

  const filtersDir = join(home, '.pandoc', 'filters');
  for (const f of REQUIRED_FILTERS) {
    const link = join(filtersDir, f);
    expect(existsSync(link)).toBe(true);
    // It must be a SYMLINK (the app stays the source of truth), not a copy.
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    // Reading through the link returns the vendored canonical content, verified
    // byte-for-byte against the committed vendor copy.
    expect(readFileSync(link, 'utf-8')).toBe(readFileSync(join(vendorFilters, f), 'utf-8'));
  }
});
