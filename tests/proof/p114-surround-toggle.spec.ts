import { test, expect } from './fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openProject, clickSidebarEntry } from './support/app';

// ── P114 — P105 (Phase E / E4): environment / command SURROUND + TOGGLE ────────
//          edits — the IN-PLACE EDIT counterpart to E2's read-only motions.
//
// THE OBLIGATION (proof-obligations.md, P105 — verbatim intent):
//   With the cursor inside a `:::{.theorem}` fenced div, invoking
//   rename-environment to `lemma` makes the div's class become `.lemma` with the
//   div BODY byte-unchanged — the EXISTING div is edited in place, NOT a new env
//   inserted (only the one div remains, now `.lemma`). With the cursor on
//   `\frac{a}{b}`, invoking toggle-fraction makes the buffer hold `a/b` at that
//   position; invoking toggle-fraction AGAIN restores `\frac{a}{b}`. With the
//   cursor inside a `(x+y)` delimiter pair, invoking delete-delimiter-pair removes
//   the parentheses, leaving `x+y` (contents kept; only the enclosing delimiters
//   removed).
//
//   Admissible because it fails on: a rename that INSERTS A NEW ENV instead of
//   editing the existing one (two envs appear — the original `.theorem` div plus a
//   new `.lemma` one — rather than the single existing div's class changing in
//   place); a fraction toggle that is ONE-WAY OR A NO-OP (toggling `\frac{a}{b}`
//   does not produce `a/b`, or a second toggle does not restore `\frac{a}{b}`, or
//   the toggle leaves the buffer unchanged); and a delimiter delete that REMOVES
//   THE CONTENTS TOO (deleting the `(`…`)` pair around `x+y` leaves an empty
//   result or drops `x+y` rather than leaving exactly `x+y`).
//
//   It is NOT satisfied by an assertion that a rename / toggle / delete command
//   merely EXISTS — a command that is wired but inserts a parallel env, toggles
//   one-way or no-ops, or strips the delimited contents would pass an existence
//   check while failing every clause above; the proof positions the cursor inside
//   each existing structure, invokes the command, and reads the buffer holding the
//   in-place transform (one renamed div with its body intact, the round-tripped
//   fraction, the contents-preserving delimiter removal).
//
// ── THE WITNESS CORPUS (scripts/provision-proof.sh, the p114 case) ────────────
// surround.md is written fresh into the hermetic project, with the three
// structures each command acts on on KNOWN, distinct lines (the spec recomputes
// every target line off disk, never hardcoding, so a layout change in the fixture
// cannot silently desync an assertion):
//   :::{.theorem} / <body> / :::   — the FENCED DIV (rename-environment's target)
//   $\frac{a}{b}$                  — the FRACTION math span (toggle-fraction)
//   $(x + y)$                      — the DELIMITER pair math span (delete-delim)
// The fraction and delimiter math spans each sit ALONE on their own line, so the
// line-start cursor goToLine places lands INSIDE the structure; the spec confirms
// the cursor offset is within the structure's character range BEFORE invoking each
// edit command.
//
// ── THE OBSERVABLE CONTRACT (the named editor-command surface) ─────────────────
// This spec is BLIND to how the surround/toggle edits are wired (which CM6
// commands, which node-walk over the markdownOutline fenced-div structure or the
// latexLanguage syntax tree, which EditorPane edit primitive). Synthetic key
// events into CodeMirror's contentEditable are flaky and the bridge cannot send
// them (the reason P52–P62/P104/P105/P109/P110/P112 drive editor actions through
// harness hooks), so each edit is driven through the named-command hook that runs
// the SAME CM6 command the bound key fires, and the resulting buffer is read off
// the REAL CM6 view:
//
//   __PPE_E2E__.runEditorCommand(name: string, arg?: string)   [reused from P112]
//     Runs the named editor command against the live CM6 view — the SAME `Command`
//     ((view) => boolean) the binding fires. P112 fires the six read-only motion
//     names through this surface; P105/E4 ADDS three IN-PLACE EDIT command names:
//     'rename-environment' (the optional `arg` is the new env name, e.g. 'lemma'),
//     'toggle-fraction', and 'delete-delimiter-pair'. Fire-and-forget; returns
//     null. (BLIND to the node-walk / edit primitive.)
//
//   __PPE_E2E__.goToLine(line: number)   [reused, App.svelte; p74/p110/p112] —
//     the cursor-move PRIMITIVE — used here ONLY to PLACE the cursor inside each
//     target structure, never to perform an edit under test.
//   __PPE_E2E__.cursorLine(): number   [reused, p41/p110/p112] — the live 1-based
//     cursor line, confirmed AFTER each placement so a later failure is the missing
//     edit command, not a misplaced cursor.
//   __PPE_E2E__.cursorOffset(): number [reused, p52/p74/p112] — the live cursor
//     character offset, confirmed to lie INSIDE each target structure's character
//     range before the edit is invoked.
//   __PPE_E2E__.getEditorText(): string [reused] — the buffer text, the decisive
//     observable: the in-place transform each command must produce.
//
// ── WHAT EACH ASSERTION KILLS ─────────────────────────────────────────────────
//   (RENAME)  cursor inside the .theorem div → rename-environment to 'lemma':
//        the buffer holds exactly ONE fenced-div opener and it is `:::{.lemma}`;
//        `:::{.theorem}` is GONE; the div BODY line is byte-unchanged. KILLS a
//        rename that INSERTS a parallel `.lemma` env (two openers survive) and a
//        no-op (the opener stays `.theorem`).
//   (TOGGLE)  cursor on `\frac{a}{b}` → toggle-fraction: the buffer holds `a/b`
//        there and `\frac{a}{b}` is GONE; toggle AGAIN restores `\frac{a}{b}` and
//        `a/b` is GONE. KILLS a one-way toggle, a no-op, and a non-inverting
//        toggle (the second toggle does not restore the fraction).
//   (DELETE)  cursor inside `(x + y)` → delete-delimiter-pair: the buffer holds
//        `x + y` there with the parens GONE; the contents survive. KILLS a delete
//        that strips the contents too (an empty result / dropped `x + y`) and a
//        no-op (the parens stay).
//
// RED today: __PPE_E2E__.runEditorCommand fires the named command, but there are
// NO surround/toggle EDIT commands registered — no rename-environment,
// toggle-fraction, or delete-delimiter-pair — so invoking each is a NO-OP and the
// buffer is NEVER transformed. The faithful no-edits RED state. The failure is the
// MISSING edit commands, not a boot/setup error: the app, project, editor, and
// witness buffer are all brought up and the cursor placed + confirmed INSIDE each
// structure FIRST, before any edit command is invoked.

