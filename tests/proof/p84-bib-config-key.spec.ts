import { test, expect } from './fixtures';
import { execFileSync } from 'node:child_process';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, previewQuery, waitForPreview } from './support/app';

// p84 — The bibliography the app cites against is ONE config-declared source
// the FRONTEND can read, and that one value is the file the preview actually
// resolves @-citations from (P84/C1: "bibliography as a single config-declared
// source for both the frontend and the preview").
//
// The proof must establish, frontend-side, WHICH file governs the app's
// citations — and cross-check that the same file is the one the live preview
// resolves references from. The cross-check uses a fixture bibliography
// carrying a UNIQUE entry the default global references.bib does NOT contain
// (key C1ONLY, authors Zariski/Voronoi, the title below). Provisioning copies
// tests/proof/fixtures/p84-bib.bib over the bibliography the renderer resolves,
// so the preview's #refs for [@C1ONLY] can only come from a bibliography that
// contains C1ONLY.
//
// Observable behaviour proved here:
//   (1) the live preview resolves [@C1ONLY] into a #refs entry carrying the
//       unique title — i.e. the preview cites against a bib that has C1ONLY;
//   (2) the running app exposes, frontend-side, the bibliography path it cites
//       against (config.editor.bibliography, surfaced via the harness as
//       __PPE_E2E__.configBibliography(), the sibling of configFontSize); and
//   (3) the file at that frontend-exposed path — read by an INDEPENDENT process
//       off disk — contains the SAME unique key C1ONLY the preview resolved.
//
// (2)+(3) together are the C1 capability: the one config value the frontend can
// read names exactly the file that governs the preview's citations. A
// split-source app (frontend naming a different bib than the preview resolves)
// fails the disk cross-check; an app with no frontend bibliography surface
// (today) cannot answer (2) at all.
//
// RED today: the frontend Config has no editor.bibliography field (src/lib/
// types.ts) and the harness exposes no configBibliography() getter, so the
// bibliography is a literal baked into the renderer command the frontend cannot
// read. The evaluate at step (2) throws — the app cannot tell you, frontend-
// side, which bibliography governs its citations.

const UNIQUE_KEY = 'C1ONLY';
const UNIQUE_TITLE = 'Sole witness entry for the C1 single-source bibliography proof';
const WITNESS = `\n\nThe single configured source governs [@${UNIQUE_KEY}].\n`;

// Read a file off disk in an INDEPENDENT process (never trusting the app's own
// report of its bytes), mirroring support/toml.ts's independent-read discipline.
function readFileIndependently(path: string): string {
  return execFileSync('cat', [path], { encoding: 'utf-8' });
}

test('the configured bibliography is one frontend-readable value that governs the preview', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  await appendAtEnd(tauriPage, WITNESS);

  // (1) The live preview resolves [@C1ONLY] from a bibliography containing it.
  await waitForPreview(
    tauriPage,
    `return d.querySelector('span.citation[data-cites="${UNIQUE_KEY}"]') !== null;`,
  );
  const refsText = await previewQuery(
    tauriPage,
    `return d.querySelector('#refs')?.textContent ?? null;`,
  );
  expect(typeof refsText).toBe('string');
  // The rendered bibliography soft-wraps the title across lines; normalize
  // whitespace before matching so step (1) reflects ONLY whether the unique
  // entry resolved, not the preview's line-wrapping.
  const refsNormalized = (refsText as string).replace(/\s+/g, ' ');
  expect(refsNormalized).toContain(UNIQUE_TITLE);

  // (2) The running app exposes, frontend-side, the bibliography it cites
  // against. RED: __PPE_E2E__.configBibliography does not exist (the frontend
  // Config has no editor.bibliography field) — this evaluate throws.
  const bibPath = await tauriPage.evaluate(
    `(() => { const p = window.__PPE_E2E__.configBibliography(); return p === null || p === undefined ? null : String(p); })()`,
  );
  expect(typeof bibPath).toBe('string');
  expect((bibPath as string).length).toBeGreaterThan(0);

  // (3) The file at the frontend-exposed path — read off disk by an independent
  // process — is the SAME file the preview resolved against: it contains the
  // unique key C1ONLY. A split-source app (frontend names a different bib than
  // the preview uses) fails here.
  const bibBytes = readFileIndependently(bibPath as string);
  expect(bibBytes).toContain(`{${UNIQUE_KEY},`);
  expect(bibBytes).toContain(UNIQUE_TITLE);

  recordObservation({ spec: manifest.spec, name: 'frontend-bibliography-path', value: String(bibPath) });
});
