import { test, expect } from './fixtures';
import { loadRunManifest } from './support/run-manifest';
import { recordObservation } from './support/observations';
import { openAndSelectDemo, appendAtEnd, editorText, seedSelection } from './support/app';

// ── P104 — D-8: copy a SELECTED subgraph of owned tikz source as canonical tikz ─
//
// THE OBLIGATION (proof-obligations.md, P97 — exact behaviour, verbatim intent):
//   With a tikz figure open in the editor whose owned tikz source carries
//   MULTIPLE nodes and edges, SELECTING a subgraph — a region of that owned tikz
//   source covering a PROPER SUBSET of its nodes/edges (not the whole picture) —
//   and invoking the copy-subgraph action places onto the SYSTEM clipboard
//   EXACTLY that subgraph rendered as deterministic CANONICAL tikz: the clipboard
//   text, read by an INDEPENDENT process and RE-PARSED by the app's own tikz
//   parser (the D-1 / P90 parser), yields a graph whose nodes and edges are
//   EXACTLY those of the selected subgraph — the selected nodes/edges with their
//   names, coordinates, props, and labels, and the edges whose BOTH endpoints lie
//   in the selection — and NO node or edge outside the selection. The clipboard
//   carries canonical tikz produced by the SAME Graph::to_tikz() serializer P90
//   round-trips, so the copied text re-parses STABLY back to the selected
//   subgraph (not the verbatim selected characters, not a non-round-trippable
//   serialization). A selection that is NOT parseable as tikz is a LOUD error.
//
// ── THE OWNED MODEL THIS REUSES (P90 / D-1) ──────────────────────────────────
// D-8 reuses the D-1 owned tikz model: the SAME `tikz::parse(src) -> Graph` and
// the SAME canonical `Graph::to_tikz()` serializer that P90's
// src-tauri/tests/tikz_roundtrip.rs round-trips over real TikzIt-class `.tikz`
// fixtures. The clipboard output of the copy-subgraph action MUST be re-parseable
// by that SAME parser back into the selected subgraph — never a verbatim
// raw-character copy, never a serialization the parser cannot re-parse. This spec
// proves that observable end-to-end through the real app on a real display: it
// re-parses the clipboard text through the app's OWN parser hook and asserts the
// structured node/edge content is EXACTLY the selected subgraph.
//
// ── THE WITNESS FIGURE: 4 nodes, 4 edges (a commutative square) ───────────────
// A TikzIt-class tikzpicture identical in shape to the P90 commutative_square
// fixture: four styled, coordinate-bearing, labelled nodes (0)=$A$, (1)=$B$,
// (2)=$C$, (3)=$D$, and four styled edges (0)->(1), (0)->(2), (1)->(3),
// (2)->(3). The node-definition lines for (0) and (1) are ADJACENT in source so a
// single contiguous editor selection covers EXACTLY those two nodes — the
// TikzIt "select a region of nodes" gesture. The induced subgraph is nodes
// {(0),(1)} plus the one edge whose BOTH endpoints are selected, (0)->(1).
// Excluded: nodes (2)=$C$ and (3)=$D$, and the three edges (0)->(2), (1)->(3),
// (2)->(3) (each has an endpoint outside the selection).
//
// The selected subgraph (what the clipboard MUST hold, canonically):
//   nodes:  (0) at (0,2) {$A$} style object ; (1) at (2,2) {$B$} style object
//   edges:  (0)->(1) style arrow
// Everything outside (the $C$ / $D$ nodes, the three other edges) MUST be absent.
//
// ── THE OBSERVABLE CONTRACT (hooks + observables, BLIND to implementation) ────
// To drive this deterministically the harness must (1) open a figure whose owned
// tikz source carries the four nodes/edges, (2) establish a REAL selection over
// the two adjacent node lines (the SAME CM6 selection state P83's seedSelection
// produces — a non-empty selection.main over that span), (3) invoke the
// copy-subgraph action, and (4) read the SYSTEM clipboard from an INDEPENDENT
// path and re-parse it. Webview clicks into a copy control are flaky (the reason
// P52–P62 drive bar/editor actions through harness hooks), so the copy action and
// the independent re-parse are NEW harness hooks (BLIND to how they are built;
// only the observables matter):
//
//   __PPE_E2E__.copySelectedSubgraphAsTikz()   [NEW for P104 / D-8]
//     Performs the SAME action a user's "copy selected subgraph" control fires:
//     parses the open buffer's owned tikz source with the D-1 parser, intersects
//     it with the LIVE editor selection to form the induced subgraph (selected
//     nodes + the edges whose BOTH endpoints are selected), serializes that
//     subgraph with the SAME canonical Graph::to_tikz() serializer, and writes
//     the resulting canonical tikz onto the REAL system clipboard (the
//     clipboard-manager plugin's writeText path — the sibling of P62's
//     paste_clipboard_image). A selection whose covered source is NOT parseable
//     tikz is a LOUD error; the clipboard is never populated with a raw-text
//     guess. Fire-and-forget; returns null. The decisive observable afterwards is
//     the SYSTEM clipboard, read INDEPENDENTLY below.
//
//   __PPE_E2E__.readClipboardText()   [NEW for P104 / D-8]
//     Reads the current SYSTEM clipboard text through the clipboard-manager
//     plugin's read-text path (the capability default.json already grants
//     clipboard-manager:allow-read-text). This is the INDEPENDENT read: it does
//     NOT call the copy action and does NOT trust the copy action's own report of
//     what it wrote — it observes the actual bytes that landed on the real system
//     clipboard, exactly as P62 lists the configured figures dir independently of
//     the paste action's report. Returns the clipboard string.
//
//   __PPE_E2E__.parseTikz(src)   [NEW for P104 / D-8]
//     Re-parses `src` through the app's OWN tikz parser (the SAME D-1
//     tikz::parse the P90 round-trip uses) and returns the structured graph as
//     JSON: { nodes: [{ name, x, y, style, label }], edges: [{ source, target,
//     style }] }, or throws a LOUD error if `src` is not parseable tikz. This is
//     the faithful re-parse the obligation demands: the clipboard text is fed
//     back through the parser and the recovered structure is asserted to be
//     EXACTLY the selected subgraph — proving the clipboard carries canonical,
//     round-trippable tikz, not verbatim selected characters and not a
//     non-re-parseable serialization.
//
// ── WHAT EACH ASSERTION KILLS ─────────────────────────────────────────────────
//   (A) Baseline: before the copy, the system clipboard does NOT already carry the
//       witness tikz (a sentinel is seeded onto it, then the copy must REPLACE it).
//       This proves the post-copy clipboard content is produced by the copy
//       action, not pre-existing.
//   (B) After copySelectedSubgraphAsTikz(), the clipboard text CONTAINS the
//       selected nodes' identity — node (0)'s label $A$ and node (1)'s label $B$,
//       and their coordinates — and the induced edge (0)->(1).
//       KILLS the NO-OP copy (clipboard still holds the seeded sentinel) and a
//       copy that DROPS the selected content.
//   (C) The clipboard text does NOT contain any UNSELECTED node or edge — no
//       $C$, no $D$ (nodes (2),(3)), and none of the three edges with an endpoint
//       outside the selection.
//       KILLS a WHOLE-GRAPH copy (the entire figure, $A$..$D$ and all four edges,
//       dumped onto the clipboard) and a copy that includes edges dangling out of
//       the selection.
//   (D) The clipboard text RE-PARSES through the app's OWN parser into a graph
//       whose nodes are EXACTLY {(0)=$A$ at (0,2), (1)=$B$ at (2,2)} and whose
//       edges are EXACTLY {(0)->(1)} — names, coordinates, styles, labels intact,
//       and nothing else.
//       KILLS a RAW-SELECTED-TEXT copy (the verbatim two source lines are not a
//       parseable tikzpicture / do not re-parse to this structure), a
//       NON-ROUND-TRIPPABLE serialization (the parser cannot re-parse it), and a
//       whole-graph copy (the re-parsed graph would carry 4 nodes / 4 edges).
//
// RED today: __PPE_E2E__.copySelectedSubgraphAsTikz / readClipboardText /
// parseTikz / seedSelection do not exist — there is no copy-selected-subgraph
// action, no subgraph-serialize-to-clipboard command, and no parser hook — so the
// seed/copy/read evaluate throws (the action/hook is absent) OR, if any partial
// surface exists, the clipboard is unchanged from the seeded sentinel. The
// failure below is the MISSING copy-subgraph behaviour, not a boot error: the app
// + editor are brought up first.

