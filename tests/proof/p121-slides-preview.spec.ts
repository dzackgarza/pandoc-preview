import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  appendAtEnd,
  previewQuery,
  waitForPreview,
  waitForHarness,
} from './support/app';

// P113 (Phase F / F6) — SLIDES FAST-FEEDBACK PREVIEW. Editing re-renders a
// reveal.js slide DECK into the preview iframe on idle (the fast HTML path),
// distinct from a full beamer->PDF compile.
//
// RESEARCH-FIRST: slides are "just a different pandoc command with reveal.js
// output" (feature-catalogue Tier-2). The deck is produced by the REAL pandoc
// revealjs WRITER (`--to revealjs --embed-resources`) — the maintained reveal.js
// library pandoc targets — via the SPEC-OWNED revealjs-renderer plugin fixture
// (the renderer-plugin sibling of pandoc-renderer). There is NO bespoke slide
// renderer; F6's app-core job is solely to WIRE that renderer plugin into the
// SAME compile-on-idle scheduler F1 built, so editing re-renders the deck into
// the EXISTING preview iframe on idle (the fast path).
//
// WHAT THIS SPEC PROVES (P113 observable clauses, nothing about wiring):
//   (1) After the slides preview mode is active and the compile-on-idle debounce
//       elapses, the preview iframe DOM contains REAL reveal.js slide structure —
//       the `.reveal` container with `.reveal > .slides` holding `<section>` slide
//       elements (the reveal.js deck markers pandoc's revealjs writer emits), with
//       MORE THAN ONE slide section (the demo's slide-separator structure became a
//       multi-slide deck, not a single document).
//   (2) The deck carries the EDITED witness text: a distinctive sentence appended
//       to the buffer AFTER the deck first renders appears INSIDE a `<section>` of
//       the deck (re-rendered on idle), proving the slides path tracks edits — not
//       a frozen first render.
//
// The deck is read from the LIVE preview iframe DOM, independently of the app's
// own report. A single-document HTML render (no `.reveal`/`<section>` structure),
// a frozen deck (the edit witness absent after the debounce), or an unwired slides
// command (an empty preview) would each fail a clause below.
//
// ADMISSIBLE because it FAILS on a plausibly broken app:
//   - the slides render target is UNSELECTABLE (setRenderTarget('revealjs-renderer')
//     does nothing / the plugin is undiscovered): the preview never gains reveal.js
//     structure -> clauses (1)/(2);
//   - the slides path emits ORDINARY single-document HTML instead of a reveal.js
//     deck (the html5 renderer still runs): no `.reveal`/`<section>` markers
//     -> clause (1);
//   - the slides path does NOT re-render on idle (frozen first render): the appended
//     witness is absent from the deck after the debounce -> clause (2).
//
// The slides target is the shipped revealjs-renderer plugin (vendored,
// self-contained: `pandoc --to revealjs` + the reveal.js template), selected through
// the discovery-driven render-target selector — NOT a bespoke slides mode. The app
// boots cleanly (the canonical pandoc/html5 renderer is the default; revealjs is a
// discovered candidate the selector switches to), so a failure is the slides render
// target not producing a deck, never a boot/config-schema error.

const EDIT_WITNESS = 'Successive minima bound the covolume −163.';

test('slides preview re-renders demo.md into a reveal.js deck on idle carrying the edited witness', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // Bring the app + project + HTML preview up FIRST, so a RED failure below is
  // demonstrably the missing SLIDES-preview surface, not a boot/open/render error:
  // the app booted, the project opened, demo.md is selected, and the existing HTML
  // preview rendered (its <h1> is present).
  await waitForHarness(tauriPage);
  await openAndSelectDemo(tauriPage, manifest.project);
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Select the SLIDES render target — the shipped revealjs-renderer plugin — through
  // the discovery-driven render-target selector. Slides is NOT a bespoke mode: it is
  // the SAME render primitive with the revealjs writer + the reveal.js template,
  // picked like any other render target. Driven through the harness transport
  // (window.__PPE_E2E__.setRenderTarget), which re-renders the open buffer through
  // that renderer + its default template into the SAME preview iframe and tracks
  // edits on idle.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.setRenderTarget('revealjs-renderer', null); return null; })()`,
  );

  // After the compile-on-idle debounce, the preview iframe is a reveal.js DECK:
  // the `.reveal` container holding `.slides > section` slide elements (pandoc's
  // revealjs writer markers). A single-document HTML render has no such structure.
  await waitForPreview(
    tauriPage,
    `const reveal = d.querySelector('.reveal > .slides');
     return reveal !== null && reveal.querySelector('section') !== null;`,
  );

  // The edit witness must be ABSENT before the edit (proves the witness is the
  // edit's product, not pre-existing demo.md text).
  const before = await previewQuery(
    tauriPage,
    `return d.body.textContent.includes(${JSON.stringify(EDIT_WITNESS)});`,
  );
  expect(before).toBe(false);

  // Append a distinctive witness at the buffer end through the REAL editor update
  // pipeline — the SAME docChanged -> compile-on-idle(debounce) path user typing
  // fires (P2's appendAtEnd). A new heading makes the witness a fresh slide under
  // the revealjs slide-separator conventions.
  await appendAtEnd(tauriPage, `\n\n# Successive minima\n\n${EDIT_WITNESS}\n`);

  // ── Clause (2): the EDITED witness re-renders INTO the deck on idle ──
  // After the configured debounce + real slides re-render, the witness appears
  // INSIDE a reveal.js `<section>` of the deck (not merely somewhere in the
  // document body) — proving the slides path re-rendered on idle AND that the
  // witness lives in the slide structure.
  await waitForPreview(
    tauriPage,
    `const sections = Array.from(d.querySelectorAll('.reveal > .slides section'));
     return sections.some((s) => s.textContent.includes(${JSON.stringify(EDIT_WITNESS)}));`,
  );

  // ── Clause (1): real reveal.js DECK structure (read off the live preview DOM) ──
  const deck = await previewQuery(
    tauriPage,
    `const reveal = d.querySelector('.reveal');
     const slides = d.querySelector('.reveal > .slides');
     const sections = slides ? Array.from(slides.querySelectorAll('section')) : [];
     const witnessSection = sections.find((s) => s.textContent.includes(${JSON.stringify(EDIT_WITNESS)}));
     return JSON.stringify({
       hasReveal: reveal !== null,
       hasSlides: slides !== null,
       sectionCount: sections.length,
       witnessInSection: witnessSection !== undefined,
     });`,
  );
  const parsed = JSON.parse(deck as string) as {
    hasReveal: boolean;
    hasSlides: boolean;
    sectionCount: number;
    witnessInSection: boolean;
  };
  expect(parsed.hasReveal).toBe(true);
  expect(parsed.hasSlides).toBe(true);
  // The demo's slide-separator structure (headings + a `---` rule) plus the edit's
  // new heading make this a MULTI-slide deck, not a single section.
  expect(parsed.sectionCount).toBeGreaterThan(1);
  expect(parsed.witnessInSection).toBe(true);

  recordObservation({
    spec: manifest.spec,
    name: 'reveal-section-count',
    value: parsed.sectionCount,
  });
  recordObservation({ spec: manifest.spec, name: 'edit-witness', value: EDIT_WITNESS });
});
