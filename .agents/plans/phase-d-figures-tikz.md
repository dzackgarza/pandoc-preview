# Phase D — Figure & TikZ Management and Live Editing (implementation plan)

Durable, resumable implementation plan for Phase D of the Competitive Parity Roadmap.
Authored 2026-06-16. If interrupted, resume from the **Status / resume here** section at
the bottom.

This is a **repo artifact** (future-work + current-state), NOT a memory. The durable
*priorities* and *mechanisms* live in memory: see the roadmap
[[competitive-parity-roadmap]] ("## Phase D — Figure & TikZ management and live editing")
and the per-program parity studies [[parity-research/tikzit]], [[parity-research/qtikz]],
[[parity-research/ipe]]. The doctrine surfaces are
[[plugins-diagrams-figures-requirements]] (the app NEVER owns tikz generation — it renders
SVGs; figures dir is global-only `~/.pandoc/figures`; the library must re-open figures in
their source tool), [[decision-provenance-user-owned-vs-framework-forced]] (blessed
allowlist quiver/FreeTikZ/qtikz/tikzit/ipe/Inkscape; drawio/xournalpp banned), and the
tracking surfaces [[feature-catalogue-and-implementation-status]] (Tier-3 figure/TikZ +
Tier-6 QTikz/Ipe/Tikzit parity) and [[proof-obligations]] (P56 tikz/tikzcd scaffold, P62
clipboard image, both green).

**Deliverable.** "Managing and editing figures/tikz/tikzcd" is a top user priority and the
**densest net-new cluster** in the roadmap ([[competitive-parity-roadmap]] Phase D
rationale). The catalogue already tracks rendering (tikz→SVG via `tikzcd.lua`), a global
figures dir, a figures sidebar tab, TikZ mode, an insertion gallery, external-tool launches,
and the Tier-6 parity milestones — but the **shared-config model and the
round-trip foundation are missing**.

**Interop is the PRIMARY disposition (HARD RULE #0).** The blessed path is to support the
NATIVE `.tikz`/`.tikzstyles`/`.tikzdefs` files directly and launch the REAL editors —
TikzIt/QTikz on owned `.tikz`, Ipe/Inkscape on their own assets — round-tripping the tools'
own files with zero porting. Most of this phase is that interop: the shared-style model, the
external-launch + watch-file loop, the dual-asset registry, and the vendored data assets
(QTikz `tikzcommands.json`, TikzIt `tikzit.sty`/`.tikzstyles`) carry no owned parsing.

The ONE place a genuinely owned structured model is unavoidable is round-trip
parse↔serialize of a tikz subset, needed by the obligations that must compute on the graph
itself (line-jump P93, deterministic subgraph→tikz copy P97). For that, **do NOT write a new
grammar.** TikzIt's parser is GPL (Flex/Bison `tikzlexer.l`/`tikzparser.y` +
`Graph::tikz()`, [[parity-research/tikzit]]) and IS the reference to PORT; evaluate existing
tikz/pgf parser libraries (crates / published grammars) before committing to a Rust port.
Before each parser-dependent obligation, **reconsider whether an in-app parser is needed AT
ALL** versus delegating editing entirely to the launched real tool operating on its native
file — only obligations that truly require an owned graph model justify the ported parser.

This plan is sequenced **foundation-first** for the obligations that DO need the ported
model — the parser and the shared `.tikzstyles`/`.tikzdefs` land before any source↔preview UX
that rides them — and **no in-app vector/node-edge canvas is greenfielded** (external launch
is the blessed interim path, [[parity-research/tikzit]] disposition; [[parity-research/ipe]]
disposition). Priority *within* the roadmap is fourth (after lint, snippets, citations); the
ported parser is built as a small, independently-testable Rust seam before any UI rides it.

## Source items (from the roadmap)

Copied verbatim from [[competitive-parity-roadmap]] "## Phase D — Figure & TikZ management
and live editing", with status tags:

