import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, editorText, waitForPreview } from './support/app';

const SENTENCE = 'The discriminant equals −163.';

// P3 — Save persists exact bytes. Make the P2 edit, click the real Save
// toolbar button, then read the file from disk in this independent process
// and assert byte-for-byte equality with the editor buffer (unicode intact).

test('Save writes the editor buffer to disk byte-for-byte', async ({ tauriPage }) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  await appendAtEnd(tauriPage, `\n\n${SENTENCE}`);

  const buffer = await editorText(tauriPage);
  // The edit must actually be in the buffer, unicode preserved.
  expect(buffer.includes(SENTENCE)).toBe(true);

  // Click the real toolbar Save button (enabled only when dirty).
  await tauriPage.click('button[title="Save (Ctrl+S)"]');

  // Independent-process disk read must equal the buffer exactly.
  await tauriPage.waitForFunction(
    `document.title.includes('Pandoc Preview') && !document.title.includes('•')`,
    15_000,
  );
  const onDisk = readFileSync(manifest.demoFile, 'utf-8');
  expect(onDisk).toBe(buffer);
  // The unicode minus sign survives the byte round-trip.
  expect(onDisk.includes('−163')).toBe(true);

  recordObservation({
    spec: manifest.spec,
    name: 'on-disk-bytes',
    value: Buffer.byteLength(onDisk, 'utf-8'),
  });
});
