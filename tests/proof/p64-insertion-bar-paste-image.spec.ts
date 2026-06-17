import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { parseTomlFile } from './support/toml';
import { openAndSelectDemo, editorText } from './support/app';

// ── P64 — DOM-CLICK smoke proof for the insertion bar's paste-image control ──
//
// COVERAGE HARDENING (not a new feature). P62 proved the paste-image BEHAVIOUR
// by driving the App's __PPE_E2E__.pasteClipboardImage hook directly. The
// insertion bar's REAL clickable paste-image button (button[data-paste-image] in
// InsertionBar.svelte, wired to onPasteImage → App.pasteImage) was not
// proof-asserted: nothing proved that a USER clicking that button — rather than
// calling the hook — writes the clipboard image into the configured figures dir
// and references it. This spec closes that gap.
//
// The clipboard SEED is still driven through the harness hook
// (__PPE_E2E__.seedClipboardImage): seeding the OS clipboard with a deterministic
// witness image is test-setup the user performs by copying a real screenshot —
// there is no bar control for it, and it is not part of the paste action under
// test. The paste action ITSELF — the only thing P62/P64 own as a bar control —
// is driven through the REAL button click here, NOT the pasteClipboardImage hook.
//
// The assertions mirror P62 exactly: a new REAL image file of the seeded 7×5
// dimensions lands in the CONFIGURED figures dir, and the buffer gains a markdown
// reference at the cursor naming that exact file — assertions on the INSERTED
// content + the on-disk artifact, never mere control existence.

const SEED_W = 7;
const SEED_H = 5;

const IMG_REF_RE = /!\[[^\]]*\]\(([^)]+)\)/g;

function decodeImageSize(path: string): { width: number; height: number } {
  const out = execFileSync(
    'python3',
    [
      '-c',
      'import sys;from PIL import Image;im=Image.open(sys.argv[1]);print(im.size[0],im.size[1])',
      path,
    ],
    { encoding: 'utf-8' },
  ).trim();
  const [w, h] = out.split(/\s+/).map((n) => Number.parseInt(n, 10));
  if (!Number.isInteger(w) || !Number.isInteger(h)) {
    throw new Error(`decodeImageSize: PIL did not return two integers for ${path}: ${out}`);
  }
  return { width: w, height: h };
}

function listFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort();
}

test('Clicking the bar paste-image button writes the clipboard image into the configured figures dir and references it at the cursor', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // The CONFIGURED global figures directory, read INDEPENDENTLY from the on-disk
  // config.toml — never the app's own report (same as P62).
  const config = parseTomlFile(manifest.configPath);
  const directories = config.directories as { figures?: unknown } | undefined;
  const figuresDir = directories?.figures;
  if (typeof figuresDir !== 'string' || figuresDir.length === 0) {
    throw new Error(
      `config.toml has no directories.figures string: ${JSON.stringify(config.directories)}`,
    );
  }

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  const filesBefore = listFiles(figuresDir);

  // Seed a KNOWN 7×5 image onto the REAL system clipboard (test setup, via the
  // hook — the user performs this by copying a screenshot; it is not the action
  // under test).
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.seedClipboardImage(${SEED_W}, ${SEED_H}); return null; })()`,
  );

  // Click the REAL paste-image button (NOT the hook). InsertionBar.svelte renders
  // it as button[data-paste-image], wired onclick={() => onPasteImage()} →
  // App.pasteImage (the SAME action P62 drives through the hook). This is the
  // control coverage P64 adds.
  await tauriPage.click('button[data-paste-image]');

  await tauriPage.waitForFunction(
    `/!\\[[^\\]]*\\]\\([^)]+\\)/.test(window.__PPE_E2E__.getEditorText())`,
    15_000,
  );

  const after = await editorText(tauriPage);

  // Inserted-content + on-disk assertions (mirror P62 B/C/D): exactly one new
  // file in the configured figures dir, decoding to the seeded 7×5 dimensions,
  // and exactly one buffer reference naming that file.
  const filesAfter = listFiles(figuresDir);
  const beforeSet = new Set(filesBefore);
  const newFiles = filesAfter.filter((name) => !beforeSet.has(name));
  expect(newFiles).toHaveLength(1);
  const newFile = newFiles[0];
  const newFilePath = join(figuresDir, newFile);

  expect(statSync(newFilePath).size).toBeGreaterThan(0);
  const size = decodeImageSize(newFilePath);
  expect(size.width).toBe(SEED_W);
  expect(size.height).toBe(SEED_H);

  const targets = [...after.matchAll(IMG_REF_RE)].map((m) => m[1]);
  const refsToNewFile = targets.filter((t) => (t.split('/').pop() ?? t) === newFile);
  expect(refsToNewFile).toHaveLength(1);
  const target = refsToNewFile[0];

  const resolved = target.startsWith('/') ? target : join(figuresDir, target.split('/').pop() ?? target);
  expect(statSync(resolved).isFile()).toBe(true);
  expect(readFileSync(resolved).length).toBe(readFileSync(newFilePath).length);

  recordObservation({ spec: manifest.spec, name: 'click-paste-written-file', value: newFile });
  recordObservation({ spec: manifest.spec, name: 'click-paste-image-width', value: size.width });
  recordObservation({ spec: manifest.spec, name: 'click-paste-image-height', value: size.height });
});
