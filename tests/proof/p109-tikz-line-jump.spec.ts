import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, editorText, waitForPreview } from './support/app';

// ── P109 — D-4: source↔preview line jumping for owned tikz ───────────────────
//          (TikzIt Ctrl+J jump-to-source / Ctrl+T re-parse)
//
// THE OBLIGATION (proof-obligations.md, P93 — exact behaviour, verbatim intent):
//   With owned tikz source open in the editor whose figure is RENDERED in the live
//   preview (the figure carries MULTIPLE distinct nodes), positioning the cursor on
//   a SPECIFIC node's source line — the `\node …(<name>) at (<x>,<y>){<label>};`
//   line for one chosen node — and invoking the jump (the TikzIt Ctrl+J
//   jump-to-source action) SELECTS/SCROLLS the preview to the rendered element
//   CORRESPONDING TO THAT node: the element the preview selects/scrolls to is the
//   one for the node under the cursor, NOT a different node's element and NOT a
//   no-op. Choosing a DIFFERENT node's source line and invoking the jump
//   selects/scrolls to that OTHER node's rendered element instead — the
//   correspondence is per-node, so the jump target tracks which node line the
//   cursor sits on. Separately, EDITING the tikz source — a change that alters the
//   model (e.g. renaming a node) — and then invoking the re-sync (the TikzIt Ctrl+T
//   re-parse action) UPDATES the preview to reflect the EDITED model: the rendered
//   figure after re-sync matches the edited source, and the STALE pre-edit render
//   does NOT persist.
//
// ── THE MODEL THIS RIDES (P90 / D-1) AND THE SEAM IT MAPS INTO (P100) ─────────
// D-4 maps FROM the D-1 owned tikz model (the SAME `tikz::parse(src) -> Graph`
// whose nodes carry `name` + `(x,y)` coordinate that P90's tikz_roundtrip.rs
// round-trips) INTO the rendered figure P100's now-active tikz→SVG preview compile
// seam produces (tikzcd.lua → pdflatex -interaction=nonstopmode → pdf2svg, an
// inline <svg> in the preview). This spec is BLIND to HOW the source line maps to
// the rendered element — whether the compiled SVG is annotated with per-node
// identity, whether the D-1 node coordinate is mapped to the SVG viewport
// position, or any other mechanism. It observes ONLY the user-facing outcome: which
// node identity the preview ends up TARGETING after a jump.
//
// ── THE WITNESS FIGURE: an owned tikz picture with TWO distinctly-positioned, ──
//    DISTINCTLY-NAMED, DISTINCTLY-LABELLED nodes.
// A TikzIt-class tikzpicture (the SAME grammar the D-1 parser accepts and p104
// uses): two styled, coordinate-bearing, labelled nodes far apart on the canvas so
// their rendered elements are unambiguously distinct positions —
//   (alpha) at (0, 4) {AlphaCornerXR}   — top-left
//   (omega) at (8, 0) {OmegaCornerXR}   — bottom-right (a different coordinate)
// and one edge (alpha) to (omega). The two node names (`alpha`, `omega`) are
// distinct and unique in the buffer, so the cursor can be placed on a specific
// node's line deterministically and the per-node correspondence (alpha's jump
// target MUST differ from omega's) is well-defined.
//
// ── THE OBSERVABLE CONTRACT (hooks + observables, BLIND to implementation) ────
// Webview clicks/keystrokes into the editor + preview are flaky (the reason
// P52–P62/P104/P105 drive editor + figure actions through harness hooks), so the
// cursor placement, the jump action, the re-sync action, and the preview
// jump-target read are NEW harness hooks. They are BLIND to how the source↔preview
// mapping is built; only the observables matter:
//
//   __PPE_E2E__.placeCursorOnTikzNodeLine(nodeName)   [NEW for P109 / D-4]
//     Places the REAL CM6 cursor on the owned-tikz source line that DEFINES the
//     node named `nodeName` — the `\node …(<nodeName>) at (…)…;` line in the open
//     buffer (located by parsing the owned tikz source with the D-1 parser / by
//     matching the node-definition line for that name, NOT by a caller-supplied
//     line number). The deterministic stand-in for the user clicking into that
//     node's source line. Fire-and-forget; returns null. A name that names no node
//     in the open source is a LOUD error (never a silent no-jump).
//
//   __PPE_E2E__.jumpSourceToPreview()   [NEW for P109 / D-4]
//     Performs the SAME action the TikzIt Ctrl+J jump-to-source keybinding fires:
//     resolves the node under the cursor (via the D-1 model) to its rendered
//     element in the live preview and SELECTS/SCROLLS the preview to that element.
//     Fire-and-forget; returns null. Invoking it with the cursor NOT on a node
//     line, or when the node has no rendered element, is a LOUD error — never a
//     silent scroll-to-top or no-op dressed as a jump.
//
//   __PPE_E2E__.previewJumpTarget(): string | null   [NEW for P109 / D-4]
//     Reads, from the REAL rendered preview, the IDENTITY of the node the preview
//     is CURRENTLY targeting as the result of the last jump — the `name` of the
//     owned-tikz node whose rendered element is the selected/highlighted/
//     scrolled-to element, read off the ACTUAL preview DOM the jump marked (e.g. the
//     selected element's node-identity data attribute / the highlighted element's
//     identity) — NOT a parallel JS variable the jump set, which could report a
//     target the preview never moved to. Returns null when no element is targeted
//     (the no-op state). The per-node discriminator observable: it must equal the
//     node under the cursor and DIFFER between the two nodes.
//
//   __PPE_E2E__.resyncPreviewFromSource()   [NEW for P109 / D-4]
//     Performs the SAME action the TikzIt Ctrl+T re-parse keybinding fires:
//     re-parses the (edited) owned tikz source with the D-1 parser and re-renders
//     the preview from the edited model (and re-establishes the per-node
//     source↔preview mapping the jump uses). Fire-and-forget; returns null.
//
//   __PPE_E2E__.setEditorText(t)  [reused, App.svelte:318; p73/p74 precedent] —
//     replace the whole buffer through the editor's REAL update pipeline. Used to
//     apply the source edit (rename omega → omega2) that alters the model.
//   __PPE_E2E__.getEditorText() [reused] — the live buffer, to confirm the witness
//     figure and the source edit landed.
//   previewQuery / waitForPreview [reused] — read the REAL rendered preview DOM
//     (the inline <svg> the figure compiled to) to confirm the figure is rendered
//     before the jump.
//
// ── WHAT EACH ASSERTION KILLS ─────────────────────────────────────────────────
//   (RENDERED) Before any jump, the owned tikz figure is RENDERED in the preview as
//         an inline <svg> with real drawing content — so the jump has a real
//         rendered figure to target (a later failure is the missing jump, not a
//         dormant compile). (P100's seam is active.)
//   (J-ALPHA) Place the cursor on node `alpha`'s source line, invoke the jump, and
//         the preview's jump target identity EQUALS `alpha`.
//         KILLS a NO-OP jump (previewJumpTarget() is null — nothing is targeted).
//   (J-OMEGA) Place the cursor on node `omega`'s DIFFERENT source line, invoke the
//         jump, and the preview's jump target identity EQUALS `omega`, and DIFFERS
//         from the alpha target.
//         KILLS an ALWAYS-SAME-TARGET / WRONG-ELEMENT jump (the target does not
//         change when the cursor moves to a different node line, or targets a node
//         other than the one under the cursor — the per-node correspondence broken)
//         and the no-op.
//   (RESYNC)  EDIT the owned source to RENAME `omega` to a NEW name `omega2` (a
//         change that alters the model), invoke the Ctrl+T re-sync, then place the
//         cursor on the RENAMED node's line and jump: the preview's jump target now
//         EQUALS `omega2`. A target of `omega2` can ONLY arise if the re-sync
//         RE-PARSED the edited source into the new model and re-rendered the
//         preview from it. KILLS a STALE re-sync (the preview keeps the pre-edit
//         model — `omega2` names no node the jump can resolve, so the target is
//         never `omega2`).
//
// RED today: __PPE_E2E__.placeCursorOnTikzNodeLine / jumpSourceToPreview /
// previewJumpTarget / resyncPreviewFromSource do NOT exist — there is no
// source↔preview jump action, no per-node preview targeting, no re-parse re-sync,
// and no jump-target read surface. So the FIRST jump driver evaluate throws (the
// hook is absent) — the faithful no-jump RED state. The failure below is the
// MISSING source↔preview jump, not a boot/setup error: the app, the editor, and
// the rendered figure are all brought up first.

