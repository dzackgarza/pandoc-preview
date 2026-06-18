import { test, expect } from './fixtures';
import { execFileSync } from 'node:child_process';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import {
  openAndSelectDemo,
  appendAtEnd,
  typeInEditor,
  acceptCompletion,
  completionLabels,
  editorText,
} from './support/app';

// ── P85 — @-trigger citation completion with metadata fuzzy-match ────────────
//
// THE OBLIGATION (proof-obligations.md, exact wording):
//   Typing `@` in a citation trigger position — at line start, immediately after
//   whitespace, or immediately after an opening bracket — opens the editor's
//   completion tooltip offering candidates drawn from the configured
//   bibliography. The candidate list filters against the entry's author, year,
//   and title, not the cite key alone: a query that matches a word appearing in
//   an entry's TITLE surfaces that entry even when the entry's KEY does not
//   contain that word (proving the match string is built from the bibliographic
//   metadata, not the key). Accepting a candidate inserts pandoc citation syntax
//   at the cursor — a bracketed `[@<key>]` or a narrative `@<key>` reference to
//   the chosen entry — not the bare cite key as plain text and not a literal
//   label.
//
// ── THE CONFIG-OWNED SOURCE (what the candidates come from) ──────────────────
// The candidates are drawn from the ONE config-declared bibliography P84/C1
// established: editor.bibliography (a required, existing-file-validated config
// key, the sibling of configFontSize the frontend can already read). This run
// (scripts/provision-proof.sh, the p85/p86 case) points that SAME config value
// at the committed fixture tests/proof/fixtures/p85-bib.bib, whose entry
//
//   @article{xq7,
//     author = {Grothendieck, Alexander and Serre, Jean-Pierre},
//     title  = {Crystalline cohomology of supersingular abelian varieties},
//     year   = {1977}, ... }
//
// carries a KEY (`xq7`) that contains NONE of the title words ("crystalline",
// "supersingular", "cohomology") and NEITHER author surname. So a query on the
// TITLE word `crystalline` can surface this entry ONLY if the candidate match
// string is built from the entry's bibliographic METADATA, never from the key.
//
// ── THE OBSERVABLE CONTRACT (driven through the EDITOR UI, parser-agnostic) ───
// This spec is BLIND to how the .bib is parsed. It drives only the editor UI and
// asserts on the REAL rendered CM6 autocomplete DOM, the SAME surface every
// completion proof (P51/P52/P59) asserts against:
//
//   typeInEditor(text)   — inserts `text` at the cursor through the real
//     docChanged pipeline and opens completion (CM6 startCompletion). The
//     deterministic stand-in for synthetic keystrokes the bridge cannot send
//     into CodeMirror's contentEditable.
//   completionLabels()   — the option labels in the open `.cm-tooltip-
//     autocomplete` popup (its `.cm-completionLabel` elements). An option is
//     "offered" iff its label text is present in the open tooltip.
//   acceptCompletion()   — runs CM6's real acceptCompletion command against the
//     live view (the Enter-key path), accepting the currently-highlighted
//     option.
//   getEditorText()      — the live editor buffer text.
//
// ── WHAT EACH ASSERTION KILLS ────────────────────────────────────────────────
//   (1) After appending a fresh blank line (the cursor at LINE START — a
//       citation trigger position) and typing `@crystalline`, the autocomplete
//       popup OPENS and offers a candidate for the fixture entry whose KEY is
//       `xq7`.
//       KILLS the no-citation-source app: with no @-trigger citation source,
//       typing `@crystalline` opens nothing matching the bibliography (the LaTeX
//       monopoly offers no bib entry), so no candidate for `xq7` is ever offered.
//   (2) The query word `crystalline` is a TITLE word ABSENT from the key `xq7`
//       AND from BOTH author surnames — verified independently off disk from the
//       configured bibliography. That the entry STILL surfaces for this query
//       proves the candidate match string is built from the metadata, not the
//       key. KILLS a key-only matcher (which would never surface `xq7` for a
//       title word) and a hardcoded candidate list (which is not the configured
//       bib's entry).
//   (3) Accepting the candidate inserts pandoc citation SYNTAX referencing the
//       chosen entry — `[@xq7]` (bracketed) or `@xq7` (narrative) — into the
//       buffer, and the literal query word `crystalline` no longer stands as
//       plain text in its place.
//       KILLS a plain-text insert (the bare key, or the title word left as
//       prose) and a literal-label insert: only a citation-syntax insert
//       referencing `xq7` passes.
//
// ── WHY THE APP IS RED TODAY ─────────────────────────────────────────────────
// No @-trigger citation completion source is registered against the configured
// bibliography. typeInEditor('@crystalline') opens the standard popup but it
// holds NO candidate sourced from editor.bibliography — the editor has a
// LaTeX-command completion monopoly and a snippet source, neither of which reads
// the bib. So assertion (1) fails behaviorally: no `xq7` candidate is offered
// for a title-word query because the @-trigger citation source does not exist.

