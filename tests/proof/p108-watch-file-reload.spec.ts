import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  appendAtEnd,
  editorText,
  previewQuery,
  waitForPreview,
  sleep,
} from './support/app';

// P98 (Phase D / D-9) — watch-file reload of the OPEN owned figure. This closes
// the launch->edit->return loop D-7/P96 opens: when an EXTERNAL tool (the
// diagram editor launched on the owned figure source) REWRITES the open owned
// figure FILE on disk with NEW content, the in-app preview must RELOAD to
// reflect that new content. The change is detected via the EXACT P48 fingerprint
// (the FNV-1a content hash + nanosecond mtime fsops.rs captures on read/write,
// the same primitive P48's conflict gate compares): the reload fires precisely
// when the open file's on-disk fingerprint DIVERGES from the one stored when it
// was opened/last loaded, and an UNCHANGED file (same fingerprint) triggers NO
// reload. There is NO new change-detection scheme.
//
// THE OWNED FIGURE. The open file (manifest.demoFile — the file carrying the P48
// fingerprint) is provisioned to carry ONE owned tikz figure as a `{=latex}`
// block whose single node is filled RED. The figure compile seam P100 activated
// (pdflatex + pdf2svg, the real toolchain) renders that figure to an inline
// <svg> whose fill is `rgb(100%, 0%, 0%)` — verified against the real toolchain
// (the SAME signature p101 verifies), and it appears in NO other fixture, so a
// red fill in the preview can ONLY come from compiling THIS figure's source. The
// distinctive content is the figure SOURCE'S OWN fill color, so rewriting the
// file's figure source from red to blue changes the rendered signature.
//
// LEG A — external rewrite reloads to the new content. An INDEPENDENT process
// (this Node test process, via fs.writeFileSync — NOT the app writing the file,
// the P48/P49 idiom for durable host-fs state) REWRITES manifest.demoFile on
// disk with the SAME figure but filled BLUE (`rgb(0%, 0%, 100%)`). The preview
// must RELOAD so it reflects the new on-disk content: the blue signature appears
// and the stale red signature is GONE. The reload is driven by the fingerprint
// DIVERGENCE the external write produced.
//
// LEG B — no spurious reload when the file is UNCHANGED. After the reload, an
// in-app edit appends a DISTINCTIVE unsaved marker into the editor buffer
// (the docChanged path appendAtEnd fires) WITHOUT writing the file — so the open
// file's on-disk fingerprint does NOT diverge (the marker lives only in the
// dirty buffer; disk still holds the blue figure). A correct watcher, whose
// trigger is fingerprint divergence, fires NO reload: the unsaved marker SURVIVES
// in the buffer and the preview keeps reflecting the buffer. A broken watcher
// that reloads on every tick regardless of content (the spurious-reload failure
// P98 must reject) would reload the file FROM DISK, reverting the buffer to the
// (markerless) on-disk blue figure and DESTROYING the unsaved edit. The marker
// surviving is the discriminator that NO reload fired absent a real change.
//
// RED EXPECTATION today: the app does NOT watch the open owned figure file. No
// file-watcher reloads the preview when an external process rewrites the open
// file on disk, so after LEG A's external rewrite the STALE render PERSISTS — the
// preview keeps showing the RED figure even though disk now holds the BLUE one.
// LEG A's wait for the blue signature (and red's disappearance) therefore times
// out / fails on the persisting stale red render. The app boots, opens the file,
// and renders the initial red figure first (so the failure is the missing
// watch-reload, NOT a boot/setup error); only the external-rewrite reload is
// absent.

// The verified pdf2svg fill signatures (rgb(R%, G%, B%)) for the owned figure's
// node fill. Red is the INITIAL on-disk figure; blue is what the external rewrite
// produces. Confirmed against the real pdflatex+pdf2svg toolchain; neither
// appears in the demo's MathJax-rendered math (which fills black/currentColor).
const RED_FILL = 'rgb(100%, 0%, 0%)';
const BLUE_FILL = 'rgb(0%, 0%, 100%)';

// Concatenated outerHTML of every <svg> in the preview body, so a fill signature
// can be detected anywhere inside the rendered figures.
const ALL_SVG_MARKUP = `return Array.from(d.querySelectorAll('svg')).map((s) => s.outerHTML).join('\\n');`;

// Build the owned-figure document body for a given node fill color. The figure
// is a single filled node in a `{=latex}` tikz block — the SAME owned-tikz
// envelope p100/p101 compile. The fill is INLINE in the node options, so the
// distinctive rendered color is the figure SOURCE'S OWN content (not a shared
// palette), which is exactly what the external rewrite changes on disk.
function ownedFigureDoc(fill: string): string {
  return [
    '# P108 — watch-file reload witness',
    '',
    '```{=latex}',
    '\\begin{tikzpicture}',
    `  \\node[fill=${fill}, draw=black, shape=rectangle, minimum width=2cm, minimum height=2cm] (a) at (0,0) {Aleph};`,
    '\\end{tikzpicture}',
    '```',
    '',
    '',
  ].join('\n');
}

