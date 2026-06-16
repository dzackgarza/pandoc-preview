import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, syntaxAncestryAt } from './support/app';

// P37 — Display math (Tier-0 line 28). LaTeX authoring needs DISPLAY math, as a
// block
//     $$
//     \int_0^1 x\,dx
//     $$
// and as a single-line $$…$$. The editor carves both forms (a spanning block
// into a MathBlock node, a single-line span into MathSpan) and parseMixed-mounts
// codemirror-lang-latex over the full span. Because the mount sees the $$
// delimiters, the latex grammar recognises the region as DISPLAY math —
// distinct from the InlineMath of a single $ (p36) — and tokenises its control
// sequences as CtrlSeq.
//
// Proof reads the editor's REAL parsed tree at control sequences inside appended
// display math:
//   - multi-line $$…$$  → ancestors 'MathBlock' and 'DisplayMath', innermost 'CtrlSeq';
//   - single-line $$…$$ → ancestors 'MathSpan'  and 'DisplayMath', innermost 'CtrlSeq'.
//
// RED until the block carve + latex mount are wired: a $$ block resolves to
// 'Paragraph < Document' (plain text), so the MathBlock assertion fails first.

test('Display math ($$…$$, block and single-line) is highlighted as LaTeX in display mode', async ({
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

  // Multi-line block: \int is inside a MathBlock carve, parsed as display math.
  const block = await syntaxAncestryAt(tauriPage, "\\int");
  expect(block).toContain("MathBlock");
  expect(block).toContain("DisplayMath");
  expect(block[0]).toBe("CtrlSeq");

  // Single-line $$…$$: \oint is inside a MathSpan carve, parsed as display math
  // (double $), distinct from inline mode.
  const display = await syntaxAncestryAt(tauriPage, "\\oint");
  expect(display).toContain("MathSpan");
  expect(display).toContain("DisplayMath");
  expect(display).not.toContain("InlineMath");
  expect(display[0]).toBe("CtrlSeq");

  recordObservation({ spec: manifest.spec, name: 'display-math-latex', value: 2 });
});
