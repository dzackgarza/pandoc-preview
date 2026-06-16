import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { currentFile, editorText, waitForHarness, sleep } from './support/app';

// ── P49 — Launch restores the last session and offers newer recovery content ─
//
// The deepest persistence guarantee (recovery-and-git-state-requirements.md):
// the model is explicitly swap-file-like — "on startup the backend scans the
// recovery store and offers to restore the last active unsaved session." The
// durable state a prior session leaves lives on the HOST FILESYSTEM, never
// browser storage (the Anti-Sandbox Rule): the last project + file in a session
// state file under XDG_STATE_HOME, and the unsaved buffer in an app-owned
// recovery git repo under XDG_DATA_HOME. So an independent process (this spec's
// provisioning) can write exactly that state, and an independent process (this
// spec) can read it back content-addressably.
//
// WHY PROVISION-THEN-LAUNCH (faithfulness):
//   A true two-instance relaunch is infeasible in this harness: proof-run.sh
//   launches exactly ONE app instance and the Playwright fixture attaches to its
//   socket; there is no in-harness primitive to spawn a second instance and
//   observe its webview. So the harness provisions, on the host fs and BEFORE the
//   single launch, exactly the durable state a prior session would have left
//   (provision-proof.sh, p49 case), then this spec observes whether the launched
//   app honors it. This is faithful, not a mock: the app boots against a clean
//   hermetic XDG with NO prior in-app activity — this spec NEVER calls openProject
//   or openAndSelectDemo — so a reopened last file and an offer of newer recovery
//   content can ONLY originate from the app reading this real host-fs state on
//   launch. There is no other source.
//
// THE OBSERVABLE CONTRACT THE IMPLEMENTER MUST SATISFY (implementation-blind):
//   1. AUTO-REOPEN. On launch the app reads the host-fs session state
//      ($XDG_STATE_HOME/pandoc-preview/session.json) and REOPENS the last file
//      WITHOUT any spec action. After launch + harness attach,
//      __PPE_E2E__.currentFile() is the session's `file`, and the editor buffer
//      (getEditorText) holds that file's content.
//   2. RESTORE OFFER. When the session's recovery store holds a buffer AHEAD OF
//      the on-disk file, the app presents a pending restore offer. Stable
//      observable (chosen — mirrors the harness's existing __PPE_E2E__ surface
//      used by every other spec, so no DOM-selector guessing):
//        - window.__PPE_E2E__.pendingRestore() returns a JSON-serializable
//          object describing the offer (at minimum { file, sessionId }) when an
//          offer is pending, or null when there is none.
//        - window.__PPE_E2E__.acceptRestore() accepts the pending offer,
//          loading the recovery buffer bytes into the live editor.
//   3. ACCEPT LOADS RECOVERY BYTES. After acceptRestore(), the editor buffer is
//      BYTE-EQUAL to the newer recovery buffer (the unsaved edit included,
//      unicode intact) — NOT the stale on-disk content.
//
// DISCRIMINATOR — what each assertion KILLS:
//   - currentFile()/buffer == the session's last file after launch (no
//     openProject called):
//       * KILLS a launch that opens blank (currentFile empty) — the last file is
//         not reopened.
//       * KILLS a hardcoded/default file open — the reopened file is whatever
//         the session state names, read from host fs, not a fixed literal.
//   - pendingRestore() present AND sourced from host-fs state:
//       * KILLS a restore offer driven from browser storage — the only session
//         + recovery state that exists lives on the host fs under the hermetic
//         XDG dirs the harness provisioned; nothing was ever written to any
//         webview sandbox, so a browser-storage restore has nothing to offer.
//       * KILLS no-offer-at-all — a launch that reopens the file but ignores the
//         ahead-of-disk recovery store leaves pendingRestore() null.
//   - accepted buffer byte-equal to the NEWER recovery bytes, AND on-disk
//     demo.md does NOT contain the unsaved edit:
//       * KILLS a stale-disk restore — restoring from disk yields the older
//         content lacking the unsaved-edit sentence, so the byte-equal check
//         fails. The on-disk file is asserted stale first, proving disk-restore
//         would be observably wrong.
//       * KILLS a lossy re-encode of the recovery buffer — the non-ASCII run
//         (é, ζ, the em dash —, ï) must survive byte-for-byte.
//
// RED EXPECTATION today: no session-restore feature exists. The app launches
// without reading session.json (opens blank, currentFile empty) and exposes no
// pendingRestore/acceptRestore on __PPE_E2E__. So assertion 1 (auto-reopen) or 2
// (offer present) fails first — proving the behavior is ABSENT, not that the spec
// is miswired: the manifest reads, the session.json read, and the recovery-blob
// read all succeed before any app-behavior assertion.