const WITNESS_FILE = 'surround.md';

// 1-based line of the first line containing `needle`, read INDEPENDENTLY off
// disk. Every structural target line is derived from the real file bytes, never
// hardcoded, so a fixture layout change cannot silently desync an assertion.
function lineOf(text: string, needle: string): number {
  const idx = text.split('\n').findIndex((l) => l.includes(needle));
  if (idx < 0) throw new Error(`needle ${JSON.stringify(needle)} not found on any line`);
  return idx + 1; // 1-based, matching cursorLine()
}

// The number of times `needle` occurs in `text` (counts fenced-div openers so a
// rename that INSERTS a parallel env — two openers — is distinguishable from one
// that edits the single existing div in place).
function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

test('surround/toggle edits transform the existing structure in place', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();
  const witnessPath = join(manifest.project, WITNESS_FILE);
  const disk = readFileSync(witnessPath, 'utf-8');

  // Target lines, resolved off disk. The fenced div, the fraction math span, and
  // the delimiter math span each sit on a distinct line.
  const DIV_OPEN_LINE = lineOf(disk, ':::{.theorem}');
  const DIV_BODY_LINE = lineOf(disk, 'A theorem body'); // INSIDE the div
  const FRAC_LINE = lineOf(disk, '\\frac{a}{b}');
  const DELIM_LINE = lineOf(disk, '(x + y)');

  expect(DIV_OPEN_LINE).toBeLessThan(DIV_BODY_LINE);
  expect(DIV_BODY_LINE).toBeLessThan(FRAC_LINE);
  expect(FRAC_LINE).toBeLessThan(DELIM_LINE);

  // The app + project + editor must be alive first, so a later failure is the
  // missing edit commands, not a boot/setup error. The witness is real markdown
  // the explorer lists; opening it shows the structured buffer in the editor.
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
  // inside-the-structure checks derive from disk are the editor's offsets too).
  const editorText0 = (await tauriPage.evaluate(
    `window.__PPE_E2E__.getEditorText()`,
  )) as string;
  expect(editorText0).toBe(disk);

  // The single existing fenced div opener: exactly one `:::{.theorem}`, no
  // `:::{.lemma}` yet — the baseline a rename must transform IN PLACE.
  expect(occurrences(editorText0, ':::{.theorem}')).toBe(1);
  expect(occurrences(editorText0, ':::{.lemma}')).toBe(0);
  // The div body line, captured verbatim off disk, must survive the rename
  // byte-for-byte (the rename touches only the class, never the body).
  const DIV_BODY_TEXT = disk.split('\n')[DIV_BODY_LINE - 1];
  expect(DIV_BODY_TEXT).toContain('A theorem body');

  // ── (RENAME) cursor INSIDE the .theorem div → rename-environment to 'lemma' ──
  // Place the cursor on the div BODY line (inside the div) and confirm it before
  // invoking the edit, so a later failure is the missing rename command.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.goToLine(${DIV_BODY_LINE}); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.cursorLine() === ${DIV_BODY_LINE}`,
    10_000,
  );

  // RED today: rename-environment is not a registered command, so this fires a
  // NO-OP and the opener stays `:::{.theorem}` — the waitForFunction times out.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.runEditorCommand('rename-environment', 'lemma'); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(':::{.lemma}')`,
    10_000,
  );
  const afterRename = (await tauriPage.evaluate(
    `window.__PPE_E2E__.getEditorText()`,
  )) as string;
  // Exactly ONE fenced-div opener, now `.lemma`; the `.theorem` opener is GONE —
  // the EXISTING div was edited in place, NOT a parallel env inserted.
  expect(occurrences(afterRename, ':::{.lemma}')).toBe(1);
  expect(occurrences(afterRename, ':::{.theorem}')).toBe(0);
  // The div body is byte-unchanged: the renamed div's body line is identical to
  // the on-disk body line.
  expect(afterRename.split('\n')).toContain(DIV_BODY_TEXT);

  // ── (TOGGLE) cursor ON `\frac{a}{b}` → toggle-fraction round-trips ──────────
  // Re-read the buffer (the rename above changed it) and place the cursor on the
  // fraction line; confirm the cursor offset lies INSIDE the `\frac{a}{b}` span.
  const beforeToggle = (await tauriPage.evaluate(
    `window.__PPE_E2E__.getEditorText()`,
  )) as string;
  const fracOpen = beforeToggle.indexOf('\\frac{a}{b}');
  expect(fracOpen).toBeGreaterThanOrEqual(0);
  const fracEnd = fracOpen + '\\frac{a}{b}'.length;
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.goToLine(${FRAC_LINE}); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.cursorLine() === ${FRAC_LINE}`,
    10_000,
  );
  const fracCursor = (await tauriPage.evaluate(
    `window.__PPE_E2E__.cursorOffset()`,
  )) as number;
  expect(fracCursor).toBeGreaterThanOrEqual(fracOpen);
  expect(fracCursor).toBeLessThanOrEqual(fracEnd);

  // RED today: toggle-fraction is not registered, so this is a NO-OP — `a/b`
  // never appears and the waitForFunction times out.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.runEditorCommand('toggle-fraction'); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes('a/b') && !window.__PPE_E2E__.getEditorText().includes('\\\\frac{a}{b}')`,
    10_000,
  );
  const toggledOnce = (await tauriPage.evaluate(
    `window.__PPE_E2E__.getEditorText()`,
  )) as string;
  expect(toggledOnce).toContain('a/b');
  expect(toggledOnce).not.toContain('\\frac{a}{b}');

  // Toggle AGAIN: the fraction is restored and `a/b` is gone — proving the toggle
  // INVERTS, not a one-way rewrite.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.goToLine(${FRAC_LINE}); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.cursorLine() === ${FRAC_LINE}`,
    10_000,
  );
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.runEditorCommand('toggle-fraction'); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes('\\\\frac{a}{b}')`,
    10_000,
  );
  const toggledBack = (await tauriPage.evaluate(
    `window.__PPE_E2E__.getEditorText()`,
  )) as string;
  expect(toggledBack).toContain('\\frac{a}{b}');
  expect(toggledBack).not.toContain('a/b');

  // ── (DELETE) cursor INSIDE `(x + y)` → delete-delimiter-pair keeps contents ──
  const beforeDelete = (await tauriPage.evaluate(
    `window.__PPE_E2E__.getEditorText()`,
  )) as string;
  const delimOpen = beforeDelete.indexOf('(x + y)');
  expect(delimOpen).toBeGreaterThanOrEqual(0);
  const delimInnerStart = delimOpen + 1; // just after the `(`
  const delimInnerEnd = delimOpen + '(x + y)'.length - 1; // just before the `)`
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.goToLine(${DELIM_LINE}); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.cursorLine() === ${DELIM_LINE}`,
    10_000,
  );
  // The cursor must lie INSIDE the delimiter pair (strictly between `(` and `)`).
  // Place it just after the opening `(` and confirm.
  const delimCursor = (await tauriPage.evaluate(
    `window.__PPE_E2E__.cursorOffset()`,
  )) as number;
  expect(delimCursor).toBeGreaterThanOrEqual(delimInnerStart - 1);
  expect(delimCursor).toBeLessThanOrEqual(delimInnerEnd + 1);

  // RED today: delete-delimiter-pair is not registered, so this is a NO-OP —
  // `(x + y)` survives and `x + y` (without parens) never appears.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.runEditorCommand('delete-delimiter-pair'); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes('$x + y$') && !window.__PPE_E2E__.getEditorText().includes('(x + y)')`,
    10_000,
  );
  const afterDelete = (await tauriPage.evaluate(
    `window.__PPE_E2E__.getEditorText()`,
  )) as string;
  // The parens are gone but the contents `x + y` survive in the math span.
  expect(afterDelete).toContain('$x + y$');
  expect(afterDelete).not.toContain('(x + y)');

  recordObservation({ spec: manifest.spec, name: 'p114-rename-environment', value: 1 });
  recordObservation({ spec: manifest.spec, name: 'p114-toggle-fraction', value: 1 });
  recordObservation({ spec: manifest.spec, name: 'p114-delete-delimiter-pair', value: 1 });
});
