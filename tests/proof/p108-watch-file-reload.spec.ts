import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  appendAtEnd,
  editorText,
  previewQuery,
  waitForPreview,
  sleep,
} from './support/app';

// P98 (Phase D / D-9) — watch-file reload of the OPEN file. When an EXTERNAL tool
// REWRITES the open file on disk with NEW content, the in-app preview must RELOAD
// to reflect it. The change is detected via the EXACT P48 fingerprint (the FNV-1a
// content hash + nanosecond mtime fsops.rs captures on read/write, the same
// primitive P48's conflict gate compares): the reload fires precisely when the
// open file's on-disk fingerprint DIVERGES from the one stored when it was opened,
// and an UNCHANGED file (same fingerprint) triggers NO reload.
//
// The watch-reload is GENERIC — independent of any renderer. The witness is plain
// markdown carrying a distinctive text marker, so the rendered preview content is
// the file's own text: rewriting the file's marker on disk changes the rendered
// preview, with no figure-compile dependency. (The retired inline-tikz version of
// this spec used a red/blue tikz fill as the witness; tikz is now a file render,
// and P98 is about the watch, not the renderer.)
//
// LEG A — external rewrite reloads to the new content. An INDEPENDENT process
// (this Node test process, via fs.writeFileSync — NOT the app writing the file,
// the P48/P49 idiom for durable host-fs state) REWRITES manifest.demoFile on disk
// with a DIFFERENT marker. The preview must RELOAD so it reflects the new on-disk
// content: the new marker appears and the stale one is GONE, driven by the
// fingerprint DIVERGENCE the external write produced.
//
// LEG B — no spurious reload when the file is UNCHANGED. After the reload, an
// in-app edit appends a DISTINCTIVE unsaved marker into the editor buffer (the
// docChanged path appendAtEnd fires) WITHOUT writing the file — so the open file's
// on-disk fingerprint does NOT diverge. A correct watcher fires NO reload: the
// unsaved marker SURVIVES. A broken watcher that reloads on every tick would
// reload FROM DISK, reverting the buffer and DESTROYING the unsaved edit. The
// marker surviving is the discriminator that NO reload fired absent a real change.

const MARKER_A = 'WATCH-WITNESS-ALEPH';
const MARKER_B = 'WATCH-WITNESS-BETH';

function witnessDoc(marker: string): string {
  return ['# P108 — watch-file reload witness', '', marker, ''].join('\n');
}

// The preview body text, so a marker can be detected in the rendered content.
const PREVIEW_TEXT = `return d.body.textContent;`;

test('an external rewrite of the open file reloads the preview to the new content, and an unchanged file triggers no spurious reload', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // The open file was provisioned to carry MARKER_A. Assert the on-disk starting
  // point independently (a botched fixture is a broken proof environment, not the
  // obligation under test).
  const initialOnDisk = readFileSync(manifest.demoFile, 'utf-8');
  expect(initialOnDisk.includes(MARKER_A)).toBe(true);

  // App + preview must be alive and rendering the INITIAL content first, so a later
  // failure is the missing watch-reload, not a boot/setup error.
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(
    tauriPage,
    `return (function(){ ${PREVIEW_TEXT} })(d).includes(${JSON.stringify(MARKER_A)});`,
  );
  const before = (await previewQuery(tauriPage, PREVIEW_TEXT)) as string;
  expect(before).toContain(MARKER_A);
  expect(before).not.toContain(MARKER_B);

  recordObservation({ spec: manifest.spec, name: 'initial-render-marker-a', value: 'present' });

  // ── LEG A — an INDEPENDENT process rewrites the open file on disk ──────────
  const docB = witnessDoc(MARKER_B);
  writeFileSync(manifest.demoFile, docB, 'utf-8');
  expect(readFileSync(manifest.demoFile, 'utf-8')).toBe(docB);

  // The watch-reload must reflect the NEW on-disk content: MARKER_B appears and
  // the stale MARKER_A is GONE, via the P48 fingerprint divergence.
  await waitForPreview(
    tauriPage,
    `return (function(){ ${PREVIEW_TEXT} })(d).includes(${JSON.stringify(MARKER_B)});`,
  );
  const after = (await previewQuery(tauriPage, PREVIEW_TEXT)) as string;
  expect(after).toContain(MARKER_B);
  expect(after).not.toContain(MARKER_A);

  recordObservation({ spec: manifest.spec, name: 'reloaded-render-marker-b', value: 'present' });

  // ── LEG B — no spurious reload when the file is UNCHANGED ──────────────────
  const unsavedMarker = `P108 unsaved buffer marker ${manifest.runId} — survives if no spurious reload`;
  await appendAtEnd(tauriPage, `\n\n${unsavedMarker}\n`);

  expect((await editorText(tauriPage)).includes(unsavedMarker)).toBe(true);
  const onDiskDuringLegB = readFileSync(manifest.demoFile, 'utf-8');
  expect(onDiskDuringLegB).toBe(docB);
  expect(onDiskDuringLegB.includes(unsavedMarker)).toBe(false);

  // Wait longer than any plausible watch interval for a spurious reload to fire. A
  // reload reloads FROM DISK, reverting the buffer to the markerless on-disk doc,
  // destroying the unsaved edit. A correct watcher (trigger = fingerprint
  // divergence) fires no reload because the fingerprint did not diverge.
  await sleep(6_000);

  expect((await editorText(tauriPage)).includes(unsavedMarker)).toBe(true);

  recordObservation({
    spec: manifest.spec,
    name: 'no-spurious-reload-unsaved-marker-survives',
    value: 'present',
  });
});