// The blob filename in the recovery repo is unknown-to-the-spec by design;
// the newer recovery bytes are discovered content-addressably from the object
// database via the `git` CLI (mirrors p45's independent-process discipline).
// Returns the bytes of the single blob the recovery commit holds.
function recoveryBufferBytes(recoveryDir: string): Buffer {
  const objectLines = execFileSync(
    'git',
    ['-C', recoveryDir, 'cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype)'],
    { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 },
  );
  const blobs: string[] = [];
  for (const line of objectLines.split('\n')) {
    const [oid, type] = line.trim().split(/\s+/);
    if (type === 'blob' && oid) blobs.push(oid);
  }
  if (blobs.length !== 1) {
    throw new Error(
      `recovery store should hold exactly one buffer blob, found ${blobs.length} in ${recoveryDir}`,
    );
  }
  return execFileSync('git', ['-C', recoveryDir, 'cat-file', 'blob', blobs[0]], {
    maxBuffer: 256 * 1024 * 1024,
  });
}

interface SessionState {
  project: string;
  file: string;
  sessionId: string;
}

function loadSessionState(xdgStateHome: string): SessionState {
  const path = join(xdgStateHome, 'pandoc-preview', 'session.json');
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  for (const key of ['project', 'file', 'sessionId'] as const) {
    if (typeof raw[key] !== 'string') {
      throw new Error(`session.json field ${key} is not a string at ${path}`);
    }
  }
  return raw as unknown as SessionState;
}

test('launch reopens the last session file and offers the newer recovery buffer', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // Ground truth from the host-fs state the harness provisioned BEFORE launch.
  const session = loadSessionState(manifest.xdgStateHome);
  const recoveryDir = join(
    manifest.xdgDataHome,
    'pandoc-preview',
    'recovery',
    session.sessionId,
  );
  // The NEWER buffer the prior session left in its recovery store — discovered
  // content-addressably, never hardcoded.
  const newerBytes = recoveryBufferBytes(recoveryDir);
  expect(newerBytes.includes(Buffer.from('Unsaved recovery edit — Café ζ naïve.', 'utf-8'))).toBe(
    true,
  );

  // The on-disk project file is the STALE older content: it must NOT contain the
  // unsaved edit, so a restore that loads disk would be observably wrong.
  const onDiskBytes = readFileSync(session.file);
  expect(onDiskBytes.includes(Buffer.from('Unsaved recovery edit', 'utf-8'))).toBe(false);
  expect(onDiskBytes.equals(newerBytes)).toBe(false);

  // Attach to the already-launched app. NO openProject / openAndSelectDemo — any
  // reopened file can only come from the app reading host-fs session state.
  await waitForHarness(tauriPage);

  // ── Assertion 1: AUTO-REOPEN ───────────────────────────────────────────────
  // Give the app a moment to complete its startup session scan, then assert the
  // last file was reopened from host-fs session state.
  await sleep(2_000);
  const reopened = await currentFile(tauriPage);
  expect(reopened).toBe(session.file);
  const reopenedBuffer = await editorText(tauriPage);
  expect(reopenedBuffer.length).toBeGreaterThan(0);

  // ── Assertion 2: RESTORE OFFER present, sourced from host-fs state ──────────
  const pendingRaw = await tauriPage.evaluate(
    `(() => { const r = window.__PPE_E2E__.pendingRestore(); return r === undefined || r === null ? null : JSON.stringify(r); })()`,
  );
  expect(pendingRaw).not.toBeNull();
  const pending = JSON.parse(pendingRaw as string) as { file: string; sessionId: string };
  expect(pending.file).toBe(session.file);
  expect(pending.sessionId).toBe(session.sessionId);

  // ── Assertion 3: ACCEPT loads the newer recovery bytes ─────────────────────
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.acceptRestore(); return null; })()`,
  );
  // Poll for the accepted restore to land in the live editor buffer.
  let acceptedBytes = Buffer.from(await editorText(tauriPage), 'utf-8');
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && !acceptedBytes.equals(newerBytes)) {
    await sleep(250);
    acceptedBytes = Buffer.from(await editorText(tauriPage), 'utf-8');
  }
  expect(acceptedBytes.equals(newerBytes)).toBe(true);

  recordObservation({
    spec: manifest.spec,
    name: 'restored-recovery-bytes',
    value: newerBytes.length,
  });
});
