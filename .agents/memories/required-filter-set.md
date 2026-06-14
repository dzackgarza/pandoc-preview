# Required Filter Set

**When this applies:** configuring the render pipeline, writing config examples/templates, provisioning test fixtures, or deciding where a document-semantics feature lives.
Inventory verified against `~/.pandoc/filters/` 2026-06-13. A missing required filter is a fatal validation failure (within the pandoc renderer plugin), and test fixtures must provision real copies — never stubs.

**These filters belong to the pandoc renderer plugin, not the app core.** Filters, their required set, and their install/management are owned by the pandoc renderer plugin ([Renderer Plugin Architecture](renderer-plugin-architecture)); the required ones surface on that plugin's config page as permanently-checked, un-uncheckable items with explanatory hover.
The generic renderer plugin has no filters and no such validation.

**Canonical filter location (user ruling, 2026-06-13): uniformize to `~/.pandoc/filters`.** All filters live there — the pandoc plugin's shipped filters are installed/managed INTO `~/.pandoc/filters`, and render commands, config examples, docs, and fixtures reference only that path.
No app-internal/resource-bundle filter paths at render time, no second filter directory ([Rendering Pipeline Requirements: Filters, MathJax, References](rendering-pipeline-requirements-filters-mathjax-references)).

**HTML preview pipeline (required — the pandoc renderer is broken without these):**

- **`tikzcd.lua`** — tikzcd/tikzpicture/`\input{*.pdf_tex}` → cached SVG via pdflatex+pdf2svg, using the fixed `standalone-tikz.tex` wrapper; emits `.pandoc-preview-editable` spans with `data-edit-kind`. Needs `PANDOC_DOC_PATH`, `FIGURES_DIR`/`SVG_DIR` env.
- **`convert_amsthm_envs.lua`** — fenced `Div.{theorem,lemma,proof,…}` → proofenv-classed HTML Divs (the first iteration's halt complaint "zero rendering of AMSThm envs" is what this filter prevents).
- **`obsidian_callouts.lua`** — `[!TYPE]` blockquotes → `Div.callout[data-callout=type]`.
- **`obsidian.lua`** — wikilink/`%%`-comment/tag handling for Obsidian-flavored sources (AST-based, per the no-regex rule).

**PDF/export pipeline (required for the latexmk path):** `include.lua` (heading-shifted multi-file inclusion), `convert_amsthm_envs.lua` (LaTeX branch: real amsthm environments with `[title]` + `\label`), `select_images.lua`, with natbib/biblatex — the `compile-pandoc` recipe in the `~/.pandoc` justfile is the reference invocation.
Note this is the EXPORT path (its own plugin surface), not preview render ([Rendering Pipeline Requirements: Filters, MathJax, References](rendering-pipeline-requirements-filters-mathjax-references)).

**Formatting pipeline (separate tool surface, NOT preview):** `normalize_displaymath.lua`, `normalize_fenced_divs.lua` (flowmark/format-markdown chain).

**Present but not app-core** (available for user pipelines; never assume them): `components.lua`, `youtube.lua`, `hide_solutions_{html,pdf}.lua`, `align-math.lua`, `convert_math_delimiters.lua`, `replace_symbols_html.lua`, `semanticlean.lua`, `base64.lua`, `post-navigation.lua`, sagemath-pandoc-filter; `utilities.lua` is a shared lib, not a filter.

**Contract reminders:** filters are the ONLY place special syntax is handled (never app code); filters tag interactive elements (`.pandoc-preview-editable` + `data-edit-kind ∈ {tikzcd, tikzpic, image,…}`) for the template JS. The raw render command string is canonical config; required filters are kept present by the pandoc plugin's own gum `configure` script (it locks them in) and verified by a fail-loud `required-filter` doctor check.
**REPEALED 2026-06-14:** the app does NOT semantically parse the command to derive the filter list — there is no in-app command parsing (see [Pandoc Command Model and Raw String Contract](pandoc-command-model-and-raw-string-contract), clauses 2–4 replaced).

Related: [Renderer Plugin Architecture](renderer-plugin-architecture), [Pandoc Asset Repo: Filters, Templates, Pipelines](pandoc-asset-repo-filters-templates-pipelines), [Shipped Template Requirements](shipped-template-requirements).
