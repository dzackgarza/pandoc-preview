import { test, expect } from '@playwright/test';
import { loadDoctorManifest } from './support/process-spec';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// D1 (d10) — the asset installer SYMLINKS the required filters into
// ~/.pandoc/filters from the COMMIT-PINNED pandoc-config submodule. pandoc-config
// owns the pandoc assets (templates/filters/csl/bib); the app consumes a pinned
// version via the git submodule at src-tauri/resources/vendor/pandoc-config and
// symlinks its filters into ~/.pandoc/filters, so a fresh machine is provisioned
// from the pinned config, updates are atomic, and the user overrides any component
// by replacing its symlink with a real file (D4). This proves the install places
// SYMLINKS (not copies) that resolve to the pinned canonical content, in a
// hermetic $HOME (never the real ~/.pandoc).

const REQUIRED_FILTERS = [
  'convert_amsthm_envs.lua',
  'obsidian_callouts.lua',
  'obsidian.lua',
];

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..'); // tests/proof -> repo root
const installScript = join(repoRoot, 'scripts', 'install-assets.sh');
const pandocConfigFilters = join(
  repoRoot,
  'src-tauri',
  'resources',
  'vendor',
  'pandoc-config',
  'filters',
);

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
    // It must be a SYMLINK (pandoc-config stays the source of truth), not a copy.
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    // Reading through the link returns the pinned canonical content, verified
    // byte-for-byte against the pandoc-config submodule copy.
    expect(readFileSync(link, 'utf-8')).toBe(readFileSync(join(pandocConfigFilters, f), 'utf-8'));
  }
});
