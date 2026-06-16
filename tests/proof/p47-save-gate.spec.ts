import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  appendAtEnd,
  editorText,
  currentFile,
  exportTo,
  exportState,
  waitForPreview,
  waitForHarness,
  sleep,
} from './support/app';

// ── P47 — Path-consuming actions are gated on durable identity ──────────────
//
// THE OBLIGATION (proof-obligations.md, exact wording):
//   Path-consuming actions (save-in-place, export, plugin-run) on an
//   identity-less (recovery-backed) buffer FIRST resolve a real durable
//   destination; UNTIL that destination is resolved, the action does not run.
//   With a buffer that has no real file identity, invoke export: NO artifact is
//   produced and the downstream command does NOT run. After a real destination
//   is resolved, the file exists at EXACTLY that destination, that destination
//   becomes the live editable file going forward, and a later edit followed by
//   Save writes to that same destination. A buffer that already has a durable
//   identity saves with NO prompt at all.
//
// "IDENTITY-LESS BUFFER": a NEW/untitled document the user is editing that has
// NO real file path yet. It may be recovery-backed (the F1/P45 host-fs autosave
// store captures it), but it has no durable project file. The current app has
// no "new untitled document" concept (the file tree's "new file" creates a real
// file immediately, giving it identity). This spec DEFINES the contract both
// for ENTERING the identity-less state and for RESOLVING a destination, then
// proves the gate is absent.
//
// ── THE OBSERVABLE CONTRACT (the bridge hooks the implementer must provide) ──
//
//   __PPE_E2E__.newUntitled()
//       Enter an identity-less buffer: open a fresh editable buffer with NO
//       currentFile path. After it, currentFile() is null/empty AND the editor
//       holds an editable buffer (appendAtEnd / getEditorText operate on it).
//       A real user reaches this via a "New" action; the harness invokes the
//       same internal entry point. (DEFINED HERE; implementer provides.)
//
//   __PPE_E2E__.resolveSavePath(path)
//       The save-gate's resolution hook. The native OS save dialog is
//       undriveable in the harness (App.svelte: the webview cannot drive native
//       dialogs — every dialog-driven flow is bridged), so this hook SUPPLIES
//       the durable destination the user would pick in that dialog. A real user
//       gets the OS dialog; the harness supplies the path here. Resolving makes
//       the buffer durable: the file is written at EXACTLY `path`, currentFile()
//       becomes `path`, and the buffer is no longer identity-less. (DEFINED
//       HERE; implementer provides — mirrors how openProject/exportTo bridge the
//       native-dialog surfaces other specs cannot drive.)
//
//   __PPE_E2E__.resolveCount()  [optional observable, falls back if absent]
//       The number of times the save-gate's resolution hook has fired. Lets the
//       already-durable case PROVE the gate did NOT re-prompt: an already-durable
//       Save must complete WITHOUT incrementing this. If the implementer does not
//       expose it, the already-durable no-prompt clause is proven structurally
//       (Save writes the new bytes to the already-open path with no resolution
//       hook supplied by this spec — see assertion 4).
//
//   Already present / reused from existing specs:
//       __PPE_E2E__.currentFile(), .getEditorText(), .appendAtEnd(),
//       .exportTo(pluginId, target)  [P7/P12], the 'menu'->'save' event [P3],
//       __PPE_EXPORT__ export-state marker [P7].
//
// ── HOW "THE ACTION DID NOT RUN" IS OBSERVABLE ──────────────────────────────
//   - export gated: NO artifact exists at the chosen target path AND no artifact
//     exists anywhere under the run dir (kills an auto-guessed filename), AND the
//     export-state marker never reports "done" (the downstream pandoc command did
//     not run to completion). No artifact, no witness.
//   - already-durable no-prompt: an ordinarily-opened file (which has a path) is
//     edited and Saved; the bytes hit disk and the resolution hook is never
//     supplied/needed — the gate did not re-prompt.
//
// ── WHAT EACH ASSERTION KILLS ───────────────────────────────────────────────
//   A1 (identity-less entry): the buffer is editable but currentFile() is empty.
//        Establishes the identity-less state P47 is about. If newUntitled is
//        absent, this is the faithful RED — the identity-less-buffer concept does
//        not exist, so the gate it would protect cannot exist either.
//   A2 (export gated, no artifact, no witness):
//        * KILLS a silent export against the volatile buffer — an artifact would
//          appear at the target with no destination ever resolved.
//        * KILLS a gate that auto-guesses a filename — no artifact materializes
//          ANYWHERE under the run dir at a path the user never chose.
//        * KILLS a gate that runs the downstream command anyway — the export
//          subprocess never reaches "done"; its effect is never observed.
//   A3 (resolve -> exact destination, becomes live file, later edit+Save writes
//        there):
//        * the file exists at EXACTLY the resolved path (kills resolving to a
//          guessed/elsewhere path).
//        * currentFile() becomes that path (the resolved file is the LIVE
//          editable file going forward).
//        * an append + Save lands in that same file on disk (independent read) —
//          proving the resolved destination is genuinely the live file, not a
//          one-shot write.
//   A4 (already-durable no-prompt):
//        * KILLS a gate that re-prompts on an already-durable save — opening a
//          real file (has a path) and Saving an edit writes to disk with NO
//          resolution hook supplied by this spec; resolveCount (if exposed) is
//          unchanged. The no-prompt clause holds.
//
// ── RED EXPECTATION today ───────────────────────────────────────────────────
// The save-gate / identity-less-buffer concept does not exist. The first hook
// this spec needs, __PPE_E2E__.newUntitled, is undefined (assertion A1's setup
// throws when the bridge eval calls an undefined property). That is a FAITHFUL
// RED: the feature SURFACE for entering an identity-less buffer is absent, so the
// gate that protects path-consuming actions on such a buffer cannot exist. Each
// downstream assertion documents the full contract so the implementer knows the
// complete observable surface to build, not merely the first missing hook.
//
// All disk assertions are by THIS independent process; bytes (not decoded text)
// are compared where unicode survival matters, mirroring p03/p45 discipline.

