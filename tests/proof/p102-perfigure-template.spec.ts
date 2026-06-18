import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, previewQuery, waitForPreview } from './support/app';

// P92 (Phase D / D-3) — the per-figure PREAMBLE TEMPLATE that wraps a tikz
// figure source before compile is CONFIG-SWAPPABLE: a `\usetikzlibrary` present
// ONLY in the config-declared per-figure template makes a figure that REQUIRES
// that library compile and render in the live preview, and swapping the config
// to a template LACKING that library makes the SAME figure FAIL to compile (no
// figure rendered). This rides P100's now-active tikz->SVG compile seam and the
// P91 shared-palette model: the fixed vendored `standalone-tikz.tex` preamble is
// generalized into a config-declared, existing-file-validated template whose
// single `<>` marker (the QTikz `.pgs` TemplateReplaceText convention) is where
// the figure source is substituted.
//
// The witness library is `spy` — the tikz library providing `spy using outlines`
// + `\spy on (...) in node (...)`. It is loaded ONLY by the per-figure template
// this spec provisions, and by NO other preamble the compile would otherwise
// use: the FIXED `standalone-tikz.tex`'s transitive preamble (dzg-tikz ->
// dzg-preamble) loads arrows.meta/cd/calc/matrix/positioning/decorations/
// shapes/backgrounds/fit/intersections/hobby/… plus pgfplots/quiver/tikz-cd/
// dynkin/xy, and `\usepackage{tikzit}` loads backgrounds/arrows/shapes — but
// NONE of them load `spy`. Verified against the real pdflatex+pdf2svg toolchain:
// WITHOUT `\usetikzlibrary{spy}` the compile fails hard (`pgfkeys Error: I do
// not know the key '/tikz/spy using outlines'`); WITH it the figure compiles and
// pdf2svg yields an SVG carrying drawing content. So a `spy`-requiring figure
// rendering in the preview can ONLY come from the compile having wrapped it in
// THIS spy-carrying template.
//
// The DISCRIMINATOR is the second leg: the spec overwrites the active
// [figures].template path on disk with a variant that OMITS `\usetikzlibrary
// {spy}`, re-triggers a render, and asserts the SAME figure NO LONGER renders
// (no compiled figure SVG above the MathJax baseline). This proves the CONFIGURED
// TEMPLATE — not a fixed built-in preamble — governs the compile outcome: a
// fixed-preamble app that ignored the config template would either fail leg 1
// (the figure never compiles) or, if some fixed preamble carried spy, compile
// REGARDLESS in leg 2 and fail the discriminator.
//
// RED today: there is no [figures].template config key (the [figures] table
// declares only tikzstyles/tikzdefs from D-2/P91, and the schema is
// deny_unknown_fields, so declaring the key would be a BOOT failure, not the
// missing-governance behavior this obligation targets). The per-figure templates
// sit on disk, unconsumed; the figure compile uses the FIXED standalone-tikz.tex
// preamble regardless — which lacks `spy`, so the spy-requiring figure NEVER
// compiles to a vector figure. Leg 1 fails: appending the figure produces no NEW
// inline <svg> above the MathJax baseline (the wait times out). The failure is
// the missing template-governance, not a boot error — the config is the canonical
// witness config (the app boots, the preview is alive) and only the
// config-declared per-figure-template `<>`-wrap is absent.

// A real tikzpicture that REQUIRES the `spy` library: it sets the
// `spy using outlines` scope option and issues `\spy on (...) in node (...)`.
// Both are pgfkeys/macros that exist ONLY when `\usetikzlibrary{spy}` is loaded,
// so this figure compiles iff the template wrapping it carries that library.
const SPY_TIKZ_BLOCK = [
  '',
  '',
  '```{=latex}',
  '\\begin{tikzpicture}[spy using outlines={circle, magnification=3, size=1cm, connect spies}]',
  '  \\draw (0,0) rectangle (2,2);',
  '  \\draw (1,1) circle (0.3);',
  '  \\spy on (1,1) in node at (4,1);',
  '\\end{tikzpicture}',
  '```',
  '',
].join('\n');

// The per-figure template fixtures this spec's provisioning placed in the
// hermetic global figures dir. `perfigure-spy.tikztemplate` is the active
// template (loads `\usetikzlibrary{spy}`); `perfigure-nospy.tikztemplate` is the
// discriminator variant (omits it) the spec swaps onto the active path for leg 2.
const FIGURES_REL = 'home/.pandoc/figures';
const SPY_TEMPLATE = 'perfigure-spy.tikztemplate';
const NOSPY_TEMPLATE = 'perfigure-nospy.tikztemplate';

