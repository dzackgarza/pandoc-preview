import { test, expect } from './fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openProject, clickSidebarEntry } from './support/app';

// ── P112 — P103 (Phase E / E2): section / environment / math-zone keyboard ─────
//          MOTIONS — structural cursor jumps relative to the cursor's position.
//
// THE OBLIGATION (proof-obligations.md, P103 — verbatim intent):
//   In a buffer containing, in order, two headings, a `:::{.theorem}` fenced div,
//   and two `$…$` math spans, with the cursor at the TOP of the buffer: invoking
//   next-section moves the cursor to the SECOND heading line; invoking
//   next-environment moves the cursor to the fenced-div line; invoking
//   next-math-zone moves the cursor INSIDE the first math span; and invoking
//   prev-section / prev-environment / prev-math-zone REVERSES each of those
//   motions (each computed relative to the cursor's current position, landing on
//   the nearest matching structure in the requested direction). The cursor
//   position is read INDEPENDENTLY of the app's own report.
//
//   Admissible because it fails on: a NO-OP motion (the cursor is unmoved after
//   the motion is invoked); a motion that lands on the WRONG structure kind
//   (next-environment landing on a heading line, or next-math-zone landing on a
//   heading/fenced-div line); and a motion that IGNORES the cursor position
//   (always jumping to the FIRST or LAST matching structure regardless of where
//   the cursor currently sits, so prev-* and next-* from a mid-buffer cursor do
//   not move in opposite directions relative to it).
//
// ── THE WITNESS CORPUS (scripts/provision-proof.sh, the p112 case) ────────────
// motions.md is rebuilt into a controlled buffer whose structures sit on KNOWN,
// distinct lines (the spec recomputes every target line off disk, never
// hardcoding, so a layout change in the fixture cannot silently desync an
// assertion):
//   #  A                     — heading 1 (the FIRST section)
//   ## B                     — heading 2 (the SECOND section)
//   :::{.theorem} … :::      — the FENCED DIV (the environment)
//   $a + b$ … $c + d$        — math span 1, then math span 2
// The headings, div, and math spans are interleaved with plain paragraphs so a
// motion that lands on the wrong KIND (heading vs div vs math) lands on a line
// the spec can tell apart from the requested structure.
//
// ── THE OBSERVABLE CONTRACT (the named editor-command surface) ─────────────────
// This spec is BLIND to how the motions are wired (which CM6 commands, which
// keymap block, which outline/syntax-tree traversal). Synthetic key events into
// CodeMirror's contentEditable are flaky and the bridge cannot send them (the
// reason P52–P62/P104/P105/P109/P110 drive editor actions through harness hooks),
// so each motion is driven through a NEW named-command hook that runs the SAME
// CM6 command the bound key fires, and the cursor is read off the REAL CM6 view:
//
//   __PPE_E2E__.runEditorCommand(name: string)   [NEW for P112 / E2]
//     Runs the named structural-motion editor command against the live CM6 view —
//     the SAME `Command` ((view) => boolean) the motion's keybinding fires (the
//     E2 keymap block composed alongside the existing app keymap, never replacing
//     it). The six command names are 'next-section' / 'prev-section' /
//     'next-environment' / 'prev-environment' / 'next-math-zone' /
//     'prev-math-zone'. Fire-and-forget; returns null. (BLIND to the traversal.)
//
//   __PPE_E2E__.goToLine(line: number)   [reused, App.svelte; p74/p110 precedent]
//     The cursor-move PRIMITIVE — used here ONLY to PLACE the cursor at a known
//     start (the top of the buffer, and a mid-buffer position for the reverse
//     legs), never to perform a motion under test.
//   __PPE_E2E__.cursorLine(): number   [reused, App.svelte; p41/p110 precedent] —
//     the live, 1-based CM6 cursor line, read INDEPENDENTLY of the motion's own
//     report. The decisive observable: which line the motion landed the cursor on.
//   __PPE_E2E__.cursorOffset(): number [reused, App.svelte; p52/p74 precedent] —
//     the live cursor character OFFSET in the buffer. Used to prove next-math-zone
//     lands the cursor INSIDE the first `$…$` span (offset strictly between the
//     opening and closing `$`), not merely on its line.
//   __PPE_E2E__.getEditorText(): string [reused] — the buffer text, read once to
//     resolve the `$…$` span's open/close offsets independently for the
//     inside-the-span assertion.
//
// ── WHAT EACH ASSERTION KILLS ─────────────────────────────────────────────────
//   (NEXT-SECTION)  cursor at top → next-section lands on the SECOND heading line.
//        KILLS a no-op (cursor stays on line 1) and a motion that lands on the
//        FIRST heading (ignores the cursor already being on/above heading 1).
//   (NEXT-ENV)      cursor at top → next-environment lands on the fenced-div line.
//        KILLS a no-op, and a motion that lands on a HEADING line instead of the
//        div (wrong structure kind).
//   (NEXT-MATH)     cursor at top → next-math-zone lands INSIDE the first `$…$`.
//        KILLS a no-op, a landing on a heading/div line (wrong kind), and a
//        landing on the `$` boundary rather than inside the span.
//   (PREV-SECTION)  cursor on heading 2 → prev-section lands on heading 1.
//        KILLS a motion that ignores the cursor (jumps to a fixed first/last) —
//        prev-* must move in the OPPOSITE direction to next-* from the same point.
//   (PREV-ENV)      cursor BELOW the div → prev-environment lands on the div line.
//        KILLS a no-op and a wrong-kind landing.
//   (PREV-MATH)     cursor inside the SECOND `$…$` → prev-math-zone lands inside
//        the FIRST `$…$`. KILLS a fixed-first/last jump that ignores the cursor.
//
// RED today: __PPE_E2E__.runEditorCommand does NOT exist — there are no structural
// section/environment/math-zone motion commands, no E2 keymap block, and no
// named-command surface to fire them. The first runEditorCommand evaluate throws,
// so the cursor never moves off its placed start. The faithful no-motions RED
// state. The failure is the MISSING motions, not a boot/setup error: the app,
// project, editor, and witness buffer are all brought up and the cursor is placed
// FIRST, with cursorLine() confirmed before any motion is invoked.

