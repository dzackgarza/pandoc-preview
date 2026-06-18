import { test, expect } from './fixtures';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openProject,
  clickSidebarEntry,
  currentFile,
  appendAtEnd,
  typeInEditor,
  completionLabels,
  editorText,
} from './support/app';

// ── P88 — Per-file `bibliography:` frontmatter override ──────────────────────
//
// THE OBLIGATION (proof-obligations.md, exact wording):
//   A document whose YAML frontmatter declares a `bibliography:` pointing at a
//   sibling `.bib` file that contains a cite key ABSENT from the global config
//   bibliography governs that document's citations: with that document open,
//   citation completion offers the file-local key — the key that exists only in
//   the frontmatter-declared bibliography — proving the per-file override is in
//   effect for the open document. A document WITHOUT the frontmatter
//   `bibliography:` key still offers the global config bibliography's keys,
//   proving the global config bibliography remains the source for documents that
//   do not override it, not a hole left behind by the override mechanism. […]
//   The `bibliography:` key is pandoc's own native per-file metadata key,
//   consumed as authored.
//
// ── THE TWO CONFIG-OWNED SOURCES (what the candidates come from) ─────────────
// This run (scripts/provision-proof.sh, the p88 case) provisions TWO distinct,
// non-overlapping bibliographies:
//
//   GLOBAL (editor.bibliography, the P84/C1 single config-declared source) is
//     pointed at the p88 GLOBAL fixture — one entry, key GLOBALKEY, title word
//     "Globally", authors Hilbert/Noether. It does NOT contain LOCALONLY.
//
//   LOCAL is a sibling `.bib` in the project, key LOCALONLY, title word
//     "Paperlocal", authors Poincare/Lefschetz. It does NOT contain GLOBALKEY.
//
// The provisioned markdown file `p88-override.md` declares, in its YAML
// frontmatter, `bibliography: ./p88-local.bib` (pandoc's native per-file key,
// resolved relative to the file's directory). demo.md declares NO frontmatter
// `bibliography:`.
//
// ── THE OBSERVABLE CONTRACT (driven through the EDITOR UI, parser-agnostic) ───
// This spec is BLIND to how the .bib is parsed or how the override is resolved.
// It drives only the editor UI and asserts on the REAL rendered CM6 autocomplete
// DOM, the SAME surface every completion proof (P51/P52/P85/P87) asserts against:
//
//   openProject + clickSidebarEntry — open a specific project file through the
//     real sidebar (the SAME path a user clicking a file fires).
//   typeInEditor(text)   — inserts `text` at the cursor through the real
//     docChanged pipeline and opens completion (CM6 startCompletion).
//   completionLabels()   — the option labels in the open `.cm-tooltip-
//     autocomplete` popup. An option is "offered" iff its label text is present
//     in the open tooltip.
//   getEditorText()      — the live editor buffer text.
//
// Each entry's discriminator is a TITLE word ("paperlocal" / "globally") absent
// from its own cite key AND from the OTHER bibliography, verified independently
// off disk below. A candidate surfaced for that title word can only have come
// from the bibliography that actually holds the entry.
//
// ── WHAT EACH LEG KILLS ───────────────────────────────────────────────────────
//   LEG (a) — override in effect: with p88-override.md open, typing `@paperlocal`
//     offers LOCALONLY, the key present ONLY in the frontmatter-declared
//     bibliography (and ideally `@globally` does NOT offer GLOBALKEY, the global
//     key the override displaces).
//     KILLS an app that IGNORES the frontmatter `bibliography:` key: with only
//     the global source consulted, LOCALONLY (present in NO global bibliography)
//     is never offered — the override has no effect.
//   LEG (b) — global fallback intact: with demo.md (no frontmatter bib) open,
//     typing `@globally` offers GLOBALKEY, the global config bibliography's key.
//     KILLS an override mechanism that drops the global bibliography for files
//     without the key (GLOBALKEY would vanish, leaving a hole).
//
// ── WHY THE APP IS RED TODAY ─────────────────────────────────────────────────
// The C2 citation source consults the SINGLE config-declared bibliography
// (editor.bibliography) regardless of the open file's frontmatter. With
// p88-override.md open, the frontmatter `bibliography: ./p88-local.bib` is
// ignored, so LOCALONLY — present only in that local bibliography — is never
// offered; only the global bibliography's GLOBALKEY is consulted. Leg (a)'s
// LOCALONLY assertion therefore fails behaviorally: the per-file override source
// does not exist.