// Two distinctly-named, distinctly-positioned, distinctly-labelled nodes and one
// edge, in the TikzIt-class grammar the D-1 parser accepts (the SAME `{=latex}`
// shape p100/p104/p105 use to put owned tikz in the editor buffer, compiled by the
// active P100 seam). Node names are unique tokens in the buffer so the cursor can
// be placed on a specific node's line deterministically.
const NODE_ALPHA = 'alpha';
const NODE_OMEGA = 'omega';
// The NEW name the source edit renames omega to — a node that does NOT exist in the
// pre-edit model, so a jump target of this name can only come from a real re-parse.
const NODE_OMEGA_RENAMED = 'omega2';
const LABEL_ALPHA = 'AlphaCornerXR';
const LABEL_OMEGA = 'OmegaCornerXR';

function buildFigure(omegaName: string): string {
  return [
    '',
    '',
    '```{=latex}',
    '\\begin{tikzpicture}',
    '\t\\begin{pgfonlayer}{nodelayer}',
    `\t\t\\node [style=object] (${NODE_ALPHA}) at (0, 4) {${LABEL_ALPHA}};`,
    `\t\t\\node [style=object] (${omegaName}) at (8, 0) {${LABEL_OMEGA}};`,
    '\t\\end{pgfonlayer}',
    '\t\\begin{pgfonlayer}{edgelayer}',
    `\t\t\\draw [style=arrow] (${NODE_ALPHA}) to (${omegaName});`,
    '\t\\end{pgfonlayer}',
    '\\end{tikzpicture}',
    '```',
    '',
  ].join('\n');
}

