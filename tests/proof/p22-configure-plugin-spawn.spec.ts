import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import {
  openAndSelectDemo,
  configurePluginById,
  waitForPreview,
  sleep,
} from './support/app';

// C1 (p22) — Plugins own their configuration entirely (render-rebuild-plan.md,
// Milestone C; user ruling 2026-06-14). Every plugin manifest declares a
// [configure] command; the app's "Configure <name>" action merely SPAWNS it
// (detached, no TTY handling, no in-app config editor), so a plugin brings its
// own config UI (pandoc: a kitty popup running gum). This is the foundation of
// the rescoped Milestone C: the typed-command-model / lexopt / round-trip /
// checkbox-editor design is repealed in favour of this generic mechanism.
//
// This proves the mechanism end-to-end: the app resolves the plugin BY ID,
// substitutes the REAL {plugin_dir}/{config_dir} into the configure command, and
// spawns it. The fixture's configure command (witness-tool/configure.sh, added
// in GREEN) writes a witness into the REAL config dir carrying the substituted
// plugin_dir and config_dir — both reconstructed independently here from the
// hermetic run paths — so an implementation that ignores the manifest, runs a
// fixed command, or fails to substitute cannot fabricate it.
//
// RED today: window.__PPE_E2E__.configurePlugin is undefined. There is no
// [configure] manifest field (PluginManifest has no such field), no
// configure_plugin Tauri command, and no bridge hook, so configurePluginById
// throws — the configure surface is entirely absent. The RED fires AFTER the app
// has booted, the harness attached, and the demo rendered, so the failure is the
// missing configure surface and nothing else.

test('A plugin is configured by id: the app spawns its [configure] command', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Independent oracle: the configure command must run with the REAL substituted
  // context for witness-tool, installed by provisioning at <runDir>/plugins, and
  // write its witness into the config dir the app was launched against.
  const configDir = dirname(manifest.configPath);
  const expectedPluginDir = join(manifest.runDir, 'plugins', 'witness-tool');
  const witness = join(configDir, 'witness-tool.configured');

  await configurePluginById(tauriPage, 'witness-tool');

  for (let i = 0; i < 80 && !existsSync(witness); i++) {
    await sleep(250);
  }
  if (!existsSync(witness)) {
    throw new Error(
      `configure witness never appeared at ${witness}. The app did not spawn ` +
        `witness-tool's [configure] command against the real plugin context.`,
    );
  }

  // The witness proves the configure command ran with the REAL substituted
  // {plugin_dir}/{config_dir}, not a fixed string or an unsubstituted placeholder.
  const produced = readFileSync(witness, 'utf-8');
  expect(produced.startsWith('CONFIGURE v1')).toBe(true);
  expect(produced).toContain(`plugin_dir: ${expectedPluginDir}`);
  expect(produced).toContain(`config_dir: ${configDir}`);
});