const GLOBAL_KEY = 'GLOBALKEY';
const LOCAL_KEY = 'LOCALONLY';
// TITLE words — each unique to one bibliography, absent from its own cite key and
// from the other bibliography — forcing a metadata match against the right file.
const GLOBAL_TITLE_QUERY = 'globally';
const LOCAL_TITLE_QUERY = 'paperlocal';

// Read a file off disk in an INDEPENDENT process (never trusting the app's own
// report of its bytes), mirroring p85/p86/p87 independent-read discipline.
function readFileIndependently(path: string): string {
  return execFileSync('cat', [path], { encoding: 'utf-8' });
}

test('a frontmatter `bibliography:` override file offers its file-local key while a file without the key still offers the global config bibliography key', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // ── Independent off-disk discriminators ────────────────────────────────────
  // The GLOBAL config bibliography (editor.bibliography, surfaced to the frontend
  // exactly as p85/p86 read it) holds GLOBALKEY and its title word, and does NOT
  // hold LOCALONLY nor its title word.
  await openProject(tauriPage, manifest.project);
  const globalBibPath = await tauriPage.evaluate(
    `(() => { const p = window.__PPE_E2E__.configBibliography(); return p === null || p === undefined ? null : String(p); })()`,
  );
  expect(typeof globalBibPath).toBe('string');
  const globalBib = readFileIndependently(globalBibPath as string);
  expect(globalBib).toContain(`{${GLOBAL_KEY},`);
  expect(globalBib.toLowerCase()).toContain(GLOBAL_TITLE_QUERY.toLowerCase());
  expect(globalBib).not.toContain(LOCAL_KEY);
  expect(globalBib.toLowerCase()).not.toContain(LOCAL_TITLE_QUERY.toLowerCase());

  // The LOCAL sibling bibliography (the frontmatter override target) holds
  // LOCALONLY and its title word, and does NOT hold GLOBALKEY.
  const localBibPath = join(manifest.project, 'p88-local.bib');
  const localBib = readFileIndependently(localBibPath);
  expect(localBib).toContain(`{${LOCAL_KEY},`);
  expect(localBib.toLowerCase()).toContain(LOCAL_TITLE_QUERY.toLowerCase());
  expect(localBib).not.toContain(GLOBAL_KEY);

  // The override file declares the per-file `bibliography:` in its YAML
  // frontmatter, pointing at the sibling LOCAL bibliography; demo.md does not.
  const overridePath = join(manifest.project, 'p88-override.md');
  const overrideBytes = readFileIndependently(overridePath);
  expect(overrideBytes).toMatch(/^\s*bibliography:\s*\.\/p88-local\.bib\s*$/m);
  const demoBytes = readFileIndependently(join(manifest.project, 'demo.md'));
  expect(/^\s*bibliography:/m.test(demoBytes)).toBe(false);

  // The cite keys never contain the discriminator title words, so a candidate
  // surfaced for a title word had to be matched on the metadata of the entry in
  // the bibliography that actually holds it.
  expect(LOCAL_KEY.toLowerCase().includes(LOCAL_TITLE_QUERY.toLowerCase())).toBe(false);
  expect(GLOBAL_KEY.toLowerCase().includes(GLOBAL_TITLE_QUERY.toLowerCase())).toBe(false);

  // ── LEG (a): the override is in effect for the frontmatter file ─────────────
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('.grow.overflow-auto.p-1 button span:last-child')).some((s) => s.textContent.trim() === 'p88-override.md')`,
    15_000,
  );
  await clickSidebarEntry(tauriPage, 'p88-override.md');
  await tauriPage.waitForFunction(
    `(window.__PPE_E2E__.currentFile() ?? '').endsWith('/p88-override.md')`,
    15_000,
  );
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );
  const openOverride = await currentFile(tauriPage);
  expect(openOverride.endsWith('/p88-override.md')).toBe(true);

  // The buffer before: neither key is present as prose.
  const beforeOverride = await editorText(tauriPage);
  expect(beforeOverride.includes(LOCAL_KEY)).toBe(false);

  // LIVENESS GUARD — prove the completion machinery is ALIVE in THIS exact buffer
  // and run, so the RED below cannot be misread as "completion is dead / the popup
  // never opens." Typing a backslash-command fragment opens the standard popup and
  // offers a LaTeX command (\alpha), exactly as P51 asserts. This pins the
  // subsequent failure to the MISSING per-file override source, not broken wiring.
  await appendAtEnd(tauriPage, '\n\n');
  await typeInEditor(tauriPage, '\\al');
  await tauriPage.waitForFunction(
    `(() => {
      const tip = document.querySelector('.cm-tooltip-autocomplete');
      if (!tip) return false;
      return Array.from(tip.querySelectorAll('.cm-completionLabel'))
        .some((el) => (el.textContent || '') === '\\\\alpha');
    })()`,
    10_000,
  );
  // Clear the liveness probe so it cannot leak into the citation query.
  await appendAtEnd(tauriPage, '\n\n');

  // The hard RED: with the override file open, typing the @-trigger + the LOCAL
  // bibliography's title word must offer LOCALONLY — the key present ONLY in the
  // frontmatter-declared bibliography. RED today: the citation source consults the
  // global config bibliography (which has no LOCALONLY) regardless of frontmatter,
  // so LOCALONLY is never offered and this waitForFunction times out.
  await typeInEditor(tauriPage, `@${LOCAL_TITLE_QUERY}`);
  await tauriPage.waitForFunction(
    `(() => {
      const tip = document.querySelector('.cm-tooltip-autocomplete');
      if (!tip) return false;
      return Array.from(tip.querySelectorAll('.cm-completionLabel'))
        .some((el) => (el.textContent || '').includes(${JSON.stringify(LOCAL_KEY)}));
    })()`,
    10_000,
  );
  const overrideLabels = await completionLabels(tauriPage);
  expect(overrideLabels.some((l) => l.includes(LOCAL_KEY))).toBe(true);

  // IDEAL second assertion (override DISPLACES the global source): with the
  // override file open, the global bibliography's title word must NOT surface
  // GLOBALKEY — the override supplies the entries INSTEAD of the global bib.
  await appendAtEnd(tauriPage, '\n\n');
  await typeInEditor(tauriPage, `@${GLOBAL_TITLE_QUERY}`);
  // Settle deterministically on the typed query landing in the buffer (the
  // observable effect of typeInEditor), then read the popup labels. Against the
  // override (local-only) source, the global bibliography's title word yields no
  // GLOBALKEY candidate; on a broken app that ignores the override and keeps the
  // global source, GLOBALKEY WOULD surface here — so its absence is meaningful.
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify('@' + GLOBAL_TITLE_QUERY)})`,
    10_000,
  );
  const overrideGlobalLabels = await completionLabels(tauriPage);
  expect(overrideGlobalLabels.some((l) => l.includes(GLOBAL_KEY))).toBe(false);

  // ── LEG (b): the global config bibliography is the source for non-overriding
  // files ─────────────────────────────────────────────────────────────────────
  await clickSidebarEntry(tauriPage, 'demo.md');
  await tauriPage.waitForFunction(
    `(window.__PPE_E2E__.currentFile() ?? '').endsWith('/demo.md')`,
    15_000,
  );
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );
  const openDemo = await currentFile(tauriPage);
  expect(openDemo.endsWith('/demo.md')).toBe(true);

  // With demo.md (no frontmatter `bibliography:`) open, typing the @-trigger + the
  // GLOBAL bibliography's title word must offer GLOBALKEY — proving the global
  // config bibliography remains the source for files that do not override it.
  await appendAtEnd(tauriPage, '\n\n');
  await typeInEditor(tauriPage, `@${GLOBAL_TITLE_QUERY}`);
  await tauriPage.waitForFunction(
    `(() => {
      const tip = document.querySelector('.cm-tooltip-autocomplete');
      if (!tip) return false;
      return Array.from(tip.querySelectorAll('.cm-completionLabel'))
        .some((el) => (el.textContent || '').includes(${JSON.stringify(GLOBAL_KEY)}));
    })()`,
    10_000,
  );
  const demoLabels = await completionLabels(tauriPage);
  expect(demoLabels.some((l) => l.includes(GLOBAL_KEY))).toBe(true);

  recordObservation({ spec: manifest.spec, name: 'perfile-bib-local-key', value: LOCAL_KEY });
  recordObservation({ spec: manifest.spec, name: 'perfile-bib-global-key', value: GLOBAL_KEY });
});
