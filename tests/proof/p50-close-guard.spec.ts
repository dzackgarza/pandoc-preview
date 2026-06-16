import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./fixtures";
import { loadRunManifest } from "./support/run-manifest";
import { recordObservation } from "./support/observations";
import {
  openAndSelectDemo,
  appendAtEnd,
  editorText,
  currentFile,
  waitForHarness,
  waitForPreview,
  sleep,
} from "./support/app";

// A unicode-discriminating sentence, made UNIQUE per run so the discard-
// durability backstop targets THIS edit specifically — not an earlier capture
// of a stale buffer. The non-ASCII run (the Greek ζ, the é in café) must survive
// the recovery capture path byte-for-byte, so a recovery store that lossily
// re-encodes the buffer fails the byte-equal backstop just as surely as one that
// never captured at all. The unique suffix makes the asserted bytes impossible
// to satisfy with any pre-edit recovery commit.
const UNIQUE = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const SENTENCE = `Discard-durability ζ café ${UNIQUE}`;

// A second UNIQUE run for the UNTITLED-buffer discard case. The untitled buffer
// has NO file identity (currentFile() is empty), so it captures recovery under
// the fixed UNTITLED_SESSION_ID. The unicode run (ζ, é) plus the unique suffix
// make the asserted bytes impossible to satisfy with any pre-edit capture and
// force the recovery store to preserve the bytes losslessly.
const UNTITLED_UNIQUE = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const UNTITLED_SENTENCE = `Untitled discard ζ café ${UNTITLED_UNIQUE}`;

// ── P50 — Closing with a dirty buffer is guarded and loses nothing ──────────
//
// Obligation (proof-obligations.md, P50): "Closing the app (or switching files)
// with a dirty buffer prompts the user to resolve; the app does not close until
// the prompt is resolved; and because recovery already captured the buffer, no
// content is lost even on discard." THREE independent guarantees:
//
//   (1) The GUARD. With a dirty buffer, requesting close fires a resolution
//       prompt and the app STAYS ALIVE — it does not close out from under the
//       unsaved work. (The native window close is not directly driveable from
//       the webview, so the harness drives the SAME close-guard path the
//       window's onCloseRequested handler runs.)
//   (2) The STAY-ALIVE. The bridge remains reachable after requestClose; the
//       close did not proceed.
//   (3) The DISCARD-DURABILITY BACKSTOP. The user RESOLVES the prompt by
//       choosing Discard. The discard tears the window down — but because
//       recovery already captured the dirty buffer to the HOST FILESYSTEM, the
//       final edit survives on disk regardless. This is the literal
//       "no content is lost even on discard" clause: an INDEPENDENT host
//       process, reading the recovery git store AFTER the window is gone, must
//       find the unique edit's bytes.
//
// THE CONTRACT THE IMPLEMENTER MUST SATISFY (stable observables, impl-blind):
//   * __PPE_E2E__.requestClose() — a fire-and-forget trigger that runs the
//     EXACT close-guard path the real window's onCloseRequested would run
//     (the same guard a user clicking the window's close button hits). It must
//     NOT bypass the guard; it must NOT actually tear the webview down on a
//     dirty buffer (the app must stay alive so the spec can keep observing it).
//   * __PPE_E2E__.pendingCloseGuard() — boolean, true iff a close-guard
//     resolution prompt is currently pending/unresolved.
//   * __PPE_E2E__.resolveClose('discard') — fire-and-forget; resolves a pending
//     close prompt by DISCARDING the dirty buffer. This runs the SAME discard
//     path the prompt's "Discard" button runs, then tears the window down. The
//     teardown drops the eval connection, so the spec issues it fire-and-forget
//     and tolerates the connection error (the window is gone — that is the
//     point). After discard the recovery store is read out-of-process.
//   * The app stays ALIVE between requestClose and resolveClose: the bridge
//     remains reachable (isDirty() still answers).
//
// THE OBSERVABLE END-STATE THIS PROVES:
//   1. Open + select demo.md; append the UNIQUE SENTENCE WITHOUT saving (buffer
//      dirty). This schedules a debounced recovery capture (the autosave timer).
//   2. IMMEDIATELY — well within the recovery debounce — request close via
//      __PPE_E2E__.requestClose().
//   3. (a) __PPE_E2E__.pendingCloseGuard() === true — a resolution prompt fired.
//   4. (b) The app is still alive — __PPE_E2E__.isDirty() still responds true,
//          i.e. the close did NOT proceed; the bridge was not torn down.
//   5. Resolve the prompt with __PPE_E2E__.resolveClose('discard') — the window
//      tears down (eval connection drops; tolerated).
//   6. (c) AFTER discard, an INDEPENDENT host process reading the host-fs
//          recovery store ($XDG_DATA_HOME/pandoc-preview/recovery/...) finds a
//          copy BYTE-EQUAL to the dirty buffer (UNIQUE SENTENCE + unicode
//          intact). The final edit SURVIVED in recovery despite Discard.
//
// DISCRIMINATOR — what each assertion KILLS:
//   - (a) a guard/prompt is PENDING after requestClose:
//       * KILLS a close that drops the dirty buffer with NO prompt — the
//         requestClose path proceeds straight to teardown, pendingCloseGuard()
//         stays false, and the unsaved work would vanish silently.
//   - (b) the app is STILL ALIVE (bridge responds) after requestClose:
//       * KILLS a close that fires a prompt but tears the webview down anyway
//         (a cosmetic prompt that does not actually block the close).
//   - (c) the host-fs recovery store holds a BYTE-EQUAL copy of the dirty buffer
//         AFTER the discard tore the window down:
//       * KILLS a discard path that CANCELS the pending debounced recovery
//         capture (clearTimeout on the autosave timer) and destroys the window
//         before the bytes reach the host fs — the CURRENT BUG. Because the
//         edit was made well within the recovery debounce, the autosave timer
//         was still pending at Discard; if Discard cancels it, the unique
//         sentence never lands on disk and an independent reader finds nothing.
//       * KILLS a prompt-only guard that loses content on discard — a guard can
//         block the graceful close yet leave NO recovery copy, so a discard (or
//         a hard kill) loses the buffer. The backstop forces the lose-nothing
//         guarantee to exist on the host fs, surviving the discard teardown.
//
// RED EXPECTATION today: the discard path (closeWindow) clears the pending
// recovery timer and destroys the window BEFORE the just-appended edit's
// debounced autosave fires (the edit is well inside RECOVERY_DEBOUNCE_MS). The
// unique sentence is therefore never committed to the host-fs recovery store, so
// the independent post-discard reader finds no byte-equal blob — assertion (c)
// fails. (If __PPE_E2E__.resolveClose is not yet exposed on the bridge, step 5's
// evaluate throws — the discard-resolution surface is absent; that too is a
// faithful RED, but the targeted assertion is (c): the lose-content-on-discard
// bug.) The prologue (openAndSelectDemo, appendAtEnd, editorText) and the guard
// assertions (a)/(b) all succeed first, proving the spec is wired correctly and
// the durability-on-discard guarantee is what is missing.

