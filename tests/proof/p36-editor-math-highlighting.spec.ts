import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, syntaxAncestryAt } from './support/app';

// P36 — LaTeX syntax highlighting inside math regions (Tier-0 line 28). The
// editor's markdown language is configured with a math extension that (a)
// delimits $…$ as an InlineMath node and (b) parseMixed-mounts a stex (LaTeX
// math-mode) sub-parser inside it. The user-visible payoff is that control
// sequences like \zeta / \pi are tokenized and highlighted as latex, not left
// as undifferentiated paragraph text.
//
// demo.md line 11 contains real math: "The Basel sum is $\zeta(2) = \pi^2/6$."
// The proof reads the editor's REAL parsed tree at the \zeta control sequence:
//   - 'InlineMath' must be an ancestor  → our markdown delimiter ran;
//   - the innermost node must be 'tagName' (a stex token), nested INSIDE
//     InlineMath → parseMixed actually mounted the latex grammar.
//
// RED until the extension is wired: plain markdown resolves that position to
// 'Paragraph < Document' — no InlineMath, no latex token — so both assertions
// fail. This discriminates "math is latex-tokenized" from "math is plain text"
// and from a hollow wiring that wraps InlineMath without embedding a parser.

test('Math regions are tokenized as embedded LaTeX (InlineMath mounts a stex sub-tree)', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `(document.querySelector('.cm-editor .cm-content')?.textContent ?? '').includes('Basel sum')`,
    15_000,
  );

  const ancestry = await syntaxAncestryAt(tauriPage, "\\zeta");

  // The $…$ span is owned by our InlineMath markdown node.
  expect(ancestry).toContain("InlineMath");

  // The control sequence resolves to a latex token (stex 'tagName'), proving the
  // embedded math parser ran — not plain markdown text.
  expect(ancestry[0]).toBe("tagName");

  // …and that token is strictly nested inside InlineMath (the interlock), not a
  // sibling or a coincidental markdown node.
  const tagIdx = ancestry.indexOf("tagName");
  const mathIdx = ancestry.indexOf("InlineMath");
  expect(tagIdx).toBeGreaterThanOrEqual(0);
  expect(tagIdx).toBeLessThan(mathIdx);

  recordObservation({ spec: manifest.spec, name: 'math-latex-highlighting', value: 1 });
});
