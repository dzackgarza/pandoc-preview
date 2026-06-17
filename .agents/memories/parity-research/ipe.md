# Ipe — Parity Research

**Source-verified** against the [Ipe manual RST sources](https://ipe.otfried.org/manual/manual.html) and the [otfried/ipe](https://github.com/otfried/ipe) tree, not the landing page. Cross-linked to [[../plugins-diagrams-figures-requirements]], [[../feature-catalogue-and-implementation-status]], [[../decision-provenance-user-owned-vs-framework-forced]].

## What it is

Ipe is a **vector drawing editor with LaTeX-typeset labels**, designed so its figures go straight into a paper as PDF. Its defining traits are (1) a deep magnetic **snapping** system, (2) LaTeX text labels rendered by real pdflatex, (3) cascading **stylesheets** (`.isy`) that define named colors/pens/symbols/preamble once and reuse them, and (4) a file format that **embeds the editable Ipe XML inside the output PDF**, so the included `\includegraphics` PDF is itself re-openable. It is on our blessed allowlist (`ipe/.ipe/Ipe-XML` registry entry in [[../plugins-diagrams-figures-requirements]]) as a **post-save-gate external launch**, not an in-app editor. Critically: **Ipe does NOT export TikZ** — it produces PDF/EPS/SVG, so it sits OUTSIDE the "owned tikz round-trip" path and inside the "launch external editor, include the resulting PDF/SVG figure" path.

## Feature inventory

- **LaTeX-typeset labels/text** `[relevance: High]` — text objects are "labels" (inline) or "minipages" (block); user types LaTeX source into a dialog; Ipe runs `pdflatex` (optionally xe/lua) and embeds the PDF rendering. `Run Latex` is Ctrl+L, or auto-on-edit ("Automatically run Latex"). Preamble is document-level (Document properties) plus stylesheet-cascaded. Full math mode + `\textcolor`. (manual `30_objects.rst`, `60_stylesheets.rst`)
- **Snapping (the killer feature)** `[relevance: Med]` — magnetic snapping with a secondary "Fifi" cursor: **grid snap** (round to grid points), **vertex snap** (polygon vertices, spline control pts, centers, arc endpoints, marks), **boundary snap** (onto path/circle/ellipse/arc boundaries), **intersection snap** (path intersections), **manual + automatic angular snap** (restrict to base-direction + n×angle; auto sets origin to previous vertex). Custom "GRID" layer for triangular/perspective grids. Toolbar toggles + F1/F2/F3 origin/direction keys. (manual `40_snapping.rst`) — Med because our figures are predominantly tikz source, not freehand vector geometry.
- **Layers and views** `[relevance: Low]` — per-page layers (visibility, lock, per-layer snap); **views** specify which layers are visible/active and become separate PDF pages for incremental-reveal presentations, with per-view attribute remapping and layer transforms. (manual `20_concepts.rst`, `70_presentations.rst`) — presentation feature, off-axis for static paper figures.
- **Stylesheets (`.isy` cascading XML)** `[relevance: Med]` — define-once-reuse-everywhere: named colors, pen widths, symbol sizes, arrow sizes, dash styles, mark shapes, opacity; reusable **symbols** (parameterized `name(sfpx)`); a `Background` auto-symbol; LaTeX preamble (cascaded bottom→top); `<layout>` paper/frame; text styles that can wrap labels in environments (e.g. a `tikzpicture` wrapper). Cascaded stack with a built-in base at the bottom; `update-master` script extracts a shared preamble into a stylesheet. (manual `60_stylesheets.rst`)
- **Vector drawing primitives** `[relevance: Low]` — polylines, polygons, uniform/cardinal/clothoid B-splines, quadratic+cubic Bezier, circles, ellipses, circular+elliptic arcs (3-point or center+endpoints), rectangles, marks; compose/decompose/join paths; even-odd holes; stroke/fill/pen/dash/arrows/tiling attributes; vertex-edit mode. (manual `30_objects.rst`)
- **Export to TikZ/PGF** `[relevance: High — NEGATIVE finding]` —
  - Searched: `styles/tikz-shapes.isy`, `doc/news.txt`, manual sections, repo tree, WebSearch for "ipe2tikz" ipelet.
  - Found: only a `tikz-shapes.isy` stylesheet that wraps **label text** in `\begin{tikzpicture}…\end{tikzpicture}` (so you can use tikz inside a label). No built-in tikz code exporter, no bundled `ipe2tikz` ipelet, no tikz import.
  - Conclusion (inference): Ipe has no native TikZ round-trip; it is a PDF/EPS/SVG figure producer. (A third-party `ipe2tikz` exists outside this repo but was not found in-tree.)
  - Confidence: High (for in-repo); Medium (for the absolute non-existence of any community ipelet).
  - Gaps: did not audit external ipelet registries exhaustively.
- **File format owned (PDF-embeds-source)** `[relevance: High]` — three forms: `.ipe` (pure XML, DTD-validated, hand-editable), **PDF with a hidden embedded Ipe XML stream** (a standard viewable PDF that Ipe re-opens and edits — the round-trip trick), and `ipetoipe` CLI conversion between them. Caveat: if any other tool rewrites the PDF, the embedded stream is corrupted and Ipe refuses it (`ipeextract` recovers). (manual `10_ipe_files.rst`, `90_file_format.rst`)
- **Edit-in-place round-tripping** `[relevance: High]` — re-open the Ipe PDF → extract embedded XML → re-render labels via pdflatex → edit → re-save. This is the model behind "re-open a previously created figure in its source tool" — but the editability lives in the PDF, NOT in tikz source.
- **Ipelets (Lua plugin system)** `[relevance: Low]` — Lua (primary) or C++ extensions in the Ipelet menu with full object-model access via `model:register`/`model:creation`; bundled align/symbols/gridmaker/euclid/voronoi/search-replace. Strong precedent for plugin-shaped extension, but app-internal to Ipe.
- **SVG/PDF/EPS/PNG export + reverse importers** `[relevance: Med]` — `iperender` to EPS/PNG/SVG; `svgtoipe`/`pdftoipe`/`figtoipe` import. SVG export is the relevant bridge for including an Ipe figure as a vector asset.
- **Shared-preamble management** `[relevance: Med]` — `update-master master.tex figures/*.ipe` extracts a marked preamble block into `master-preamble.isy` so many figures share one paper preamble. Mirrors our "global figures dir + shared config" intent.

## Parity matrix

| Feature | Ipe has it | Our status | Math-writing relevance | Notable mechanism worth porting |
| --- | --- | --- | --- | --- |
| LaTeX-typeset labels (real pdflatex) | Yes (Ctrl+L / auto) | have (filter pipeline compiles real LaTeX) | High | auto-run-latex toggle for label re-typeset |
| Strong magnetic snapping | Yes (grid/vertex/boundary/intersection/angular) | gap (no app-owned vector canvas) | Med | only relevant if an in-app vector canvas is ever built; for tikz-source figures it is off-axis |
| Stylesheets: define-once colors/pens/symbols/preamble | Yes (`.isy` cascade) | partial — analogous to shared `.tikzstyles`/figures-dir preamble | Med | the cascade + `update-master` shared-preamble extraction is a clean shared-config pattern for the figures dir |
| PDF-embeds-editable-source round-trip | Yes (hidden XML stream in PDF) | gap (our owned round-trip is tikz-source-based) | High | edit-in-place by re-opening the included asset — but ours keys on owned `.tex`/`.tikz`, not embedded-PDF |
| Export to TikZ | No | n/a | High | Ipe is a PDF/SVG figure producer — belongs to "include external figure," NOT "owned tikz" |
| SVG/PDF/EPS export | Yes (`iperender`) | have (figure render upkeep / export plugins) | Med | SVG export as the vector bridge for an Ipe figure |
| Lua/C++ ipelet plugins | Yes | planned: Tier4 (plugin firewall) — but Ipe-internal | Low | external tool's own plugin system; not app-owned |
| Layers + presentation views | Yes | excluded | Low | presentation/slide feature, not paper figures |
| Post-save-gate external launch of Ipe | n/a (it IS the external tool) | planned: Tier3 (diagram tool launches; `ipe/.ipe/Ipe-XML` registry) | High | launch Ipe on a `.ipe`, include resulting PDF/SVG; re-open to edit |

## Gaps (net-new candidates our catalogue does NOT track)

- **Edit-in-place of NON-tikz figures (Ipe `.ipe`/PDF) via the figures registry** `[relevance: High]` — our owned-figure round-trip (Tier3 "right-click to edit owned tikz") is tikz-source-specific. Ipe figures are PDF/SVG with editability embedded in the `.ipe`/PDF, not in tikz. To honor "re-open a previously created figure in its source tool" for Ipe-authored figures, the figures registry must track the **source `.ipe` file** alongside the included PDF/SVG and launch Ipe on the `.ipe` (not attempt tikz extraction). This dual-asset (editable-source + included-render) tracking is net-new.
- **Shared-preamble extraction for the global figures dir** `[relevance: Med]` — Ipe's `update-master` (one paper preamble → shared `.isy`) is a concrete pattern for a single global figures-dir preamble that every figure compiles against. Our docs mention a figures dir and TikZ mode but not a shared-preamble-extraction mechanism. Pairs with the QTikz per-figure-template gap.
- **SVG-vector inclusion path for external-editor figures** `[relevance: Med]` — Ipe (and Inkscape) emit SVG/PDF, not tikz. The catalogue's figure-insertion gallery and TikZ mode assume tikz→SVG; a parallel "external editor produced an SVG/PDF asset, register and insert it" path is implied but not explicitly tracked for non-tikz tools.

## Dispositions

- **In-app port of Ipe's vector canvas + snapping** — gimmick — deprioritized: building an app-owned freehand vector editor with magnetic snapping is a massive surface, off-axis for a math-writing app whose figures are predominantly tikz source. The blessed path is **launch Ipe externally** (Tier3), not reimplement it. Snapping is `[relevance: Med]` only in the hypothetical of an owned canvas.
- **Layers / presentation views** — excluded — adjacent to banned non-goals: this is slide-deck/presentation tooling (our slides mode is a separate revealjs renderer plugin, Tier2), not paper-figure editing.
- **Ipe PDF-embeds-source format adoption** — deprioritized: our owned round-trip is tikz-source-based by doctrine ("the app never owns tikz generation; it renders SVGs"). Adopting Ipe's embedded-PDF format would fork the ownership model; instead track the `.ipe` source file and launch Ipe.
- **TikZ export from Ipe** — does not exist in-repo (see negative finding); do not plan a feature around it. Treat Ipe output as PDF/SVG assets.
- **Ipelets** — excluded as an app feature: that is Ipe's internal plugin system; our plugin firewall (Tier4) is app-owned and unrelated.
