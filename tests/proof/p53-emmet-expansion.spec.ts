import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, expandEmmet, editorText } from './support/app';

// ── P53 — Emmet abbreviation expands ────────────────────────────────────────
//
// THE OBLIGATION (proof-obligations.md, exact wording):
//   Typing an Emmet abbreviation in the editor and firing the Emmet-expand
//   action replaces the abbreviation with the expanded markup at the cursor.
//   Type an Emmet abbreviation that uniquely discriminates a real expansion (a
//   multi-character/multi-element expansion Emmet produces, e.g. one that yields
//   nested elements, repeated siblings, or attribute/class wrappers from a terse
//   source) and invoke the Emmet-expand action: the abbreviation text is gone and
//   the buffer at the cursor now holds the expanded markup it denotes, with the
//   cursor landing inside the expansion. Admissible because it fails when the
//   Emmet extension/keymap is absent — the abbreviation stays literal in the
//   buffer (the expand action is a no-op and the typed abbreviation is echoed
//   verbatim rather than replaced by the markup it expands to).
//
// ── THE EXPAND-ACTION CONTRACT (what the implementer must wire) ──────────────
// Emmet's expand is a real editor command. The implementer must:
//   (a) install an Emmet plugin for CM6 and bind its expand command to the
//       USER-FACING keybinding `Ctrl-e` (Emmet's standard `expandAbbreviation`),
//       composed into EditorPane's keymap alongside the existing bindings — NOT
//       replacing them; and
//   (b) expose `__PPE_E2E__.expandEmmet()`, a harness hook that runs the SAME
//       Emmet expand command against the live view. The bridge cannot synthesize
//       `Ctrl-e` into CodeMirror's contentEditable (the same reason P51/P52 use
//       hooks rather than synthetic keys), so this hook is the in-harness firing
//       of the very command the keybinding fires — it adds no behaviour, only an
//       entry point.
//
// ── THE DISCRIMINATING WITNESS (the abbreviation + its unique expansion) ─────
// Abbreviation:  ul>li.item$*3
// Emmet's canonical expansion (and ONLY Emmet's) of this terse source:
//
//     <ul>
//       <li class="item1"></li>
//       <li class="item2"></li>
//       <li class="item3"></li>
//     </ul>
//
// This is maximally discriminating: it combines child nesting (`>`), a class
// attribute (`.item`), repetition (`*3`), and the `$` numbering operator, which
// emits the running index into each class — item1/item2/item3. Those numbered
// class names are something ONLY Emmet's expander produces from the source
// `ul>li.item$*3`; no literal echo, naive paste, or generic insertion could
// invent `class="item2"`. So the witnesses below cannot be satisfied by anything
// other than a real Emmet expansion of this exact abbreviation.
//
// ── THE OBSERVABLE CONTRACT (BLIND to implementation) ────────────────────────
//   appendAtEnd(text) [reused] — inserts `text` at the buffer end through the
//     REAL editor update pipeline (the docChanged path user typing fires) and
//     leaves the cursor at the END of the inserted text — i.e. directly after the
//     abbreviation, which is exactly the position Emmet expands from. Unlike
//     typeInEditor, it does NOT open the completion tooltip, so the abbreviation
//     sits in the buffer untouched until the expand action fires.
//   expandEmmet() [NEW for P53] — fires the Emmet expand command (above).
//   getEditorText() [reused] — the live editor buffer text, the observable.
//
// ── WHAT THIS KILLS ──────────────────────────────────────────────────────────
//   The expansion assertions KILL the Emmet-absent / keymap-unbound app: with no
//   Emmet plugin and no expand command, firing the action is a NO-OP and the
//   literal abbreviation `ul>li.item$*3` is echoed verbatim — the markup it
//   denotes never appears. Concretely:
//     - the literal abbreviation token `ul>li.item$*3` SURVIVES in the buffer
//       (it would be GONE after a real expansion); and
//     - the numbered-class markup `<li class="item1">` / `item2` / `item3` and
//       the wrapping `<ul>` … `</ul>` are ABSENT (they only exist after Emmet
//       expands the source).
//   Today this assertion is unreachable: __PPE_E2E__.expandEmmet does not exist,
//   so expandEmmet() throws — itself faithful evidence that there is no Emmet
//   expand surface in the app at all.
//
// Together the assertions pin the full obligation: the abbreviation is replaced
// (gone) by the multi-element, numbered-class markup Emmet uniquely denotes.

const ABBREV = 'ul>li.item$*3';

test('Firing the Emmet-expand action replaces the abbreviation with its expanded markup', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // Type the abbreviation on its own line at the buffer end. appendAtEnd leaves
  // the cursor directly after the abbreviation — the position Emmet expands from.
  await appendAtEnd(tauriPage, '\n\n' + ABBREV);

  // Sanity: the literal abbreviation is in the buffer before expansion, and its
  // expansion is not yet present. (Proves the witnesses below measure a real
  // transformation, not pre-existing text.)
  const before = await editorText(tauriPage);
  expect(before).toContain(ABBREV);
  expect(before).not.toContain('class="item2"');

  // Fire the Emmet-expand action — the SAME command the `Ctrl-e` keybinding
  // fires. RED today: __PPE_E2E__.expandEmmet does not exist, so this throws —
  // there is no Emmet expand surface in the app.
  await expandEmmet(tauriPage);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes('class="item2"')`,
    10_000,
  );

  const after = await editorText(tauriPage);

  // (1) The expanded markup Emmet uniquely denotes is now in the buffer: the
  // wrapping <ul>…</ul> and three numbered-class <li> siblings.
  expect(after).toContain('<ul>');
  expect(after).toContain('</ul>');
  expect(after).toContain('class="item1"');
  expect(after).toContain('class="item2"');
  expect(after).toContain('class="item3"');

  // (2) The literal abbreviation is GONE — replaced by its expansion, not echoed
  // verbatim alongside it. This is the assertion the Emmet-absent app fails: a
  // no-op expand leaves `ul>li.item$*3` literal in the buffer.
  expect(after).not.toContain(ABBREV);

  recordObservation({ spec: manifest.spec, name: 'emmet-abbreviation', value: ABBREV });
  recordObservation({ spec: manifest.spec, name: 'emmet-expanded', value: 1 });
});
