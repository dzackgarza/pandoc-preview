# Rendering Pipeline Requirements: Filters, MathJax, References

**When this applies:** any work on the render pipeline, pandoc assets, math rendering, exports, or the settings/pandoc-command UI. User-stated 2026-06-13.

**The product is one editor -> pandoc rendering plugin -> output pane pipeline (user correction 2026-06-20).** The editor supplies a typed source document; the pandoc rendering plugin orchestrates the command, inputs, flags, templates, filters, and output type; the output pane displays HTML or PDF according to the selected workflow ([Renderer Plugin Architecture](renderer-plugin-architecture)). Modes come from source type and pandoc orchestration: markdown, full LaTeX documents, TikZ snippets, slides, HTML preview, and PDF output are not separate app-owned renderers.
Never add app-core code that owns TikZ rendering, LaTeX compilation, pandoc flag semantics, or document conversion.

**Render and export are pandoc orchestration choices, not app-owned conversion engines.** Preview and export workflows may choose different pandoc commands, inputs, flags, templates, filters, and output views, but the app still owns only editor ergonomics, invocation, diagnostics, and display.
The app must never invoke a latexmk-class pipeline or TikZ compiler as its own mode logic.

**Features ship as filters, never as app code:** the app must never render tikz or handle special syntax itself.
tikz/tikzcd rendering is an **independent, reusable, standalone pandoc filter** producing SVG — using the user's specific tikz-rendering template that includes a large subset of their macro and preamble files, so custom macros (`\RR`) and styles (`\coxeterblacknode`) work inside diagram code.
An Obsidian-style **callouts filter** also existed.
The app **installs and manages its own filters inside `~/.pandoc`** (a repo) in a simple filters directory/subdirectory — app-owned filters live in user-space asset land, not in the binary.

**The pandoc-command convenience module is a playground:** enumerate the templates/filters dirs for quick-swapping and quickly testing new filters; render-pipeline failures dump logs/stdout/stderr into a **debugging pane** — the app is "a quick playground for testing variations of flags, filters, templates."

**MathJax integration is deep, not a flag:** for user macros to render, either (a) de-macro the entire input — "tricky, we don't have a turnkey solution for this yet" — or (b) the app lets the user specify their own ENTIRE MathJax config and injects it into HTML output wherever it makes sense.
That injection requires careful pandoc flag and input/output choices (`--standalone` vs fragment, which template).
MathJax-always is already locked ([Decision Provenance: User-Owned vs Framework-Forced](decision-provenance-user-owned-vs-framework-forced)); this records WHY the integration must be config-deep.
**Update 2026-06-13:** option (b) already exists and works — the tier-1/2 macro generation + template-injection pipeline in `~/.pandoc` ([MathJax Macro System: Tiers and Injection](mathjax-macro-system-tiers-and-injection)); de-macroing remains unexplored.

**PDF output is pandoc-command-controlled (user correction 2026-06-20):** the app chooses a configured pandoc workflow and surfaces its real command, output, and exit status.
Pandoc plus filters/templates/tools own the TeX/PDF details.
The app never hardcodes a compile recipe, never implements latexmk-class orchestration, and never treats PDF as a separate app-owned renderer.
The target templates are the vendored research set (`research_draft.tex` via amsart + `dzg-unified` — [Shipped Template Requirements](shipped-template-requirements)).

**References/crefs need real investigation:** the correct behavior must come from the pandoc workflow and its filters/templates, not from app-side document semantics.
Do not paper over unresolved references with app-owned parsing or a single-pass approximation and call references "done."
The working reference implementation is `~/.pandoc` justfile `compile-pandoc` (latexmk + include.lua + convert_amsthm_envs.lua + natbib/biblatex — [Pandoc Asset Repo: Filters, Templates, Pipelines](pandoc-asset-repo-filters-templates-pipelines)).

Related: [Founding Philosophy: Exact Pandoc Preview](founding-philosophy-exact-pandoc-preview), [Contract Invariants and Ownership Boundaries](contract-invariants-and-ownership-boundaries), [Preview Iframe and Asset Resolution](preview-iframe-and-asset-resolution).
