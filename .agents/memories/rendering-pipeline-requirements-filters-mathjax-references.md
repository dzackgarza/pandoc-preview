# Rendering Pipeline Requirements: Filters, MathJax, References

**When this applies:** any work on the render pipeline, pandoc assets, math rendering, exports, or the settings/pandoc-command UI. User-stated 2026-06-13.

**Renderer-agnostic is now literal: the renderer is a swappable plugin (user, 2026-06-13).** The app core "stupidly pipes the text buffer" to a renderer plugin and shows the HTML it returns — it owns no renderer-specific knowledge ([Renderer Plugin Architecture](renderer-plugin-architecture)). The pandoc renderer plugin is the happy path: HTML through a specific collection of required templates and filters, with the user's raw pandoc command (developed in a terminal, pasted in) as canonical config.
Consequence: **revealjs slides work with zero additional app configuration** (user owns command + templates; output is HTML; the plugin renders what it gets), and a **generic script renderer (markdown stdin → HTML stdout, e.g. markdown-it) must work with no app changes** — that is the acceptance test for the abstraction.
Never add app-core code that assumes the output is "a document."

**Render ≠ export.** Preview rendering is fast, single-pass, renderer-plugin-owned.
Export (the section below on PDF) is a separate path with its own plugin surface — never conflate the two; a render must never invoke a latexmk-class pipeline.

**Features ship as filters, never as app code:** the app must never render tikz or handle special syntax itself.
tikz/tikzcd rendering is an **independent, reusable, standalone pandoc filter** producing SVG — using the user's specific tikz-rendering template that includes a large subset of their macro and preamble files, so custom macros (`\RR`) and styles (`\coxeterblacknode`) work inside diagram code.
An Obsidian-style **callouts filter** also existed.
The app **installs and manages its own filters inside `~/.pandoc`** (a repo) in a simple filters directory/subdirectory — app-owned filters live in user-space asset land, not in the binary.

**The pandoc-command convenience module is a playground:** enumerate the templates/filters dirs for quick-swapping and quickly testing new filters; render-pipeline failures dump logs/stdout/stderr into a **debugging pane** — the app is "a quick playground for testing variations of flags, filters, templates."

**MathJax integration is deep, not a flag:** for user macros to render, either (a) de-macro the entire input — "tricky, we don't have a turnkey solution for this yet" — or (b) the app lets the user specify their own ENTIRE MathJax config and injects it into HTML output wherever it makes sense.
That injection requires careful pandoc flag and input/output choices (`--standalone` vs fragment, which template).
MathJax-always is already locked ([Decision Provenance: User-Owned vs Framework-Forced](decision-provenance-user-owned-vs-framework-forced)); this records WHY the integration must be config-deep.
**Update 2026-06-13:** option (b) already exists and works — the tier-1/2 macro generation + template-injection pipeline in `~/.pandoc` ([MathJax Macro System: Tiers and Injection](mathjax-macro-system-tiers-and-injection)); de-macroing remains unexplored.

**PDF compilation is completely script-controllable (user requirement, 2026-06-13):** the "real paper" compile is almost always a far more complex pipeline than a single pandoc call — latexmk-class multi-run drivers, plus pandoc inclusion filters (`include.lua`) when a paper is split across many section files.
The PDF/export path must therefore accept an **arbitrary user script/command as the compile pipeline** — the app never hardcodes a compile recipe, it executes the configured one and surfaces its real command, output, and exit status.
The target templates are the vendored research set (`research_draft.tex` via amsart + `dzg-unified` — [Shipped Template Requirements](shipped-template-requirements)).

**References/crefs need real investigation:** the MOST correct PDF path is an intermediate **md → tex → latexmk-style pipeline** (multiple re-runs to resolve references).
The HTML path is less clear and may need pandoc-specific plugins to approximate what the PDF would produce.
Do not paper over this with a single-pass pandoc call and call references "done."
The working reference implementation is `~/.pandoc` justfile `compile-pandoc` (latexmk + include.lua + convert_amsthm_envs.lua + natbib/biblatex — [Pandoc Asset Repo: Filters, Templates, Pipelines](pandoc-asset-repo-filters-templates-pipelines)).

Related: [Founding Philosophy: Exact Pandoc Preview](founding-philosophy-exact-pandoc-preview), [Contract Invariants and Ownership Boundaries](contract-invariants-and-ownership-boundaries), [Preview Iframe and Asset Resolution](preview-iframe-and-asset-resolution).
