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
  // first-run.sh produces the renderer-plugin config: the app is renderer-agnostic,
  // so pandoc settings live in the pandoc renderer plugin's own section and the
  // active renderer is selected by id.
  expect((cfg.renderer as Record<string, unknown>).active).toBe('pandoc-renderer');
  // Milestone C: the pandoc renderer's config IS the raw pandoc command string —
  // the single canonical source of truth. There are NO structured
  // path/from_format/extra_args fields anymore; the plugin owns the command's
  // meaning and the core stores it verbatim.
  const pandocRenderer = (cfg.plugin as Record<string, Record<string, unknown>>)['pandoc-renderer'];
  expect(typeof pandocRenderer.command).toBe('string');
  const command = pandocRenderer.command as string;
  expect(command).toContain('pandoc');
  expect(command).toContain('--from markdown');
  // The image-embedding contract (preview resolves no files) is carried in the
  // canonical command itself.
  expect(command).toContain('--embed-resources');
  // Structured fields are gone — the raw string is the only source of truth.
  expect(pandocRenderer.from_format).toBeUndefined();
  expect(pandocRenderer.path).toBeUndefined();
  expect(pandocRenderer.extra_args).toBeUndefined();

  // (2) The app booted into the editor UI, not the config-error screen. The
  // activity bar's Explorer control is always present once the editor UI renders
  // (the activity bar persists even when the side bar is collapsed — see P18).
  await tauriPage.waitForSelector('[data-view="explorer"]', 15_000);
  const configErrorPresent = await tauriPage.evaluate(
    `document.body.textContent.includes('Configuration required')`,
  );
  expect(configErrorPresent).toBe(false);
  // The editor pane (CodeMirror host) exists — the editor really mounted.
  expect(await tauriPage.count('.cm-host')).toBe(1);

  recordObservation({ spec: manifest.spec, name: 'first-run-font-size', value: 20 });
});
