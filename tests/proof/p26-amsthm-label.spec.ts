import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, previewQuery, waitForPreview } from './support/app';

// p26 — An amsthm-style environment renders with its label. convert_amsthm_envs.lua
// turns `:::{.remark}` into `<div class="remark proofenv">` for HTML; the visible
// "Remark." label is supplied by the preview template's CSS
// (`.remark::before { content: "Remark." }`, as in the reference pandoc-config
// templates/css/math-environments.css). The greenfield2 template ships none of that
// CSS, so the environment renders as an unlabelled, unstyled block — ":::{.remark}
// Something" does not become "Remark. Something".
//
// RED today: the rendered `.remark` element has no ::before label content
// (computed content is "none"), because the template carries no proofenv CSS.

const WITNESS = `\n\n:::{.remark}\nThe form is even.\n:::\n`;

test('a .remark environment renders a visible "Remark." label', async ({ tauriPage }) => {
  const manifest = loadRunManifest();
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  await appendAtEnd(tauriPage, WITNESS);

  // The div.remark itself renders today (the filter runs) — wait on it so the
  // assertion is about the label, not about the edit arriving.
  await waitForPreview(tauriPage, `return d.querySelector('div.remark') !== null;`);

  const label = await previewQuery(
    tauriPage,
    `const el = d.querySelector('div.remark');
     return el ? d.defaultView.getComputedStyle(el, '::before').getPropertyValue('content') : null;`,
  );
  // CSS string content serialises with quotes, e.g. '"Remark."'.
  expect(typeof label).toBe('string');
  expect(label).toContain('Remark.');

  recordObservation({ spec: manifest.spec, name: 'remark-label-content', value: String(label) });
});
