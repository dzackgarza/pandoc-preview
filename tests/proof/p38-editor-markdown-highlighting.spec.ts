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
// RED under the latex-only host: `#`, `*`, backtick runs are swallowed as plain
// LaTeX text (no markdown node, no span), so nothing here is highlighted.

test('Markdown constructs (heading, emphasis, strong, inline code) render highlighted', async ({
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
    "\n\n## Test Heading\n\nThis is *emphasized* and **strongbold** and `inlinecode` text.\n",
  );
  await tauriPage.waitForFunction(
    `(document.querySelector('.cm-editor .cm-content')?.textContent ?? '').includes('Test Heading')`,
    15_000,
  );

  // ATX heading (needs the # passthrough grammar tweak).
  const heading = await renderedToken(tauriPage, "Test Heading");
  expect(isHighlighted(heading)).toBe(true);
  expect(await syntaxAncestryAt(tauriPage, "Test Heading")).toContain("ATXHeading2");

  // Emphasis -> italic.
  const em = await renderedToken(tauriPage, "emphasized");
  expect(isHighlighted(em)).toBe(true);
  expect(await syntaxAncestryAt(tauriPage, "emphasized")).toContain("Emphasis");

  // Strong -> bold.
  const strong = await renderedToken(tauriPage, "strongbold");
  expect(isHighlighted(strong)).toBe(true);
  expect(await syntaxAncestryAt(tauriPage, "strongbold")).toContain("StrongEmphasis");

  // Inline code -> monospace span.
  const code = await renderedToken(tauriPage, "inlinecode");
  expect(isHighlighted(code)).toBe(true);
  expect(await syntaxAncestryAt(tauriPage, "inlinecode")).toContain("InlineCode");

  recordObservation({ spec: manifest.spec, name: 'markdown-prose-highlighted', value: 4 });
});
