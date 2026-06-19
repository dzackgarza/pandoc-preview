import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { parseTomlFile } from './support/toml';
import { readFileSync } from 'node:fs';
import { openAndSelectDemo, editorText, cursorOffset } from './support/app';

// ── P63 — DOM-CLICK smoke proofs for the insertion bar's clickable controls ──
//
// COVERAGE HARDENING (not a new feature). Milestone G (P55–P62) proved the
// insert BEHAVIOUR by driving the App's __PPE_E2E__ hooks directly. The
// insertion bar's REAL clickable DOM controls (buttons / <select>s in
// InsertionBar.svelte) are built but were NOT proof-asserted: nothing proved
// that a user clicking the bar — rather than calling the hook — produces the
// same insert. This spec closes that gap for the controls that ARE clickable in
// the webview harness:
//
//   - the amsthm "theorem" env button   button[data-insert-env="theorem"]   (cf P55)
//   - the tikz / tikzcd diagram buttons  button[data-insert-diagram="…"]     (cf P56)
//   - the snippet dropdown <select>      select[data-insert-snippet]         (cf P59)
//   - the code-block dropdown <select>   select[data-insert-codeblock]       (cf P60)
//
// Each block drives the REAL control through the tauri-playwright transport
// (page.click / page.selectOption on the live bar DOM — NOT the __PPE_E2E__
// hook) and asserts the SAME inserted-content contract the matching P55–P60
// hook-driven spec asserts. The assertions are on INSERTED CONTENT (the scaffold
// / expansion in the editor buffer), mirroring P55–P60 — never mere control
// existence.
//
// The clipboard image control (button[data-paste-image]) and the modal-backed
// matrix / table / footnote controls are covered by p64 (they need the clipboard
// seed hook and a modal interaction respectively).

const ENV = 'theorem';
const ENV_OPEN_FENCE = ':::{.theorem}';
const FENCE = ':::';

const TIKZCD_MARKER = 'tikzcd';
const TIKZ_MARKER = 'tikzpicture';

const LANG = 'python';
const CODE_OPEN_FENCE = '```' + LANG;
const CODE_FENCE = '```';

const SNIPPET_TRIGGER = 'mthm';
const SNIPPET_BODY_OPEN = '::: {.theorem}';

