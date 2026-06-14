import { test, expect } from '@playwright/test';
import { loadDoctorManifest } from './support/process-spec';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// D4 (d12) — a user override is honored. The app owns its vendored filters as
// symlinks (D1), but the user overrides any one by replacing its symlink with a
// REAL file (render-rebuild-plan.md, Fork 3). Re-running the install must (a) leave
// that real override untouched and (b) keep the other filters as managed symlinks.
// d10 only exercised the clean-install branch; this covers install-assets's
// preserve-override branch, which otherwise had no test.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const installScript = join(repoRoot, 'scripts', 'install-assets.sh');

test('install-assets preserves a real-file user override and (re)links the rest', () => {
  const manifest = loadDoctorManifest();
  const home = join(manifest.runDir, 'home');
  const filtersDir = join(home, '.pandoc', 'filters');

  const install = () => {
    const r = spawnSync('bash', [installScript], {
      env: { ...process.env, HOME: home },
      encoding: 'utf-8',
    });
    expect(r.status).toBe(0);
  };

  // First install: every filter is a managed symlink.
  install();
  expect(lstatSync(join(filtersDir, 'obsidian.lua')).isSymbolicLink()).toBe(true);

  // The user overrides one filter per the contract: REPLACE the symlink with a
  // real file (remove the link first — writing through it would edit the canonical
  // vendor source, not create an override).
  const overridden = join(filtersDir, 'obsidian_callouts.lua');
  const custom = '-- user override\nfunction BlockQuote(el) return el end\n';
  rmSync(overridden);
  writeFileSync(overridden, custom);
  expect(lstatSync(overridden).isSymbolicLink()).toBe(false);

  // Re-install: the override is preserved (still a real file with the user's exact
  // content), while the rest remain managed symlinks.
  install();
  expect(lstatSync(overridden).isSymbolicLink()).toBe(false);
  expect(readFileSync(overridden, 'utf-8')).toBe(custom);
  expect(lstatSync(join(filtersDir, 'obsidian.lua')).isSymbolicLink()).toBe(true);
});
