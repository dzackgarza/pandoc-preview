import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  runPluginById,
  pluginResult,
  waitForPreview,
  sleep,
} from './support/app';

// P109 (Phase F / F3) — MULTI-PASS (latexmk) REFERENCE RESOLUTION: the configured
// PDF compile command is the vendored latexmk multi-pass driver (pandoc
// md->latex, then `latexmk -lualatex -output-directory={builddir}` over the
// emitted .tex). The REAL /usr/bin/latexmk binary runs exactly-as-many-passes-as-
// needed and auto-invokes BibTeX by its OWN default behaviour — the app/plugin
// orchestrates NO passes itself; the deliverable is the configured driver command
// + a [[doctor_checks]] that latexmk resolves, not a bespoke pass loop.
//
// THE FIXTURE (tests/proof/fixtures/p118-multipass.md, provisioned as the spec's
// source by scripts/provision-proof.sh) is engineered so a SINGLE LaTeX pass
// leaves BOTH references unresolved:
//   (a) a \cite{DM19} against the config-declared bibliography
//       ($HOME/.pandoc/bib/references.bib, the fixture references.bib that
//       carries the DM19 entry — Dolgachev & Mumford, 2019); the raw-LaTeX
//       \bibliography{references} requires BibTeX to build the .bbl, which a
//       single lualatex pass never invokes -> the citation renders [?] (no
//       author/year, no bibliography list);
//   (b) a FORWARD cross-reference \eqref{eq:later} to a numbered equation whose
//       \label{eq:later} appears strictly LATER in the document; a single pass
//       cannot know the equation's number (its .aux entry does not exist yet) ->
//       the reference renders (??).
// Equation numbering (not section numbering) is used deliberately: pandoc's
// standalone latex sets secnumdepth = -maxdimen (sections are UNnumbered), so a
// numbered equation is the robust forward-reference target whose resolved value
// is a real number.
//
// WHAT THIS SPEC PROVES (P109 observable clauses, nothing about wiring):
//   An INDEPENDENT process (pdftotext) reads the produced PDF off disk and
//   recovers, in the extracted text, BOTH:
//     - the CITATION RENDERED to its bibliography entry — the author surname
//       "Dolgachev" AND a real numeric citation marker "[1]" appear, and the
//       unresolved-citation marker "[?]" does NOT survive. Rendering the citation
//       PROVES BibTeX ran (latexmk auto-invoked it from its .aux);
//     - the forward cross-reference RESOLVED to a real number — the extracted text
//       shows "equation (1)" and the unresolved-reference marker "(??)" does NOT
//       survive. A resolved forward reference PROVES more than one LaTeX pass ran
//       (the .aux from pass N fed pass N+1).
//
// The produced PDF is read off disk by an INDEPENDENT process (pdftotext), wholly
// outside the app's own report (P109: not satisfied by an existence check on a
// latexmk plugin / an -output-directory/multi-pass symbol, nor by a doctor check
// that latexmk resolves alone — those would pass while proving NOTHING about
// multi-pass + BibTeX). The proof compiles the single-pass-unresolvable fixture
// and observes the citation rendered to author/year and the cross-reference
// resolved to a real number.
//
// ADMISSIBLE because it FAILS on a plausibly broken app:
//   - a SINGLE-PASS command (the configured PDF driver runs ONE lualatex pass and
//     never re-runs): the cross-reference stays (??) AND/OR the citation stays the
//     unresolved [?] marker — one pass cannot resolve a forward reference;
//   - a driver that NEVER invokes BibTeX: the citation stays UNRENDERED — no
//     author/year, the [?] marker survives — because the .bbl was never built.
//
// RED today: scripts/provision-proof.sh provisions the obligation's named PDF
// driver id (latexmk-pdf-export, the id this spec drives) with a DELIBERATELY
// single-pass export.sh override (tests/proof/fixtures/p118-single-pass-export.sh:
// pandoc md->latex then ONE lualatex pass, no latexmk, no BibTeX). So the produced
// PDF carries (??) for the forward equation reference and [?] for the unrendered
// citation, and the assertions below fail on those surviving unresolved markers.
// The GREEN deliverable ships the real multi-pass latexmk driver as the configured
// command (the override is removed), and latexmk's own as-many-passes-as-needed +
// auto-BibTeX resolves BOTH. The app BOOTS cleanly (the canonical config + the
// schema-valid [plugin.latexmk-pdf-export] section is provisioned) and the HTML
// preview renders FIRST below, so the failure is the unresolved references, NOT a
// boot/open/render error.

