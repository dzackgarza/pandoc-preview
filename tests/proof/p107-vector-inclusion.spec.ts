import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { parseTomlFile } from './support/toml';
import { openAndSelectDemo, editorText } from './support/app';

// ── P107 — D-10: register + insert an external-editor-produced SVG/PDF vector
//    asset into the configured GLOBAL figures dir and reference it at the cursor ─
//
// THE OBLIGATION (proof-obligations.md, P99 — exact behaviour, verbatim intent):
//   With an external-editor-produced vector asset to include — an Ipe/Inkscape-
//   emitted SVG or PDF (not tikz) — invoking the insertion bar's vector-figure-
//   inclusion action writes that asset as a real file into the CONFIGURED GLOBAL
//   figures directory (config.directories.figures — the SAME ExistingDir P62
//   writes into, NEVER a project-local ./figures) and inserts a markdown image
//   reference (`![…](…)`) to that exact written file at the cursor.
//   An independent process reading the configured global figures directory finds a
//   newly-written vector asset whose bytes are the external asset's real bytes (a
//   real, non-zero-length file is persisted — never a zero-length / unreadable
//   asset), and the markdown reference inserted at the cursor points at that SAME
//   on-disk file (the reference resolves to a file that exists — not a dangling
//   reference). The inserted vector asset is REGISTERED in the D-7 / P96 dual-asset
//   registry — the included render is tracked alongside its editable source — so
//   the inserted figure is later re-openable in its source tool via P96's edit
//   action.
//   Admissible because it fails on a no-op insert (no reference appears at the
//   cursor), on a dangling reference (the reference points at a file that was never
//   written / does not exist), on a wrong-location write (the asset is written into
//   a project-local ./figures instead of the configured GLOBAL figures dir), on a
//   zero-length/empty persist (the reference points at a file holding no bytes),
//   and on an unregistered insert (the inserted asset is not recorded in the
//   dual-asset registry).
//
// ── THE P62 MODEL THIS REUSES (the exact non-tikz sibling) ────────────────────
// P62 (p62-clipboard-image.spec.ts) persists a clipboard PNG into the configured
// global figures dir (config.directories.figures, the SAME ExistingDir P29 uses,
// the stage-and-rename atomic write in src-tauri/src/clipboard.rs) and inserts a
// markdown image reference to it at the cursor. P99 does the SAME for an external-
// editor-produced VECTOR asset (an Ipe/Inkscape SVG/PDF), reusing P62's figures-
// dir resolution + atomic-write discipline, and ADDITIONALLY registers the
// inserted render in the D-7 / P96 dual-asset registry sidecar (the host-FS
// XDG-state JSON p106-dual-asset-registry.spec.ts reads). This spec asserts the
// P62 SHAPE — file written into the configured GLOBAL figures dir + a reference at
// the cursor — PLUS the registry sidecar leg, all read INDEPENDENTLY off disk.
//
// ── THE EXTERNAL VECTOR ASSET ON DISK (provision-proof.sh, p107 branch) ───────
// provision-proof.sh stages a REAL non-empty SVG OUTSIDE the configured figures
// dir (under the hermetic project, where an Ipe/Inkscape user's source file would
// live), carrying a distinctive marker in its bytes so the figures-dir copy can be
// proven byte-identical to THIS source — not some other file. The source lives in
// the PROJECT, never in config.directories.figures: the inclusion action must COPY
// it INTO the configured global figures dir, which is the decisive on-disk move.
//
// ── THE OBSERVABLE CONTRACT (hook + observables, BLIND to implementation) ──────
// To drive this deterministically the harness must invoke the SAME action the
// insertion bar's vector-figure-inclusion control fires, on the external asset.
// Webview clicks into the bar are flaky (the reason P52–P62 / P104 / P106 drive
// bar/editor actions through harness hooks, not synthetic key/click events), so a
// NEW hook is required (BLIND to how it is implemented; only the observables
// matter):
//
//   __PPE_E2E__.registerAndInsertVectorFigure(sourcePath)   [NEW for P107 / D-10]
//     Performs the SAME action a user's "include a vector figure" control fires
//     for the external-editor-produced vector asset at `sourcePath` (an Ipe/
//     Inkscape SVG/PDF, NOT tikz): writes that asset as a REAL file into the
//     CONFIGURED GLOBAL figures directory (config.directories.figures — NOT a
//     project-local ./figures), inserts a markdown image reference
//     `![…](<path to that file>)` at the cursor pointing at that exact on-disk
//     file, and REGISTERS the inserted render in the D-7 / P96 dual-asset registry
//     sidecar (recording the included render alongside its editable source — the
//     external asset — so the figure is later re-openable in its source tool).
//     Fire-and-forget; returns null. The observables afterwards are the editor
//     buffer (getEditorText), the configured figures directory on disk, and the
//     registry sidecar JSON under XDG_STATE_HOME — all read by THIS independent
//     test process.
//
//   __PPE_E2E__.getEditorText()  [reused]  — the live editor buffer text.
//
// ── THE CONFIGURED FIGURES DIRECTORY (independent read) ───────────────────────
// The configured global figures dir is read INDEPENDENTLY from the app: this spec
// parses the on-disk config.toml (provision-proof.sh wrote directories.figures =
// "$run/home/.pandoc/figures", the SAME ExistingDir P29/P62 use) with a separate
// process (python tomllib via parseTomlFile), never trusting the app's own report
// of where it wrote. The before/after listing of THAT directory is the decisive
// on-disk proof.
//
// ── WHAT EACH ASSERTION KILLS ─────────────────────────────────────────────────
//   (A) Before the inclusion, the configured figures directory holds a known set
//       of files (the baseline listing). demo.md ships ONE pre-existing project-
//       local image reference (`fig/plot.png`, NOT under the configured figures
//       dir), so the file + reference proven below are keyed by the UNIQUE on-disk
//       filename the inclusion produces — NEWLY produced, not pre-existing.
//   (B) After registerAndInsertVectorFigure(source), the configured figures
//       directory gained EXACTLY ONE new file (independent before/after listing of
//       the configured dir, read by this test process).
//       KILLS the NO-OP insert (no file appears) AND the WRONG-LOCATION write (the
//       asset lands under a project-local ./figures, never under the configured
//       global figures dir, so the configured dir gains nothing).
//   (C) That new file is the REAL external asset: it is non-empty AND its bytes are
//       BYTE-IDENTICAL to the staged external source (same length, same distinctive
//       marker), read INDEPENDENTLY off disk.
//       KILLS the ZERO-LENGTH / EMPTY persist (a zero-length / placeholder file
//       holding none of the asset's bytes) and proves the EXTERNAL asset (not an
//       unrelated file) is what got persisted.
//   (D) The editor buffer gained a markdown image reference `![…](<target>)` whose
//       target path resolves to that EXACT newly-written file under the configured
//       figures dir.
//       KILLS the NO-OP insert (no reference at the cursor), the DANGLING reference
//       (a reference pointing at a path that does not exist on disk), and the
//       WRONG-LOCATION reference (a ./figures-relative target rather than the
//       configured global figures file).
//   (E) The inserted render is REGISTERED in the D-7 / P96 dual-asset registry
//       sidecar — the host-FS XDG-state JSON p106 reads — pairing the written
//       render (under the configured figures dir) with its editable source (the
//       external asset). KILLS the UNREGISTERED insert (the included figure has no
//       tracked editable source and cannot be re-opened in its source tool).
//
// RED today: __PPE_E2E__.registerAndInsertVectorFigure does not exist — there is no
// vector-figure-inclusion action, no clipboard.rs vector-asset write command, and
// no registry-on-insert wiring — so the inclusion evaluate throws (the hook is
// absent). Even were a partial surface present, no file appears under the
// configured figures dir, no reference targeting it is inserted, and no registry
// sidecar pairs the render with its source. The failure below is the MISSING
// register+insert-vector-asset behaviour, not a boot error: the app + editor are
// brought up first.

