import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, previewQuery, waitForPreview } from './support/app';

// P91 (Phase D / D-2) — a tikz style defined ONLY in the shared `.tikzstyles`
// palette must visibly determine a compiled figure's appearance in the live
// preview, and CHANGING that shared file must change the rendered figure. This
// rides P100's now-active tikz->SVG compile seam: the shared style/defs files are
// `\input` by the figure compile that produces the preview SVG.
//
// The witness style is `bigredbox`, declared ONLY in the shared `.tikzstyles`
// file (provisioned by scripts/provision-proof.sh into this spec's hermetic
// global figures dir, in TikzIt's native `\tikzstyle{NAME}=[...]` format). It
// sets `fill=red`, a distinctive visual signature: a node carrying this style
// compiles (pdflatex + pdf2svg, the real toolchain) to an SVG whose fill is
// `rgb(100%, 0%, 0%)`. That style name and fill appear in NO other fixture, so a
// red fill in the rendered figure can ONLY come from the figure compile having
// consumed THIS shared file.
//
// The DISCRIMINATOR is the second leg: the spec overwrites the active shared file
// on disk with a variant declaring the SAME style name with `fill=blue`
// (`rgb(0%, 0%, 100%)`), re-triggers a render, and asserts the rendered figure
// changes from the red signature to the blue signature. This proves the SHARED
// FILE'S CONTENT determines the render — a hardcoded-red compile that ignored the
// file would pass the first leg but FAIL the discriminator.
//
// RED today: the figure-compile seam P100 activated does NOT `\input` this shared
// file, and there is no config key declaring it (the config schema is
// deny_unknown_fields, so a node using `style=bigredbox` compiles WITHOUT the
// style's effect — the figure either fails to produce a vector figure or renders
// with no red fill). The shared file sits on disk, unconsumed. The first leg
// fails: the appended figure never carries the `rgb(100%, 0%, 0%)` signature the
// shared style declares. The failure is the missing shared-style consumption, not
// a boot error — the config is the canonical witness config (the app boots, the
// preview is alive) and only the shared-palette `\input` is absent.

// A real tikzpicture whose single node USES the shared style by name. The
// `style=bigredbox` reference is meaningless unless the shared `.tikzstyles`
// declaring `bigredbox` is `\input` by the compile.
const STYLED_TIKZ_BLOCK = [
  '',
  '',
  '```{=latex}',
  '\\begin{tikzpicture}',
  '  \\node[style=bigredbox] (a) at (0,0) {Aleph};',
  '\\end{tikzpicture}',
  '```',
  '',
].join('\n');

// The shared palette files this spec's provisioning placed in the hermetic
// global figures dir. `shared.tikzstyles` is the active file (fill=red);
// `shared-blue.tikzstyles` is the discriminator variant (fill=blue) the spec
// swaps onto the active path on disk for the second leg.
const FIGURES_REL = 'home/.pandoc/figures';
const ACTIVE_STYLES = 'shared.tikzstyles';
const BLUE_STYLES = 'shared-blue.tikzstyles';

// pdf2svg emits fill colors as `rgb(R%, G%, B%)`. A bigredbox node fills red →
// `rgb(100%, 0%, 0%)`; the blue variant fills → `rgb(0%, 0%, 100%)`. These
// signatures are verified against the real pdflatex+pdf2svg toolchain and do not
// appear in the demo's MathJax-rendered math (which fills black/currentColor).
const RED_FILL = 'rgb(100%, 0%, 0%)';
const BLUE_FILL = 'rgb(0%, 0%, 100%)';

// Concatenated outerHTML of every <svg> currently in the preview body, so the
// assertions can detect a fill signature anywhere inside the rendered figures.
const ALL_SVG_MARKUP = `return Array.from(d.querySelectorAll('svg')).map((s) => s.outerHTML).join('\\n');`;

test('a tikz style defined only in the shared .tikzstyles palette determines the rendered figure, and changing the shared file changes the render', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();
  const figuresDir = join(manifest.runDir, FIGURES_REL);
  const activePath = join(figuresDir, ACTIVE_STYLES);
  const bluePath = join(figuresDir, BLUE_STYLES);

  // The shared palette was provisioned to disk before launch — the proof asserts
  // CONSUMPTION of it, never its existence, but a missing fixture is a broken
  // proof environment, so fail loud here.
  if (!existsSync(activePath)) {
    throw new Error(`shared .tikzstyles fixture missing at ${activePath}`);
  }
  if (!existsSync(bluePath)) {
    throw new Error(`shared blue .tikzstyles variant missing at ${bluePath}`);
  }

  // App + preview must be alive first, so a later failure is the missing shared
  // style consumption, not a boot/setup error.
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  const svgCountBefore = (await previewQuery(
    tauriPage,
    `return d.querySelectorAll('svg').length;`,
  )) as number;

  // Append a figure whose node uses the shared style, through the real editor
  // update pipeline (docChanged -> scheduleRender(debounce) -> real pandoc).
  await appendAtEnd(tauriPage, STYLED_TIKZ_BLOCK);

  // A NEW inline <svg> (the compiled figure) must appear above the MathJax
  // baseline. RED if the styled figure never compiles to a vector figure.
  await waitForPreview(
    tauriPage,
    `return d.querySelectorAll('svg').length > ${svgCountBefore};`,
  );

  // Leg 1 — the rendered figure carries the RED signature the shared file
  // declares. RED today: the shared `.tikzstyles` is not `\input` by the compile,
  // so `style=bigredbox` has no effect and no red fill reaches the preview.
  await waitForPreview(
    tauriPage,
    `return (function(){ ${ALL_SVG_MARKUP} })(d).includes(${JSON.stringify(RED_FILL)});`,
  );
  const markupRed = (await previewQuery(tauriPage, ALL_SVG_MARKUP)) as string;
  expect(markupRed).toContain(RED_FILL);
  expect(markupRed).not.toContain(BLUE_FILL);

  recordObservation({ spec: manifest.spec, name: 'shared-style-red-fill', value: 'present' });

  // Leg 2 (DISCRIMINATOR) — overwrite the ACTIVE shared file on disk with the
  // blue variant, then re-trigger a render. If (and only if) the compile consumes
  // the shared file, the SAME figure must now render BLUE instead of red. A
  // hardcoded-red compile that ignored the file would stay red here and fail.
  copyFileSync(bluePath, activePath);

  // Re-trigger the render pipeline by appending a fresh no-op marker (a blank
  // line + comment), which fires docChanged -> re-render -> a fresh figure
  // compile that re-reads the (now blue) shared file.
  await appendAtEnd(tauriPage, '\n\n<!-- p101 rerender -->\n');

  // The render now reflects the swapped shared file: the figure carries the BLUE
  // signature and no longer the red one.
  await waitForPreview(
    tauriPage,
    `return (function(){ ${ALL_SVG_MARKUP} })(d).includes(${JSON.stringify(BLUE_FILL)});`,
  );
  const markupBlue = (await previewQuery(tauriPage, ALL_SVG_MARKUP)) as string;
  expect(markupBlue).toContain(BLUE_FILL);
  expect(markupBlue).not.toContain(RED_FILL);

  recordObservation({ spec: manifest.spec, name: 'shared-style-blue-fill', value: 'present' });
});
