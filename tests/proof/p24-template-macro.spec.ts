import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, previewQuery, waitForPreview } from './support/app';

// E1 (p24) — the pandoc renderer renders through the vendored preview template,
// whose baked MathJax config defines the tier-1 macros (render-rebuild-plan.md,
// Milestone E). A witness using \RR (a tier-1 macro = \mathbf{R}) typesets offline
// WITHOUT a MathJax error, proving the template (and its macros) is in the render
// pipeline. Appended to the buffer so the shared demo/byte-fidelity specs are not
// perturbed.
//
// RED today: the command uses pandoc's default html5 template + bare --mathjax,
// which carries NO macros, so \RR is an undefined control sequence and MathJax
// renders an error (mjx-merror).

test('a tier-1 macro typesets via the template macros (no MathJax error)', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(
    tauriPage,
    `return d.querySelector('span.math mjx-container') !== null;`,
  );

  // Append a macro-using formula and wait for the second math container to typeset.
  await appendAtEnd(tauriPage, '\n\nMacro witness: $\\RR$\n');
  await waitForPreview(
    tauriPage,
    `return d.querySelectorAll('span.math mjx-container').length >= 2;`,
  );

  // The macro is DEFINED by the template (\RR := \mathbf{R}); MathJax expands it,
  // so the LAST math container's assistive MathML flattens to "R". Without the
  // template's macros, \RR is undefined and expands to something else.
  const mmlRaw = await previewQuery(
    tauriPage,
    `const c = d.querySelectorAll('span.math mjx-container mjx-assistive-mml');
     return c.length >= 2 ? (c[c.length - 1].textContent ?? null) : null;`,
  );
  expect(typeof mmlRaw).toBe('string');
  const mml = (mmlRaw as string).replace(/[\s⁡-⁤]/g, '');
  expect(mml).toBe('R');

  recordObservation({ spec: manifest.spec, name: 'macro-mml', value: mml });
});
