import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, editorText, sleep } from './support/app';

// Dispatch a real keydown to CodeMirror's content DOM. CM's keymap runs from
// the keydown observer on .cm-content, so a bubbling KeyboardEvent exercises
// the SAME path the user's keystroke takes. (Distinct from typing text into the
// contentEditable, which the bridge cannot synthesize — see support/app.ts.)
async function pressKey(
  page: { evaluate(expr: string): Promise<unknown> },
  key: string,
  opts: { ctrl?: boolean; code?: string } = {},
): Promise<void> {
  const init = JSON.stringify({
    key,
    code: opts.code ?? "",
    ctrlKey: !!opts.ctrl,
    bubbles: true,
    cancelable: true,
  });
  const ok = await page.evaluate(`(() => {
    const el = document.querySelector('.cm-content');
    if (!el) return 'no-content';
    el.dispatchEvent(new KeyboardEvent('keydown', ${init}));
    return true;
  })()`);
  if (ok !== true) throw new Error(`keydown ${key} not dispatched: ${String(ok)}`);
}

// P33 — Ctrl+/ comment toggle + Select All (native Edit menu). Owned behavior:
// the editor wires @codemirror/commands' toggleComment to Mod-/ and routes the
// native Edit > Select All menu item to selectAll. With the whole markdown
// buffer selected, one Ctrl+/ wraps it in an HTML comment (markdown's only
// comment token, <!-- -->), and a second Ctrl+/ removes it exactly — proving a
// real, invertible text transformation, not just that a keybinding exists.

test('Ctrl+/ block-comments the selected buffer and toggles back exactly', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  const original = await editorText(tauriPage);
  expect(original).toContain("Geometry of Numbers");

  // Select the whole buffer through the real native Edit > Select All path.
  await tauriPage.evaluate(
    `(() => { window.__TAURI__.event.emit('menu', 'select_all'); return null; })()`,
  );
  await sleep(100);

  // First Ctrl+/ → buffer is wrapped in an HTML comment.
  await pressKey(tauriPage, "/", { ctrl: true, code: "Slash" });
  await sleep(100);
  const commented = await editorText(tauriPage);
  expect(commented).not.toBe(original);
  expect(commented).toContain("<!--");
  expect(commented).toContain("-->");
  // The original text survives inside the comment.
  expect(commented).toContain("Geometry of Numbers");

  // Second Ctrl+/ → comment removed, buffer identical to the start.
  await pressKey(tauriPage, "/", { ctrl: true, code: "Slash" });
  await sleep(100);
  const reverted = await editorText(tauriPage);
  expect(reverted).toBe(original);

  recordObservation({ spec: manifest.spec, name: 'comment-toggle-roundtrip', value: 1 });
});
