import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, editorText, waitForPreview, sleep } from './support/app';

// ── P48 — Save refuses to clobber an externally modified file ───────────────
//
// The obligation (proof-obligations.md, P48): before writing, the app compares a
// fingerprint captured at open/last-save against the current on-disk state; if
// the file changed underneath the editor, Save is refused LOUDLY and the
// external content is preserved. Open a file; an independent process rewrites it
// on disk; the next in-app Save is refused with a VISIBLE error, the on-disk
// external content stays intact, and the buffer stays dirty; an explicit
// overwrite resolution then succeeds. Admissible because it fails on a blind
// overwrite, a never-captured fingerprint, and a silent refusal.
//
// THE OBSERVABLE CONTRACT THIS SPEC DEFINES (what the implementer must satisfy):
//
//   (1) VISIBLE ERROR SURFACE on a refused save. The app's toast surface
//       (src/lib/components/Toasts.svelte) must, when a save is refused due to a
//       detected external modification, render an ERROR toast that is
//       discoverable and discriminating:
//         * the toast element carries `data-toast-kind="error"` (the implementer
//           adds this attribute to the Toasts component — toast.kind is already
//           "error"; the attribute makes the kind assertable from the DOM), AND
//         * its text contains one of the discriminating words `modified`,
//           `conflict`, or `changed` (case-insensitive) — so a generic success
//           toast or an unrelated error cannot satisfy it.
//       A refusal that throws silently, logs to console, or shows a success
//       toast does NOT satisfy this. Silence is the failure mode this kills.
//
//   (2) RESOLUTION AFFORDANCE — an explicit force-overwrite path. The test
//       harness (window.__PPE_E2E__, App.svelte behind VITE_PPE_E2E) must expose
//       `forceSave()`: a fire-and-forget trigger (same shape as appendAtEnd /
//       runPlugin) that performs the explicit overwrite resolution the user
//       chooses when they decide their buffer should win — writing the editor
//       buffer to disk and re-capturing the fingerprint. This mirrors the
//       harness's role everywhere else: it bypasses ONLY the native dialog the
//       webview cannot drive, invoking the SAME internal overwrite the dialog's
//       "Overwrite" button would. A real conflict dialog may also exist; the
//       harness hook is the stable, assertable resolution this spec drives.
//
//   (3) DIRTY-STATE OBSERVABLE — the harness must expose `isDirty()`: a getter
//       returning the app's live `dirty` flag (App.svelte already maintains
//       `let dirty = $state(false)`; the harness exposes it exactly as it already
//       exposes `currentFile()`). The buffer is dirty after an edit and after a
//       refused save; clean after a successful (forced) save. This is the SAME
//       cleanliness notion p03 reasons about, read directly rather than via the
//       native window title (which the webview's document.title does not mirror).
//
// All disk facts are read by THIS independent process via plain fs against
// manifest.demoFile — never the app's own report (mirrors p03 / p45).
//
// DISCRIMINATOR — what each assertion KILLS:
//
//   (a) After the in-app Save, an INDEPENDENT disk read of manifest.demoFile
//       STILL equals the external marker (NOT the editor buffer):
//         * KILLS a BLIND OVERWRITE — the current behavior, which calls
//           writeTextFile unconditionally and replaces the external content with
//           the buffer. If the buffer wins, the disk no longer equals the marker.
//         * KILLS a NEVER-CAPTURED FINGERPRINT — without a fingerprint taken at
//           open, there is nothing to compare against, so the save proceeds and
//           clobbers. This assertion fails in exactly that case.
//
//   (b) A VISIBLE error toast (data-toast-kind="error" + discriminating text)
//       appears after the refused Save:
//         * KILLS a SILENT REFUSAL — a save that quietly does nothing (or only
//           logs) leaves no visible error; the user would not know their work was
//           not persisted. The toast is the loud-failure witness.
//
//   (c) The buffer stays DIRTY after the refused Save (harness isDirty() === true
//       — the SAME dirtiness notion p03 reasons is ABSENT after a successful
//       save):
//         * KILLS a refusal that nonetheless clears dirty state — the user's
//           unsaved edit must remain pending so a later resolution can persist
//           it. A refusal that marks the buffer clean would silently strand the
//           edit.
//
//   (d) After invoking the force-overwrite resolution, an INDEPENDENT disk read
//       equals the editor buffer (the buffer now WON, deliberately):
//         * KILLS a DEAD-END REFUSAL — proves the conflict gate is a real,
//           resolvable gate, not a permanent lockout. The refusal must be
//           escapable via an explicit user choice that actually writes.
//
// RED EXPECTATION today: the app has NO conflict detection. saveCurrent() in
// src/App.svelte calls api.writeTextFile(currentFile, ...) unconditionally and
// then toastSuccess(...). So the in-app Save BLINDLY OVERWRITES the external
// marker: assertion (a) fails because the independent disk read no longer equals
// the marker (the buffer clobbered it), and assertion (b) fails because the
// error toast never appears (a success toast does). This proves the conflict
// detection is ABSENT, not that the spec is miswired — the project open, the
// dirty edit, and the independent external rewrite all succeed first.

const SENTENCE = 'In-app edit — buffer should not silently win.';

// Read the live error-toast text off the DOM, or null if no error toast is
// present. Returns the raw text so a wrong-kind or non-discriminating toast is
// observable rather than silently coerced to a pass. Relies ONLY on the
// implementer-supplied data-toast-kind="error" attribute on the toast element.
async function errorToastText(page: {
  evaluate(expr: string): Promise<unknown>;
}): Promise<string | null> {
  const raw = await page.evaluate(
    `(() => {
      const el = document.querySelector('[data-toast-kind="error"]');
      return el === null ? null : String(el.textContent || '');
    })()`,
  );
  if (raw === null) return null;
  if (typeof raw !== 'string') {
    throw new Error(`errorToastText returned non-string: ${JSON.stringify(raw)}`);
  }
  return raw;
}

