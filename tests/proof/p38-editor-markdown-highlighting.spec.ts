import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  appendAtEnd,
  renderedToken,
  isHighlighted,
  syntaxAncestryAt,
} from './support/app';

// P38 — Markdown prose is highlighted (Tier-0 line 28; Phase 1 of the fusion).
// The editor's language is the forked latex grammar with @lezer/markdown mounted
// (parseMixed) over the runs latex passes through as plain prose. So CommonMark
// constructs in prose must render with their OWN markdown highlighting, while
// latex math (p36/p37) keeps its latex highlighting.
//
// Decisive claim (observable, not parse-tree): each construct renders in a
// highlight <span> that is visually distinct from base prose — recoloured
// (heading, code) or restyled (emphasis→italic, strong→bold). isHighlighted()
// captures both. A secondary syntaxAncestryAt check confirms the markdown node.
//
// RED under the latex-only host: `#` and `*` runs are swallowed as plain LaTeX
// text (no markdown node, no span), so nothing here is highlighted.
//
// Phase 1 proves the fusion via the block construct that needs the # passthrough
// grammar tweak (heading) and the two inline constructs that restyle without
// recolouring (emphasis->italic, strong->bold). Inline code parses correctly
// (InlineCode node) but the editor's highlight style does not colour `monospace`
// yet — its styling is deferred to Phase 2.

test('Markdown constructs (heading, emphasis, strong) render highlighted', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `(document.querySelector('.cm-editor .cm-content')?.textContent ?? '').includes('Basel sum')`,
    15_000,
  );

  // Append clean ASCII markdown through the real editor pipeline.
  await appendAtEnd(
    tauriPage,
    "\n\n## Test Heading\n\nThis is *emphasized* and _underitalic_ and **strongbold** text.\n",
  );
  await tauriPage.waitForFunction(
    `(document.querySelector('.cm-editor .cm-content')?.textContent ?? '').includes('Test Heading')`,
    15_000,
  );

  // ATX heading (needs the # passthrough grammar tweak) — bold, recoloured.
  const heading = await renderedToken(tauriPage, "Test Heading");
  expect(isHighlighted(heading)).toBe(true);
  expect(await syntaxAncestryAt(tauriPage, "Test Heading")).toContain("ATXHeading2");

  // Emphasis -> italic (both * and _ forms; _ exercises the fork's Underscore
  // passthrough end-to-end).
  const em = await renderedToken(tauriPage, "emphasized");
  expect(isHighlighted(em)).toBe(true);
  expect(await syntaxAncestryAt(tauriPage, "emphasized")).toContain("Emphasis");

  const underEm = await renderedToken(tauriPage, "underitalic");
  expect(isHighlighted(underEm)).toBe(true);
  expect(await syntaxAncestryAt(tauriPage, "underitalic")).toContain("Emphasis");

  // Strong -> bold.
  const strong = await renderedToken(tauriPage, "strongbold");
  expect(isHighlighted(strong)).toBe(true);
  expect(await syntaxAncestryAt(tauriPage, "strongbold")).toContain("StrongEmphasis");

  recordObservation({ spec: manifest.spec, name: 'markdown-prose-highlighted', value: 3 });
});