// Recursively collect every regular file under `root` (host-fs only; the
// recovery store, by contract, is NOT in any browser sandbox). Returns [] if the
// root does not exist yet — an absent XDG data tree is itself the RED signal.
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
    if (st.isDirectory()) {
      out.push(...walkFiles(p));
    } else if (st.isFile()) {
      out.push(p);
    }
  }
  return out;
}

// True if any regular file under the XDG data tree has bytes EXACTLY equal to
// `buffer`. Raw-byte compare so a lossy re-encoding of the unicode run fails.
function plainFileEqualsBuffer(root: string, buffer: Buffer): boolean {
  for (const file of walkFiles(root)) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(file);
    } catch {
      continue;
    }
    if (bytes.equals(buffer)) return true;
  }
  return false;
}

// True if any git repository under the XDG data tree holds a blob whose bytes
// equal `buffer`. The recovery store is a git repo whose every autosave is a
// commit (P45), so the captured buffer lives as a blob in the object database,
// reachable via the `git` CLI as an independent reader: enumerate every object,
// take the blobs, compare each blob's bytes to the buffer.
function gitBlobEqualsBuffer(root: string, buffer: Buffer): boolean {
  const repos = walkFiles(root)
    .filter((p) => p.endsWith("/HEAD") && p.includes("/.git/"))
    .map((p) => p.slice(0, p.indexOf("/.git/") + 4));
  const bareRepos = walkFiles(root)
    .filter((p) => p.endsWith("/HEAD"))
    .map((p) => p.slice(0, -"/HEAD".length))
    .filter((dir) => {
      try {
        return statSync(join(dir, "objects")).isDirectory();
      } catch {
        return false;
      }
    });
  const candidates = Array.from(new Set([...repos, ...bareRepos]));
  for (const gitDir of candidates) {
    let objectLines: string;
    try {
      objectLines = execFileSync(
        "git",
        [
          "--git-dir",
          gitDir,
          "cat-file",
          "--batch-all-objects",
          "--batch-check=%(objectname) %(objecttype)",
        ],
        { encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 },
      );
    } catch {
      continue;
    }
    for (const line of objectLines.split("\n")) {
      const [oid, type] = line.trim().split(/\s+/);
      if (type !== "blob" || !oid) continue;
      let blob: Buffer;
      try {
        blob = execFileSync(
          "git",
          ["--git-dir", gitDir, "cat-file", "blob", oid],
          {
            maxBuffer: 256 * 1024 * 1024,
          },
        );
      } catch {
        continue;
      }
      if (blob.equals(buffer)) return true;
    }
  }
  return false;
}