const UNTITLED_SENTINEL = '# Untitled draft — Café ζ\n\nIdentity-less body: naïve résumé.';
const POST_RESOLVE_EDIT = '\n\nThe discriminant equals −163.';
const DURABLE_EDIT = '\n\nMinkowski bound revisited — ζ(2).';

// Enter the identity-less buffer via the DEFINED bridge hook. Fire-and-forget,
// like appendAtEnd; the spec awaits the observable (currentFile empty) after.
async function newUntitled(page: { evaluate(e: string): Promise<unknown> }): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.newUntitled(); return null; })()`,
  );
}

// Supply the durable destination the OS save dialog would yield (DEFINED hook).
async function resolveSavePath(
  page: { evaluate(e: string): Promise<unknown> },
  path: string,
): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.resolveSavePath(${JSON.stringify(path)}); return null; })()`,
  );
}

// The number of resolution prompts the gate has fired, or null if the optional
// observable is not exposed. Used to prove the already-durable case did NOT
// re-prompt.
async function resolveCount(
  page: { evaluate(e: string): Promise<unknown> },
): Promise<number | null> {
  const raw = await page.evaluate(
    `(() => { const f = window.__PPE_E2E__.resolveCount; return typeof f === 'function' ? f() : null; })()`,
  );
  if (raw === null) return null;
  if (typeof raw !== 'number') {
    throw new Error(`resolveCount returned non-number: ${JSON.stringify(raw)}`);
  }
  return raw;
}

// Recursively collect every regular file under `root` — used to prove an export
// against an identity-less buffer produced NO artifact ANYWHERE (kills a gate
// that auto-guesses a filename and writes somewhere the user never chose).
function walkFiles(root: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    const p = join(root, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...walkFiles(p));
    else if (st.isFile()) out.push(p);
  }
  return out;
}