test('an external rewrite of the open owned figure reloads the preview to the new content, and an unchanged file triggers no spurious reload', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // The open file was provisioned to carry the RED owned figure. Assert the
  // on-disk starting point independently (a botched fixture is a broken proof
  // environment, not the obligation under test).
  const initialOnDisk = readFileSync(manifest.demoFile, 'utf-8');
  expect(initialOnDisk.includes('fill=red')).toBe(true);

  // App + preview must be alive and rendering the INITIAL figure first, so a
  // later failure is the missing watch-reload, not a boot/setup error.
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // The open figure compiles to an inline <svg> carrying the RED signature. This
  // is the pre-rewrite render: a NEW vector figure with the red fill the figure
  // source declares.
  await waitForPreview(
    tauriPage,
    `return (function(){ ${ALL_SVG_MARKUP} })(d).includes(${JSON.stringify(RED_FILL)});`,
  );
  const markupBefore = (await previewQuery(tauriPage, ALL_SVG_MARKUP)) as string;
  expect(markupBefore).toContain(RED_FILL);
  expect(markupBefore).not.toContain(BLUE_FILL);

  recordObservation({ spec: manifest.spec, name: 'initial-render-red', value: 'present' });

  // ── LEG A — an INDEPENDENT process rewrites the open owned figure on disk ──
  // fs.writeFileSync from THIS test process (not the app) replaces the open
  // file's figure source: the SAME figure, filled BLUE. This is a real on-disk
  // content change, so the open file's P48 fingerprint DIVERGES from the one the
  // app stored at open.
  const blueDoc = ownedFigureDoc('blue');
  writeFileSync(manifest.demoFile, blueDoc, 'utf-8');
  // Confirm the external write landed (independent read), so a later failure is
  // attributable to the app NOT reloading, not a botched fixture write.
  expect(readFileSync(manifest.demoFile, 'utf-8')).toBe(blueDoc);

  // The watch-reload must reflect the NEW on-disk content: the figure now renders
  // BLUE. RED today: nothing watches the open file, so the preview keeps showing
  // the stale RED figure and this wait exhausts (the blue signature never
  // appears).
  await waitForPreview(
    tauriPage,
    `return (function(){ ${ALL_SVG_MARKUP} })(d).includes(${JSON.stringify(BLUE_FILL)});`,
  );
  const markupAfter = (await previewQuery(tauriPage, ALL_SVG_MARKUP)) as string;
  // The reload reflects the rewrite: blue is now present and the stale red figure
  // is GONE (the stale render did NOT persist).
  expect(markupAfter).toContain(BLUE_FILL);
  expect(markupAfter).not.toContain(RED_FILL);

  recordObservation({ spec: manifest.spec, name: 'reloaded-render-blue', value: 'present' });

  // ── LEG B — no spurious reload when the file is UNCHANGED ──────────────────
  // Append a DISTINCTIVE marker into the editor buffer WITHOUT writing the file:
  // the marker lives only in the dirty buffer, so the open file's on-disk
  // fingerprint does NOT diverge (disk still holds the blue figure). A reload
  // fires ONLY on fingerprint divergence, so no reload should fire here.
  const unsavedMarker = `P108 unsaved buffer marker ${manifest.runId} — survives if no spurious reload`;
  await appendAtEnd(tauriPage, `\n\n${unsavedMarker}\n`);

  // The marker is in the buffer now (the in-app edit landed). Disk is unchanged
  // by the in-app edit — confirm independently that the open file still holds the
  // blue figure and NOT the unsaved marker (so the fingerprint did not diverge).
  expect((await editorText(tauriPage)).includes(unsavedMarker)).toBe(true);
  const onDiskDuringLegB = readFileSync(manifest.demoFile, 'utf-8');
  expect(onDiskDuringLegB).toBe(blueDoc);
  expect(onDiskDuringLegB.includes(unsavedMarker)).toBe(false);

  // Wait a generous window — longer than any plausible watch interval — for a
  // spurious reload to (wrongly) fire. A reload reloads the file FROM DISK, which
  // would REVERT the buffer to the markerless on-disk blue figure, destroying the
  // unsaved edit. A correct watcher (trigger = fingerprint divergence) fires no
  // reload because the fingerprint did not diverge, so the marker SURVIVES.
  await sleep(6_000);

  // The unsaved marker is STILL in the buffer — no spurious reload reverted it to
  // disk. This is the discriminator that NO reload fired absent a real change.
  expect((await editorText(tauriPage)).includes(unsavedMarker)).toBe(true);

  recordObservation({
    spec: manifest.spec,
    name: 'no-spurious-reload-unsaved-marker-survives',
    value: 'present',
  });
});