test("closing with a dirty buffer prompts, stays alive, and the final edit survives a Discard in the recovery store", async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // The exact bytes the discard-durability backstop (c) must equal. We compute
  // them on the host: append the UNIQUE sentence to the pristine demo buffer the
  // same way appendAtEnd does, so we know the post-append buffer without an
  // extra cross-process read that would burn into the recovery debounce window.
  const pristine = await editorText(tauriPage);
  const dirtyBuffer = `${pristine}\n\n${SENTENCE}`;
  const bufferBytes = Buffer.from(dirtyBuffer, "utf-8");

  // Drive the dirty-edit → close-guard → guard-observation sequence in ONE
  // synchronous browser-context evaluate that RETURNS cleanly (no teardown in
  // this block, so the eval resolves with the observations). The append (re)arms
  // the debounced recovery autosave timer (RECOVERY_DEBOUNCE_MS == 1500ms); the
  // DISCARD is fired in the very next round-trip below — one transport hop, far
  // inside 1500ms — so the autosave timer is STILL PENDING when discard runs.
  // That is the precise window in which the bug loses content: a discard that
  // cancels the pending timer and destroys the window before the unique edit
  // reaches the host fs. Capturing (a)/(b)/(pre-c) here, before any teardown,
  // means no destroy can race the guard observations.
  const captured = (await tauriPage.evaluate(
    `(() => {
      const E = window.__PPE_E2E__;
      // Append through the real editor pipeline — fires the same docChanged path
      // user typing fires and (re)arms the debounced recovery autosave timer.
      E.appendAtEnd(${JSON.stringify(`\n\n${SENTENCE}`)});
      const editorHasSentence = E.getEditorText().includes(${JSON.stringify(SENTENCE)});
      // Dirty before close — the precondition for the guard to fire.
      const dirtyBefore = E.isDirty();
      // Request close through the SAME guard path onCloseRequested runs.
      E.requestClose();
      // (a) a resolution prompt is pending; (b) the app is still alive (the
      // bridge still answers isDirty truthfully) — both captured synchronously
      // immediately after requestClose, before any teardown.
      const guardPending = E.pendingCloseGuard();
      const aliveDirty = E.isDirty();
      // (pre-c) Is the DISCARD-resolution surface present? The discard path is a
      // contract hook the implementer must expose on the bridge so a spec can
      // resolve the prompt by discarding (the same path the prompt's "Discard"
      // button runs). Captured here, synchronously, while the bridge is reachable.
      const discardSurface = typeof E.resolveClose === "function";
      return { editorHasSentence, dirtyBefore, guardPending, aliveDirty, discardSurface };
    })()`,
  )) as {
    editorHasSentence: boolean;
    dirtyBefore: boolean;
    guardPending: boolean;
    aliveDirty: boolean;
    discardSurface: boolean;
  };

  // The edit reached the live buffer, unicode preserved.
  expect(captured.editorHasSentence).toBe(true);
  // The buffer was dirty before close — precondition for the guard.
  expect(captured.dirtyBefore).toBe(true);
  // (a) A resolution prompt was pending after the close request. KILLS a close
  // that drops the buffer with no prompt (pendingCloseGuard stays false).
  expect(captured.guardPending).toBe(true);
  // (b) The app was still ALIVE after requestClose: the bridge answered
  // isDirty() truthfully — the close did NOT proceed out from under the unsaved
  // work. KILLS a cosmetic prompt that fires but tears the webview down anyway.
  expect(captured.aliveDirty).toBe(true);

  // (pre-c) The discard-resolution surface must exist for the lose-nothing-on-
  // discard guarantee to be reachable at all. RED today: __PPE_E2E__.resolveClose
  // is NOT exposed on the bridge (App.svelte wires resolveClose only to the
  // prompt's buttons, never onto the E2E harness), so the discard path cannot be
  // driven and the durability-on-discard backstop below is unreachable. This is
  // the faithful RED: the discard-resolution surface is ABSENT. The durability
  // assertion (c) is the TARGET this guards — once resolveClose is exposed, a
  // discard that cancels the pending recovery capture will fail (c) instead.
  expect(captured.discardSurface).toBe(true);

  // Resolve the prompt by DISCARDING — milliseconds after the append (one
  // round-trip, far inside the 1500ms recovery debounce), so the autosave timer
  // armed by the append is STILL PENDING. resolveClose('discard') runs the SAME
  // discard path the prompt's "Discard" button runs and then tears the window
  // down. The teardown drops the eval connection, so this is fire-and-forget:
  // tolerate the eval rejection (the window is gone — exactly the force-quit-on-
  // discard the backstop must survive).
  try {
    await tauriPage.evaluate(
      `(() => { window.__PPE_E2E__.resolveClose("discard"); return null; })()`,
    );
  } catch {
    // The discard destroyed the window; the eval connection drop is expected.
  }

  // (c) The lose-nothing-on-discard backstop, proven INDEPENDENTLY and AFTER the
  // discard: an independent host process reading the host-fs recovery store finds
  // a copy byte-equal to the dirty buffer. Poll up to ~10s. RED once the discard
  // surface exists but the bug remains: the discard path cancels the pending
  // debounced recovery capture (clearTimeout on the autosave timer) and destroys
  // the window before the unique edit ever reaches the host fs, so no byte-equal
  // blob is written — the poll exhausts and this fails. KILLS a discard that
  // cancels the recovery timer + destroys before the final edit is captured.
  let recovered = false;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (
      plainFileEqualsBuffer(manifest.xdgDataHome, bufferBytes) ||
      gitBlobEqualsBuffer(manifest.xdgDataHome, bufferBytes)
    ) {
      recovered = true;
      break;
    }
    await sleep(500);
  }
  expect(recovered).toBe(true);

  recordObservation({
    spec: manifest.spec,
    name: "discard-durable-buffer-bytes",
    value: bufferBytes.length,
  });
});

