# QTikz / KtikZ — Parity Research

**Source-verified** against the [fhackenberger/ktikz](https://github.com/fhackenberger/ktikz) source tree (KDE qtikz/ktikz lineage), not the landing page.
Cross-linked to [[../plugins-diagrams-figures-requirements]], [[../feature-catalogue-and-implementation-status]], [[../proof-obligations]].

## What it is

QTikz/KtikZ is a **source-only live TikZ editor**: a plain-text pane where the user writes a tikz snippet, plus a side preview pane that recompiles the snippet through real LaTeX and shows the rendered figure.
There is NO drawing canvas — the only input is tikz source.
It owns no project format; it edits raw `.tikz`/`.pgf`/`.tex` files and keeps the LaTeX template and settings in per-user config (`~/.config/ktikzrc`), not in the file.
This is exactly the shape our **TikZ mode** (Tier 3) and **TikZ preview QTikz parity** (Tier 6) milestones target.

## Feature inventory

- **Live render-on-edit of tikz source** `[relevance: High]` — debounced 1s (`s_minUpdateInterval = 1000` in `tikzpreviewcontroller.cpp`); writes snippet to a temp `.pgf`, wraps via template into a temp `.tex`, runs `pdflatex`/`lualatex`/`xelatex`/ConTeXt in `nonstopmode`, renders the PDF to a raster via the **Poppler** library (embedded, not an external viewer).
  Toggleable automatic/manual build mode (`BuildAutomatically`). This is precisely our "compile tikz → SVG preview" loop.
- **Template/preamble management** `[relevance: High]` — user picks a template file (`.pgs`); the tikz snippet is substituted into a `<>` placeholder (`TemplateReplaceText`, customizable).
  Built-in fallback template uses `\usepackage{tikz}` + `[active,tightpage]{preview}` + `\PreviewEnvironment{tikzpicture}`. Recent-templates history, file browser, edit-in-external-editor button.
  Config keys: `TemplateFile`, `TemplateReplaceText`, `TemplateRecent`.
- **Snippet/symbol palette** `[relevance: High]` — JSON command database (`app/tikzcommands.json`) drives a nested Insert menu AND a toggleable dock widget tree of tikz commands (paths, shapes, nodes, arrows, decorations, colors, transforms, math, loops).
  Each entry has `{name, description, insert, type}` with cursor-offset placement (`dx`/`dy`). Users can add custom commands.
  Syntax highlighting and code completion are derived from the same metadata.
- **Style/node libraries** `[relevance: Med]` — no graphical style builder; node styles are just tikz `every node/.style` / shape entries surfaced through the command palette.
  Styles live inline in the tikz source via PGF's native style system.
- **Snapping/grid** `[relevance: Low]` — NONE. Purely text-based; no canvas, no snap, no coordinate picker.
  Coordinates are typed by hand.
  Preview is read-only (no click-to-edit geometry).
  (Confirmed by absence of any snapping code.)
- **Clipboard/export** `[relevance: Med]` — File > Export to EPS/PDF/PNG/JPEG/TIFF/BMP (PDF from pdflatex; raster via Poppler→QImage; EPS via external `pdftops`). Print + Print Preview.
  NO copy-rendered-image-to-clipboard and NO copy-tikz-to-clipboard beyond ordinary text editor copy.
  Hover shows mouse coordinates (`ShowCoordinates`).
- **Edit-in-place round-tripping** `[relevance: High]` — stateless: opens any text file, saves back the same raw tikz/LaTeX source.
  Template/replacement settings are per-user config, NOT embedded per-file (so a file is not self-describing across machines).
  `WatchFile` reloads on external change; recent-files list maintained.
- **File format owned** `[relevance: High]` — none proprietary.
  Plain text: `.tikz`, `.pgf`, `.pgs` (templates with `<>`), `.tex`, or extensionless.
  Configurable per-file encoding (UTF-8 default).
  The figure is just the raw tikz source — matching our doctrine that **the app never owns tikz generation**.
- **LaTeX command/engine selection** `[relevance: Med]` — `LatexCommand` config (pdflatex/lualatex/xelatex/ConTeXt); `-shell-escape` opt-in (`UseShellEscaping`, warning-gated) for gnuplot/external.
- **Error/log surfacing** `[relevance: High]` — messages panel parses LaTeX errors as `file:line:message`; View Log shows full compiler output.
  Matches our Overleaf-style log surface requirement.
- **Preview zoom/pan + multipage** `[relevance: Med]` — QGraphicsView zoom in/out, fit-to-window, drag-pan; Previous/Next page navigation when the template yields multiple pages (e.g. beamer).
- **Editor affordances** `[relevance: Low]` — tikz-aware syntax highlighting, basic/KTextEditor completion, find/replace with regex, goto-line, configurable keyboard shortcuts.

## Parity matrix

| Feature | QTikz has it | Our status | Math-writing relevance | Notable mechanism worth porting |
| --- | --- | --- | --- | --- |
| Debounced live tikz→raster preview | Yes (1s, Poppler) | planned: Tier3 (TikZ mode) / Tier6 (QTikz parity) | High | 1s single-shot debounce + temp `.pgf`→template→`.tex`→pdflatex→Poppler; our filter pipeline already does the compile, we render SVG not raster |
| Template substitution via `<>` placeholder | Yes (`.pgs` + `TemplateReplaceText`) | gap (not catalogued as a discrete surface) | High | A swappable preamble template wrapping the snippet at a single marker — distinct from the pandoc filter's fixed preamble; useful for figures-dir tikz |
| Tikz command/snippet palette (JSON-driven) | Yes (`tikzcommands.json` menu+dock) | gap | High | Declarative `{name, description, insert, type}` DB with cursor offsets — could seed the insertion bar's tikz snippets and CodeMirror completions |
| LaTeX engine selection for tikz compile | Yes (`LatexCommand`) | have (pandoc/export plugins own engine) | Med | per-figure engine config |
| LaTeX error parsing `file:line:message` | Yes (messages panel) | planned: Tier2 (compile log surface) | High | error-to-source-line mapping in the tikz preview |
| Export figure to PNG/PDF/EPS/SVG | Partial (no SVG; has raster+PDF+EPS) | have via export plugins / figure render upkeep | Med | — |
| Watch-file reload on external edit | Yes (`WatchFile`) | gap | Med | reload preview when an external tool rewrites the owned `.tex` figure |
| Snapping/grid/canvas | No | n/a | Low | not applicable — QTikz is source-only |
| Copy tikz / rendered image to clipboard | No (text-copy only) | planned: Tier3 (one-button extraction → clipboard image P62) | Med | — |
| Multipage preview navigation | Yes | gap | Low | gimmick for single figures |

## Gaps (net-new candidates our catalogue does NOT track)

- **Swappable per-figure preamble template with a single insertion placeholder** `[relevance: High]` — our docs describe TikZ mode as "replicates the pandoc tikz filter" with the filter's fixed preamble.
  QTikz's `<>`-placeholder template model lets a figure declare its OWN wrapping preamble (extra `\usetikzlibrary`, macros) independent of the pandoc filter.
  Worth tracking for figures-dir `.tex` editing where a figure needs libraries the global filter preamble lacks.
- **Declarative tikz-command snippet database** `[relevance: High]` — `tikzcommands.json` is a portable, categorized, cursor-aware snippet corpus.
  Our insertion bar (P56) only scaffolds bare tikz/tikzcd; a JSON-driven tikz palette (arrows, shapes, decorations) for the insertion bar / CodeMirror completion source is net-new and directly reusable (it could be vendored).
- **LaTeX-error-to-source-line mapping inside tikz preview** `[relevance: High]` — Tier2 P11 covers the pandoc compile log, but a tikz-mode-specific `file:line:message` jump (click the error → cursor lands on the offending tikz line) is not catalogued for the figures TikZ mode.
- **Watch-file reload of the owned figure** `[relevance: Med]` — when an external diagram tool (post-save-gate launch) rewrites the owned `.tex`, auto-reload the in-app preview.
  Complements "right-click to edit owned tikz → launch QTikz" (Tier3) by closing the loop on return.

## Dispositions

- **In-browser/TikZJax rendering** — excluded — banned non-goal (in-browser TikZ). QTikz's real-pdflatex+Poppler model is the blessed approach and matches our filter pipeline.
- **Multipage beamer preview navigation** — gimmick — deprioritized: figures are single pictures; multipage stepping is a slide-deck affordance, irrelevant to a figures editor.
- **Built-in print / print-preview** — gimmick — deprioritized: figures are `\includegraphics`'d into the paper; in-app printing of a single figure is not a math-writing need.
- **Copy-to-clipboard of raster export** — deprioritized: our clipboard story is the reverse (paste image FROM clipboard → figures dir, P62); exporting a figure to the clipboard is not a tracked need.
- **Raster (PNG/QImage) preview** — note: QTikz renders PDF→raster; our pipeline already renders **tikz→SVG**, which is strictly better for a vector figure.
  Do not port the raster path.