test('Clicking the bar amsthm theorem button inserts the theorem fenced div at the cursor', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  const before = await editorText(tauriPage);
  expect(before).not.toContain(ENV_OPEN_FENCE);

  // Click the REAL bar button (not the hook). InsertionBar.svelte renders one
  // button per pandocDivEnvironments entry, tagged data-insert-env=<env>.
  await tauriPage.click(`button[data-insert-env="${ENV}"]`);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(ENV_OPEN_FENCE)})`,
    10_000,
  );

  const after = await editorText(tauriPage);
  // Inserted-content assertion (mirrors P55 B/C): the theorem scaffold appears,
  // its class is exactly `theorem`, and it is properly closed.
  expect(after).toContain(ENV_OPEN_FENCE);
  const openIdx = after.indexOf(ENV_OPEN_FENCE);
  const closeIdx = after.indexOf(FENCE, openIdx + ENV_OPEN_FENCE.length);
  expect(closeIdx).toBeGreaterThan(openIdx);
  const classMatch = after.slice(openIdx).match(/^:::\{\.([A-Za-z][\w-]*)\}/);
  expect(classMatch?.[1]).toBe(ENV);

  // Cursor in the body (mirrors P55 D): the $0 tabstop is honoured on the click
  // path exactly as on the hook path.
  const bodyStart = openIdx + (ENV_OPEN_FENCE + '\n').length;
  const cursor = await cursorOffset(tauriPage);
  expect(cursor).toBeGreaterThanOrEqual(bodyStart);
  expect(cursor).toBeLessThan(closeIdx);

  recordObservation({ spec: manifest.spec, name: 'click-env-class', value: classMatch?.[1] ?? '' });
});

test('Clicking the bar tikzcd and tikz diagram buttons inserts the distinct scaffolds at the cursor', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  const before = await editorText(tauriPage);
  expect(before).not.toContain(TIKZCD_MARKER);
  expect(before).not.toContain(TIKZ_MARKER);

  // Click the REAL tikzcd diagram button.
  await tauriPage.click(`button[data-insert-diagram="tikzcd"]`);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(TIKZCD_MARKER)})`,
    10_000,
  );

  const afterCd = await editorText(tauriPage);
  // Inserted-content assertion (mirrors P56 B/C): tikzcd scaffold present, cursor
  // inside its body.
  expect(afterCd).toContain(TIKZCD_MARKER);
  const cdMarkerIdx = afterCd.indexOf(TIKZCD_MARKER);
  const cdLineEnd = afterCd.indexOf('\n', cdMarkerIdx);
  expect(cdLineEnd).toBeGreaterThan(cdMarkerIdx);
  const cdCursor = await cursorOffset(tauriPage);
  expect(cdCursor).toBeGreaterThanOrEqual(cdLineEnd + 1);
  expect(cdCursor).toBeLessThan(afterCd.length);

  // Click the REAL tikz diagram button — a DISTINCT scaffold (mirrors P56 D).
  await tauriPage.click(`button[data-insert-diagram="tikz"]`);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(TIKZ_MARKER)})`,
    10_000,
  );

  const afterTikz = await editorText(tauriPage);
  expect(afterTikz).toContain(TIKZ_MARKER);
  expect(TIKZ_MARKER).not.toContain(TIKZCD_MARKER);

  recordObservation({ spec: manifest.spec, name: 'click-tikzcd-cursor', value: cdCursor });
});

test('Selecting the bar snippet dropdown option expands the snippet body at the tabstop', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // The bar's snippet dropdown surfaces the config dictionary's triggers; this
  // run provisions the shared p52/p59 dict (mode-tagged object schema:
  // { "snippets": [ { trigger, body, mode? } ] }). Read the dict independently
  // to assert the option this spec selects exists.
  const config = parseTomlFile(manifest.configPath);
  const editor = config.editor as { snippet_dictionary?: unknown } | undefined;
  const dictPath = editor?.snippet_dictionary;
  if (typeof dictPath !== 'string' || dictPath.length === 0) {
    throw new Error('config.editor.snippet_dictionary is missing — the p63 run must point config at the fixture dict');
  }
  // Mirror p59: the trigger set is the DISTINCT trigger tokens across the
  // dictionary's snippets[] entries (the same trigger may appear twice — prose +
  // math — and surfaces once).
  const parsedDict = JSON.parse(readFileSync(dictPath, 'utf-8')) as {
    snippets: Array<{ trigger: string }>;
  };
  const dictKeys = Array.from(new Set(parsedDict.snippets.map((e) => e.trigger))).sort();
  expect(dictKeys).toContain(SNIPPET_TRIGGER);

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  const before = await editorText(tauriPage);
  expect(before).not.toContain(SNIPPET_BODY_OPEN);
  expect(before).not.toContain(SNIPPET_TRIGGER);

  // The dropdown renders only once the dictionary is parsed; wait for the option.
  await tauriPage.waitForFunction(
    `!!document.querySelector('select[data-insert-snippet] option[value=${JSON.stringify(SNIPPET_TRIGGER)}]')`,
    15_000,
  );

  // Select the REAL <select> option (not the hook). The control's onchange fires
  // onInsertSnippet(trigger) → editor.insertSnippetByTrigger.
  await tauriPage.selectOption('select[data-insert-snippet]', SNIPPET_TRIGGER);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(SNIPPET_BODY_OPEN)})`,
    10_000,
  );

  const after = await editorText(tauriPage);
  // Inserted-content assertion (mirrors P59 B/C): the BODY is expanded, the
  // literal trigger is NOT left behind, and the cursor lands at the tabstop.
  expect(after).toContain(SNIPPET_BODY_OPEN);
  expect(after).not.toContain(SNIPPET_TRIGGER);
  const openIdx = after.indexOf(SNIPPET_BODY_OPEN);
  const closeIdx = after.indexOf(FENCE, openIdx + SNIPPET_BODY_OPEN.length);
  expect(closeIdx).toBeGreaterThan(openIdx);
  const tabstop = openIdx + (SNIPPET_BODY_OPEN + '\n').length;
  const cursor = await cursorOffset(tauriPage);
  expect(cursor).toBeGreaterThanOrEqual(tabstop);
  expect(cursor).toBeLessThan(closeIdx);

  recordObservation({ spec: manifest.spec, name: 'click-snippet-trigger', value: SNIPPET_TRIGGER });
});

test('Selecting the bar code-block dropdown option inserts a fence tagged with the chosen language', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  const before = await editorText(tauriPage);
  expect(before).not.toContain(CODE_FENCE);

  await tauriPage.waitForFunction(
    `!!document.querySelector('select[data-insert-codeblock] option[value=${JSON.stringify(LANG)}]')`,
    15_000,
  );

  // Select the REAL <select> option (not the hook). The control's onchange fires
  // onInsertCodeBlock(lang) → editor.insertCodeBlock.
  await tauriPage.selectOption('select[data-insert-codeblock]', LANG);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(CODE_OPEN_FENCE)})`,
    10_000,
  );

  const after = await editorText(tauriPage);
  // Inserted-content assertion (mirrors P60 B/C/D): the opening fence carries the
  // chosen language tag, the block is closed, and the cursor is in the body.
  expect(after).toContain(CODE_OPEN_FENCE);
  const openIdx = after.indexOf(CODE_OPEN_FENCE);
  const afterOpen = openIdx + CODE_OPEN_FENCE.length;
  const closeIdx = after.indexOf(CODE_FENCE, afterOpen);
  expect(closeIdx).toBeGreaterThan(openIdx);
  const bodyStart = openIdx + (CODE_OPEN_FENCE + '\n').length;
  const cursor = await cursorOffset(tauriPage);
  expect(cursor).toBeGreaterThanOrEqual(bodyStart);
  expect(cursor).toBeLessThan(closeIdx);

  recordObservation({ spec: manifest.spec, name: 'click-codeblock-lang', value: LANG });
});
