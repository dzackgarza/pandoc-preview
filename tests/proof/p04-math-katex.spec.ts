import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, previewQuery, waitForPreview } from './support/app';

const TEX = '\\zeta(2) = \\pi^2/6';

// P4 — Math via the configured engine. Config has math = "katex", so the
// real pandoc invocation passes --katex and the preview iframe runs KaTeX,
// producing span.katex with a TeX annotation exactly equal to the source.
// The literal "$\zeta(2)" must not survive as visible text.

test('katex engine renders span.katex with the exact TeX annotation', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);

  // KaTeX renders client-side after the script loads; wait for span.katex.
  await waitForPreview(
    tauriPage,
    `return d.querySelector('span.katex') !== null;`,
  );

  // KaTeX reconstructs the annotation from its parse tree and emits a newline
  // where the source had an inter-token space; collapse whitespace RUNS to a
  // single space to compare the exact TeX tokens. This still fails on wrong
  // TeX, an unwired engine, or junk — it only neutralizes KaTeX's internal
  // whitespace normalization, not the discriminating content.
  const annotationRaw = await previewQuery(
    tauriPage,
    `return d.querySelector('span.katex annotation[encoding="application/x-tex"]')?.textContent ?? null;`,
  );
  expect(typeof annotationRaw).toBe('string');
  const annotation = (annotationRaw as string).trim().replace(/\s+/g, ' ');
  expect(annotation).toBe(TEX);

  // The raw dollar-delimited source must not appear as visible text.
  const rawPresent = await previewQuery(
    tauriPage,
    `return d.body.textContent.includes('$\\\\zeta(2)');`,
  );
  expect(rawPresent).toBe(false);

  recordObservation({ spec: manifest.spec, name: 'tex-annotation', value: String(annotation) });
});