// The witness tikz figure embedded in a `{=latex}` fenced block (the SAME shape
// p100 uses to put tikz in the editor buffer). Four nodes (0)=$A$ .. (3)=$D$ and
// four edges. The (0) and (1) node lines are ADJACENT so the selection over them
// is a single contiguous span. Authored in the SAME TikzIt-class grammar the D-1
// parser accepts (\node [style=...] (n) at (x, y) {label}; \draw [style=...] (a)
// to (b)).
const FIGURE = [
  '',
  '',
  '```{=latex}',
  '\\begin{tikzpicture}',
  '\t\\begin{pgfonlayer}{nodelayer}',
  '\t\t\\node [style=object] (0) at (0, 2) {$A$};',
  '\t\t\\node [style=object] (1) at (2, 2) {$B$};',
  '\t\t\\node [style=object] (2) at (0, 0) {$C$};',
  '\t\t\\node [style=object] (3) at (2, 0) {$D$};',
  '\t\\end{pgfonlayer}',
  '\t\\begin{pgfonlayer}{edgelayer}',
  '\t\t\\draw [style=arrow] (0) to (1);',
  '\t\t\\draw [style=arrow] (0) to (2);',
  '\t\t\\draw [style=arrow] (1) to (3);',
  '\t\t\\draw [style=arrow] (2) to (3);',
  '\t\\end{pgfonlayer}',
  '\\end{tikzpicture}',
  '```',
  '',
].join('\n');

