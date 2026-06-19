import { test, expect } from './fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openProject, clickSidebarEntry, editorText } from './support/app';

// ── P115 — P106 (Phase E / E5): the structured YAML frontmatter editor MODAL. ──
//
// THE OBLIGATION (proof-obligations.md, P106 — verbatim intent):
//   With a document open whose buffer begins with a `---` … `---` YAML frontmatter
//   block carrying `title:` and `author:` followed by a body, opening the
//   frontmatter editor modal and CHANGING the title and ADDING a `bibliography:`
//   value, then confirming, makes the document's leading `---` block reflect
//   EXACTLY the new fields — the frontmatter parses to the NEW title and the ADDED
//   `bibliography:` value (the edited title is present and the previous title is
//   gone; the bibliography value is present) — while the document BODY (every byte
//   after the closing `---` of the frontmatter block) is BYTE-FOR-BYTE UNCHANGED.
//   Separately, with a document that has NO frontmatter, opening the editor,
//   setting a field, and confirming makes the buffer GAIN a well-formed leading
//   `---` … `---` block carrying that field, ahead of the original body — and the
//   original body content is preserved below the inserted block.
//
//   Admissible because it fails on: an editor that REWRITES THE WHOLE DOCUMENT
//   (the body bytes change after confirm); a field edit that is DROPPED (after
//   confirm the frontmatter does not carry the new title or the added
//   `bibliography:` value); and a missing-frontmatter case that FAILS TO INSERT A
//   BLOCK (no `---` block gained, or a malformed one that does not parse as a
//   `---`-delimited YAML block).
//
// ── THE WITNESS CORPUS (scripts/provision-proof.sh, the p115 case) ────────────
// Two files are written into the shared project; the spec opens each by sidebar
// label and reads the buffer independently of the app's own report:
//   frontmatter.md   — `--- title: Old Title / author: A. Tikhonov ---` then a body
//                      carrying the distinctive marker `DELTA-163`.
//   nofrontmatter.md — body only, carrying the distinctive marker `OMEGA-577`.
// The spec parses the leading `---` block with the SAME `yaml` package the editor
// re-emits with, and locates the body region off the distinctive marker so the
// body byte-comparison and the inserted-block check are independent of the impl.
//
// ── THE OBSERVABLE CONTRACT (the modal surface, sibling of SettingsModal) ─────
// This spec is BLIND to how the modal is wired (component, yaml field-mapping,
// block-splice). It drives the REAL modal DOM, exactly as p09 drives the Settings
// modal — open via the menu event boundary, fill real inputs, click the footer
// confirm — using the established stable hooks the implementer must provide:
//
//   window.__TAURI__.event.emit('menu', 'frontmatter')   [the open boundary]
//     The menu/command event that opens the frontmatter editor — the sibling of
//     the `settings` event p09 fires to open SettingsModal. The modal renders as a
//     `.fixed.inset-0` panel whose `<h2>` reads `Frontmatter` (the SettingsModal
//     `<h2>` === 'Settings' convention).
//   [data-frontmatter="title|author|date|bibliography|csl"]   [the field inputs]
//     One stable-hooked text input per known field (the `data-setting="theme"`
//     convention SettingsModal already uses for its fields). The spec fills the
//     `title` and `bibliography` inputs.
//   the modal-footer button whose text is `Save`   [the confirm boundary]
//     Confirms the edit (the SettingsModal footer `Save` convention). On confirm
//     ONLY the frontmatter block is rewritten; the body is left byte-unchanged.
//
//   editorText() [reused, __PPE_E2E__.getEditorText] — the live CM6 buffer, read
//     INDEPENDENTLY of the modal's own report. The decisive observable for both
//     legs: the buffer's leading `---` block and its body.
//
// RED today: there is no frontmatter editor — no FrontmatterModal component, no
// `frontmatter` menu surface, no field mapping, no block-splice on confirm — so
// firing the `frontmatter` menu event renders NO modal and the wait for the
// modal's `Frontmatter` `<h2>` TIMES OUT. The failure is the MISSING editor, not a
// boot/setup error: the app, project, editor, and the witness buffer (with its
// `---` block confirmed present) are all brought up FIRST.

const FM_FILE = 'frontmatter.md';
const NF_FILE = 'nofrontmatter.md';
const NEW_TITLE = 'New Discriminant Title';
const ADDED_BIB = 'refs.bib';
const INSERT_TITLE = 'Inserted Title';