// The app's live dirty flag, read through the harness getter the implementer
// must expose (contract (3)). p03 reasons about its ABSENCE after a clean save;
// here we assert its PRESENCE after the edit and after a refused save, and its
// ABSENCE after a successful forced save. RED today: __PPE_E2E__.isDirty does
// not exist, so this evaluate returns undefined and the type guard throws — the
// dirty observable is absent. (The PRIOR assertions (a)/(b) fail first, so the
// faithful RED is the clobber/silence, not this helper.)
async function bufferIsDirty(page: {
  evaluate(expr: string): Promise<unknown>;
}): Promise<boolean> {
  const raw = await page.evaluate(`!!window.__PPE_E2E__.isDirty()`);
  if (typeof raw !== 'boolean') {
    throw new Error(`bufferIsDirty returned non-boolean: ${JSON.stringify(raw)}`);
  }
  return raw;
}

// Drive the explicit overwrite resolution through the harness hook — the same
// fire-and-forget shape as appendAtEnd. RED today: __PPE_E2E__.forceSave does
// not exist, so this evaluate throws — the resolution affordance is absent.
async function forceSave(page: { evaluate(expr: string): Promise<unknown> }): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.forceSave(); return null; })()`,
  );
}

test('Save refuses to clobber an externally modified file, then an explicit overwrite resolves it', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Make the buffer dirty so there is something to save. Same docChanged path
  // user typing fires (p03 / p45 use this helper).
  await appendAtEnd(tauriPage, `\n\n${SENTENCE}`);
  const buffer = await editorText(tauriPage);
  // The unsaved edit is in the buffer — there is content pending a save. (We do
  // not assert the dirty FLAG here: that observable is part of the P48 contract
  // proven at clause (c); asserting it as a precondition would mask the real RED
  // — the clobber/silence — behind a not-yet-exposed getter.)
  expect(buffer.includes(SENTENCE)).toBe(true);

  // ── An INDEPENDENT process rewrites the file on disk underneath the editor ──
  // A discriminating external marker the editor buffer never contained, so a
  // disk read can tell whether the external content survived or was clobbered.
  const externalMarker = `EXTERNAL EDIT — do not clobber ${manifest.runId}\n`;
  writeFileSync(manifest.demoFile, externalMarker, 'utf-8');
  // Confirm the external write landed (independent read), so a later failure is
  // attributable to the app's clobber, not a botched fixture write.
  expect(readFileSync(manifest.demoFile, 'utf-8')).toBe(externalMarker);

  // ── Trigger the in-app Save via the SAME File-menu event bus p03 uses ──────
  // File > Save / Ctrl+S delivers a "menu" event with id "save" to the webview.
  await tauriPage.evaluate(
    `(() => { window.__TAURI__.event.emit('menu', 'save'); return null; })()`,
  );

  // Give the (async) save path time to run and surface its outcome. Poll for an
  // error toast for a generous window; if conflict detection existed, the toast
  // would appear well within this. RED today: no error toast ever appears (the
  // blind overwrite shows a SUCCESS toast instead), so this poll exhausts.
  let toastText: string | null = null;
  const toastDeadline = Date.now() + 8_000;
  while (Date.now() < toastDeadline) {
    toastText = await errorToastText(tauriPage);
    if (toastText !== null) break;
    await sleep(250);
  }

  // (a) NO CLOBBER: the on-disk file STILL equals the external marker. This is
  // the assertion that fails RED today — the current blind writeTextFile
  // replaces the marker with the editor buffer, so disk no longer equals marker.
  const onDiskAfterSave = readFileSync(manifest.demoFile, 'utf-8');
  expect(onDiskAfterSave).toBe(externalMarker);

  // (b) LOUD REFUSAL: a visible error toast with discriminating text appeared.
  expect(toastText).not.toBeNull();
  expect(/modified|conflict|changed/i.test(toastText ?? '')).toBe(true);

  // (c) BUFFER STAYS DIRTY: the unsaved edit is still pending after the refusal,
  // so the resolution below has something to persist.
  expect(await bufferIsDirty(tauriPage)).toBe(true);
  // The buffer content is unchanged by the refusal (the app did not drop the edit).
  expect((await editorText(tauriPage)).includes(SENTENCE)).toBe(true);

  // ── Resolution: explicit force-overwrite. The user decides their buffer wins ─
  const bufferAtResolve = await editorText(tauriPage);
  await forceSave(tauriPage);

  // (d) The gate is RESOLVABLE: after the explicit overwrite, an independent
  // disk read equals the editor buffer — the buffer was written deliberately.
  let resolved = false;
  const resolveDeadline = Date.now() + 8_000;
  while (Date.now() < resolveDeadline) {
    if (readFileSync(manifest.demoFile, 'utf-8') === bufferAtResolve) {
      resolved = true;
      break;
    }
    await sleep(250);
  }
  expect(resolved).toBe(true);
  // And after a clean overwrite, the dirty flag is gone (the edit is persisted).
  expect(await bufferIsDirty(tauriPage)).toBe(false);

  recordObservation({
    spec: manifest.spec,
    name: 'conflict-refusal-then-overwrite',
    value: 'refused-marker-intact-then-forced-write',
  });
});