// The contiguous selection span: EXACTLY the two adjacent node-definition lines
// for nodes (0) and (1) — a proper subset of the figure's source. seedSelection
// puts a real CM6 selection over the first occurrence of this exact text. This is
// the "select a region of nodes" gesture; the copy action forms the induced
// subgraph (these two nodes + the single edge between them).
const SELECTION = [
  '\\node [style=object] (0) at (0, 2) {$A$};',
  '\t\t\\node [style=object] (1) at (2, 2) {$B$};',
].join('\n');

// A sentinel seeded onto the clipboard before the copy, so the post-copy
// clipboard content is provably produced by the copy action (B replaces it),
// never pre-existing. An unusual marker no canonical tikz would carry.
const CLIPBOARD_SENTINEL = '__P104_PRECOPY_SENTINEL__';

// Labels / coordinates that identify each node, used as content witnesses.
const SELECTED_LABEL_A = '$A$';
const SELECTED_LABEL_B = '$B$';
const EXCLUDED_LABEL_C = '$C$';
const EXCLUDED_LABEL_D = '$D$';

interface ParsedNode {
  name: string;
  x: number;
  y: number;
  style: string | null;
  label: string;
}
interface ParsedEdge {
  source: string;
  target: string;
  style: string | null;
}
interface ParsedGraph {
  nodes: ParsedNode[];
  edges: ParsedEdge[];
}