// Click a button by exact text inside the Frontmatter modal dialog. Scoping to
// the modal (the `.fixed.inset-0` panel whose `<h2>` reads 'Frontmatter') avoids
// the toolbar/menu and any sibling modal — the p09 clickModalButton pattern.
async function clickModalButton(
  page: { evaluate(expr: string): Promise<unknown> },
  text: string,
): Promise<void> {
  const ok = await page.evaluate(`(() => {
    const modal = Array.from(document.querySelectorAll('.fixed.inset-0'))
      .find((m) => m.querySelector('h2') && m.querySelector('h2').textContent.trim() === 'Frontmatter');
    if (!modal) return 'no-modal';
    const b = Array.from(modal.querySelectorAll('button')).find((x) => x.textContent.trim() === ${JSON.stringify(text)});
    if (!b) return 'no-button';
    b.click();
    return true;
  })()`);
  if (ok !== true) throw new Error(`modal button '${text}' not clicked: ${String(ok)}`);
}

// Set a frontmatter field input's value (by its data-frontmatter hook) through a
// real DOM input + an `input` event, so the modal's bound draft sees the change —
// the deterministic substitute for synthetic typing into the modal input.
async function setField(
  page: { evaluate(expr: string): Promise<unknown> },
  field: string,
  value: string,
): Promise<void> {
  const ok = await page.evaluate(`(() => {
    const modal = Array.from(document.querySelectorAll('.fixed.inset-0'))
      .find((m) => m.querySelector('h2') && m.querySelector('h2').textContent.trim() === 'Frontmatter');
    if (!modal) return 'no-modal';
    const el = modal.querySelector('[data-frontmatter=' + ${JSON.stringify(JSON.stringify(field))} + ']');
    if (!el) return 'no-field';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (ok !== true) throw new Error(`frontmatter field '${field}' not set: ${String(ok)}`);
}

// Open the named file in the editor and wait until the live buffer holds the
// expected distinctive marker (so a later failure is the missing editor, not a
// race on the file load).
async function openWitness(
  page: Parameters<typeof openProject>[0] & {
    waitForFunction(expr: string, timeoutMs?: number): Promise<unknown>;
  },
  project: string,
  file: string,
  marker: string,
): Promise<void> {
  await page.waitForFunction(
    `Array.from(document.querySelectorAll('.grow.overflow-auto.p-1 button span:last-child')).some((s) => s.textContent.trim() === ${JSON.stringify(file)})`,
    15_000,
  );
  await clickSidebarEntry(page, file);
  await page.waitForFunction(
    `(document.querySelector('.cm-editor .cm-content')?.textContent ?? '').includes(${JSON.stringify(marker)})`,
    15_000,
  );
}

// Open the frontmatter editor through its menu surface and wait for the modal's
// `Frontmatter` <h2> to render. RED today this TIMES OUT — no such modal exists.
async function openFrontmatterEditor(page: {
  evaluate(expr: string): Promise<unknown>;
  waitForFunction(expr: string, timeoutMs?: number): Promise<unknown>;
}): Promise<void> {
  await page.evaluate(
    `(() => { window.__TAURI__.event.emit('menu', 'frontmatter'); return null; })()`,
  );
  await page.waitForFunction(
    `Array.from(document.querySelectorAll('h2')).some((h) => h.textContent.trim() === 'Frontmatter')`,
    15_000,
  );
}

// Split a buffer into its leading `---` … `---` frontmatter block and the body
// that follows. Returns null when the buffer does not begin with a `---` block.
// "body" is EVERY byte after the closing `---` line's terminating newline — the
// exact region P106's body byte-equality covers.
function splitFrontmatter(
  text: string,
): { yamlSource: string; body: string } | null {
  if (!text.startsWith('---\n')) return null;
  const close = text.indexOf('\n---', 3);
  if (close < 0) return null;
  // The closing fence line is `---` possibly followed by `\n`; the body is what
  // remains after that fence line (and its newline, if present).
  const afterClose = close + '\n---'.length;
  const rest = text.slice(afterClose);
  const bodyStart = rest.startsWith('\n') ? 1 : 0; // consume the fence's own EOL
  const yamlSource = text.slice('---\n'.length, close + 1);
  const body = rest.slice(bodyStart);
  return { yamlSource, body };
}

test('frontmatter editor rewrites ONLY the block (body byte-unchanged) and inserts a block when none exists', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // ── Independent off-disk pre-edit reads ──────────────────────────────────
  const fmDisk = readFileSync(join(manifest.project, FM_FILE), 'utf-8');
  const fmSplit = splitFrontmatter(fmDisk);
  if (fmSplit === null) throw new Error('fixture frontmatter.md does not begin with a --- block');
  const fmParsed = parseYaml(fmSplit.yamlSource) as Record<string, unknown>;
  // The fixture is the corpus the obligation describes: title + author present,
  // a distinctive body. (Self-check the corpus before driving the editor.)
  expect(fmParsed.title).toBe('Old Title');
  expect(fmParsed.author).toBe('A. Tikhonov');
  expect(fmSplit.body.includes('DELTA-163')).toBe(true);
  const preEditBody = fmSplit.body; // the body bytes that MUST survive unchanged

  // ── Bring up the app + project + editor FIRST (so a later failure is the ──
  // missing editor, not boot/setup). Open the with-frontmatter witness and
  // confirm the live buffer equals the on-disk bytes (so the block/body the
  // assertions split are the editor's, not a stale copy).
  await openProject(tauriPage, manifest.project);
  await openWitness(tauriPage, manifest.project, FM_FILE, 'DELTA-163');
  const bufBefore = await editorText(tauriPage);
  expect(bufBefore).toBe(fmDisk);
  const splitBefore = splitFrontmatter(bufBefore);
  if (splitBefore === null) throw new Error('open buffer lost its --- frontmatter block');
  expect((parseYaml(splitBefore.yamlSource) as Record<string, unknown>).title).toBe('Old Title');

  // ── LEG 1: open the editor, CHANGE title + ADD bibliography, confirm ──────
  // RED today: openFrontmatterEditor TIMES OUT — no Frontmatter modal exists.
  await openFrontmatterEditor(tauriPage);
  await setField(tauriPage, 'title', NEW_TITLE);
  await setField(tauriPage, 'bibliography', ADDED_BIB);
  await clickModalButton(tauriPage, 'Save');
  // The modal closes on confirm (the Frontmatter <h2> goes away).
  await tauriPage.waitForFunction(
    `!Array.from(document.querySelectorAll('h2')).some((h) => h.textContent.trim() === 'Frontmatter')`,
    15_000,
  );

  // Independent buffer read after confirm: the leading `---` block parses to the
  // NEW title + the ADDED bibliography, the previous title is GONE, and the BODY
  // is byte-for-byte the pre-edit body (only the block was rewritten).
  const bufAfter = await editorText(tauriPage);
  const splitAfter = splitFrontmatter(bufAfter);
  if (splitAfter === null) {
    throw new Error('after confirm the buffer no longer begins with a --- block');
  }
  const fmAfter = parseYaml(splitAfter.yamlSource) as Record<string, unknown>;
  expect(fmAfter.title).toBe(NEW_TITLE); // edited title present
  expect(fmAfter.title).not.toBe('Old Title'); // previous title gone
  expect(fmAfter.bibliography).toBe(ADDED_BIB); // added field present
  expect(splitAfter.body).toBe(preEditBody); // BODY byte-for-byte unchanged

  // ── LEG 2: a document with NO frontmatter gains a well-formed block ───────
  const nfDisk = readFileSync(join(manifest.project, NF_FILE), 'utf-8');
  expect(splitFrontmatter(nfDisk)).toBeNull(); // the fixture truly has no block
  expect(nfDisk.includes('OMEGA-577')).toBe(true);

  await openWitness(tauriPage, manifest.project, NF_FILE, 'OMEGA-577');
  const nfBufBefore = await editorText(tauriPage);
  expect(nfBufBefore).toBe(nfDisk);
  expect(splitFrontmatter(nfBufBefore)).toBeNull(); // no block in the open buffer either

  await openFrontmatterEditor(tauriPage);
  await setField(tauriPage, 'title', INSERT_TITLE);
  await clickModalButton(tauriPage, 'Save');
  await tauriPage.waitForFunction(
    `!Array.from(document.querySelectorAll('h2')).some((h) => h.textContent.trim() === 'Frontmatter')`,
    15_000,
  );

  // Independent buffer read after confirm: a well-formed leading `---` block now
  // exists, parses to the set field, and the ORIGINAL body is preserved below it.
  const nfBufAfter = await editorText(tauriPage);
  const nfSplit = splitFrontmatter(nfBufAfter);
  if (nfSplit === null) {
    throw new Error('a frontmatter-less document gained no well-formed --- block on confirm');
  }
  expect((parseYaml(nfSplit.yamlSource) as Record<string, unknown>).title).toBe(INSERT_TITLE);
  expect(nfSplit.body.includes('OMEGA-577')).toBe(true); // original body preserved below

  recordObservation({ spec: manifest.spec, name: 'p115-new-title', value: NEW_TITLE });
  recordObservation({ spec: manifest.spec, name: 'p115-added-bibliography', value: ADDED_BIB });
  recordObservation({ spec: manifest.spec, name: 'p115-inserted-title', value: INSERT_TITLE });
});
