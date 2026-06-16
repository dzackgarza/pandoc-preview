import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, renderedToken, syntaxAncestryAt } from './support/app';

// P36 — Inline math is VISIBLY highlighted (Tier-0 line 28). The decisive claim
// is the on-screen payoff: a math control sequence is rendered in a syntax-
// highlight span with a colour distinct from plain prose. A parse tree that
// merely contains latex nodes is NOT enough — it can be correct while nothing is
// coloured (the failure mode this proof was written to catch).
//
// demo.md line 11: "The Basel sum is $\zeta(2) = \pi^2/6$."
//   - \zeta renders inside a <span> whose computed colour ≠ the editor base
//     colour → it is actually highlighted;
//   - "Basel" (plain prose) renders at the base colour → highlighting is
//     selective, not a blanket recolour;
//   - the latex grammar recognises INLINE math mode (not display).
//
// RED while math is mounted as a bare parser without highlight styleTags: \zeta
// parses (CtrlSeq in the tree) but is an unstyled text node at the base colour.

test('Inline $…$ math renders with LaTeX syntax highlighting', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `(document.querySelector('.cm-editor .cm-content')?.textContent ?? '').includes('Basel sum')`,
    15_000,
  );

  // Decisive: \zeta is a highlight span coloured differently from base text.
  const zeta = await renderedToken(tauriPage, "\\zeta");
  expect(zeta.tag).toBe("SPAN");
  expect(zeta.color).not.toBe(zeta.base);

  // Selective: surrounding prose is not highlighted (rules out "colour every
  // token" implementations that would also pass the line above).
  const basel = await renderedToken(tauriPage, "Basel");
  expect(basel.color).toBe(basel.base);

  // Semantic: the latex grammar entered inline math mode over the single $.
  const ancestry = await syntaxAncestryAt(tauriPage, "\\zeta");
  expect(ancestry).toContain("InlineMath");
  expect(ancestry).not.toContain("DisplayMath");

  recordObservation({ spec: manifest.spec, name: 'inline-math-highlighted', value: 1 });
});