// ── P50 — Discarding an UNTITLED dirty buffer must also lose nothing ─────────
//
// The titled case above proves the lose-nothing-on-discard backstop for a buffer
// that HAS a file identity. But P50's "no content is lost even on discard" is not
// qualified by whether the buffer has a path: an UNTITLED (P47 identity-less)
// buffer the user has been typing into is exactly the work most at risk, because
// it has never been saved anywhere. recoveryTarget()/scheduleRecovery DO capture
// untitled buffers (under UNTITLED_SESSION_ID), so the debounced autosave is
// armed by an untitled edit just as it is for a titled one.
//
// THE BUG THIS CASE KILLS — the discard path does NOT flush an untitled buffer:
//   closeWindow() awaits flushRecovery() before destroy. flushRecovery first
//   clearTimeout()s the pending debounced capture, THEN early-returns on
//   `!dirty || !currentFile`. For an untitled buffer currentFile is null, so the
//   flush cancels the pending autosave and returns WITHOUT committing the buffer
//   — the window is then destroyed (onDestroy also clears the timer). Because the
//   untitled edit was made well within RECOVERY_DEBOUNCE_MS (1500ms), the
//   debounced capture had not yet fired, so the unique sentence NEVER reaches the
//   host-fs recovery store. An independent post-discard reader finds no
//   byte-equal blob — the final untitled edit is lost.
//
// This case therefore KILLS:
//   * a flushRecovery that skips untitled buffers (the `!currentFile`
//     early-return) — the live bug;
//   * any close path that cancels the untitled pending capture (clearTimeout on
//     the autosave timer) before it reaches the host fs and then destroys the
//     window.
//
// CONTRACT SURFACES (must already exist; if absent that is a DIFFERENT problem):
//   * __PPE_E2E__.newUntitled() (P47) — enter an identity-less buffer; after it
//     currentFile() is empty and the editor holds an editable buffer.
//   * __PPE_E2E__.resolveClose('discard') (P50) — run the SAME discard path the
//     prompt's Discard button runs, then tear the window down (fire-and-forget;
//     the eval connection drops on teardown — tolerated).
//
// RED EXPECTATION today: the durability assertion (the recovery store holds a
// byte-equal copy of the untitled dirty buffer AFTER discard) FAILS — the bytes
// are MISSING because flushRecovery skipped the untitled buffer and the debounced
// capture was cancelled by the close. The newUntitled entry, the empty
// currentFile observation, the dirty observation, and the discard surface all
// succeed first, so the failure lands squarely on the durability backstop, not a
// missing hook.
test("discarding an untitled (identity-less) dirty buffer still leaves the final edit in the recovery store", async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();
  await waitForHarness(tauriPage);

  // Enter an identity-less buffer (P47). currentFile() becomes empty: this is the
  // buffer whose final edit the discard must NOT lose, even though it was never
  // saved to any path.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.newUntitled(); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `(window.__PPE_E2E__.currentFile() ?? '') === ''`,
    10_000,
  );
  expect(await currentFile(tauriPage)).toBe("");

  // Append the UNIQUE unicode sentence through the real editor pipeline — this
  // fires the same docChanged path user typing fires, marks the buffer dirty, and
  // (re)arms the debounced recovery autosave timer under the untitled session.
  await appendAtEnd(tauriPage, UNTITLED_SENTENCE);

  // The exact bytes the durability backstop must equal: the untitled buffer
  // contents after the append. Read the live buffer (no save anywhere).
  const untitledBuffer = await editorText(tauriPage);
  expect(untitledBuffer.includes(UNTITLED_SENTENCE)).toBe(true);
  const bufferBytes = Buffer.from(untitledBuffer, "utf-8");

  // Synchronously confirm the preconditions while the bridge is still reachable:
  // the buffer is dirty (so a debounced recovery capture is armed) and the
  // discard-resolution surface exists. If discardSurface were false this would be
  // a missing-hook precondition failure (a DIFFERENT problem), not the durability
  // bug — so it is asserted explicitly before the discard.
  const pre = (await tauriPage.evaluate(
    `(() => {
      const E = window.__PPE_E2E__;
      return {
        identityless: (E.currentFile() ?? '') === '',
        dirtyBefore: E.isDirty(),
        discardSurface: typeof E.resolveClose === 'function',
      };
    })()`,
  )) as { identityless: boolean; dirtyBefore: boolean; discardSurface: boolean };
  expect(pre.identityless).toBe(true);
  expect(pre.dirtyBefore).toBe(true);
  expect(pre.discardSurface).toBe(true);

  // Resolve the (untitled) close by DISCARDING — milliseconds after the append,
  // one round-trip, far inside the 1500ms recovery debounce, so the autosave
  // timer armed by the append is STILL PENDING. resolveClose('discard') runs the
  // SAME discard path the prompt's Discard button runs and then tears the window
  // down; the teardown drops the eval connection, so this is fire-and-forget and
  // the rejection is tolerated (the window is gone — exactly the force-quit-on-
  // discard the backstop must survive).
  try {
    await tauriPage.evaluate(
      `(() => { window.__PPE_E2E__.resolveClose("discard"); return null; })()`,
    );
  } catch {
    // The discard destroyed the window; the eval connection drop is expected.
  }

  // (c) The lose-nothing-on-discard backstop for the UNTITLED buffer, proven
  // INDEPENDENTLY and AFTER the discard: an independent host process reading the
  // host-fs recovery store finds a copy byte-equal to the untitled dirty buffer.
  // Poll up to ~10s. RED today: flushRecovery skips the untitled buffer
  // (`!currentFile` early-return) after cancelling the pending debounced capture,
  // and the window is destroyed before the unique sentence ever reaches the host
  // fs — so no byte-equal blob is written and the poll exhausts. The final
  // untitled edit is lost.
  let recovered = false;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (
      plainFileEqualsBuffer(manifest.xdgDataHome, bufferBytes) ||
      gitBlobEqualsBuffer(manifest.xdgDataHome, bufferBytes)
    ) {
      recovered = true;
      break;
    }
    await sleep(500);
  }
  expect(recovered).toBe(true);

  recordObservation({
    spec: manifest.spec,
    name: "untitled-discard-durable-buffer-bytes",
    value: bufferBytes.length,
  });
});
