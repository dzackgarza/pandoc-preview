import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openProject, clickSidebarEntry, previewQuery, waitForPreview } from './support/app';

// Obligation P128 (issue-#2 render-matrix realignment; spec file p132 since the
// p128 filename is taken by the view-toggle spec — spec filenames and obligation
// numbers diverge in this suite). A tikz FILE renders standalone as an inline
// VECTOR figure (an SVG) in the live preview, via the user-owned template, and the
// raw tikz source is NOT shown verbatim. The file-mode replacement for the retired
// inline P100 (which compiled tikz blocks embedded in markdown); it carries the
// burden retired off P91/P92: tikz is the SAME render primitive as markdown, only
// the renderer + template differ, selected by the open file's input type from
// plugin discovery — NOT a bespoke inline-compile subsystem with an app-injected
// palette.
//
// Provisioning places a real `figure.tikz` in the witness project (a tikzpicture
// with two nodes and an edge) and installs the tikz-renderer plugin (inputs=["tikz"]).
// Opening that file routes through the discovery-driven matrix to the tikz-renderer,
// which wraps the source in the user-owned standalone-tikz.tex template (it owns its
// preamble via \usepackage{dzg-tikz}) and compiles pdflatex → pdf2svg to an inline
// SVG painted into the preview iframe.
//
// Admissible because it fails on: a tikz file rendered as RAW SOURCE (no <svg> with
// drawing content — the file was not compiled, e.g. routed through the markdown
// renderer); a render producing an EMPTY/placeholder figure (no path/line/text in
// the SVG); and the raw `\draw`/`tikzpicture` control sequences appearing verbatim
// in the preview (an echoed source proves no compile). It is never satisfied by the
// tikz-renderer plugin merely existing on disk.

const RAW_SOURCE_NEEDLE = '\\draw (a) -- (b)';
const RAW_ENV_NEEDLE = 'tikzpicture';

test('a .tikz file renders standalone as an inline SVG via the user-owned template, not raw source', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // Open the witness project, then select the provisioned tikz FILE. Selecting it
  // drives the SAME render scheduler markdown uses; the discovery-driven dispatch
  // resolves the tikz input type to the tikz-renderer + its template.
  await openProject(tauriPage, manifest.project);
  await clickSidebarEntry(tauriPage, 'figure.tikz');

  // After the render, an inline <svg> (the compiled vector figure) must appear in
  // the preview. RED on a broken app: no SVG is produced (raw source survives) or
  // the file rendered through the markdown renderer as a code block.
  await waitForPreview(tauriPage, `return d.querySelectorAll('svg').length > 0;`);

  // The figure is a real vector figure carrying actual drawing content, not an
  // empty placeholder.
  const svgHasGraphics = await previewQuery(
    tauriPage,
    `const s = d.querySelector('svg'); return !!s && s.querySelector('path, line, g, text, polyline, rect') !== null;`,
  );
  expect(svgHasGraphics).toBe(true);

  // The source was COMPILED, not echoed: the `\draw` / `tikzpicture` control
  // sequences must NOT appear verbatim anywhere in the preview body.
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

  recordObservation({ spec: manifest.spec, name: 'tikz-file-render', value: 'svg' });
});