const WITNESS_FILE = 'motions.md';

// 1-based line of the first line containing `needle`, read INDEPENDENTLY off
// disk. Every structural target line is derived from the real file bytes, never
// hardcoded, so a fixture layout change cannot silently desync an assertion.
function lineOf(text: string, needle: string): number {
  const idx = text.split('\n').findIndex((l) => l.includes(needle));
  if (idx < 0) throw new Error(`needle ${JSON.stringify(needle)} not found on any line`);
  return idx + 1; // 1-based, matching cursorLine()
}

test('section / environment / math-zone motions move the cursor structurally, relative to its position', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();
  const witnessPath = join(manifest.project, WITNESS_FILE);
  const disk = readFileSync(witnessPath, 'utf-8');

  // Target lines, resolved off disk. The two headings, the fenced div, and the
  // two math spans each sit on a distinct line (the corpus interleaves plain
  // paragraphs so a wrong-kind landing is on a line none of these match).
  const HEADING1_LINE = lineOf(disk, '# A'); // first section
  const HEADING2_LINE = lineOf(disk, '## B'); // second section
  const DIV_LINE = lineOf(disk, ':::{.theorem}'); // the environment
  const MATH1_LINE = lineOf(disk, '$a + b$'); // first math span
  const MATH2_LINE = lineOf(disk, '$c + d$'); // second math span

  expect(HEADING1_LINE).toBeLessThan(HEADING2_LINE);
  expect(HEADING2_LINE).toBeLessThan(DIV_LINE);
  expect(DIV_LINE).toBeLessThan(MATH1_LINE);
  expect(MATH1_LINE).toBeLessThan(MATH2_LINE);

  // The app + project + editor must be alive first, so a later failure is the
  // missing motions, not a boot/setup error. The witness is real markdown the
  // explorer lists; opening it shows the structured buffer in the editor.
  await openProject(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('.grow.overflow-auto.p-1 button span:last-child')).some((s) => s.textContent.trim() === ${JSON.stringify(WITNESS_FILE)})`,
    15_000,
  );
  await clickSidebarEntry(tauriPage, WITNESS_FILE);
  await tauriPage.waitForFunction(
    `(document.querySelector('.cm-editor .cm-content')?.textContent ?? '').includes('A theorem body')`,
    15_000,
  );

  // The buffer the editor holds matches the on-disk witness (so the offsets the
  // inside-the-span assertion derives from disk are the editor's offsets too).
  const editorText = (await tauriPage.evaluate(
    `window.__PPE_E2E__.getEditorText()`,
  )) as string;
  expect(editorText).toBe(disk);

  // Resolve the FIRST `$…$` span's open/close character offsets off the buffer,
  // for the inside-the-span proof (the cursor must land strictly between them).
  const math1Open = editorText.indexOf('$a + b$');
  expect(math1Open).toBeGreaterThanOrEqual(0);
  const math1InnerStart = math1Open + 1; // just after the opening `$`
  const math1InnerEnd = math1Open + '$a + b$'.length - 1; // just before the closing `$`

  // PLACE the cursor at the TOP of the buffer (line 1), via the move PRIMITIVE,
  // and CONFIRM it independently — establishing the known start every forward
  // motion is computed relative to, before any motion under test is invoked.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.goToLine(1); return null; })()`,
  );
  await tauriPage.waitForFunction(`window.__PPE_E2E__.cursorLine() === 1`, 10_000);

  // (NEXT-SECTION) From the top, next-section moves the cursor to the SECOND
  // heading line. RED today: runEditorCommand does not exist, so this evaluate
  // throws — the faithful no-motions RED state; the cursor never leaves line 1.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.runEditorCommand('next-section'); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.cursorLine() === ${HEADING2_LINE}`,
    10_000,
  );
  expect(await tauriPage.evaluate(`window.__PPE_E2E__.cursorLine()`)).toBe(HEADING2_LINE);

  // (PREV-SECTION) From the SECOND heading, prev-section reverses the motion and
  // lands on the FIRST heading — proving prev-* moves OPPOSITE to next-* relative
  // to the cursor, not to a fixed first/last position.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.runEditorCommand('prev-section'); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.cursorLine() === ${HEADING1_LINE}`,
    10_000,
  );
  expect(await tauriPage.evaluate(`window.__PPE_E2E__.cursorLine()`)).toBe(HEADING1_LINE);

  // (NEXT-ENV) Re-place the cursor at the top, then next-environment lands on the
  // fenced-div line — NOT a heading line (wrong kind) and NOT a no-op.
  await tauriPage.evaluate(`(() => { window.__PPE_E2E__.goToLine(1); return null; })()`);
  await tauriPage.waitForFunction(`window.__PPE_E2E__.cursorLine() === 1`, 10_000);
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.runEditorCommand('next-environment'); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.cursorLine() === ${DIV_LINE}`,
    10_000,
  );
  expect(await tauriPage.evaluate(`window.__PPE_E2E__.cursorLine()`)).toBe(DIV_LINE);

  // (PREV-ENV) Place the cursor BELOW the div (on the second math line), then
  // prev-environment reverses upward to the fenced-div line.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.goToLine(${MATH2_LINE}); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.cursorLine() === ${MATH2_LINE}`,
    10_000,
  );
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.runEditorCommand('prev-environment'); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.cursorLine() === ${DIV_LINE}`,
    10_000,
  );
  expect(await tauriPage.evaluate(`window.__PPE_E2E__.cursorLine()`)).toBe(DIV_LINE);

  // (NEXT-MATH) Re-place the cursor at the top, then next-math-zone lands INSIDE
  // the first `$…$` span: on its line AND with the cursor offset strictly between
  // the opening and closing `$` (not on a heading/div line, not on the boundary).
  await tauriPage.evaluate(`(() => { window.__PPE_E2E__.goToLine(1); return null; })()`);
  await tauriPage.waitForFunction(`window.__PPE_E2E__.cursorLine() === 1`, 10_000);
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.runEditorCommand('next-math-zone'); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.cursorLine() === ${MATH1_LINE}`,
    10_000,
  );
  expect(await tauriPage.evaluate(`window.__PPE_E2E__.cursorLine()`)).toBe(MATH1_LINE);
  const mathOffset = (await tauriPage.evaluate(
    `window.__PPE_E2E__.cursorOffset()`,
  )) as number;
  expect(mathOffset).toBeGreaterThan(math1InnerStart - 1);
  expect(mathOffset).toBeLessThan(math1InnerEnd + 1);

  // (PREV-MATH) Place the cursor inside the SECOND `$…$` span, then prev-math-zone
  // reverses to the FIRST `$…$` span — proving the math motion is relative to the
  // cursor, not a fixed first/last jump.
  const math2Open = editorText.indexOf('$c + d$');
  expect(math2Open).toBeGreaterThanOrEqual(0);
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.goToLine(${MATH2_LINE}); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.cursorLine() === ${MATH2_LINE}`,
    10_000,
  );
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.runEditorCommand('prev-math-zone'); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.cursorLine() === ${MATH1_LINE}`,
    10_000,
  );
  expect(await tauriPage.evaluate(`window.__PPE_E2E__.cursorLine()`)).toBe(MATH1_LINE);

  recordObservation({ spec: manifest.spec, name: 'p112-next-section', value: HEADING2_LINE });
  recordObservation({ spec: manifest.spec, name: 'p112-next-environment', value: DIV_LINE });
  recordObservation({ spec: manifest.spec, name: 'p112-next-math-zone', value: MATH1_LINE });
});