test('a \\usetikzlibrary present only in the config-declared per-figure template makes the figure compile, and swapping to a template lacking it makes the same figure fail to compile', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();
  const figuresDir = join(manifest.runDir, FIGURES_REL);
  const spyTemplatePath = join(figuresDir, SPY_TEMPLATE);
  const nospyTemplatePath = join(figuresDir, NOSPY_TEMPLATE);

  // The per-figure templates were provisioned to disk before launch — the proof
  // asserts CONSUMPTION (the figure compiles only under the spy-carrying
  // template), never their existence, but a missing fixture is a broken proof
  // environment, so fail loud here.
  if (!existsSync(spyTemplatePath)) {
    throw new Error(`per-figure spy template fixture missing at ${spyTemplatePath}`);
  }
  if (!existsSync(nospyTemplatePath)) {
    throw new Error(`per-figure no-spy template variant missing at ${nospyTemplatePath}`);
  }

  // App + preview must be alive first, so a later failure is the missing
  // per-figure-template governance, not a boot/setup error.
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Baseline SVG count: the witness preview already has SVGs (MathJax renders
  // the demo's inline math as SVG). The appended spy figure is the ONLY new
  // source of a vector figure, so a count RISING above this baseline can only
  // come from the spy figure having compiled — which requires the spy-carrying
  // template to have wrapped it.
  const svgCountBefore = (await previewQuery(
    tauriPage,
    `return d.querySelectorAll('svg').length;`,
  )) as number;

  // Append the spy-requiring figure through the real editor update pipeline
  // (docChanged -> scheduleRender(debounce) -> real pandoc -> figure compile).
  await appendAtEnd(tauriPage, SPY_TIKZ_BLOCK);

  // Leg 1 — a NEW inline <svg> (the compiled spy figure) must appear above the
  // MathJax baseline. RED today: the config-declared per-figure template is not
  // consumed; the fixed standalone-tikz.tex preamble (which lacks `spy`) is used
  // regardless, so the spy figure FAILS to compile and no new SVG is produced —
  // this wait times out at the baseline count.
  await waitForPreview(
    tauriPage,
    `return d.querySelectorAll('svg').length > ${svgCountBefore};`,
  );

  const svgCountWithSpy = (await previewQuery(
    tauriPage,
    `return d.querySelectorAll('svg').length;`,
  )) as number;
  expect(svgCountWithSpy).toBeGreaterThan(svgCountBefore);

  // The newly-rendered figure is a real vector figure carrying actual drawing
  // content (path/line/polyline/text/g/rect), not an empty placeholder — the spy
  // figure genuinely compiled.
  const lastSvgHasGraphics = await previewQuery(
    tauriPage,
    `const all = d.querySelectorAll('svg'); const s = all[all.length - 1]; return !!s && s.querySelector('path, line, g, text, polyline, rect') !== null;`,
  );
  expect(lastSvgHasGraphics).toBe(true);

  recordObservation({
    spec: manifest.spec,
    name: 'perfigure-template-spy-svg-count',
    value: String(svgCountWithSpy),
  });

  // Leg 2 (DISCRIMINATOR) — overwrite the ACTIVE per-figure template on disk with
  // the variant that OMITS `\usetikzlibrary{spy}`, then re-trigger a render. If
  // (and only if) the compile is governed by the configured template, the SAME
  // spy-requiring figure must now FAIL to compile: the new figure SVG disappears
  // and the count falls back to the MathJax baseline. A fixed-preamble app that
  // ignored the config template would keep rendering the figure here.
  copyFileSync(nospyTemplatePath, spyTemplatePath);

  // Re-trigger the render pipeline with a fresh no-op marker (a blank line +
  // comment), which fires docChanged -> re-render -> a fresh figure compile that
  // re-reads the (now spy-less) per-figure template.
  await appendAtEnd(tauriPage, '\n\n<!-- p102 rerender -->\n');

  // The render now reflects the swapped template: the spy figure no longer
  // compiles, so the compiled-figure SVG is gone and the count returns to the
  // pre-figure MathJax baseline.
  await waitForPreview(
    tauriPage,
    `return d.querySelectorAll('svg').length <= ${svgCountBefore};`,
  );

  const svgCountWithoutSpy = (await previewQuery(
    tauriPage,
    `return d.querySelectorAll('svg').length;`,
  )) as number;
  expect(svgCountWithoutSpy).toBeLessThan(svgCountWithSpy);
  expect(svgCountWithoutSpy).toBeLessThanOrEqual(svgCountBefore);

  recordObservation({
    spec: manifest.spec,
    name: 'perfigure-template-nospy-svg-count',
    value: String(svgCountWithoutSpy),
  });
});