const KEY = 'xq7';
// A TITLE word of the fixture entry that is ABSENT from its cite key (and from
// both author surnames) — the discriminator that forces a metadata match.
const TITLE_QUERY = 'crystalline';

// Read a file off disk in an INDEPENDENT process (never trusting the app's own
// report of its bytes), mirroring p84 / support/toml.ts independent-read
// discipline. Used to prove the discriminator query word is genuinely absent
// from the key and authors in the CONFIGURED bibliography this run points at.
function readFileIndependently(path: string): string {
  return execFileSync('cat', [path], { encoding: 'utf-8' });
}

test('typing @ surfaces a configured-bibliography candidate by a title word absent from its key, and accepting inserts pandoc citation syntax', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // Independently confirm the discriminator: in the CONFIGURED bibliography the
  // frontend reads (editor.bibliography), the query word is a TITLE word that
  // does NOT appear in the entry's KEY nor in either author surname. So any
  // candidate surfaced for this query had to be matched on metadata, not key.
  const bibPath = await tauriPage.evaluate(
    `(() => { const p = window.__PPE_E2E__.configBibliography(); return p === null || p === undefined ? null : String(p); })()`,
  );
  expect(typeof bibPath).toBe('string');
  const bibBytes = readFileIndependently(bibPath as string).toLowerCase();
  const keyLine = `{${KEY},`;
  expect(bibBytes).toContain(keyLine.toLowerCase());
  // The query word IS in the bib (as a title word) ...
  expect(bibBytes).toContain(TITLE_QUERY.toLowerCase());
  // ... but the cite key itself does NOT contain it (and authors do not either):
  // the key token `xq7` shares no substring with `crystalline`.
  expect(KEY.toLowerCase().includes(TITLE_QUERY.toLowerCase())).toBe(false);
  expect(TITLE_QUERY.toLowerCase().includes(KEY.toLowerCase())).toBe(false);
  // Cross-check the authors carry no `crystalline` either (it is title-only): the
  // only line carrying it must be the title line, so the entry can be reached
  // ONLY via the title field of the metadata.
  const carrierLines = bibBytes
    .split('\n')
    .filter((l) => l.includes(TITLE_QUERY.toLowerCase()));
  expect(carrierLines.length).toBe(1);
  expect(carrierLines[0]).toContain('title');

  // The buffer before: no citation syntax for our key, and the query word is not
  // already present as prose.
  const before = await editorText(tauriPage);
  expect(before).not.toContain(`@${KEY}`);

  // Put the cursor at a citation trigger position: a fresh blank line (line
  // start). appendAtEnd lands the cursor at the end of the appended text.
  await appendAtEnd(tauriPage, '\n\n');

  // (1)+(2) Type the @-trigger followed by a TITLE-word query. The completion
  // popup must open and offer a candidate for the fixture entry whose KEY is
  // `xq7` — surfaced by a title word ABSENT from that key, proving the match is
  // built from metadata. RED today: no @-trigger citation source is registered
  // against editor.bibliography, so no `xq7` candidate is ever offered for this
  // query.
  await typeInEditor(tauriPage, `@${TITLE_QUERY}`);
  await tauriPage.waitForFunction(
    `!!document.querySelector('.cm-tooltip-autocomplete')`,
    10_000,
  );
  // The offered candidate must REFERENCE the chosen entry's key. The label set
  // surfaced for a title-word query must include an option carrying `xq7` (the
  // candidate for the metadata-matched entry).
  await tauriPage.waitForFunction(
    `(() => {
      const tip = document.querySelector('.cm-tooltip-autocomplete');
      if (!tip) return false;
      return Array.from(tip.querySelectorAll('.cm-completionLabel'))
        .some((el) => (el.textContent || '').includes(${JSON.stringify(KEY)}));
    })()`,
    10_000,
  );
  const labels = await completionLabels(tauriPage);
  expect(labels.some((l) => l.includes(KEY))).toBe(true);

  // (3) Accept the highlighted candidate. The buffer must now carry pandoc
  // citation SYNTAX referencing the chosen entry — bracketed `[@xq7]` or
  // narrative `@xq7` — not the bare key as prose and not a literal label, and the
  // title-word query must no longer stand as plain text in its place.
  await acceptCompletion(tauriPage);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify('@' + KEY)})`,
    10_000,
  );
  const after = await editorText(tauriPage);
  const bracketed = after.includes(`[@${KEY}]`);
  const narrative = after.includes(`@${KEY}`);
  expect(bracketed || narrative).toBe(true);
  // The query word is not left dangling as prose immediately after the cite.
  expect(after).not.toContain(`@${KEY}${TITLE_QUERY}`);

  recordObservation({ spec: manifest.spec, name: 'citation-completion-key', value: KEY });
  recordObservation({
    spec: manifest.spec,
    name: 'citation-completion-title-query',
    value: TITLE_QUERY,
  });
});