// A distinctive marker committed into the external source SVG by provisioning, so
// an independent read of the figures-dir copy can prove it is THIS asset's bytes
// (not some other file). An unusual token no incidental SVG would carry.
const SOURCE_MARKER = '__P107_EXTERNAL_VECTOR_SOURCE__';

// A markdown inline image reference: `![alt](target)`. Captures the target path.
// Used with a global flag to enumerate ALL references in the buffer (demo.md ships
// one pre-existing project-local reference), so the spec can pick the reference
// whose target is the file the inclusion actually wrote.
const IMG_REF_RE = /!\[[^\]]*\]\(([^)]+)\)/g;

// List regular files directly under `dir` (basenames). Used to diff the configured
// figures directory before/after the inclusion — the independent on-disk
// observation that the app actually wrote a file THERE.
function listFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort();
}

// Search the app's host-FS state dir for a registry sidecar JSON whose parsed
// content pairs `render` with `source` (the editable source the render resolves
// to). Returns the sidecar path, or null if none records the pairing. The SAME
// restart-faithful independent read p106-dual-asset-registry.spec.ts uses: the
// pairing must be readable from a real file on disk (the place a relaunched app
// reads), not from the live app's in-memory state. The exact sidecar
// filename/shape is the implementer's choice (the session.json/fold-state.json
// pattern), so this discovers any JSON under the state dir that, parsed, contains
// BOTH paths.
function findRegistrySidecar(stateDir: string, render: string, source: string): string | null {
  if (!existsSync(stateDir)) return null;
  for (const candidate of walkJson(stateDir)) {
    let raw: string;
    try {
      raw = readFileSync(candidate, 'utf-8');
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const flat = JSON.stringify(parsed);
    if (flat.includes(render) && flat.includes(source)) {
      return candidate;
    }
  }
  return null;
}

// Yield every .json file under `dir`, recursively. The registry sidecar is a JSON
// file under the app's XDG-state pandoc-preview dir.
function* walkJson(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walkJson(full);
    } else if (st.isFile() && name.endsWith('.json')) {
      yield full;
    }
  }
}