const FIGURE = buildFigure(NODE_OMEGA);

// Read the preview's current jump-target node identity (or null). BLIND to how the
// jump marked the element — reads the NEW hook, tolerating its absence (returns
// null) so the failure is the missing jump surface, not a thrown read.
async function previewJumpTarget(page: {
  evaluate(expr: string): Promise<unknown>;
}): Promise<string | null> {
  const raw = await page.evaluate(
    `(() => {
      const fn = window.__PPE_E2E__ && window.__PPE_E2E__.previewJumpTarget;
      if (!fn) return JSON.stringify(null);
      return JSON.stringify(fn() ?? null);
    })()`,
  );
  if (typeof raw !== 'string') {
    throw new Error(`previewJumpTarget returned non-string: ${JSON.stringify(raw)}`);
  }
  return JSON.parse(raw) as string | null;
}

// Place the cursor on `nodeName`'s source line and invoke the Ctrl+J jump, then
// await the preview targeting that node. The first evaluate throws today (the hook
// is absent) — the faithful no-jump RED.
async function jumpFromNode(
  page: { evaluate(e: string): Promise<unknown>; waitForFunction(e: string, t?: number): Promise<unknown> },
  nodeName: string,
): Promise<void> {
  await page.evaluate(
    `(() => { window.__PPE_E2E__.placeCursorOnTikzNodeLine(${JSON.stringify(nodeName)}); return null; })()`,
  );
  await page.evaluate(
    `(() => { window.__PPE_E2E__.jumpSourceToPreview(); return null; })()`,
  );
  await page.waitForFunction(
    `(() => {
      const fn = window.__PPE_E2E__ && window.__PPE_E2E__.previewJumpTarget;
      if (!fn) return false;
      return fn() === ${JSON.stringify(nodeName)};
    })()`,
    15_000,
  );
}

