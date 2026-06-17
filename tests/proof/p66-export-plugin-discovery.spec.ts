import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openProject, clickSidebarEntry, waitForHarness } from './support/app';

// P66 — Export is a DISCOVERED plugin in the pandoc suite. A plugin declaring
// `category = "export"`, placed in the [plugins].dir, is discovered the SAME way
// the pandoc-renderer plugin is — by the generic discover() — with NO app-core
// [export.<id>] config table involved anywhere. Once discovered, that plugin
// auto-populates an "Export: <name>" menu / command-palette entry that carries
// the plugin's declared output extension (a GENERIC manifest field on the
// export-category plugin, read by the menu populator), AND the plugin contributes
// its own row to the doctor battery.
//
// The fixture (tests/proof/fixtures/plugins/witness-export-plugin) is provisioned
// by scripts/provision-proof.sh into this spec's hermetic plugins dir with its
// [plugin.witness-export-plugin] config section and — deliberately — NO
// [export.witness-export-plugin] app-core table. Its manifest declares
// category="export", a generic `extension = "wexp"` field, the human name
// "Witness Export", and a contributed doctor check `witness-export-runnable`.
//
// This spec proves BOTH halves of the contract against REAL surfaces:
//
//   (1) DOCTOR ROW — run the app binary's `--doctor` battery against the SAME
//       hermetic config the app was launched with. The export plugin must be
//       discovered (its `plugin-config:witness-export-plugin` schema row joins
//       the battery) AND it must contribute its own `witness-export-runnable`
//       row. Both come ONLY from category-aware discovery of the manifest, never
//       from a [export.<id>] config table (there is none for this plugin).
//
//   (2) COMMAND-PALETTE ENTRY — the live webview's command palette must surface
//       an "Export: Witness Export" entry carrying the plugin's declared
//       extension "wexp", sourced from the DISCOVERED plugin, not config.export.
//
// RED today, for the exact KILLs P66 names:
//   - The PluginManifest (plugins.rs) has NO `extension` field and uses
//     deny_unknown_fields, so a manifest carrying `extension = "wexp"` FAILS to
//     parse: discover() errors loudly, so the export plugin's doctor rows are
//     ABSENT from the battery (and the app cannot enumerate it at all).
//   - The menu/command-palette is populated from the app-core config.export
//     (App.svelte paletteCommands, lib.rs build_menu); an export plugin declaring
//     no [export.*] table therefore NEVER appears, and there is no extension
//     surface read from a discovered plugin.
//   - Discovery ignores `category`: there is no category-driven menu populator,
//     so a category="export" plugin populates no "Export:" entry.

// Resolve the app binary the proof harness built (scripts/proof-run.sh builds it
// at src-tauri/target/debug/pandoc-preview; playwright runs from the repo root).
// Its `--doctor` consumer (lib.rs) runs the full check battery and exits BEFORE
// any window, so spawning it here is safe and self-terminating.
function appBinary(): string {
  return resolve(process.cwd(), 'src-tauri/target/debug/pandoc-preview');
}