test('selecting a subgraph and invoking copy places EXACTLY that subgraph as canonical, re-parseable tikz on the system clipboard', async ({
  tauriPage,
}) => {
  const manifest = loadRunManifest();

  // The app + editor must be alive first, so a later failure is the missing
  // copy-subgraph behaviour, not a boot/setup error.
  await openAndSelectDemo(tauriPage, manifest.project);
  await tauriPage.waitForFunction(
    `document.querySelectorAll('.cm-editor .cm-content .cm-line').length > 3`,
    15_000,
  );

  // Place the witness tikz figure in the buffer through the REAL editor update
  // pipeline (the same docChanged path user typing fires).
  await appendAtEnd(tauriPage, FIGURE);
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.getEditorText().includes(${JSON.stringify(SELECTED_LABEL_A)})`,
    10_000,
  );
  const buffer = await editorText(tauriPage);
  // Sanity: the full figure (all four nodes) is present in the owned source the
  // copy action will parse — so excluding $C$/$D$ from the clipboard is a real
  // subset, not an artifact of them never being there.
  expect(buffer).toContain(SELECTED_LABEL_A);
  expect(buffer).toContain(SELECTED_LABEL_B);
  expect(buffer).toContain(EXCLUDED_LABEL_C);
  expect(buffer).toContain(EXCLUDED_LABEL_D);

  // (A) Seed a sentinel on the REAL system clipboard, then read it back
  // INDEPENDENTLY to confirm the baseline. RED today: __PPE_E2E__.readClipboardText
  // does not exist, so this evaluate throws — there is no independent clipboard
  // read surface. (seedClipboardText is the P82 sibling that already exists; the
  // independent READ is the new D-8 observable.)
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.seedClipboardText(${JSON.stringify(CLIPBOARD_SENTINEL)}); return null; })()`,
  );
  await tauriPage.waitForFunction(
    `window.__PPE_E2E__.readClipboardText() === ${JSON.stringify(CLIPBOARD_SENTINEL)}`,
    10_000,
  );

  // Establish a REAL selection over EXACTLY the two adjacent node lines for (0)
  // and (1) — a proper subset of the figure's source. RED today:
  // __PPE_E2E__.seedSelection exists only behind P83's `${VISUAL}` support; with
  // no copy-subgraph surface there is no need for it here, but it is the SAME real
  // CM6 selection state. The decisive RED below is the missing copy action.
  await seedSelection(tauriPage, SELECTION);

  // Invoke the copy-subgraph action. RED today:
  // __PPE_E2E__.copySelectedSubgraphAsTikz does not exist — there is no
  // copy-selected-subgraph action, no subgraph-serialize command, and no
  // clipboard write of canonical tikz — so this evaluate throws.
  await tauriPage.evaluate(
    `(() => { window.__PPE_E2E__.copySelectedSubgraphAsTikz(); return null; })()`,
  );

  // The copy is async (parse + serialize + clipboard write). Await the observable
  // end state: the clipboard no longer holds the seeded sentinel — the canonical
  // subgraph tikz has REPLACED it. Read INDEPENDENTLY off the system clipboard.
  await tauriPage.waitForFunction(
    `(() => { const t = window.__PPE_E2E__.readClipboardText(); return typeof t === 'string' && t !== ${JSON.stringify(CLIPBOARD_SENTINEL)} && t.length > 0; })()`,
    15_000,
  );

  const clipboard = await tauriPage.evaluate(
    `(() => { const t = window.__PPE_E2E__.readClipboardText(); return typeof t === 'string' ? t : JSON.stringify(t); })()`,
  );
  if (typeof clipboard !== 'string') {
    throw new Error(`readClipboardText returned non-string: ${JSON.stringify(clipboard)}`);
  }

  // (B) The clipboard CONTAINS the selected nodes' identity and the induced edge.
  // KILLS the no-op copy (sentinel still present) and a copy that drops selected
  // content.
  expect(clipboard).not.toContain(CLIPBOARD_SENTINEL);
  expect(clipboard).toContain(SELECTED_LABEL_A);
  expect(clipboard).toContain(SELECTED_LABEL_B);

  // (C) The clipboard does NOT contain any UNSELECTED node or edge. KILLS a
  // whole-graph copy (the full figure $A$..$D$ dumped) and edges dangling out of
  // the selection.
  expect(clipboard).not.toContain(EXCLUDED_LABEL_C);
  expect(clipboard).not.toContain(EXCLUDED_LABEL_D);

  // (D) THE DECISIVE RE-PARSE: feed the clipboard text back through the app's OWN
  // tikz parser (the D-1 / P90 parser) and assert the recovered structure is
  // EXACTLY the selected subgraph. KILLS a raw-selected-text copy (the verbatim
  // two source lines do not re-parse to this structure), a non-round-trippable
  // serialization (the parser cannot re-parse), and a whole-graph copy (4 nodes /
  // 4 edges would come back). RED today: __PPE_E2E__.parseTikz does not exist, so
  // this evaluate throws.
  const reparsedRaw = await tauriPage.evaluate(
    `(() => { return JSON.stringify(window.__PPE_E2E__.parseTikz(${JSON.stringify(clipboard)})); })()`,
  );
  if (typeof reparsedRaw !== 'string') {
    throw new Error(`parseTikz returned non-string: ${JSON.stringify(reparsedRaw)}`);
  }
  const reparsed = JSON.parse(reparsedRaw) as ParsedGraph;

  // EXACTLY the two selected nodes — by name, with coordinates and labels intact.
  const nodeNames = reparsed.nodes.map((n) => n.name).sort();
  expect(nodeNames).toEqual(['0', '1']);

  const node0 = reparsed.nodes.find((n) => n.name === '0');
  const node1 = reparsed.nodes.find((n) => n.name === '1');
  expect(node0).toBeDefined();
  expect(node1).toBeDefined();
  expect(node0?.label).toBe(SELECTED_LABEL_A);
  expect(node1?.label).toBe(SELECTED_LABEL_B);
  expect(node0?.x).toBe(0);
  expect(node0?.y).toBe(2);
  expect(node1?.x).toBe(2);
  expect(node1?.y).toBe(2);

  // EXACTLY the one induced edge (0)->(1) — both endpoints in the selection — and
  // NO other edge.
  const edgePairs = reparsed.edges.map((e) => `${e.source}->${e.target}`).sort();
  expect(edgePairs).toEqual(['0->1']);

  recordObservation({ spec: manifest.spec, name: 'p104-clipboard-tikz', value: clipboard });
  recordObservation({ spec: manifest.spec, name: 'p104-reparsed-nodes', value: nodeNames.join(',') });
  recordObservation({ spec: manifest.spec, name: 'p104-reparsed-edges', value: edgePairs.join(',') });
});
