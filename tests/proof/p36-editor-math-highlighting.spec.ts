import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, syntaxAncestryAt } from './support/app';

// P36 — Inline LaTeX math highlighting (Tier-0 line 28). The editor's markdown
// language carves $…$ regions into a MathSpan node and parseMixed-mounts the
// codemirror-lang-latex grammar over the FULL span (dollars included) so the
// grammar selects the math mode itself: a single-$ span is recognised as
// InlineMath and its control sequences are tokenised as CtrlSeq.
//
// demo.md line 11: "The Basel sum is $\zeta(2) = \pi^2/6$." The proof reads the
// editor's REAL parsed tree at the \zeta control sequence:
//   - 'MathSpan'   ancestor → our markdown carve ran;
//   - 'InlineMath' ancestor → the latex grammar entered INLINE math mode
//                             (single $), and NOT display mode;
//   - innermost node 'CtrlSeq' → \zeta is tokenised as a latex command, not
//                             plain paragraph text.
//
// RED until the latex-grammar mount is wired: plain markdown (or a bare mount in
// text mode) does not produce MathSpan/InlineMath/CtrlSeq for that span.

test('Inline $…$ math is highlighted as LaTeX in inline math mode', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `(document.querySelector('.cm-editor .cm-content')?.textContent ?? '').includes('Basel sum')`,
    15_000,
  );

  const ancestry = await syntaxAncestryAt(tauriPage, "\\zeta");

  // Our markdown extension carved the $…$ span.
  expect(ancestry).toContain("MathSpan");

  // The latex grammar entered INLINE math mode — not display — over a single-$.
  expect(ancestry).toContain("InlineMath");
  expect(ancestry).not.toContain("DisplayMath");

  // \zeta is tokenised as a latex control sequence (the highlighting payoff),
  // strictly inside the math span.
  expect(ancestry[0]).toBe("CtrlSeq");
  expect(ancestry.indexOf("CtrlSeq")).toBeLessThan(ancestry.indexOf("MathSpan"));

  recordObservation({ spec: manifest.spec, name: 'inline-math-latex', value: 1 });
});
