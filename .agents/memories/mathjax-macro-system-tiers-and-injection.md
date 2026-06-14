# MathJax Macro System: Tiers and Injection

# MathJax Macro System: Tiers and Injection

**When this applies:** any math-rendering, template, or MathJax-config work. Source: `~/.pandoc` (audited 2026-06-13). This largely ANSWERS the open MathJax-macros question recorded in [Rendering Pipeline Requirements: Filters, MathJax, References](rendering-pipeline-requirements-filters-mathjax-references) — a working injection pipeline already exists.

**The macro tier system (`~/.pandoc` styles/macros, by MathJax compatibility):**

- **tier1** (`tier1-mathjax-simple.tex`, ~1059 lines): 500+ no-arg macros (`\RR`, `\CC`, `\cA`, …) — MathJax-safe.
- **tier2** (`tier2-mathjax-args.tex`): macros with arguments — MathJax-safe.
- **tier3** (`tier3-tex-complex.tex`): TeX-only constructs — PDF pipeline only, never reaches MathJax.
- **tier4**: preamble-level directives. Plus `categories.tex` and `spectral.tex` (MathJax-safe domain macros).
- Two unified packages: `dzg-unified.sty` (LaTeX: preamble + all tiers + environments + biblatex + cleveref) vs `dzg-mathjax.sty` (tiers 1–2 + categories + spectral only).

**The working injection pipeline:**

1.  `generate-mathjax-config.py` parses tier1/tier2 (+categories+spectral) → `templates/css/mathjax-macros.json` (~500 macros, also `.mjs`/`.ts` exports);
2.  `inject-mathjax-into-template.py` replaces the `MATHJAX_MACROS_JSON` placeholder between `<!--MATHJAX_MACROS_START/END-->` markers in `pandoc_preview_template.html`;
3.  at render time MathJax 3 reads the inlined `window.MathJax.tex.macros` client-side. No de-macro step exists for HTML; macros expand in MathJax. Justfile recipes: `generate-math-macros`, `_inject-mathjax-into-template`.

**App implications (clarified 2026-06-15 — the MathJax config is STATIC):** the
generate→inject pipeline is a BUILD-TIME concern of the `~/.pandoc` asset repo (it
bakes the tier-1/2 macros into the config); the app does NOT drive it at runtime or
re-run it per render. `window.MathJax = <config>` is a static assignment. The app's
only job is to SHIP the static baked config and load it — done in Milestone E1: the
vendored `pandoc_preview_template.html` carries the macros baked in and renders them
offline (p24). The app embeds no macro list (the macros live in the vendored
config/template, not app code). Updating macros = regenerate offline + re-vendor (or
edit a separate static config asset, if factored out — the webpack-`require` pattern).
Tier3-dependent documents render differently in HTML vs PDF — by design (tier3 is not
in the MathJax config), not a bug. The earlier "app must drive the regeneration
pipeline / re-render when macros change" framing is REPEALED.