// The bibliography entry's author surname (references.bib DM19 = Dolgachev &
// Mumford). It appears in the rendered PDF ONLY if BibTeX built the .bbl and a
// subsequent lualatex pass typeset the bibliography — i.e. the multi-pass driver
// ran. A single pass never builds the .bbl, so this surname is absent.
const CITATION_AUTHOR = 'Dolgachev';
// The resolved numeric citation marker [1] (the first/only bibliography entry).
// A single pass renders the unresolved [?] instead.
const CITATION_RESOLVED = '[1]';
// The unresolved-citation marker a single pass (no BibTeX) leaves in place.
const CITATION_UNRESOLVED = '[?]';
// The resolved forward equation cross-reference: equation (1). A single pass
// cannot number the later equation when it typesets the earlier \eqref.
const REF_RESOLVED = 'equation (1)';
// The unresolved-reference marker a single pass leaves for the forward \eqref.
const REF_UNRESOLVED = '(??)';

test('the configured multi-pass latexmk driver resolves the citation and forward cross-reference', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // Bring the app + project + HTML preview up FIRST, so a RED failure below is
  // demonstrably the unresolved references, not a boot/open/render error: the app
  // booted, the project opened, the multipass source (provisioned as demo.md) is
  // selected, and the existing HTML preview rendered (its <h1> "Multi-pass
  // references" is present). The provisioning for this spec overwrites demo.md with
  // the multipass fixture, so the proven openAndSelectDemo selection path applies.
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // The user-chosen one-shot export {output}: placed at the run dir.
  const output = join(manifest.runDir, 'multipass.pdf');
  expect(existsSync(output)).toBe(false);

  // Fire the real one-shot export by running the obligation's named PDF driver by
  // id through the generic firewall (P8/P108 idiom): discover -> spawn the
  // plugin's command with the real source + the app-supplied {builddir}, build the
  // PDF, write {output}. Then poll for the artifact AND the structured
  // PluginResult. A multi-pass compile is heavy (pandoc + multiple lualatex passes
  // + BibTeX on a cold luaotfload cache), so the poll window is generous.
  await runPluginById(tauriPage, 'latexmk-pdf-export', output);

  let result = await pluginResult(tauriPage);
  for (let i = 0; i < 480 && (!existsSync(output) || result === null); i++) {
    await sleep(500);
    result = await pluginResult(tauriPage);
  }
  if (!existsSync(output)) {
    throw new Error(
      `Multi-pass export artifact never appeared at ${output} (result: ${JSON.stringify(result)}). ` +
        `The latexmk-pdf-export driver did not produce the PDF — the failure must be the ` +
        `unresolved references, not a missing artifact.`,
    );
  }

  // Valid PDF: magic header + pdfinfo parses it (independent processes).
  const head = readFileSync(output).subarray(0, 5).toString('latin1');
  expect(head).toBe('%PDF-');
  const info = execFileSync('pdfinfo', [output], { encoding: 'utf-8' });
  const pagesMatch = info.match(/Pages:\s+(\d+)/);
  expect(pagesMatch).not.toBeNull();
  expect(Number((pagesMatch as RegExpMatchArray)[1])).toBeGreaterThanOrEqual(1);

  // Extracted text (independent process) — the decisive proof.
  const textOut = execFileSync('pdftotext', [output, '-'], { encoding: 'utf-8' });

  recordObservation({
    spec: manifest.spec,
    name: 'pdf-text',
    value: textOut.replace(/\s+/g, ' ').trim().slice(0, 400),
  });

  // ── Citation clause: rendered to its bibliography entry, NOT [?] ────────────
  // RED today: the single-pass driver never invokes BibTeX, so the .bbl is never
  // built, the bibliography is never typeset, and the citation stays [?].
  expect(textOut.includes(CITATION_AUTHOR)).toBe(true);
  expect(textOut.includes(CITATION_RESOLVED)).toBe(true);
  expect(textOut.includes(CITATION_UNRESOLVED)).toBe(false);

  // ── Cross-reference clause: forward \eqref resolved to a real number, NOT ?? ─
  // RED today: a single pass cannot number the later equation when it typesets the
  // earlier \eqref, so the reference stays (??).
  expect(textOut.includes(REF_RESOLVED)).toBe(true);
  expect(textOut.includes(REF_UNRESOLVED)).toBe(false);
});