test('path-consuming actions are gated on a resolved durable destination', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();
  await waitForHarness(tauriPage);

  // ── A1: enter an identity-less buffer ─────────────────────────────────────
  // Open a fresh editable buffer with no real file path. RED today: newUntitled
  // is undefined, so this throws — the identity-less-buffer concept is absent.
  await newUntitled(tauriPage);
  await tauriPage.waitForFunction(
    `(window.__PPE_E2E__.currentFile() ?? '') === ''`,
    10_000,
  );
  await appendAtEnd(tauriPage, UNTITLED_SENTINEL);

  const beforeResolve = await currentFile(tauriPage);
  expect(beforeResolve).toBe(''); // no durable identity
  const untitledBuffer = await editorText(tauriPage);
  expect(untitledBuffer.includes('Identity-less body: naïve résumé.')).toBe(true);

  // (F1 tie-in, non-fatal observation: an identity-less buffer is still
  // recovery-backed. We only assert that SOME host-fs copy of the buffer exists
  // under the XDG data tree — proving the identity-less buffer is not lost — but
  // the decisive P47 clauses are the gate clauses below.)
  const untitledBytes = Buffer.from(untitledBuffer, 'utf-8');
  let recoveryHasUntitled = false;
  const recDeadline = Date.now() + 6_000;
  while (Date.now() < recDeadline) {
    if (walkFiles(manifest.xdgDataHome).some((f) => {
      try {
        return readFileSync(f).equals(untitledBytes);
      } catch {
        return false;
      }
    })) {
      recoveryHasUntitled = true;
      break;
    }
    await sleep(500);
  }
  recordObservation({
    spec: manifest.spec,
    name: 'identityless-recovery-backed',
    value: recoveryHasUntitled,
  });

  // ── A2: export on the identity-less buffer WITHOUT resolving a path ────────
  // The gate must NOT run the export. Observable: no artifact at the chosen
  // target, no artifact anywhere under the run dir, and the export never reaches
  // "done".
  const filesBefore = new Set(walkFiles(manifest.runDir));
  const exportTarget = join(manifest.runDir, 'p47-gated-export.html');
  await exportTo(tauriPage, 'html', exportTarget);

  // Give a generous window in which a NON-gated (broken) app would have written
  // the artifact and reached "done". A faithful gate produces neither.
  let sawArtifact = false;
  let sawDone = false;
  const exportDeadline = Date.now() + 8_000;
  while (Date.now() < exportDeadline) {
    if (existsSync(exportTarget)) sawArtifact = true;
    const state = await exportState(tauriPage);
    if (state === 'done') sawDone = true;
    if (sawArtifact || sawDone) break;
    await sleep(250);
  }

  // No artifact at the chosen target (kills silent export against the volatile
  // buffer).
  expect(existsSync(exportTarget)).toBe(false);
  // No artifact materialized ANYWHERE new under the run dir (kills a gate that
  // auto-guesses a filename the user never chose).
  const newFiles = walkFiles(manifest.runDir).filter((f) => !filesBefore.has(f));
  const htmlLikeNewFiles = newFiles.filter(
    (f) => f.endsWith('.html') || f.endsWith('.htm'),
  );
  expect(htmlLikeNewFiles).toEqual([]);
  // The downstream export command never ran to completion (kills a gate that
  // runs the command anyway).
  expect(sawDone).toBe(false);

  // ── A3: resolve a durable destination, then prove it is the LIVE file ──────
  const resolved = join(manifest.runDir, 'p47-resolved.md');
  await resolveSavePath(tauriPage, resolved);

  // The file exists at EXACTLY the resolved path, carrying the buffer bytes.
  await tauriPage.waitForFunction(
    `(window.__PPE_E2E__.currentFile() ?? '') === ${JSON.stringify(resolved)}`,
    10_000,
  );
  expect(existsSync(resolved)).toBe(true);
  const afterResolveDisk = readFileSync(resolved, 'utf-8');
  expect(afterResolveDisk.includes('Identity-less body: naïve résumé.')).toBe(true);

  // currentFile() became that path — the resolved file is now the live editable
  // file going forward.
  expect(await currentFile(tauriPage)).toBe(resolved);

  // A later edit followed by Save writes to THAT SAME destination.
  await appendAtEnd(tauriPage, POST_RESOLVE_EDIT);
  const liveBuffer = await editorText(tauriPage);
  await tauriPage.evaluate(
    `(() => { window.__TAURI__.event.emit('menu', 'save'); return null; })()`,
  );
  // Poll the resolved path (independent disk read) for the appended sentence.
  let liveWritten = false;
  const liveDeadline = Date.now() + 15_000;
  while (Date.now() < liveDeadline) {
    if (readFileSync(resolved, 'utf-8').includes('The discriminant equals −163.')) {
      liveWritten = true;
      break;
    }
    await sleep(250);
  }
  expect(liveWritten).toBe(true);
  // The whole live buffer is on disk at the resolved path, byte-for-byte.
  expect(readFileSync(resolved, 'utf-8')).toBe(liveBuffer);

  // ── A4: an already-durable buffer saves with NO prompt ────────────────────
  // Open the ordinary demo.md (which HAS a path), edit, Save. The gate must NOT
  // re-prompt: no resolution hook is supplied by this spec, and resolveCount (if
  // exposed) is unchanged across the save.
  const resolvesBeforeDurable = await resolveCount(tauriPage);
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);
  expect(await currentFile(tauriPage)).toBe(manifest.demoFile);

  await appendAtEnd(tauriPage, DURABLE_EDIT);
  const durableBuffer = await editorText(tauriPage);
  await tauriPage.evaluate(
    `(() => { window.__TAURI__.event.emit('menu', 'save'); return null; })()`,
  );
  // The already-durable Save wrote to its existing path with no resolution — an
  // independent disk read shows the edit, with NO resolveSavePath supplied here.
  let durableWritten = false;
  const durableDeadline = Date.now() + 15_000;
  while (Date.now() < durableDeadline) {
    if (readFileSync(manifest.demoFile, 'utf-8').includes('Minkowski bound revisited — ζ(2).')) {
      durableWritten = true;
      break;
    }
    await sleep(250);
  }
  expect(durableWritten).toBe(true);
  expect(readFileSync(manifest.demoFile, 'utf-8')).toBe(durableBuffer);

  // No re-prompt fired for the already-durable save (when the observable exists).
  const resolvesAfterDurable = await resolveCount(tauriPage);
  if (resolvesBeforeDurable !== null && resolvesAfterDurable !== null) {
    expect(resolvesAfterDurable).toBe(resolvesBeforeDurable);
  }

  recordObservation({
    spec: manifest.spec,
    name: 'resolved-live-file-bytes',
    value: Buffer.byteLength(readFileSync(resolved)),
  });
});
