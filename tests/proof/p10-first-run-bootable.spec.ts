import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { parseTomlFile } from './support/toml';

// P10 — First-run script -> bootable app. The config was created by the REAL
// scripts/first-run.sh, driven through a real PTY answering the gum prompts
// (scripts/drive-first-run.py, run during provisioning). This spec asserts:
//   (1) the on-disk config.toml parses to exactly the selected values, and
//   (2) the app booted with that config reaches the editor UI (the toolbar
//       Save button exists) and NOT the "Configuration required" screen.
// (2) is observed through the real webview the orchestrator launched.

test('first-run.sh config parses to the selected values and boots the editor', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // (1) Exact selected values, read by an independent process.
  const cfg = parseTomlFile(manifest.configPath);
  expect((cfg.general as Record<string, unknown>).theme).toBe('light');
  const editor = cfg.editor as Record<string, unknown>;
  expect(editor.font_size).toBe(20);
  expect(editor.line_wrapping).toBe(true);
  expect(editor.line_numbers).toBe(true);
  const preview = cfg.preview as Record<string, unknown>;
  expect(preview.debounce_ms).toBe(350);
  expect((cfg.pandoc as Record<string, unknown>).from_format).toBe('markdown');

  // (2) The app booted into the editor UI, not the config-error screen.
  await tauriPage.waitForSelector('button[title="Save (Ctrl+S)"]', 15_000);
  const configErrorPresent = await tauriPage.evaluate(
    `document.body.textContent.includes('Configuration required')`,
  );
  expect(configErrorPresent).toBe(false);
  // The editor pane (CodeMirror host) exists — the editor really mounted.
  expect(await tauriPage.count('.cm-host')).toBe(1);

  recordObservation({ spec: manifest.spec, name: 'first-run-font-size', value: 20 });
});