test('the vector-figure-inclusion action writes the external SVG into the configured figures dir, references that exact file at the cursor, and registers it in the dual-asset registry', async ({
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

  // The external-editor-produced vector asset staged OUTSIDE the figures dir by
  // provisioning (under the hermetic project, where an Ipe/Inkscape source file
  // lives). Confirm it exists, is non-empty, and carries its distinctive marker, so
  // "the configured-dir copy is byte-identical to THIS source" is a real distinction
  // between two real files — not an artifact of one being absent.
  const externalSource = join(manifest.project, 'external-figure.svg');
  if (!existsSync(externalSource)) {
    throw new Error(`provisioning did not stage the external vector asset at ${externalSource}`);
  }
  const sourceBytes = readFileSync(externalSource);
  expect(sourceBytes.length).toBeGreaterThan(0);
  expect(sourceBytes.toString('utf-8')).toContain(SOURCE_MARKER);
  // The source is staged OUTSIDE the configured figures dir — the inclusion must
  // COPY it IN, which is the decisive on-disk move (B) observes.
  expect(externalSource.startsWith(figuresDir)).toBe(false);

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // (A) Baseline: the configured figures dir holds a known set of files. demo.md
  // ships ONE pre-existing project-local image reference (`fig/plot.png`, NOT under
  // the configured figures dir); the file + reference proven below are keyed by the
  // UNIQUE on-disk filename the inclusion produces, so they are NEWLY produced by
  // the inclusion, not this pre-existing one.
  const filesBefore = listFiles(figuresDir);

  // Invoke the insertion bar's vector-figure-inclusion action on the external
  // asset. RED today: __PPE_E2E__.registerAndInsertVectorFigure does not exist —
  // there is no vector-figure-inclusion control, no clipboard.rs vector-asset write
  // command, and no registry-on-insert wiring — so this evaluate throws.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.registerAndInsertVectorFigure(${JSON.stringify(externalSource)}); return null; })()`,
  );

  // The inclusion is async (file write + buffer edit + registry write). Await the
  // observable end state: a markdown image reference present in the buffer.
  await tauriPage.waitForFunction(
    `/!\\[[^\\]]*\\]\\([^)]+\\)/.test(window.__PPE_E2E__.getEditorText())`,
    15_000,
  );

  const after = await editorText(tauriPage);

  // (B) The configured figures directory gained EXACTLY ONE new file (independent
  // before/after listing of the CONFIGURED dir). KILLS the no-op insert (nothing
  // written) and the wrong-location write (a file under a project-local ./figures
  // never appears under the configured global figures dir).
  const filesAfter = listFiles(figuresDir);
  const beforeSet = new Set(filesBefore);
  const newFiles = filesAfter.filter((name) => !beforeSet.has(name));
  expect(newFiles).toHaveLength(1);
  const newFile = newFiles[0];
  const newFilePath = join(figuresDir, newFile);

  // (C) That new file is the REAL external asset: non-empty AND byte-identical to
  // the staged external source (same length, same distinctive marker), read
  // INDEPENDENTLY off disk. KILLS the zero-length / empty persist (a zero-length /
  // placeholder file) and proves the EXTERNAL asset is what was persisted, not an
  // unrelated file.
  const writtenBytes = readFileSync(newFilePath);
  expect(writtenBytes.length).toBeGreaterThan(0);
  expect(writtenBytes.length).toBe(sourceBytes.length);
  expect(writtenBytes.equals(sourceBytes)).toBe(true);
  expect(writtenBytes.toString('utf-8')).toContain(SOURCE_MARKER);

  // (D) The buffer gained a markdown image reference `![…](<target>)` whose target
  // NAMES that EXACT newly-written file under the configured figures dir. Enumerate
  // ALL image references in the buffer (demo.md's pre-existing `fig/plot.png` is one
  // of them) and require that exactly one of them points at the new figures file by
  // basename. KILLS the no-op insert (no reference names the new file), the dangling
  // reference (the named target does not exist on disk), and the wrong-location
  // reference (a ./figures-relative or project-local target rather than the
  // configured global figures file).
  const targets = [...after.matchAll(IMG_REF_RE)].map((m) => m[1]);
  const refsToNewFile = targets.filter((t) => (t.split('/').pop() ?? t) === newFile);
  expect(refsToNewFile).toHaveLength(1);
  const target = refsToNewFile[0];

  // The reference's target, resolved the way an independent reader would (an
  // absolute target as-is; a bare/relative target under the configured figures
  // dir), must be the file proven real in (C) — it must exist on disk (kills
  // dangling) and be byte-identical to the configured-dir file the diff found.
  const resolved = target.startsWith('/')
    ? target
    : join(figuresDir, target.split('/').pop() ?? target);
  expect(statSync(resolved).isFile()).toBe(true);
  expect(readFileSync(resolved).equals(writtenBytes)).toBe(true);

  // (E) The inserted render is REGISTERED in the D-7 / P96 dual-asset registry
  // sidecar — the host-FS XDG-state JSON p106 reads — pairing the written render
  // (under the configured figures dir) with its editable source (the external
  // asset). Discover the sidecar under the app's hermetic XDG_STATE_HOME (the spec
  // does NOT hardcode the sidecar filename — any JSON under the app's state dir
  // whose parsed content pairs THIS render with THIS source), read INDEPENDENTLY.
  // KILLS the unregistered insert (the included figure has no tracked editable
  // source and cannot be re-opened in its source tool via P96's edit action).
  const stateDir = join(manifest.xdgStateHome, 'pandoc-preview');
  const sidecar = findRegistrySidecar(stateDir, newFilePath, externalSource);
  if (sidecar === null) {
    throw new Error(
      `no host-FS registry sidecar under ${stateDir} pairs the written render ` +
        `${newFilePath} with its editable source ${externalSource}. The inserted ` +
        `vector asset was not registered in the dual-asset registry, so the included ` +
        `figure has no tracked editable source and cannot be re-opened in its source ` +
        `tool via P96's edit action.`,
    );
  }

  recordObservation({ spec: manifest.spec, name: 'p107-figures-dir', value: figuresDir });
  recordObservation({ spec: manifest.spec, name: 'p107-written-file', value: newFile });
  recordObservation({ spec: manifest.spec, name: 'p107-written-bytes', value: writtenBytes.length });
  recordObservation({ spec: manifest.spec, name: 'p107-image-ref-target', value: target });
  recordObservation({ spec: manifest.spec, name: 'p107-registry-sidecar', value: sidecar });
});