// Run `pandoc-preview --doctor` against the SAME hermetic environment the app
// under test was launched with (the per-run XDG dirs under manifest.runDir), and
// return the report text. spawnSync does NOT throw on a nonzero exit (a failing
// battery — which today's discovery error produces — is a normal observable, not
// a thrown exception); the report text (stdout+stderr) is the observable either way.
function doctorReport(runDir: string): string {
  const bin = appBinary();
  const env = {
    ...process.env,
    HOME: `${runDir}/home`,
    XDG_CONFIG_HOME: `${runDir}/xdg-config`,
    XDG_CACHE_HOME: `${runDir}/xdg-cache`,
    XDG_STATE_HOME: `${runDir}/xdg-state`,
    PANDOC_RESOURCE_PATH: `${runDir}/home/.pandoc/figures`,
  };
  const result = spawnSync(bin, ['--doctor'], { encoding: 'utf-8', env });
  if (result.error) {
    throw new Error(`could not spawn ${bin} --doctor: ${String(result.error)}`);
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

async function openCommandPalette(page: { evaluate(e: string): Promise<unknown> }) {
  await page.evaluate(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', ctrlKey: true, bubbles: true, cancelable: true }));
    return null;
  })()`);
}

// Every command-palette entry's visible label text, read from the REAL rendered
// palette DOM ([data-testid="command-palette"] → button). An entry is "surfaced"
// iff its label text is present in the open palette.
async function paletteLabels(page: { evaluate(e: string): Promise<unknown> }): Promise<string[]> {
  const raw = await page.evaluate(`(() => {
    const p = document.querySelector('[data-testid="command-palette"]');
    if (!p) return JSON.stringify([]);
    return JSON.stringify(Array.from(p.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim()));
  })()`);
  if (typeof raw !== 'string') {
    throw new Error(`paletteLabels returned non-string: ${JSON.stringify(raw)}`);
  }
  return JSON.parse(raw) as string[];
}

test('an export-category plugin is discovered, surfaced in the menu with its extension, and contributes a doctor row', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // ── Half 1: the discovered export plugin contributes to the doctor battery ──
  // The report must carry the export plugin's schema-config row (proving it was
  // DISCOVERED at all — discovery rejects the `extension` field today) AND its
  // own contributed doctor row. Both are attributable to the discovered export
  // plugin and arrive with NO [export.<id>] config table for it.
  const report = doctorReport(manifest.runDir);

  // The core battery still runs (the discovered plugin's rows JOIN it).
  expect(/\[OK\]\s+config-exists\b/.test(report)).toBe(true);

  // The export plugin was discovered: its generic plugin-config schema row joins
  // the battery (plugin_check_rows names it `plugin-config:<id>`). RED today: the
  // manifest's `extension` field is rejected by deny_unknown_fields, so discover()
  // errors and no row attributable to this plugin appears.
  expect(/plugin-config:witness-export-plugin\b/.test(report)).toBe(true);

  // The export plugin contributes its OWN doctor row to the battery (export.sh is
  // executable, so it is OK on its real condition). This is the row P66 requires
  // be "attributable to that discovered export plugin".
  expect(/\[OK\]\s+witness-export-runnable\b/.test(report)).toBe(true);

  // ── Half 2: the discovered export plugin is surfaced in the command palette ──
  // with its declared name AND its declared output extension, sourced from the
  // DISCOVERED plugin (not the app-core config.export, which has no entry for it).
  await waitForHarness(tauriPage);
  await openProject(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('.grow.overflow-auto.p-1 button span:last-child')).some((s) => s.textContent.trim() === 'demo.md')`,
    15_000,
  );
  await clickSidebarEntry(tauriPage, 'demo.md');

  await openCommandPalette(tauriPage);
  await tauriPage.waitForFunction(
    `!!document.querySelector('[data-testid="command-palette"]')`,
    10_000,
  );

  const labels = await paletteLabels(tauriPage);

  // An "Export: <name>" entry built from the DISCOVERED plugin's declared name.
  const exportEntry = labels.find((l) => l.includes('Witness Export'));
  if (exportEntry === undefined) {
    throw new Error(
      `no "Export: Witness Export" command-palette entry surfaced from the discovered ` +
        `export plugin. Palette labels were: ${JSON.stringify(labels)}. The menu/palette ` +
        `still reads config.export and ignores category="export" plugins (P66 KILL).`,
    );
  }
  // The entry must carry the plugin's declared output extension — the generic
  // manifest field "wexp" (migration ruling 4), sourced from THIS plugin, not a
  // hardcoded html/pdf or a config value. A wrong/absent extension fails here.
  expect(exportEntry).toContain('wexp');

  recordObservation({ spec: manifest.spec, name: 'export-plugin-extension', value: 'wexp' });
});
