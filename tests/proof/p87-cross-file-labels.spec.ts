import { test, expect } from './fixtures';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  appendAtEnd,
  typeInEditor,
  acceptCompletion,
  completionLabels,
  editorText,
  currentFile,
} from './support/app';

// ── P87 — Cross-file label completion spans the whole project ────────────────
//
// THE OBLIGATION (proof-obligations.md, exact wording):
//   In a project containing TWO markdown files, a label/anchor — a pandoc `{#id}`
//   heading attribute, a `:::{#id}` fenced-div id, or a `\label{}` — is defined in
//   file A. Opening file B and triggering label completion offers the label
//   defined in the OTHER file (file A), proving the label index spans the whole
//   project, not just the current buffer. Accepting the offered label inserts a
//   reference to that label at the cursor.
//
// ── THE PROJECT-OWNED SOURCE (what the candidates come from) ──────────────────
// P87/C3 is an INDEPENDENT completion source: labels are harvested from the
// project's markdown files, NOT from editor.bibliography. The witness project
// ships two markdown files — demo.md (file B, the file the spec opens and edits)
// and outline.md (file A). This run (scripts/provision-proof.sh, the p87 case)
// appends to file A, in THIS spec's hermetic project copy only, a DISTINCTIVE
// label:
//
//   A cross-file lemma. \label{lem:xyz-cross}
//
// The label token `xyz-cross` appears in NEITHER demo.md nor outline.md before
// this append — verified independently off disk below. So a candidate surfaced
// for `lem:xyz-cross` while editing demo.md can ONLY have come from harvesting
// the OTHER file (outline.md); a buffer-local index could never offer it, because
// the open buffer (demo.md) does not contain that label.
//
// ── THE OBSERVABLE CONTRACT (driven through the EDITOR UI, parser-agnostic) ───
// This spec is BLIND to how labels are harvested or indexed. It drives only the
// editor UI and asserts on the REAL rendered CM6 autocomplete DOM, the SAME
// surface every completion proof (P51/P52/P85) asserts against:
//
//   typeInEditor(text)   — inserts `text` at the cursor through the real
//     docChanged pipeline and opens completion (CM6 startCompletion). The
//     deterministic stand-in for synthetic keystrokes the bridge cannot send into
//     CodeMirror's contentEditable.
//   completionLabels()   — the option labels in the open `.cm-tooltip-
//     autocomplete` popup (its `.cm-completionLabel` elements). An option is
//     "offered" iff its label text is present in the open tooltip.
//   acceptCompletion()   — runs CM6's real acceptCompletion command against the
//     live view (the Enter-key path), accepting the currently-highlighted option.
//   getEditorText()      — the live editor buffer text.
//
// ── THE TRIGGER (a cross-reference / label context) ──────────────────────────
// The obligation's labels are LaTeX/pandoc cross-reference targets, so the
// trigger is a cross-reference command — `\cref{` (the cleveref command this
// research workflow uses). Typing `\cref{lem` in file B opens completion in a
// label-reference context; the cross-file source must then offer file A's label.
//
// ── WHAT EACH ASSERTION KILLS ────────────────────────────────────────────────
//   (1) The label token `lem:xyz-cross` is genuinely defined in file A
//       (outline.md) and is ABSENT from the open buffer file B (demo.md) — both
//       verified independently off disk. This is the discriminator: any candidate
//       offered for it while editing demo.md had to be harvested cross-file.
//   (2) After opening file B (demo.md) and typing the cross-reference trigger
//       `\cref{lem`, the autocomplete popup OPENS and offers a candidate carrying
//       file A's label `lem:xyz-cross`.
//       KILLS the no-cross-file-source app: with no project-wide label index, the
//       popup holds no candidate for a label defined only in the OTHER file (the
//       LaTeX-command monopoly and the citation source neither harvest project
//       labels), so `lem:xyz-cross` is never offered while editing demo.md.
//       KILLS a buffer-local label index too: demo.md does not contain that
//       label, so a current-buffer-only source could never surface it.
//   (3) Accepting the offered label inserts a REFERENCE to that label at the
//       cursor — the buffer now carries `lem:xyz-cross` as the reference target
//       (e.g. `\cref{lem:xyz-cross}`), the label from the OTHER file.
//       KILLS an accept that inserts nothing / the wrong token.
//
// ── WHY THE APP IS RED TODAY ─────────────────────────────────────────────────
// No cross-file label completion source is registered. typeInEditor('\\cref{lem')
// opens the standard popup but it holds NO candidate harvested from the project's
// other markdown files — the editor has a LaTeX-command completion monopoly, a
// snippet source, and (Phase C) a citation source, none of which harvests project
// labels. So assertion (2) fails behaviorally: no `lem:xyz-cross` candidate is
// offered for the cross-reference trigger because the cross-file label source does
// not exist.

