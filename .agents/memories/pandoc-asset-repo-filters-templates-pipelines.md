# Pandoc Asset Repo: Filters, Templates, Pipelines

# Pandoc Asset Repo: Filters, Templates, Pipelines

**When this applies:** integrating with `~/.pandoc` — the contractually central asset repo the app validates, reads, and partially manages.
Audited 2026-06-13; it is a git repo with its own AGENTS.md/HANDOFF.md.

**The canonical pipelines (justfile — "see the justfile in ~/.pandoc for ideas on what standard compilation pipelines look like" — user):**

- `preview`: md → PDF live-reload via `entr` + zathura — the PDF half of the manual loop the app replaces.
- `compile-pandoc`: **md → LaTeX → PDF via latexmk** with filters `include.lua`, `convert_amsthm_envs.lua`, `select_images.lua`, natbib/biblatex — THE reference implementation of the "most correct" references/crefs pipeline ([Rendering Pipeline Requirements: Filters, MathJax, References](rendering-pipeline-requirements-filters-mathjax-references)).
- `format-markdown`: flowmark --semantic; `render-figures` → `render_figures.py`.

**Filter highlights (filters/):**

- **`tikzcd.lua` (274 lines)** — the model filter-owned feature: compiles `\begin{tikzcd}`, `\begin{tikzpicture}`, and `\input{*.pdf_tex}` to SVG via pdflatex→pdf2svg; content-hash cache `dzgtikz-<hash>.svg` in `$SVG_DIR`; recursive `\input` resolution (`PANDOC_DOC_PATH` env for relative paths); namespaces SVG ids; wraps HTML output in `.pandoc-preview-editable` spans; uses `standalone-tikz.tex` as the macro-including wrapper template.
- `convert_amsthm_envs.lua`: fenced `Div.{theorem,lemma,proof,…}` → real LaTeX environments with `[title]` and `\label` for PDF; proofenv-classed Divs for HTML.
- `obsidian_callouts.lua`: `[!TYPE]` blockquotes → `Div.callout[data-callout=type]`.
- Normalizers (`normalize_displaymath.lua`, `normalize_fenced_divs.lua`), `include.lua` (heading-shifted file inclusion), plus single-purpose filters (solutions hiding, symbol replacement, etc.).

**`pandoc_preview_template.html` (51KB):** inlined MathJax config with injected macros ([MathJax Macro System: Tiers and Injection](mathjax-macro-system-tiers-and-injection)); `.pandoc-preview-editable` hover CSS; the hover-edit contract: hover shows an "Edit ⚙️" overlay, click does `window.parent.postMessage({type:'pandoc-preview-edit', kind, path}, '*')` with `kind ∈ {tikzcd, tikzpic, tikzcode}` (no path) or img/embed (path from src).
This is the concrete protocol the app's hover-edit-bridge consumes.

**Environment contract (justfile):** `TEXINPUTS=.:~/.pandoc/styles//:~/.pandoc/macros//:~/.pandoc/config//:` ; `FIGURES_DIR` default `~/figures`; `SVG_DIR` default `$FIGURES_DIR/rendered`; `PANDOC_DOC_PATH` set per render.
Note the figures-dir ambiguity across sources: `.pandoc` justfile says `~/figures`, an old app config defaulted `~/.pandoc/figures` — the app's config names ONE; verify with the user which is canonical before encoding a value.

**Formatter quirks (HANDOFF.md):** pandoc percent-encodes link targets containing spaces and rewrites SoftBreak→Space (destroying semantic line breaks) — why FORMATTER_SPEC_V2 abandoned "pandoc as final emitter" for a source-preserving protect/restore design with fixture-first tests, wikilinks/math opaque, and `:::` as a fixed delimiter.
Any app feature that round-trips the document through pandoc inherits these hazards.

Related: [Founding Philosophy: Exact Pandoc Preview](founding-philosophy-exact-pandoc-preview), [Contract Invariants and Ownership Boundaries](contract-invariants-and-ownership-boundaries).
