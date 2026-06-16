import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { parseTomlFile } from './support/toml';
import { openAndSelectDemo, editorText } from './support/app';

// ── P62 — Insertion bar: insert image from the system clipboard ──────────────
//
// THE OBLIGATION (proof-obligations.md, exact wording):
//   P62 — Insert image from clipboard. With an image on the system clipboard,
//   the insertion bar's paste-image action writes the image as a real file into
//   the CONFIGURED GLOBAL figures directory and inserts a markdown image
//   reference (`![…](…)`) to that exact file at the cursor. An independent
//   process reading the configured global figures directory finds a
//   newly-written image file whose bytes are the clipboard image (real image
//   bytes are persisted, not zero-length), and the markdown reference inserted
//   at the cursor points at that same on-disk file. Admissible because it fails
//   on a no-op insert (the paste-image action leaves the buffer unchanged so no
//   image reference appears at the cursor), on a dangling reference (a markdown
//   image reference is inserted but it points at a file that was never written /
//   does not exist on disk), on a wrong-location write (the file is written into
//   a local `./figures` relative to the project instead of the configured global
//   figures directory), and on an empty persist (the reference points at a file
//   that exists but holds no image bytes — nothing of the clipboard image was
//   actually persisted).
//
// ── THE OBSERVABLE CONTRACT (hooks + observables, BLIND to implementation) ───
// To drive this deterministically the harness must (1) put a KNOWN image on the
// real system clipboard, then (2) trigger the bar's paste-image action — the
// SAME action a user's "paste image" control fires. Webview clicks into the bar
// are flaky (the same reason P52–P61 drive their bar/editor actions through
// harness hooks rather than synthetic key/click events), so two NEW hooks are
// required (BLIND to how they are implemented; only the observables matter):
//
//   __PPE_E2E__.seedClipboardImage(width: number, height: number)   [NEW for P62]
//     Constructs a deterministic raster image of EXACTLY `width`×`height` pixels
//     and writes it onto the REAL system clipboard through the clipboard-manager
//     plugin's writeImage path (the SAME clipboard a user's screenshot/copy
//     lands on). This is the faithful seed: the app's paste-image action later
//     reads this exact image back off the clipboard. The chosen dimensions are
//     the witness — a deterministic, unusual size (7×5) no incidental image
//     would carry — so the persisted file's decoded dimensions prove the
//     CLIPBOARD image (not some other file) was what got persisted.
//     Fire-and-forget; returns null.
//
//   __PPE_E2E__.pasteClipboardImage()   [NEW for P62]
//     Performs the SAME action the insertion bar's paste-image control performs:
//     reads the image off the system clipboard, writes it as a REAL image file
//     into the CONFIGURED GLOBAL figures directory (config.directories.figures —
//     NOT a project-local ./figures), and inserts a markdown image reference
//     `![…](<path to that file>)` at the cursor pointing at that exact on-disk
//     file. Fire-and-forget; returns null. The observables afterwards are the
//     editor buffer (getEditorText) and — decisively — the configured figures
//     directory on disk, read by THIS independent test process.
//
//   __PPE_E2E__.getEditorText()  [reused]  — the live editor buffer text.
//
// The bar control MAY also be a DOM control (a paste-image button, the pattern
// InsertionBar.svelte's other controls use); the hooks are the stable,
// click-free surface this spec drives — the same choice P55–P61 made.
//
// ── THE CONFIGURED FIGURES DIRECTORY (independent read) ───────────────────────
// The configured global figures dir is read INDEPENDENTLY from the app: this
// spec parses the on-disk config.toml (provision-proof.sh wrote
// directories.figures = "$run/home/.pandoc/figures", the SAME ExistingDir P29
// uses) with a separate process (python tomllib via parseTomlFile), never
// trusting the app's own report of where it wrote. The before/after listing of
// THAT directory is the decisive on-disk proof.
//
// ── A DETERMINISTIC WITNESS SIZE (kills no-bytes / wrong-file) ────────────────
// The seeded clipboard image is EXACTLY SEED_W×SEED_H pixels (7×5) — a small,
// unusual size. An independent image decoder (Python PIL, a separate process)
// must open the newly-written file and read back EXACTLY those dimensions. This
// is the faithful "real image bytes are persisted" check: a zero-length file, a
// truncated/garbage file, or a placeholder of the wrong size all fail to decode
// to 7×5, killing the empty-persist failure mode without coupling to the app's
// chosen on-disk encoding.
//
// ── WHAT EACH ASSERTION KILLS ─────────────────────────────────────────────────
//   (A) Before the paste, the configured figures directory holds a known set of
//       files (the baseline listing). The witness demo.md ships ONE pre-existing,
//       project-local image reference (`![scatter](fig/plot.png)`, NOT under the
//       configured global figures dir), so this spec does not assert "no image
//       reference exists"; it asserts the NEW file + the NEW reference targeting
//       it (by the unique on-disk filename the paste produced) are produced by
//       the paste, not pre-existing.
//   (B) After pasteClipboardImage(), the configured figures directory gained
//       EXACTLY ONE new file (independent before/after listing of the configured
//       dir, read by this test process).
//       KILLS the NO-OP insert (no file appears) AND the WRONG-LOCATION write
//       (the file lands under a project-local ./figures, never under the
//       configured global figures dir, so the configured dir gains nothing).
//       (RED today: __PPE_E2E__.pasteClipboardImage / seedClipboardImage do not
//       exist, so the seed/paste evaluate throws — there is no insertion-bar
//       paste-image surface, no clipboard-image write command, and no
//       write-image capability at all.)
//   (C) That new file is a REAL image: it is non-empty AND an independent decoder
//       opens it and reads back EXACTLY the seeded 7×5 pixel dimensions.
//       KILLS the EMPTY persist (a zero-length / undecodable placeholder file)
//       and proves the CLIPBOARD image (the 7×5 seed) is what got persisted, not
//       an unrelated file.
//   (D) The editor buffer gained a markdown image reference `![…](<target>)`
//       whose target path resolves to that EXACT newly-written file under the
//       configured figures dir.
//       KILLS the NO-OP insert (no reference at the cursor), the DANGLING
//       reference (a reference pointing at a path that does not exist on disk),
//       and the WRONG-LOCATION reference (a `./figures`-relative target rather
//       than the configured global figures file): the reference's target, joined
//       against the configured figures dir, must name the file that (B)/(C)
//       proved was written there with real image bytes.
//
// Together: with a known image on the clipboard, the paste-image action writes
// a REAL image file of the clipboard image's exact dimensions into the CONFIGURED
// figures dir (B, C) and inserts a markdown reference at the cursor pointing at
// THAT file (D) — not a no-op, not a dangling reference, not a ./figures write,
// not an empty persist.