test('the source↔preview jump from a node line targets THAT node\'s rendered element (a different node line targets a different element), and a source edit + re-sync updates the preview model', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // The app + editor must be alive first, so a later failure is the missing
  // source↔preview jump, not a boot/setup error.
  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );
  await waitForPreview(tauriPage, `return d.querySelector('h1') !== null;`);

  // Place the witness owned tikz figure in the buffer through the REAL editor
  // update pipeline (the SAME docChanged → scheduleRender(debounce) → real pandoc →
  // tikzcd.lua → pdflatex figure-compile path user typing fires).
  await appendAtEnd(tauriPage, FIGURE);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(LABEL_OMEGA)})`,
    10_000,
  );
  const buffer = await editorText(tauriPage);
  // Sanity: both distinctly-named nodes are present in the owned source the jump
  // maps from — so a per-node target difference is a real difference, not an
  // artifact of one node never existing.
  expect(buffer).toContain(`(${NODE_ALPHA})`);
  expect(buffer).toContain(`(${NODE_OMEGA})`);
  expect(buffer).toContain(LABEL_ALPHA);
  expect(buffer).toContain(LABEL_OMEGA);

  // (RENDERED) The owned tikz figure compiles to a real inline <svg> in the preview
  // (P100's seam is active) — the jump has a real rendered figure to target. This
  // makes the later jump failure unambiguously the missing jump, not a missing
  // render.
  await waitForPreview(
    tauriPage,
    `const all = d.querySelectorAll('svg'); const s = all[all.length - 1]; return !!s && s.querySelector('path, line, g, text, polyline, rect') !== null;`,
  );

  // (J-ALPHA) Place the cursor on node alpha's source line and invoke the jump. The
  // preview's jump target must be alpha's rendered element.
  // RED today: __PPE_E2E__.placeCursorOnTikzNodeLine does not exist (there is no
  // source↔preview jump surface), so the first evaluate inside jumpFromNode throws —
  // the faithful no-jump RED state.
  await jumpFromNode(tauriPage, NODE_ALPHA);
  const alphaTarget = await previewJumpTarget(tauriPage);
  // KILLS the no-op (null) and a target that is not alpha.
  expect(alphaTarget).toBe(NODE_ALPHA);

  // (J-OMEGA) Move the cursor to node omega's DIFFERENT source line and invoke the
  // jump again. The preview's jump target must now be omega's rendered element —
  // a DIFFERENT target than alpha's. The discriminator that kills the
  // always-same-target / wrong-element jump.
  await jumpFromNode(tauriPage, NODE_OMEGA);
  const omegaTarget = await previewJumpTarget(tauriPage);
  // KILLS the always-same-target / wrong-element jump and the no-op:
  expect(omegaTarget).toBe(NODE_OMEGA);
  // The decisive per-node discriminator: the two nodes' jump targets DIFFER.
  expect(omegaTarget).not.toBe(alphaTarget);

  // (RESYNC) EDIT the owned source to RENAME omega → omega2 (a change that alters
  // the model), through the editor's REAL update pipeline (setEditorText, the
  // p73/p74 precedent). The pre-edit model has no node `omega2`.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.setEditorText(${JSON.stringify(buildFigure(NODE_OMEGA_RENAMED))}); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `(() => {
      const t = window.__PPE_E2E__.getEditorText();
      return t.includes('(${NODE_OMEGA_RENAMED})') && !t.includes('(${NODE_OMEGA})');
    })()`,
    10_000,
  );

  // Invoke the Ctrl+T re-parse re-sync. RED today:
  // __PPE_E2E__.resyncPreviewFromSource does not exist, so this evaluate throws —
  // there is no re-sync action.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.resyncPreviewFromSource(); return null; })()`,
  );

  // The preview must reflect the EDITED model: a jump from the RENAMED node's line
  // now targets `omega2`. That target can ONLY arise if the re-sync re-parsed the
  // edited source into the new model and re-rendered the per-node mapping from it.
  // KILLS a STALE re-sync (the preview keeps the pre-edit model — `omega2` names no
  // node, so the jump target is never `omega2`).
  await jumpFromNode(tauriPage, NODE_OMEGA_RENAMED);
  const renamedTarget = await previewJumpTarget(tauriPage);
  expect(renamedTarget).toBe(NODE_OMEGA_RENAMED);

  recordObservation({ spec: manifest.spec, name: 'p109-alpha-target', value: String(alphaTarget) });
  recordObservation({ spec: manifest.spec, name: 'p109-omega-target', value: String(omegaTarget) });
  recordObservation({ spec: manifest.spec, name: 'p109-resync-target', value: String(renamedTarget) });
});
