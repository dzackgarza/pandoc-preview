import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, previewQuery, waitForPreview } from './support/app';

// P4 — Math rendering. Math is ALWAYS MathJax (no config option; KaTeX cannot
// cover pandoc's full math syntax range), so the real pandoc invocation
// passes --mathjax, the preview iframe loads MathJax, and typesetting
// replaces pandoc's span.math wrapper content with mjx-container. The
// assistive MathML must carry exactly the witnessed formula, and the literal
// "$\zeta(2)" must not survive as visible text.

test('mathjax typesets the formula inside pandoc math spans with exact MathML content', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);

  // MathJax typesets client-side after its script loads; wait for the
  // container to appear inside pandoc's own math span (proves the formula
  // went through pandoc's math pathway, not arbitrary page script).
  await waitForPreview(
    tauriPage,
    `return d.querySelector('span.math mjx-container') !== null;`,
  );

  // The assistive MathML flattens \zeta(2) = \pi^2/6 to the exact character
  // sequence ζ(2)=π2/6 (the superscript loses position in textContent).
  // Strip all whitespace before comparing; this still fails on wrong TeX, an
  // unwired engine, or junk — it only neutralizes MathML pretty-printing.
  const mmlRaw = await previewQuery(
    tauriPage,
    `return d.querySelector('span.math mjx-container mjx-assistive-mml')?.textContent ?? null;`,
  );
  expect(typeof mmlRaw).toBe('string');
  const mml = (mmlRaw as string).replace(/\s+/g, '');
  expect(mml).toBe('ζ(2)=π2/6');

  // The raw dollar-delimited source must not appear as visible text.
  const rawPresent = await previewQuery(
    tauriPage,
    `return d.body.textContent.includes('$\\\\zeta(2)');`,
  );
  expect(rawPresent).toBe(false);

  recordObservation({ spec: manifest.spec, name: 'assistive-mml', value: String(mml) });
});
