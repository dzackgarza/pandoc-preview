import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, sleep } from './support/app';

// Toggle a Settings-modal checkbox identified by its trailing label text,
// scoped to the modal so it cannot match a stray page checkbox.
async function setModalCheckbox(
  page: { evaluate(expr: string): Promise<unknown> },
  label: string,
  checked: boolean,
): Promise<void> {
  const ok = await page.evaluate(`(() => {
    const modal = Array.from(document.querySelectorAll('.fixed.inset-0'))
      .find((m) => m.querySelector('h2') && m.querySelector('h2').textContent.trim() === 'Settings');
    if (!modal) return 'no-modal';
    const lab = Array.from(modal.querySelectorAll('label'))
      .find((l) => l.textContent.trim() === ${JSON.stringify(label)});
    if (!lab) return 'no-label';
    const box = lab.querySelector('input[type="checkbox"]');
    if (!box) return 'no-checkbox';
    if (box.checked !== ${JSON.stringify(checked)}) box.click();
    return true;
  })()`);
  if (ok !== true) throw new Error(`modal checkbox '${label}' not set: ${String(ok)}`);
}

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

// Count CodeMirror line-number gutters in the real editor DOM.
async function lineNumberGutters(page: { evaluate(expr: string): Promise<unknown> }): Promise<number> {
  return (await page.evaluate(
    `document.querySelectorAll('.cm-editor .cm-gutters .cm-lineNumbers').length`,
  )) as number;
}

// P32 — Editor gutters and syntax highlighting. Three real-DOM obligations on
// the live CodeMirror instance, with demo.md (a heading section, emphasis,
// several lines) loaded:
//
//   1. line_numbers = true (the proof config default) must produce EXACTLY ONE
//      line-number gutter. (CodeMirror dedupes the duplicate lineNumbers() that
//      basicSetup and the component's compartment both contribute, so this
//      already holds; it is asserted as an invariant the fix must preserve.)
//   2. Turning the "Show line numbers" setting off must remove the gutter
//      entirely (zero gutters). Today one survives: basicSetup adds an
//      unconditional lineNumbers() OUTSIDE any compartment, so the
//      gutterCompartment going empty cannot remove it — the toggle is inert.
//   3. The fold gutter and syntax highlighting (token spans) must be present,
//      so the decomposition of basicSetup does not silently drop folding or
//      highlighting.
//
// Assertion 2 is RED until line numbers are wired through a single compartment
// (basicSetup's lineNumbers removed); 1 and 3 guard the refactor.

test('Editor renders one line-number gutter, an inert-free toggle, fold gutter, and highlighting', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);

  // Wait for the editor to render demo.md (multiple lines present).
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // (1) line_numbers = true → exactly one line-number gutter.
  const atStartup = await lineNumberGutters(tauriPage);
  expect(atStartup).toBe(1);

  // (3) Fold gutter present (folding wired).
  const foldGutters = (await tauriPage.evaluate(
    `document.querySelectorAll('.cm-editor .cm-gutters .cm-foldGutter').length`,
  )) as number;
  expect(foldGutters).toBeGreaterThanOrEqual(1);

  // (3) Syntax highlighting active: highlighted tokens are wrapped in styled
  // spans inside the lines. Without highlighting the lines are raw text nodes
  // with zero child spans. Highlighting renders asynchronously after the
  // viewport parse, so wait for it rather than sampling a single instant.
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line span').length > 0`,
    15_000,
  );

  // (2) Toggle "Show line numbers" off via the real Settings modal → zero gutters.
  await tauriPage.evaluate(
    `(() => { window.__TAURI__.event.emit('menu', 'settings'); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('h2')).some((h) => h.textContent.trim() === 'Settings')`,
    15_000,
  );
  await clickModalButton(tauriPage, 'Editor');
  await setModalCheckbox(tauriPage, 'Show line numbers', false);
  await clickModalButton(tauriPage, 'Save');
  await tauriPage.waitForFunction(
    `!Array.from(document.querySelectorAll('h2')).some((h) => h.textContent.trim() === 'Settings')`,
    15_000,
  );
  await sleep(200);

  const afterOff = await lineNumberGutters(tauriPage);
  expect(afterOff).toBe(0);

  recordObservation({ spec: manifest.spec, name: 'line-number-gutters', value: atStartup });
});