| Item | Status | Rel |
| --- | --- | --- |
| A real tikz-SUBSET PARSER (round-trip parse↔serialize, not just render) — TikzIt's Flex/Bison + `Graph::tikz()` model; the foundation for "hand-edit the `.tikz`, re-sync" and for Tier-6 node/edge editing | net-new gap | High |
| Shared `.tikzstyles` + `.tikzdefs` palette for the global figures dir (one style file + one preamble file shared by every figure and `\input` by the paper) — a blessed shared-config pattern the figures-dir doctrine lacks; cf. Ipe's `update-master` preamble extraction | net-new gap | High |
| Source↔preview line jumping for owned tikz (TikzIt Ctrl+J jump-to-source-line / Ctrl+T re-parse) — the exact round-trip UX the Tier-3 "right-click to edit owned tikz" needs but never specified | refines Tier 3 | High |
| Swappable per-figure preamble template with a single `<>` insertion placeholder (QTikz `.pgs`) — lets a figure declare its OWN libraries/macros independent of the fixed pandoc-filter preamble | net-new gap | High |
| Declarative tikz-command snippet database (QTikz `tikzcommands.json`: `{name, description, insert, type}` with cursor offsets) — vendorable to seed the insertion bar's tikz snippets + CM completions; P56 only scaffolds bare tikz/tikzcd | net-new gap | High |
| LaTeX-error→source-line mapping + compile-log tab INSIDE TikZ mode (click error → cursor on the offending tikz line) | net-new gap | High/Med |
| Edit-in-place of NON-tikz figures (Ipe `.ipe`/PDF) via a dual-asset registry tracking the editable source alongside the included render — launch Ipe on the `.ipe`, do NOT attempt tikz extraction | net-new gap | High |
| Copy selected subgraph as tikz to clipboard (TikzIt) — deterministic subgraph→tikz at the cursor | maps Tier 3 (one-button quiver/FreeTikZ extraction) | High |
| Watch-file reload of an owned figure when an external tool rewrites it (closes the launch→edit→return loop) | net-new gap | Med |
| SVG/PDF-vector inclusion path for external-editor figures (Ipe/Inkscape emit SVG/PDF, not tikz) — a parallel "register + insert a non-tikz vector asset" path | net-new gap | Med |

**Out of scope (referenced, not planned here).**

