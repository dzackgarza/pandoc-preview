import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, waitForPreview, sleep } from './support/app';

// ── P46 — Repo-state machine reflects and mutates REAL git state ────────────
//
// The obligation (proof-obligations.md, P46): the app continuously reflects
// whether the open file is noRepo / untracked / tracked via a prominent
// indicator, with one-click shortcuts OUT of every degraded state. Opening a
// file in a non-git directory must read noRepo; "initialize repository" must
// produce a REAL repository on disk (an independent git query against the
// directory succeeds) and flip the indicator to untracked; "start tracking"
// must make an independent git query report the file tracked and flip the
// indicator to tracked.
//
// THE OBSERVABLE CONTRACT THIS SPEC DEFINES (what the implementer must satisfy):
//   - A repo-state indicator: an element matching `[data-repo-state]` whose
//     `data-repo-state` attribute value is exactly one of
//     `noRepo` | `untracked` | `tracked`.
//   - One-click controls OUT of the degraded states:
//       * `[data-repo-action="init"]`  — initialize a repository here.
//       * `[data-repo-action="track"]` — start tracking the open file.
//
// All git facts are read by THIS independent process via the real `git` CLI
// (/usr/bin/git on the proof PATH) and the host filesystem — never the app's
// own report. The witness project is provisioned as a plain (non-git) directory
// copy (provision-proof.sh copies tests/proof/fixtures/project, which has no
// .git), so the starting state is genuinely noRepo on disk; the app must do the
// init itself.
//
// DISCRIMINATOR — what each assertion KILLS:
//   1. indicator reads `noRepo` at open AND no .git on disk:
//        * KILLS a state hardcoded to `tracked`/`untracked` — it would already
//          contradict the indicator at step 1.
//   2. after clicking init: indicator becomes `untracked` AND an independent
//      git query (`rev-parse --is-inside-work-tree`) succeeds AND .git exists:
//        * KILLS a UI-only indicator that never touches git — the independent
//          git query would still fail (no repo on disk) while the UI claimed a
//          transition.
//        * KILLS a state hardcoded to one value — it must TRANSITION here from
//          noRepo to untracked, observed across two distinct reads.
//   3. after clicking track: indicator becomes `tracked` AND an independent git
//      query (`git ls-files` / `status --porcelain`) reports demo.md as tracked
//      (staged in the index):
//        * KILLS a "track" action that merely relabels the indicator without
//          staging — the independent index query would still report the file
//          absent from the index while the UI claimed `tracked`.
//
// RED EXPECTATION today: no repo-state machine exists. `[data-repo-state]` is
// not in the DOM, so the FIRST assertion (count of `[data-repo-state]` === 1)
// fails — proving the indicator/controls are ABSENT, not that the spec is
// miswired (the project open and preview render succeed first).

const GIT = '/usr/bin/git';

// Read the live `data-repo-state` attribute value off the indicator, or null
// if the indicator is not in the DOM. Returns the raw attribute string so a
// hardcoded/invalid value is observable rather than silently coerced.
async function repoStateAttr(page: {
  evaluate(expr: string): Promise<unknown>;
}): Promise<string | null> {
  const raw = await page.evaluate(
    `(() => { const e = document.querySelector('[data-repo-state]'); return e === null ? null : String(e.getAttribute('data-repo-state')); })()`,
  );
  if (raw === null) return null;
  if (typeof raw !== 'string') {
    throw new Error(`repoStateAttr returned non-string: ${JSON.stringify(raw)}`);
  }
  return raw;
}

// Independent git query: does `dir` sit inside a real git work tree? Runs the
// real git CLI as a separate process (mirrors p06/p45 independent-disk reads).
// Returns false on any non-zero exit (no repo) rather than throwing, so a
// missing repo is a clean negative.
function gitInsideWorkTree(dir: string): boolean {
  try {
    const out = execFileSync(GIT, ['-C', dir, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf-8',
    });
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

// Independent git query: is `file` tracked (present in the index) in the repo
// at `dir`? `git ls-files --error-unmatch` exits 0 iff the path is in the index
// (staged/tracked), non-zero otherwise. This is the staging witness that a
// relabel-without-staging "track" action cannot satisfy.
function gitFileTracked(dir: string, file: string): boolean {
  try {
    execFileSync(GIT, ['-C', dir, 'ls-files', '--error-unmatch', file], {
      encoding: 'utf-8',
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

test('the repo-state indicator transitions noRepo→untracked→tracked, driving real git on disk', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // ── Step 1: opened in a NON-git directory → indicator reads noRepo ────────
  // The indicator must exist (this is the assertion that fails RED today —
  // no `[data-repo-state]` element is rendered).
  expect(await tauriPage.count('[data-repo-state]')).toBe(1);
  expect(await repoStateAttr(tauriPage)).toBe('noRepo');
  // Independent disk fact: the project directory genuinely has no repository.
  expect(existsSync(`${manifest.project}/.git`)).toBe(false);
  expect(gitInsideWorkTree(manifest.project)).toBe(false);

  // ── Step 2: one-click "initialize repository" → real repo + untracked ─────
  expect(await tauriPage.count('[data-repo-action="init"]')).toBe(1);
  await tauriPage.click('[data-repo-action="init"]');

  // Poll the indicator until it transitions to untracked.
  await tauriPage.waitForFunction(
    `(() => { const e = document.querySelector('[data-repo-state]'); return !!e && e.getAttribute('data-repo-state') === 'untracked'; })()`,
    10_000,
  );
  expect(await repoStateAttr(tauriPage)).toBe('untracked');

  // Independent disk fact: a REAL repository now exists. Poll briefly so the
  // disk read does not race the UI flip (the app may write .git just after the
  // attribute updates), but the assertion is the independent git query, not the
  // app's claim.
  let repoOnDisk = false;
  const initDeadline = Date.now() + 5_000;
  while (Date.now() < initDeadline) {
    if (existsSync(`${manifest.project}/.git`) && gitInsideWorkTree(manifest.project)) {
      repoOnDisk = true;
      break;
    }
    await sleep(250);
  }
  expect(repoOnDisk).toBe(true);
  // demo.md is in the work tree but NOT yet in the index — untracked, as the
  // indicator claims. This is the precondition the track action must change.
  expect(gitFileTracked(manifest.project, 'demo.md')).toBe(false);

  // ── Step 3: one-click "start tracking" → file staged + tracked ────────────
  expect(await tauriPage.count('[data-repo-action="track"]')).toBe(1);
  await tauriPage.click('[data-repo-action="track"]');

  await tauriPage.waitForFunction(
    `(() => { const e = document.querySelector('[data-repo-state]'); return !!e && e.getAttribute('data-repo-state') === 'tracked'; })()`,
    10_000,
  );
  expect(await repoStateAttr(tauriPage)).toBe('tracked');

  // Independent disk fact: demo.md is now in the git index — actually staged,
  // not merely relabeled. Poll to avoid racing the UI flip.
  let fileTracked = false;
  const trackDeadline = Date.now() + 5_000;
  while (Date.now() < trackDeadline) {
    if (gitFileTracked(manifest.project, 'demo.md')) {
      fileTracked = true;
      break;
    }
    await sleep(250);
  }
  expect(fileTracked).toBe(true);

  recordObservation({
    spec: manifest.spec,
    name: 'repo-state-transitions',
    value: 'noRepo->untracked->tracked',
  });
});
