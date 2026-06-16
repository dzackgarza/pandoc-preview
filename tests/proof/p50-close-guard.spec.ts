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
  waitForPreview,
  sleep,
} from "./support/app";

// A unicode-discriminating sentence. The non-ASCII run (é, ï, the em dash —,
// the Greek ζ) must survive the recovery capture path byte-for-byte, so a
// recovery store that lossily re-encodes the buffer fails the byte-equal
// backstop assertion just as surely as one that never captured at all.
const SENTENCE = "Café résumé — naïve ζ.";

// ── P50 — Closing with a dirty buffer is guarded and loses nothing ──────────
//
// Obligation (proof-obligations.md, P50): "Closing the app (or switching files)
// with a dirty buffer prompts the user to resolve; the app does not close until
// the prompt is resolved; and because recovery already captured the buffer, no
// content is lost even on discard." Two independent guarantees:
//
//   (1) The GUARD. With a dirty buffer, requesting close fires a resolution
//       prompt and the app STAYS ALIVE — it does not close out from under the
//       unsaved work. (The native window close is not directly driveable from
//       the webview, so the harness drives the SAME close-guard path the
//       window's onCloseRequested handler runs.)
//   (2) The BACKSTOP. Independently of any prompt, the host-filesystem recovery
//       store already holds the dirty content — the lose-nothing guarantee that
//       survives even a forced quit that never honors the prompt.
//
// THE CONTRACT THE IMPLEMENTER MUST SATISFY (stable observables, impl-blind):
//   * __PPE_E2E__.requestClose() — a fire-and-forget trigger that runs the
//     EXACT close-guard path the real window's onCloseRequested would run
//     (the same guard a user clicking the window's close button hits). It must
//     NOT bypass the guard; it must NOT actually tear the webview down (the app
//     must stay alive so the spec can keep observing it).
//   * __PPE_E2E__.pendingCloseGuard() — boolean, true iff a close-guard
//     resolution prompt is currently pending/unresolved. (Equivalently a
//     [data-close-guard] element in the DOM; this spec reads the bridge.)
//   * The app stays ALIVE after requestClose: the __PPE_E2E__ bridge remains
//     reachable and responsive (isDirty() still answers).
//
// THE OBSERVABLE END-STATE THIS PROVES:
//   1. Open + select demo.md; append SENTENCE WITHOUT saving (buffer dirty).
//   2. Request close via __PPE_E2E__.requestClose().
//   3. (a) __PPE_E2E__.pendingCloseGuard() === true — a resolution prompt fired.
//   4. (b) The app is still alive — __PPE_E2E__.isDirty() still responds true,
//          i.e. the close did NOT proceed; the bridge was not torn down.
//   5. (c) Independently, an INDEPENDENT host process reading the host-fs
//          recovery store ($XDG_DATA_HOME/pandoc-preview/recovery/...) finds a
//          copy BYTE-EQUAL to the dirty buffer (SENTENCE + unicode intact).
//
// DISCRIMINATOR — what each assertion KILLS:
//   - (a) a guard/prompt is PENDING after requestClose:
//       * KILLS a close that drops the dirty buffer with NO prompt — the
//         requestClose path proceeds straight to teardown, pendingCloseGuard()
//         stays false, and the unsaved work would vanish silently.
//   - (b) the app is STILL ALIVE (bridge responds) after requestClose:
//       * KILLS a close that fires a prompt but tears the webview down anyway
//         (a cosmetic prompt that does not actually block the close) — the
//         bridge would be unreachable / isDirty() would not answer.
//   - (c) the host-fs recovery store holds a BYTE-EQUAL copy of the dirty buffer:
//       * KILLS a prompt-only guard that still loses content on force-quit — a
//         guard can block a graceful close yet leave NO recovery copy, so a hard
//         kill loses the buffer. The backstop assertion forces the lose-nothing
//         guarantee to exist on the host fs, independent of whether any prompt
//         is ever honored.
//
// RED EXPECTATION today: neither __PPE_E2E__.requestClose nor
// __PPE_E2E__.pendingCloseGuard exists (App.svelte wires no onCloseRequested
// handler; resolveDirty is only reachable on file-switch, never exposed on the
// bridge or wired to window close). So step 2's evaluate throws (requestClose is
// undefined) — the close-guard surface is ABSENT. The failure is for the RIGHT
// reason: the prologue (openAndSelectDemo, appendAtEnd, editorText) all succeed
// first, proving the spec is wired correctly and the guard is what is missing.

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

test("closing with a dirty buffer fires a prompt, stays alive, and the recovery backstop holds the buffer", async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Append the unicode sentence through the real editor update pipeline —
  // WITHOUT saving. This is the dirty buffer the close guard must protect.
  await appendAtEnd(tauriPage, `\n\n${SENTENCE}`);

  // Ground truth: the edit is in the live buffer, unicode preserved. This is
  // the bytes the recovery backstop (c) must equal, and the dirty state the
  // guard (a)/(b) must react to.
  const buffer = await editorText(tauriPage);
  expect(buffer.includes(SENTENCE)).toBe(true);
  const bufferBytes = Buffer.from(buffer, "utf-8");

  // The buffer is dirty before we request close — the precondition for the
  // guard to fire. (If this were false the guard would correctly NOT fire, so
  // the spec must establish dirtiness first.)
  const dirtyBefore = await tauriPage.evaluate(`window.__PPE_E2E__.isDirty()`);
  expect(dirtyBefore).toBe(true);

  // Request close through the SAME guard path the window's onCloseRequested
  // would run. RED today: __PPE_E2E__.requestClose is undefined, so this throws
  // — the close-guard surface is absent.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.requestClose(); return null; })()`,
  );

  // (a) A resolution prompt is pending after the close request. KILLS a close
  // that drops the buffer with no prompt (pendingCloseGuard stays false).
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.pendingCloseGuard() === true`,
    10_000,
  );
  const guardPending = await tauriPage.evaluate(
    `window.__PPE_E2E__.pendingCloseGuard()`,
  );
  expect(guardPending).toBe(true);

  // (b) The app is still ALIVE: the bridge is reachable and isDirty() still
  // answers truthfully — the close did NOT proceed out from under the unsaved
  // work. KILLS a cosmetic prompt that fires but tears the webview down anyway.
  const aliveDirty = await tauriPage.evaluate(`window.__PPE_E2E__.isDirty()`);
  expect(aliveDirty).toBe(true);

  // (c) The lose-nothing backstop, proven INDEPENDENTLY of the prompt: an
  // independent host process reading the host-fs recovery store finds a copy
  // byte-equal to the dirty buffer. Poll up to ~10s (recovery debounce is well
  // under "several seconds"). KILLS a prompt-only guard that still loses content
  // on force-quit — without this copy a hard kill would lose the buffer.
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
    name: "close-guard-dirty-buffer-bytes",
    value: bufferBytes.length,
  });
});