- **quiver/FreeTikZ node/edge→tikz extraction** (Tier-3 "one-button extraction → tikz-cd
  insertion at cursor", [[feature-catalogue-and-implementation-status]]) is ALREADY planned;
  the roadmap lists "copy selected subgraph as tikz" as *maps Tier 3*, not net-new. Phase D's
  parser produces the deterministic subgraph→tikz serializer that extraction reuses, but the
  quiver-iframe / FreeTikZ launch surfaces are NOT re-proposed here.
- **A full in-app node/edge graphical canvas** (Tier-6 "TikZ parity with Ipe and Tikzit",
  [[parity-research/tikzit]] disposition) — a very large surface, **explicitly deferred**:
  do not greenfield the canvas before the round-trip parser and shared-style model land. The
  parser this phase builds is the prerequisite that makes Tier-6 *possible* later; Phase D
  stops at "hand-edit the `.tikz`, re-sync + jump", with external launch as the interim
  editor.
- **Ipe TikZ export** does not exist (negative finding, [[parity-research/ipe]]): treat Ipe
  output as PDF/SVG assets via the dual-asset registry, never attempt tikz extraction from an
  Ipe figure.
- **Canvas-side approximate label rendering** (gimmick, [[parity-research/tikzit]]): our
  preview already typesets via real pdflatex/MathJax; do not replicate.

## Discipline

(Matches [[../render-rebuild-plan]] and the global TDD doctrine.)

- **Interop-first / research-first governs EVERY work item ([[../AGENTS]] HARD RULE #0).**
  Each sub-milestone below BEGINS with the research step "what already exists?" and must name
  the concrete existing tool / library / binary / native file format / reference implementation
  it leverages, supports, or ports — *before* any build step. Greenfield is rejected: there is
  always a real binary to launch (TikzIt/QTikz/Ipe), a native format to support
  (`.tikz`/`.tikzstyles`/`.tikzdefs`/`.ipe`/`.pgs`/`tikzcommands.json`), or a GPL reference to
  port (TikzIt's Flex/Bison parser + `Graph::tikz()`). A work item whose first action is "write
  a new X" with no such research is inadmissible and is sent back for the research step. The
  PRIMARY disposition is external-tool interop on native files; in-app owned logic is justified
  ONLY where an obligation genuinely requires an owned structured model, and even then it is
  PORTED, never designed fresh.
- TDD per sub-milestone: design → RED proof obligation (user-ratified) → commit RED →
  GREEN → commit. Each sub-milestone gates on its proof green before the next starts.
  RED must FAIL because the observed figure/tikz behaviour is absent, never because a guessed
  solution surface is missing — a proof that would still pass on a broken app is inadmissible
  ([[proof-obligations]] admissibility rule). The parser obligations in particular must
  assert a **round-trip equality on real `.tikz` source** (parse a fixture → serialize →
  re-parse → structurally equal; and serialize → byte-or-AST-stable), not "a parser function
  exists".
- Existing obligations **P1–P69** (and D1–D16) stay green throughout. A sub-milestone that
  would break one must be re-scoped. In particular P56 (tikz/tikzcd scaffold) and P62
  (clipboard image into the configured figures dir) are the existing figure surfaces this
  phase EXTENDS, never replaces.
- No fallbacks, no soft defaults, no mocks, no smoke tests in proof paths; fail loud.
  The figures dir, the shared style/defs files, and the per-figure template are
  **config/disk-validated existing paths** (the `ExistingDir`/`ExistingFile` pattern in
  `config.rs`), never silently-defaulted. A missing required asset is a hard error, never a
  fallback to a project-local `./figures` or a built-in preamble.
- Single-user Linux; pandoc/pdflatex/pdf2svg/ipe are hard dependencies, provisioned through
  the doctor battery (a missing tool is a loud doctor FAIL contributed by the relevant
  plugin, never a runtime try/except). External diagram tools (ipe, qtikz, inkscape) launch
  through the **plugin firewall** per the diagram-tool-as-plugin doctrine
  ([[plugins-diagrams-figures-requirements]] richness bar) — Phase D does NOT add app-core
  knowledge of any external tool's argv.
- The tikz parser is **owned app code** (a bespoke surface), so it is held to the
  proof-of-correctness bar: tests assert it recovers real, known tikz source, not generic
  properties. It is the one place this phase adds nontrivial owned logic; everything else
  rides existing config/plugin/editor seams.

## Current code seams (what gets touched/extended)

Verified by reading the real files at HEAD (commit `eb51421`).

- **`src-tauri/src/config.rs`** (455 L) — `Config` carries `directories.figures: ExistingDir`
  (the global figures dir, already validated-existing at deserialize) and the
  `ExistingDir`/`ExistingFile` newtype pattern. Phase D adds a `[figures]` table (or extends
  `[directories]`) declaring the shared `tikzstyles`/`tikzdefs` files and the per-figure
  preamble TEMPLATE path — each an `ExistingFile` so a missing asset is a hard load error,
  never a default. The figures **dual-asset registry** (editable source ↔ included render)
  is a sidecar JSON persisted via the same `read_*_state`/`save_*_state` host-FS pattern as
  `fold-state.json`/`session.json` (XDG state/config, fail-loud parse) — NOT browser storage.
- **`src-tauri/src/render.rs`** (207 L) — `render_preview` delegates buffer→HTML to the
  active renderer plugin via `plugins::render_active`; the pandoc tikz pipeline
  (`tikzcd.lua` → `tikz_to_svg.sh` → SVG, env `PANDOC_DIR`/`FIGURES_DIR`/`SVG_DIR`) lives in
  the vendored `pandoc-renderer` plugin, NOT in core. **TikZ mode** (compile a standalone
  `.tex` figure → SVG preview) reuses this exact compile-to-SVG seam — it must NOT duplicate
  a second pandoc/pdflatex invocation in core. The per-figure preamble template wraps the
  figure source at the `<>` placeholder before that compile; the LaTeX-error→source-line map
  is parsed from the compile log this seam already returns (`RenderResult.log`).
- **`src-tauri/src/clipboard.rs`** (137 L) — `paste_clipboard_image` already persists a
  clipboard image as a real PNG into `cfg.directories.figures` atomically (P62, green). The
  SVG/PDF-vector inclusion path (item 9) and the dual-asset registration are siblings of this
  command: same figures-dir resolution, same atomic-write discipline, returning the inserted
  reference path. Reuse, do not fork.
- **`src-tauri/src/plugins.rs`** (594 L) — the generic plugin firewall: `discover`,
  `run_plugin` (buffer on stdin, `{file}`/`{artifact}`/`{plugin_dir}` argv substitution,
  structured `PluginResult`), `configure_plugin` (detached spawn), `plugin_check_rows`
  (doctor contribution). **Diagram-tool launches** (ipe/qtikz/inkscape on a figure source)
  are `run_plugin`/`configure_plugin`-shaped: a diagram-tool plugin contributes the launch
  argv + an availability doctor check; the app core stays tool-agnostic. The dual-asset
  registry's "launch the editor for THIS figure" routes through here.
- **`src-tauri/src/fsops.rs`** (206 L) — `read_text_file`/`write_text_file*` return a
  `Fingerprint` (FNV-1a hash + nanosecond mtime). **Watch-file reload** (item 8) reuses the
  EXACT P48 fingerprint mechanism: when an external tool rewrites an owned figure, the stored
  fingerprint diverges → reload the preview. No new change-detection scheme; the conflict
  primitive already exists.
- **`src/lib/components/InsertionBar.svelte`** + **`src/lib/editor/`** — the insertion bar
  already offers `onInsertDiagram("tikz"|"tikzcd")` (P56) and paste-image (P62), and the
  editor hosts the composable completion registry (P51) + snippet sources (P52/P59). The
  `tikzcommands.json` snippet DB (item 5) seeds BOTH the bar's tikz palette AND a CM6
  completion source — the same dual surface P52/P59 already split (autocomplete-popup vs
  bar-dropdown). The figures sidebar tab rides the configured-directories explorer (P44).
- **`src-tauri/resources/vendor/pandoc-config/`** — `filters/tikzcd.lua`,
  `bin/tikz_to_svg.sh`, `templates/standalone-tikz.tex` are the vendored compile assets the
  per-figure template and TikZ mode build on; `standalone-tikz.tex` is the current FIXED
  preamble the swappable `<>`-template (item 4) generalizes. Vendoring of a
  `tikzcommands.json` data asset and the shared `.tikzstyles`/`.tikzdefs` starter files
  follows the existing symlink-install model (Milestone D, [[../render-rebuild-plan]]).

## Work items (ordered sub-milestones)

Sequenced so the **tikz-subset PARSER lands first as the foundation**; the shared-style
model and per-figure template land next (they define what the parser/preview compile
against); then the round-trip UX, the snippet DB, the error map, the non-tikz registry, and
the watch/inclusion edges. Each sub-milestone is one RED→GREEN pair gated on its proof.

1. **D-1 — tikz-subset parser (PORT TikzIt's, do not greenfield a grammar).**
   **Research-first:** TikzIt's GPL Flex/Bison parser (`tikzlexer.l`, `tikzparser.y`) plus its
   `Graph::tikz()` serializer ([[parity-research/tikzit]]) IS the reference implementation for
   this exact tikz subset — PORT its grammar and serializer; first evaluate existing tikz/pgf
   parser crates/published grammars to LEVERAGE rather than rewrite. The owned graph model is
   justified only because P93 (line-jump) and P97 (subgraph copy) must compute on the graph;
   confirm no launched-tool delegation covers them before owning this surface. An owned Rust
   module (e.g. `src-tauri/src/tikz.rs`, or a sub-crate) ports the TikzIt-class tikz SUBSET into
   a structured graph model — `tikzpicture` envelope; `\node[props](name) at (x,y){label};`;
   `\draw[props](src) to (tgt);` edge chains; `\begin{pgfonlayer}{nodelayer/edgelayer}`;
   bbox `\path … rectangle …` — and serializes the model back to canonical source
   (`Graph::tikz()` analog). Drive the port through a real parser library (a PEG/combinator
   crate such as `pest`/`nom`/`chumsky`), never hand-rolled string splitting. Parse failure is a loud
   structured error (the offending line/token), never a silent soft-revert in the LIBRARY
   layer (soft-revert is a UI policy, not a parser behaviour). **Proof: P90** (round-trip on
   real `.tikz` fixtures). This is the prerequisite for D-3, the subgraph→tikz serializer
   (item 8, maps Tier 3), and any future Tier-6 canvas.

2. **D-2 — shared `.tikzstyles` + `.tikzdefs` palette for the figures dir.**
   **Research-first:** SUPPORT TikzIt's native `.tikzstyles`/`.tikzdefs` format directly
   (`\tikzstyle{name}=[...]` palette + optional preamble, [[parity-research/tikzit]]) and vendor
   TikzIt's `tikzit.sty`/starter `.tikzstyles` as data assets — the same one-style-file +
   one-preamble-file-shared-by-every-figure model TikzIt and Ipe's `update-master`
   ([[parity-research/ipe]]) already use; do not invent a bespoke style format. Config declares
   a shared style file and a shared preamble file for the global figures dir (`ExistingFile`
   each, fail-loud). Both are `\input` by the in-app figure-compile AND emitted into the
   paper's figure inclusion, so one style/preamble pair is shared by every figure (cf. Ipe
   `update-master`). The parser's node/edge `props` reference style names from this file. The
   figures sidebar surfaces the palette. **Proof: P91** (a style defined ONLY in the shared
   `.tikzstyles` visibly affects a compiled figure; removing it changes the render).

3. **D-3 — swappable per-figure preamble template (`<>` placeholder).**
   **Research-first:** SUPPORT QTikz's native `.pgs` template format and its `<>` substitution
   marker (`TemplateReplaceText`, [[parity-research/qtikz]]) — port that exact placeholder
   convention onto our existing vendored `standalone-tikz.tex` so QTikz users bring their
   templates with zero porting; do not design a new template syntax. Generalize the FIXED
   `standalone-tikz.tex` into a config-declared template (`ExistingFile`) whose single `<>`
   marker is where the figure source is substituted before compile, letting a figure declare
   its own `\usetikzlibrary`/macros independent of the pandoc-filter preamble (QTikz `.pgs`
   model). TikZ-mode compile and figure-render upkeep both consume it. **Proof: P92** (a
   library/macro present ONLY in the per-figure template makes a figure compile that fails
   under the default preamble; swapping the template changes the compile outcome).

4. **D-4 — source↔preview line jumping for owned tikz (Ctrl+J / Ctrl+T).**
   **Research-first:** PORT TikzIt's exact round-trip UX — Ctrl+T refresh-from-source, Ctrl+J
   jump-to-source-line ([[parity-research/tikzit]]) — reusing the D-1 ported parser as the graph
   model; the keybindings and semantics are TikzIt's, not invented. This obligation genuinely
   needs the owned graph (the jump maps a source line to a rendered element), so it justifies the
   ported parser rather than pure external-tool delegation. Using the D-1
   parser: Ctrl+T re-parses the buffer's `.tikz` source and refreshes the preview model;
   Ctrl+J maps the cursor's tikz line to the corresponding rendered node (and the inverse:
   selecting a node jumps the cursor to its source line). This is the round-trip UX the
   Tier-3 "right-click to edit owned tikz" needs but never specified. **Proof: P93** (Ctrl+J
   from a cursor on a node's source line selects/scrolls the matching rendered element;
   editing the source + Ctrl+T re-syncs the preview — fails on a stale or wrong-element jump).

5. **D-5 — declarative tikz-command snippet DB (`tikzcommands.json`).**
   **Research-first:** VENDOR QTikz's own `tikzcommands.json` data asset verbatim
   ([[parity-research/qtikz]]) — a maintained, categorized, cursor-aware corpus — rather than
   authoring our own snippet list; this is interop on a native data file, no owned parsing.
   Vendor QTikz's
   `tikzcommands.json` (`{name, description, insert, type}` with cursor offsets) as a
   versioned data asset (pin provenance, OSOT — same model as the P52 quicktex-dict vendoring)
   plus a committed converter if reshaping is needed. It seeds the insertion bar's tikz
   palette AND a CM6 completion source (reusing the P51 composable registry + the P59
   bar-dropdown surface), replacing P56's bare tikz/tikzcd scaffolds with a categorized
   command corpus (paths, shapes, nodes, arrows, decorations). **Proof: P94** (a tikz command
   present ONLY in the vendored DB is surfaced by the bar/completion and inserts its `insert`
   body with the cursor at the declared offset; pointing config at a different DB surfaces
   that DB's commands).

6. **D-6 — LaTeX-error→source-line + compile-log tab inside TikZ mode.**
   **Research-first:** LEVERAGE the standard `file:line:message` LaTeX error format that QTikz's
   messages panel already parses ([[parity-research/qtikz]]) and the `RenderResult.log` our
   existing render seam already returns — reuse the compiler's own diagnostic format, parse no
   bespoke error shape. Parse the
   `file:line:message` records out of the compile log (`RenderResult.log`, already returned by
   the render seam) and surface them as a TikZ-mode log tab; clicking an error lands the
   cursor on the offending tikz line. Distinct from P11 (pandoc compile log) — this is the
   figure-compile log mapped back to the figure SOURCE. **Proof: P95** (an introduced tikz
   error produces a log entry whose click moves the cursor to the exact offending line; fails
   on a missing log tab, an unparsed error, or a wrong target line).

7. **D-7 — dual-asset registry for NON-tikz figures (Ipe `.ipe`/PDF, Inkscape SVG).**
   **Research-first:** This is PURE external-tool interop — LAUNCH the real Ipe/Inkscape binaries
   on their NATIVE source files (`.ipe`/`.svg`) via the plugin firewall and track the
   editable-source↔included-render pairing; Ipe owns no tikz (negative finding,
   [[parity-research/ipe]]), so there is NO owned parser here — never attempt tikz extraction. A
   host-FS registry (XDG-state JSON, fail-loud, the `session.json` pattern) tracking the
   editable SOURCE (`.ipe`/`.svg`) alongside the INCLUDED render (PDF/SVG) for each non-tikz
   figure. "Edit this figure" routes to the diagram-tool plugin launched on the SOURCE
   (`run_plugin`/`configure_plugin`-shaped), NEVER attempting tikz extraction from an Ipe
   figure (negative finding, [[parity-research/ipe]]). **Proof: P96** (a registered non-tikz
   figure's edit action launches the editor on the tracked editable source, not the rendered
   asset; the registry persists across restart — fails if the render is opened instead of the
   source, or the pairing is lost).

8. **D-8 — copy selected subgraph as tikz to clipboard.**
   **Research-first:** PORT TikzIt's copy-subgraph-as-tikz behaviour ([[parity-research/tikzit]])
   by reusing the D-1 ported `Graph::tikz()` serializer — the deterministic subgraph→tikz model
   is TikzIt's, not invented. This obligation genuinely needs the owned graph serializer (it emits
   re-parseable canonical tikz for a selection), so it justifies the ported parser. Reuse the D-1 serializer: select a
   region of owned tikz source (or, later, a canvas subgraph) and write deterministic tikz to
   the clipboard (TikzIt copy model), maps the Tier-3 extraction obligation. Sibling of
   `clipboard.rs`'s existing clipboard work. **Proof: P97** (selecting a subgraph and copying
   places exactly that subgraph's canonical tikz on the system clipboard, re-parseable by D-1;
   fails on a whole-graph copy, a non-tikz copy, or a non-round-trippable serialization).

9. **D-9 — watch-file reload of an owned figure.**
   **Research-first:** SUPPORT the same watch-file-reload contract QTikz's `WatchFile` already
   provides ([[parity-research/qtikz]]) and LEVERAGE our existing P48 fingerprint primitive
   (hash+mtime in `fsops.rs`) — no new change-detection scheme is owned. When an external tool (post-save-gate
   launch) rewrites an owned figure, detect the change via the EXACT P48 fingerprint
   (hash+mtime in `fsops.rs`) and reload the in-app preview, closing the launch→edit→return
   loop. No new change-detection scheme. **Proof: P98** (an external rewrite of the open
   owned figure triggers a preview reload reflecting the new content; fails if the stale
   render persists or the reload fires without a real change).

10. **D-10 — SVG/PDF-vector inclusion path for external-editor figures.**
    **Research-first:** PURE interop — LEVERAGE the SVG/PDF that Ipe (`iperender`) and Inkscape
    natively emit ([[parity-research/ipe]]) and reuse P62's existing atomic figures-dir write
    path in `clipboard.rs`; no owned tikz, no bespoke asset format. A parallel
    "register + insert a non-tikz vector asset" path: an Ipe/Inkscape-produced SVG/PDF is
    registered (D-7) and inserted as a markdown image reference into the configured global
    figures dir — the non-tikz sibling of P62's clipboard-image path in `clipboard.rs`.
    **Proof: P99** (registering and inserting an external SVG/PDF figure writes it into the
    configured GLOBAL figures dir and inserts a reference to that exact file at the cursor;
    fails on a project-local `./figures` write, a dangling reference, or a zero-length asset —
    the P62 admissibility shape, applied to vector assets).

## Proposed proof obligations (P90–P99)

PROPOSALS only — these are NOT yet written into [[proof-obligations]] (the RESERVED block is
**P90–P99**; the proof-obligations doc is not edited by this plan). Each is stated as an
externally-observable behaviour that FAILS on a broken app, per the admissibility rule. The
spec design (vehicle, fixtures, harness wiring) belongs to the test author, not this plan.

- **P90 — tikz-subset parser round-trips real source.** Parsing a real `.tikz` fixture
  (TikzIt-class: layered nodes/edges, styles, labels, bbox) into the structured model and
  serializing it back yields canonical source that re-parses to a STRUCTURALLY EQUAL model;
  serialization is stable across the round-trip. Admissible: fails on a parser that drops
  nodes/edges/props/labels, on a serializer that emits non-re-parseable source, and on a
  parser that accepts a malformed picture without a loud structured error.

- **P91 — shared `.tikzstyles` affects a compiled figure.** A style defined ONLY in the
  config-declared shared `.tikzstyles` (`\input` by the figure compile) visibly determines a
  rendered figure's appearance; removing/changing that style changes the render. Admissible:
  fails if the figure renders identically with the style absent (the shared file is not
  actually consumed), or if the style file is silently defaulted rather than config-declared.

- **P92 — per-figure preamble template (`<>`) is consumed.** A `\usetikzlibrary`/macro
  present ONLY in the config-declared per-figure template lets a figure that REQUIRES it
  compile successfully; swapping to a template lacking it makes the same figure fail to
  compile. Admissible: fails if the figure compiles regardless of the template (the fixed
  preamble is still used), or if the `<>` placeholder is not where the figure source lands.

- **P93 — source↔preview line jump for owned tikz.** Ctrl+J from the cursor on a node's
  source line selects/scrolls to the matching rendered element, and editing the source +
  Ctrl+T re-syncs the preview to the new model. Admissible: fails on a no-op jump, a jump to
  the wrong element, or a Ctrl+T that leaves the preview stale.

- **P94 — tikz-command snippet DB seeds bar + completion.** A tikz command present ONLY in
  the vendored `tikzcommands.json` is surfaced by the insertion bar (and the completion
  source) and, when chosen, inserts its `insert` body with the cursor at the declared offset;
  pointing config at a different DB surfaces that DB's commands. Admissible: fails on a
  hardcoded/empty palette that ignores the DB, on literal-name insertion instead of the
  `insert` body, on a wrong cursor offset, and on an ignored DB.

- **P95 — TikZ-mode error maps to the source line.** An introduced error in a tikz figure
  produces a compile-log entry whose activation lands the cursor on the exact offending
  source line. Admissible: fails on a missing log tab, an unparsed error (no clickable
  record), or a click that targets the wrong line.

- **P96 — non-tikz dual-asset edit launches the source.** A registered non-tikz figure's
  edit action launches the diagram-tool plugin on the tracked editable SOURCE (`.ipe`/`.svg`),
  not the included render, and the source↔render pairing persists across restart. Admissible:
  fails if the rendered asset is opened instead of the source, if tikz extraction is attempted
  on an Ipe figure, or if the pairing is lost after restart.

- **P97 — copy subgraph as tikz to clipboard.** Selecting a subgraph and copying places
  exactly that subgraph's canonical tikz (re-parseable by the D-1 parser) on the system
  clipboard. Admissible: fails on a whole-graph copy, a non-tikz/plain-text copy, or a
  serialization the parser cannot re-parse.

- **P98 — watch-file reload of an owned figure.** An external rewrite of the currently-open
  owned figure (detected via the P48 fingerprint) reloads the in-app preview to reflect the
  new content. Admissible: fails if the stale render persists after the external write, or if
  a reload fires absent any real change.

- **P99 — external vector figure inserted into the global figures dir.** Registering and
  inserting an Ipe/Inkscape-produced SVG/PDF writes the asset into the CONFIGURED GLOBAL
  figures dir and inserts a markdown reference to that exact on-disk file at the cursor.
  Admissible (the P62 shape, for vector assets): fails on a project-local `./figures` write,
  a dangling reference, a zero-length asset, or a no-op insert.

## Verification

Same vehicle as the existing suite ([[proof-obligations]] "Verification vehicle"): the real
app on a real display via `tauri-plugin-playwright`; hermetic per-run temp project dirs and
`XDG_CONFIG_HOME`/`XDG_STATE_HOME`; disk assertions by INDEPENDENT processes; pandoc,
pdflatex, pdf2svg, ipe, gum as hard dependencies surfaced through the doctor battery. No
mocks, no skips, no forced error modes.

- The parser obligation (P90) is the one **pure-Rust unit-testable** seam — it may be proven
  as a Rust test over real `.tikz` fixtures (round-trip equality), the highest-confidence
  vehicle, in addition to any webview spec exercising the round-trip UX (P93). A round-trip
  test is admissible precisely because a parser that drops content fails it; an "a parse
  function exists" assertion is NOT admissible.
- Figure-compile obligations (P91/P92/P95) assert on the REAL pdflatex→SVG outcome through
  the existing compile seam, not on a mocked render — a style/library/error must change the
  observable rendered output or log.
- Registry/clipboard/inclusion obligations (P96/P97/P98/P99) assert via independent
  filesystem/clipboard reads (the P48/P62 discipline), never via the app's own report.
- Spec families: webview specs continue the `pXX` sequence (the next free indices after p62);
  any external-tool-availability or doctor-contributed checks continue the `dXX` sequence.
  Exact spec numbering is the test author's to assign — this plan fixes the OBLIGATION range
  (P90–P99) only.

## Sequencing & dependencies

- **The parser (D-1 / P90) is the hard prerequisite.** D-4 (line jump), D-8 (subgraph copy),
  and any future Tier-6 canvas all consume its parse↔serialize. Build and prove it first as
  an isolated module before any UI rides it. Do NOT start D-4/D-8 until P90 is green.
- **The shared-style + per-figure-template model (D-2/D-3) precedes the preview UX
  (D-4/D-6).** The line-jump and error-map surfaces operate on figures compiled WITH the
  shared `.tikzstyles`/`.tikzdefs` and the per-figure template; defining what a figure
  compiles against comes before mapping its render/errors back to source.
- **The snippet DB (D-5) is independent** of the parser and can proceed in parallel once
  D-2/D-3 land (it rides the existing P51/P59 completion + bar surfaces), but it is sequenced
  after the foundation so the insertion bar's tikz surface is upgraded against a settled
  figure-compile model.
- **The non-tikz path (D-7/D-10) is parser-INDEPENDENT** (Ipe/Inkscape produce PDF/SVG, no
  tikz) and rides the plugin firewall + the figures-dir/registry seam; it can run in parallel
  with the parser track but is sequenced after D-2 so the figures dir's shared-config and
  registry land coherently.
- **Watch-file reload (D-9)** depends only on the P48 fingerprint primitive (already green)
  and the figure-open path; it can land at any point after D-3 but pairs naturally with the
  external-launch loop D-7 completes.
- **External-tool launches** (ipe/qtikz/inkscape) are delivered as individually-managed
  plugins through the Tier-4 richness bar ([[plugins-diagrams-figures-requirements]]); Phase
  D consumes that firewall, it does not add app-core tool knowledge. If the richness-bar
  plugin model for diagram tools is not yet landed when D-7 starts, that is a real upstream
  dependency to surface, not a reason to hardcode a tool launch in core.
- **Regression gate:** P1–P69 and D1–D16 stay green at every step; P56 and P62 are extended
  (richer tikz palette; vector-asset sibling), never regressed.

## Status / resume here

- **2026-06-16:** Plan authored. Phase D scoped foundation-first: the tikz-subset PARSER
  (D-1 / P90) is the keystone and lands before any UI rides it; the shared
  `.tikzstyles`/`.tikzdefs` model (D-2) and the swappable per-figure `<>`-template (D-3)
  define the figure-compile model the preview UX (D-4 line jump, D-6 error map) operates on;
  the vendored `tikzcommands.json` DB (D-5) upgrades the insertion-bar tikz surface; the
  dual-asset registry (D-7) + vector-inclusion path (D-10) cover NON-tikz (Ipe/Inkscape)
  figures via the plugin firewall (no tikz extraction); subgraph-copy (D-8) and watch-file
  reload (D-9) reuse the parser serializer and the P48 fingerprint respectively.
  Reserved obligation block **P90–P99** proposed (NOT written into [[proof-obligations]]).
  No in-app vector/node-edge canvas greenfielded (Tier-6 deferred; external launch is the
  interim editor). Nothing implemented yet.
- **Prerequisite green baseline:** P1–P69, D1–D16 (per [[../render-rebuild-plan]] status and
  the proof-artifacts at HEAD `eb51421`).
- **NEXT:** ratify P90–P99 with the user, then RED for D-1 (parser round-trip on real `.tikz`
  fixtures) as the foundation sub-milestone.
- **Open decisions to surface before RED:**
  - Parser library choice (`pest` vs `nom` vs `chumsky`) — pick the one with the cleanest
    round-trip-serialization story; the parser is owned code held to the round-trip proof.
  - Whether the shared style/defs/template paths extend `[directories]` or get their own
    `[figures]` config table — confirm the config shape with the user (OSOT for the figures
    dir is `~/.pandoc/figures`, [[plugins-diagrams-figures-requirements]]).
  - Whether the dual-asset registry is a single XDG-state sidecar JSON or per-figure
    metadata — the `session.json`/`fold-state.json` host-FS pattern is the default.
