import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, renderedToken, syntaxAncestryAt } from './support/app';

// P37 — Display math is VISIBLY highlighted (Tier-0 line 28). LaTeX authoring
// needs DISPLAY math, as a block
//     $$
//     \int_0^1 x\,dx
//     $$
// and as a single-line $$…$$. Both forms must render with latex syntax
// highlighting (coloured spans), and the latex grammar must recognise them as
// DISPLAY math (distinct from the inline mode of a single $, p36).
//
//   - \int (block) and \oint (single-line) each render in a <span> coloured
//     differently from the editor base colour → actually highlighted;
//   - both resolve under a DisplayMath node → display mode recognised.
//
// RED while math is mounted as a bare parser without highlight styleTags: the
// control sequences parse but render as unstyled base-colour text.

test('Display math ($$…$$, block and single-line) renders with LaTeX highlighting', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `(document.querySelector('.cm-editor .cm-content')?.textContent ?? '').includes('Basel sum')`,
    15_000,
  );

  await appendAtEnd(
    tauriPage,
    "\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nThe area is $$\\oint_C f$$ here.\n",
  );
  await tauriPage.waitForFunction(
    `(document.querySelector('.cm-editor .cm-content')?.textContent ?? '').includes('oint_C f')`,
    15_000,
  );

  // Decisive: block-math \int is a highlight span, coloured ≠ base.
  const intTok = await renderedToken(tauriPage, "\\int");
  expect(intTok.tag).toBe("SPAN");
  expect(intTok.color).not.toBe(intTok.base);
  expect(await syntaxAncestryAt(tauriPage, "\\int")).toContain("DisplayMath");

  // Decisive: single-line $$…$$ \oint is a highlight span, coloured ≠ base.
  const oint = await renderedToken(tauriPage, "\\oint");
  expect(oint.tag).toBe("SPAN");
  expect(oint.color).not.toBe(oint.base);
  expect(await syntaxAncestryAt(tauriPage, "\\oint")).toContain("DisplayMath");

  recordObservation({ spec: manifest.spec, name: 'display-math-highlighted', value: 2 });
});
