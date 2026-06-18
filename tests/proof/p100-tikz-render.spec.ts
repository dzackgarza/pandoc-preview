import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, previewQuery, waitForPreview } from './support/app';

// P100 (Phase D / D-0) — a tikzpicture in the open document is COMPILED and
// rendered as an inline VECTOR figure (an SVG) inside the LIVE preview, and the
// raw tikz source is NOT shown verbatim. This is the discovered-foundation
// obligation: the tikz->SVG preview compile seam is dormant today (the
// tikz-compiling filter is required-on-disk but deliberately never loaded into
// the renderer command), so a tikzpicture appended to the buffer re-renders the
// preview without producing any SVG — the source survives as plain text.
//
// The witness is a tikzpicture with two nodes and an edge between them. The
// witness preview ALREADY contains SVGs before any tikz is added — MathJax
// renders the demo's inline math ($\zeta(2)=\pi^2/6$) as SVG — so the proof is
// not an absolute SVG count but a DELTA: appending the tikzpicture must add a
// NEW inline <svg> (the compiled vector figure) that did not exist before, AND
// the raw tikz source (the `\draw`/`tikzpicture` markup) must NOT appear
// verbatim in the preview body — a compiled figure replaces it; an echoed source
// proves the figure was never compiled.
//
// RED today: the renderer command loads no tikz-compiling filter, so the
// appended `{=latex}` tikz block is passed through as raw text — no NEW <svg> is
// produced (the SVG count never rises above the MathJax baseline), and the
// `\draw`/`tikzpicture` source is shown verbatim. The assertions below fail on
// exactly that dormant state, and would also fail on an app that silently skips
// a missing-converter figure (no new SVG, raw source visible) — never satisfied
// by a filter merely existing on disk.

// A real tikzpicture: two named nodes and an edge between them. Distinctive
// source tokens (\node, \draw, the node label text) let the spec prove the raw
// source is not echoed into the compiled preview.
const TIKZ_BLOCK = [
  '',
  '',
  '```{=latex}',
  '\\begin{tikzpicture}',
  '  \\node (a) at (0,0) {Aleph};',
  '  \\node (b) at (2,0) {Beth};',
  '  \\draw (a) -- (b);',
  '\\end{tikzpicture}',
  '```',
  '',
].join('\n');

// A source token that can only appear in the preview if the tikz markup was
// echoed verbatim instead of compiled. A compiled SVG figure contains no
// literal `\draw` / `\node` / `tikzpicture` control sequences.
const RAW_SOURCE_NEEDLE = '\\draw (a) -- (b)';
const RAW_ENV_NEEDLE = 'tikzpicture';

test('a tikzpicture renders as an inline SVG figure in the live preview, not raw source', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // The app + preview must be alive first, so a later assertion failure is the
  // missing tikz render, not a boot/setup error.
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Baseline SVG count: the witness preview already has SVGs (MathJax renders
  // the demo's inline math as SVG). The appended tikzpicture is the ONLY new
  // source of a vector figure, so the count RISING above this baseline can only
  // come from compiling the tikzpicture.
  const svgCountBefore = (await previewQuery(
    tauriPage,
    `return d.querySelectorAll('svg').length;`,
  )) as number;

  // Append the tikzpicture at the buffer end through the REAL editor update
  // pipeline — the same docChanged -> scheduleRender(debounce) -> real pandoc
  // path user typing fires.
  await appendAtEnd(tauriPage, TIKZ_BLOCK);

  // After the configured debounce + real render, a NEW inline <svg> must appear
  // — the compiled tikz figure pushes the count above the MathJax baseline. RED:
  // the tikz block is never compiled (the compile seam is dormant), so no new SVG
  // is produced and this wait times out at the baseline count.
  await waitForPreview(
    tauriPage,
    `return d.querySelectorAll('svg').length > ${svgCountBefore};`,
  );

  const svgCountAfter = (await previewQuery(
    tauriPage,
    `return d.querySelectorAll('svg').length;`,
  )) as number;
  expect(svgCountAfter).toBeGreaterThan(svgCountBefore);

  // The newly-rendered figure is a real vector figure carrying actual drawing
  // content (path/line/polyline/text/g/rect), not an empty placeholder.
  const lastSvgHasGraphics = await previewQuery(
    tauriPage,
    `const all = d.querySelectorAll('svg'); const s = all[all.length - 1]; return !!s && s.querySelector('path, line, g, text, polyline, rect') !== null;`,
  );
  expect(lastSvgHasGraphics).toBe(true);

  // The raw tikz source was COMPILED, not echoed: the `\draw` / `tikzpicture`
  // control sequences must NOT appear verbatim anywhere in the preview body.
  const rawDrawShown = await previewQuery(
    tauriPage,
    `return d.body.textContent.includes(${JSON.stringify(RAW_SOURCE_NEEDLE)});`,
  );
  expect(rawDrawShown).toBe(false);

  const rawEnvShown = await previewQuery(
    tauriPage,
    `return d.body.textContent.includes(${JSON.stringify(RAW_ENV_NEEDLE)});`,
  );
  expect(rawEnvShown).toBe(false);

  recordObservation({ spec: manifest.spec, name: 'tikz-svg-count', value: String(svgCountAfter) });
});