const SEED_W = 7;
const SEED_H = 5;

// A markdown inline image reference: `![alt](target)`. Captures the target path.
// Used with a global flag to enumerate ALL references in the buffer (demo.md
// ships one pre-existing project-local reference), so the spec can pick the
// reference whose target is the file the paste actually wrote.
const IMG_REF_RE = /!\[[^\]]*\]\(([^)]+)\)/g;

// Decode an image file's pixel dimensions in an INDEPENDENT process (Python
// PIL), so neither the app nor this test's own code is trusted to report them.
// Format-agnostic (PNG/JPEG/BMP/…): proves the file holds real, decodable image
// bytes of the expected size, without coupling to the app's chosen encoding.
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

// List regular files directly under `dir` (basenames). Used to diff the
// configured figures directory before/after the paste — the independent on-disk
// observation that the app actually wrote a file THERE.
function listFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort();
}

test('the paste-image action writes the clipboard image into the configured figures dir and references that exact file at the cursor', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // The CONFIGURED global figures directory, read INDEPENDENTLY from the on-disk
  // config.toml (python tomllib) — never the app's own report. This is the exact
  // ExistingDir directories.figures provision-proof.sh wrote.
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

  // (A) Baseline: the configured figures dir holds a known set of files. demo.md
  // ships ONE pre-existing project-local image reference (`fig/plot.png`, NOT
  // under the configured figures dir); the file + reference proven below are
  // keyed by the UNIQUE on-disk filename the paste produces, so they are NEWLY
  // produced by the paste, not this pre-existing one.
  const filesBefore = listFiles(figuresDir);

  // (1) Seed a KNOWN 7×5 image onto the REAL system clipboard. RED today:
  // __PPE_E2E__.seedClipboardImage does not exist, so this evaluate throws —
  // there is no clipboard image-write surface (the capability grants only
  // clipboard text read/write, and no seed hook exists).
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.seedClipboardImage(${SEED_W}, ${SEED_H}); return null; })()`,
  );

  // (2) Trigger the insertion bar's paste-image action. RED today:
  // __PPE_E2E__.pasteClipboardImage does not exist, so this evaluate throws —
  // there is no paste-image control, no clipboard-image read, and no Rust
  // command that writes the image into the configured figures dir.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.pasteClipboardImage(); return null; })()`,
  );

  // The paste is async (clipboard read + file write + buffer edit). Await the
  // observable end state: a markdown image reference present in the buffer.
  await tauriPage.waitForFunction(
    `/!\\[[^\\]]*\\]\\([^)]+\\)/.test(window.__PPE_E2E__.getEditorText())`,
    15_000,
  );

  const after = await editorText(tauriPage);

  // (B) The configured figures directory gained EXACTLY ONE new file (independent
  // before/after listing of the CONFIGURED dir). KILLS the no-op insert (nothing
  // written) and the wrong-location write (a file under a project-local
  // ./figures never appears under the configured global figures dir).
  const filesAfter = listFiles(figuresDir);
  const beforeSet = new Set(filesBefore);
  const newFiles = filesAfter.filter((name) => !beforeSet.has(name));
  expect(newFiles).toHaveLength(1);
  const newFile = newFiles[0];
  const newFilePath = join(figuresDir, newFile);

  // (C) That new file is a REAL image: non-empty, and an independent decoder
  // reads back EXACTLY the seeded 7×5 dimensions. KILLS the empty persist (a
  // zero-length / undecodable file) and proves the CLIPBOARD image is what was
  // persisted (its exact pixel dimensions), not an unrelated file.
  expect(statSync(newFilePath).size).toBeGreaterThan(0);
  const size = decodeImageSize(newFilePath);
  expect(size.width).toBe(SEED_W);
  expect(size.height).toBe(SEED_H);

  // (D) The buffer gained a markdown image reference `![…](<target>)` whose
  // target NAMES that EXACT newly-written file under the configured figures dir.
  // Enumerate ALL image references in the buffer (demo.md's pre-existing
  // `fig/plot.png` is one of them) and require that exactly one of them points at
  // the new figures file by basename. KILLS the no-op insert (no reference names
  // the new file), the dangling reference (the named target does not exist on
  // disk), and the wrong-location reference (a `./figures`-relative or
  // project-local target rather than the configured global figures file).
  const targets = [...after.matchAll(IMG_REF_RE)].map((m) => m[1]);
  const refsToNewFile = targets.filter((t) => (t.split('/').pop() ?? t) === newFile);
  expect(refsToNewFile).toHaveLength(1);
  const target = refsToNewFile[0];

  // The reference's target, resolved the way an independent reader would (an
  // absolute target as-is; a bare/relative target under the configured figures
  // dir), must be the file proven real in (C) — it must exist on disk (kills
  // dangling) and be byte-identical to the configured-dir file the diff found
  // (same file, real image bytes — not a project-local ./figures copy).
  const resolved = target.startsWith('/') ? target : join(figuresDir, target.split('/').pop() ?? target);
  expect(statSync(resolved).isFile()).toBe(true);
  expect(readFileSync(resolved).length).toBe(readFileSync(newFilePath).length);

  recordObservation({ spec: manifest.spec, name: 'figures-dir', value: figuresDir });
  recordObservation({ spec: manifest.spec, name: 'written-file', value: newFile });
  recordObservation({ spec: manifest.spec, name: 'image-width', value: size.width });
  recordObservation({ spec: manifest.spec, name: 'image-height', value: size.height });
  recordObservation({ spec: manifest.spec, name: 'image-ref-target', value: target });
});
