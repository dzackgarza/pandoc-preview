import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { parseTomlFile } from './support/toml';
import { openAndSelectDemo, sleep } from './support/app';

// Click a button by exact text inside the Settings modal dialog (the
// fixed-position panel sized 680x480). Scoping to the modal avoids the
// toolbar Save and the status bar.
async function clickModalButton(
  page: { evaluate(expr: string): Promise<unknown> },
  text: string,
): Promise<void> {
  const ok = await page.evaluate(`(() => {
    const modal = Array.from(document.querySelectorAll('.fixed.inset-0'))
      .find((m) => m.querySelector('h2') && m.querySelector('h2').textContent.trim() === 'Settings');
    if (!modal) return 'no-modal';
    const b = Array.from(modal.querySelectorAll('button')).find((x) => x.textContent.trim() === ${JSON.stringify(text)});
    if (!b) return 'no-button';
    b.click();
    return true;
  })()`);
  if (ok !== true) throw new Error(`modal button '${text}' not clicked: ${String(ok)}`);
}

// P9 — Settings round-trip to XDG TOML. Under the hermetic XDG_CONFIG_HOME,
// open the real Settings modal, change font size 14->18 and theme
// dark->light, save. The on-disk config.toml (parsed by an independent
// process) must hold exactly font_size = 18 and theme = "light" with every
// other key unchanged, and the editor's computed font-size must be 18px.

test('Settings changes persist to config.toml and re-style the editor', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);

  const before = parseTomlFile(manifest.configPath);
  expect((before.editor as Record<string, unknown>).font_size).toBe(14);
  expect((before.general as Record<string, unknown>).theme).toBe('dark');

  // Open Settings via the app's real menu event boundary (no toolbar entry).
  await tauriPage.evaluate(
    `(() => { window.__TAURI__.event.emit('menu', 'settings'); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('h2')).some((h) => h.textContent.trim() === 'Settings')`,
    15_000,
  );

  // Editor pane: change font size 14 -> 18 (the only number input shown).
  await clickModalButton(tauriPage, 'Editor');
  await tauriPage.fill('input[type="number"]', '18');

  // General pane: change theme dark -> light. Target the theme select by its
  // stable data-setting hook — a bare 'select' selector is ambiguous now that
  // the insertion bar renders its own always-present selects (code-block
  // language, snippet dropdown), which would otherwise shadow this one.
  await clickModalButton(tauriPage, 'General');
  await tauriPage.selectOption('[data-setting="theme"]', 'light');

  // Save the settings via the modal footer Save button.
  await clickModalButton(tauriPage, 'Save');
  await tauriPage.waitForFunction(
    `!Array.from(document.querySelectorAll('h2')).some((h) => h.textContent.trim() === 'Settings')`,
    15_000,
  );

  // Independent-process disk read: exact mutated values, rest unchanged.
  await sleep(300);
  const after = parseTomlFile(manifest.configPath);
  expect((after.editor as Record<string, unknown>).font_size).toBe(18);
  expect((after.general as Record<string, unknown>).theme).toBe('light');
  // Every other key is identical to before the change.
  const beforeRest = { ...before, editor: { ...(before.editor as object) }, general: {} };
  const afterRest = { ...after, editor: { ...(after.editor as object) }, general: {} };
  (beforeRest.editor as Record<string, unknown>).font_size = 0;
  (afterRest.editor as Record<string, unknown>).font_size = 0;
  expect(afterRest).toEqual(beforeRest);

  // The editor's computed font-size reflects 18px in the real DOM.
  const fontSize = await tauriPage.evaluate(
    `(() => {
      const cm = document.querySelector('.cm-editor');
      return cm ? getComputedStyle(cm).fontSize : null;
    })()`,
  );
  expect(fontSize).toBe('18px');

  recordObservation({ spec: manifest.spec, name: 'config-font-size', value: 18 });
});
