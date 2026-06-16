import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, editorText, waitForPreview, sleep } from './support/app';

// A unicode-discriminating sentence. Every byte of the non-ASCII run
// (é, ï, the em dash —, the Greek ζ) must survive the capture path intact,
// so a recovery store that lossily re-encodes the buffer fails the byte-equal
// assertion just as surely as one that never captured at all.
const SENTENCE = 'Café résumé — naïve ζ.';

// ── P45 — Recovery captures unsaved edits durably (HOST FILESYSTEM) ─────────
//
// The deepest guarantee in the app (recovery-and-git-state-requirements.md):
// no more than several seconds of work is ever permanently lost, and the
// recovery copy lives on the HOST FILESYSTEM — never browser storage — so an
// independent host process (this spec) can read it. While the user edits, the
// buffer is continuously captured to an app-owned recovery store under an XDG
// data location (dirs::data_dir() == the hermetic $XDG_DATA_HOME the harness
// provisions as manifest.xdgDataHome), with NO user action.
//
// THE OBSERVABLE END-STATE THIS PROVES (implementation-blind):
//   1. Append SENTENCE to the buffer WITHOUT saving.
//   2. Within several seconds, an INDEPENDENT process reading the host-fs
//      recovery store finds a copy BYTE-EQUAL to the current editor buffer —
//      the appended sentence included, unicode intact.
//   3. The project file on disk (manifest.demoFile) is STILL byte-for-byte
//      what it was before the edit — no Save happened.
//
// The store's on-disk layout is UNKNOWN to this spec (it may be a git repo
// whose every autosave is a commit, or plain snapshot files). So discovery is
// content-addressed, not path-addressed: scan the hermetic XDG data tree for
// ANY regular file whose bytes equal the buffer, AND for any git repo found,
// enumerate ALL blobs reachable in its object database via the `git` CLI and
// compare. The assertion is durable host-fs recoverability of the EXACT bytes,
// independent of where or how the app chose to store them.
//
// DISCRIMINATOR — what each assertion KILLS:
//   - recovery content byte-equal to the LIVE buffer (with SENTENCE):
//       * KILLS a no-op autosave — the store never contains the sentence.
//       * KILLS a debounce too long to capture within several seconds — the
//         ~10s poll window expires with no matching content on disk.
//   - the copy is found on the HOST FILESYSTEM by an independent process:
//       * KILLS a browser-storage-only autosave (localStorage/IndexedDB) — no
//         host-fs copy exists for any process outside the webview sandbox to
//         read, so the tree scan finds nothing.
//   - manifest.demoFile unchanged on disk (no Save occurred):
//       * KILLS an autosave that fires only on Save — the project file would
//         have changed. The pre-save witness is forced: recovery must precede
//         any disk write to the real file, so a capture that piggybacks on Save
//         cannot satisfy both "recovery has the sentence" and "project file
//         unchanged" at once.
//
// RED EXPECTATION today: no recovery feature exists, so no host-fs copy of the
// buffer is ever written under the XDG data tree. The poll exhausts and the
// "recovery store contains a byte-equal copy" assertion fails — proving the
// capture behavior is ABSENT, not that the spec is miswired (the project-file
// read, the editor buffer read, and the manifest field all succeed first).

// Recursively collect every regular file under `root` (host-fs only; the
// store, by contract, is NOT in any browser sandbox). Returns [] if the root
// does not exist yet — an absent XDG data tree is itself the RED signal that
// nothing was captured.
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
// `buffer`. Compares raw bytes (not decoded text) so a lossy re-encoding of the
// unicode run does not pass.
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
// equal `buffer`. The recovery store may be a git repo whose every autosave is
// a commit (the SoloMD AutoGit model in
// reference-autosave-and-git-recovery-solomd-mx.md), in which case the captured
// buffer lives as a blob in the object database, reachable even before any
// working-tree checkout. Uses the `git` CLI as the independent reader (mirrors
// p17's independent-process discipline): enumerate every object, take the
// blobs, and compare each blob's bytes to the buffer.
function gitBlobEqualsBuffer(root: string, buffer: Buffer): boolean {
  const repos = walkFiles(root)
    .filter((p) => p.endsWith('/HEAD') && p.includes('/.git/'))
    .map((p) => p.slice(0, p.indexOf('/.git/') + 4));
  // Also consider bare repos (a `HEAD` file directly under a dir holding
  // `objects/` and `refs/`). Discover them by scanning directories.
  const bareRepos = walkFiles(root)
    .filter((p) => p.endsWith('/HEAD'))
    .map((p) => p.slice(0, -'/HEAD'.length))
    .filter((dir) => {
      try {
        return statSync(join(dir, 'objects')).isDirectory();
      } catch {
        return false;
      }
    });
  const candidates = Array.from(new Set([...repos, ...bareRepos]));
  for (const gitDir of candidates) {
    let objectLines: string;
    try {
      // List every object id + type in the repo. --batch-all-objects walks the
      // entire object database (loose + packed), independent of refs, so a blob
      // committed by autosave is found even if HEAD has not advanced to it.
      objectLines = execFileSync(
        'git',
        ['--git-dir', gitDir, 'cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype)'],
        { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 },
      );
    } catch {
      continue;
    }
    for (const line of objectLines.split('\n')) {
      const [oid, type] = line.trim().split(/\s+/);
      if (type !== 'blob' || !oid) continue;
      let blob: Buffer;
      try {
        blob = execFileSync('git', ['--git-dir', gitDir, 'cat-file', 'blob', oid], {
          maxBuffer: 256 * 1024 * 1024,
        });
      } catch {
        continue;
      }
      if (blob.equals(buffer)) return true;
    }
  }
  return false;
}

test('the recovery store holds a host-fs copy of the unsaved buffer within seconds', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Capture the pristine on-disk project file BEFORE the edit. The
  // project-file-unchanged clause is asserted against exactly these bytes.
  const projectBytesBefore = readFileSync(manifest.demoFile);

  // Append the unicode sentence through the real editor update pipeline —
  // WITHOUT saving. This fires the same docChanged path user typing fires; no
  // Save menu event is emitted anywhere in this spec.
  await appendAtEnd(tauriPage, `\n\n${SENTENCE}`);

  // The edit is in the live buffer, unicode preserved. This is the ground
  // truth the recovery copy must equal byte-for-byte.
  const buffer = await editorText(tauriPage);
  expect(buffer.includes(SENTENCE)).toBe(true);
  const bufferBytes = Buffer.from(buffer, 'utf-8');

  // Poll the HOST FILESYSTEM for up to ~10s for a byte-equal copy of the live
  // buffer, in an independent process (plain fs reads + the git CLI). "Several
  // seconds" is the contract; 10s gives generous margin while still failing a
  // debounce set too long to be a real autosave.
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

  // (a) An independent host process found the exact buffer (sentence + unicode)
  // in the recovery store. RED today: nothing is captured to the host fs, so
  // this is false after the full poll window — the capture behavior is absent.
  expect(recovered).toBe(true);

  // (b) No Save happened: the project file on disk is byte-for-byte unchanged.
  // Forces the recovery copy to be a PRE-SAVE witness (a save-only autosave
  // cannot satisfy both clauses).
  const projectBytesAfter = readFileSync(manifest.demoFile);
  expect(projectBytesAfter.equals(projectBytesBefore)).toBe(true);

  recordObservation({
    spec: manifest.spec,
    name: 'recovered-buffer-bytes',
    value: bufferBytes.length,
  });
});