// The distinctive label provisioning appends to file A (outline.md). The token is
// absent from both files beforehand, so it is the cross-file discriminator.
const LABEL = 'lem:xyz-cross';
// A cross-reference trigger placing the cursor in a label-reference context.
const REF_TRIGGER = '\\cref{lem';

// Read a file off disk in an INDEPENDENT process (never trusting the app's own
// report of its bytes), mirroring p85/p86 independent-read discipline. Used to
// prove the label is genuinely in file A and genuinely absent from open file B.
function readFileIndependently(path: string): string {
  return execFileSync('cat', [path], { encoding: 'utf-8' });
}

test('a label defined in another project file is offered for a cross-reference trigger while editing a second file, and accepting inserts a reference to it', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // Open file B (demo.md) — the file the spec edits. file A (outline.md) is the
  // OTHER project file, carrying the label, and is NOT opened.
  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // The active buffer is file B (demo.md), not file A.
  const openFile = await currentFile(tauriPage);
  expect(openFile.endsWith('/demo.md')).toBe(true);

  // (1) The discriminator, verified independently off disk: the distinctive label
  // is defined in file A (outline.md) and is ABSENT from the open buffer file B
  // (demo.md). So any candidate surfaced for it while editing demo.md had to be
  // harvested from the OTHER file — a buffer-local index could never offer it.
  const fileA = join(manifest.project, 'outline.md');
  const fileB = join(manifest.project, 'demo.md');
  const fileABytes = readFileIndependently(fileA);
  const fileBBytes = readFileIndependently(fileB);
  expect(fileABytes).toContain(`\\label{${LABEL}}`);
  expect(fileBBytes.includes(LABEL)).toBe(false);

  // The buffer before: the cross-file label is not already present as text.
  const before = await editorText(tauriPage);
  expect(before.includes(LABEL)).toBe(false);

  // Put the cursor on a fresh blank line. appendAtEnd lands the cursor at the end
  // of the appended text.
  await appendAtEnd(tauriPage, '\n\n');

  // LIVENESS GUARD — prove the completion machinery is ALIVE in THIS exact buffer
  // and run, so the RED below cannot be misread as "completion is dead / the popup
  // never opens." Typing a backslash-command fragment opens the standard popup and
  // offers a LaTeX command (\alpha), exactly as P51 asserts. This pins the
  // subsequent failure to the MISSING cross-file label source, not broken wiring.
  await typeInEditor(tauriPage, '\\al');
  await tauriPage.waitForFunction(
    `(() => {
      const tip = document.querySelector('.cm-tooltip-autocomplete');
      if (!tip) return false;
      return Array.from(tip.querySelectorAll('.cm-completionLabel'))
        .some((el) => (el.textContent || '') === '\\\\alpha');
    })()`,
    10_000,
  );
  // Clear the liveness probe so it cannot leak into the cross-reference query.
  await appendAtEnd(tauriPage, '\n\n');

  // (2) Type a cross-reference trigger in file B. The completion popup must open
  // and offer a candidate carrying file A's label `lem:xyz-cross` — a label
  // defined ONLY in the OTHER file, proving the label index spans the project.
  // RED today: no cross-file label source is registered, so no `lem:xyz-cross`
  // candidate is ever offered while editing demo.md (the popup either does not
  // open for a `\cref{` reference context, or opens with no cross-file label in
  // it). The liveness guard above already proved the popup machinery works, so
  // this timeout is the genuine "no cross-file label source" failure.
  await typeInEditor(tauriPage, REF_TRIGGER);
  await tauriPage.waitForFunction(
    `(() => {
      const tip = document.querySelector('.cm-tooltip-autocomplete');
      if (!tip) return false;
      return Array.from(tip.querySelectorAll('.cm-completionLabel'))
        .some((el) => (el.textContent || '').includes(${JSON.stringify(LABEL)}));
    })()`,
    10_000,
  );
  const labels = await completionLabels(tauriPage);
  expect(labels.some((l) => l.includes(LABEL))).toBe(true);

  // (3) Accept the highlighted candidate. The buffer must now carry a REFERENCE
  // to that label — the cross-file label `lem:xyz-cross` as the reference target.
  await acceptCompletion(tauriPage);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(LABEL)})`,
    10_000,
  );
  const after = await editorText(tauriPage);
  expect(after.includes(LABEL)).toBe(true);

  recordObservation({ spec: manifest.spec, name: 'cross-file-label', value: LABEL });
});
