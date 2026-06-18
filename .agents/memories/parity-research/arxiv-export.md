# arXiv-Ready Export — Parity Research

**Scope note (read first):** This is a WORKFLOW TARGET, not a single program: the path from a local paper source to a tarball arXiv will accept and compile.
For this app the source of truth is pandoc markdown, so the arXiv path is `markdown → pandoc → flattened self-contained latex → latexmk (.bbl baked in) → arxiv_latex_cleaner → tar`. Researched against arXiv's official submission help (info.arxiv.org) and google-research/arxiv-latex-cleaner (June 2026). See [[../export-plugins-contract]], [[../rendering-pipeline-requirements-filters-mathjax-references]], [[../feature-catalogue-and-implementation-status]].

## What it is

arXiv compiles submitted TeX server-side with an automatic processor (AutoTeX, latexmk-style multi-pass over a pinned TeX Live, default 2025). The submission is a tar/zip of self-contained sources — "We do not have your style files or macros," so every custom package/macro must be bundled.
arXiv does NOT do on-the-fly figure conversion and does NOT run a `.bib` through BibTeX unless forced — the canonical path is to **include the precompiled `.bbl`** (named to match the main `.tex`). `arxiv_latex_cleaner` is the de-facto open-source tool that takes a built local project and produces the cleaned, size-reduced, comment-stripped folder "ready to ZIP and upload."

## arXiv hard requirements (from info.arxiv.org/help/submit_tex)

- **Self-contained sources** — bundle all custom `.sty`/`.cls`/macros; arXiv has none of yours.
- **`.bbl` included, named to match the main `.tex`** — arXiv reads `.bbl` directly; it auto-runs BibTeX from `.bib` only if `.bbl` is absent, and BLOCKS submission if required `.bib` files are missing.
  Canonical practice: bake the `.bbl`, ship it, omit `.bib`.
- **Compilation from the root of the submission directory** — main file in root or a subdir.
- **Remove auxiliary files** before upload (`.aux`, `.log`, `.dvi`, etc.).
- **Figure formats are processor-dependent** — pdfLaTeX mode: PDF/PNG/JPG; DVI/plain mode: EPS only.
  arXiv does NOT convert figure formats on the fly.
- **Include `.ind` (makeindex), `.gls`/`.nls` (glossary/nomenclature)** if those packages are used.
- **Avoid hidden/dot files and dot-prefixed directories.**
- **No embedded JavaScript / animated PDFs; no double-spaced referee mode.**
- **50 MB size limit** (the motivation for arxiv_latex_cleaner's size transforms).

## arxiv_latex_cleaner feature inventory

- **Strip comments** — removes `%` comments, `\begin{comment}…\end{comment}`, `\iffalse…\fi`, `\if0…\fi`. `[relevance: High]`
- **Delete user commands** — e.g. `\todo{}` via `commands_to_delete`. `[relevance: High]`
- **Custom regex replacements** — config-file pattern rules.
  `[relevance: Med]`
- **Remove auxiliary files** — `.aux`/`.log`/`.out` etc. `[relevance: Med]`
- **Remove unused `.tex` files** — files not included from the root.
  `[relevance: Med]`
- **Remove unused images** — graphics not actually `\includegraphics`'d. `[relevance: Med]`
- **Resize images to a pixel cap + PNG→JPG conversion** — size reduction under 50 MB. `[relevance: Med]`
- **PDF compression via ghostscript** (Linux/Mac).
  `[relevance: Low]`
- **Image allowlist** — exempt specific images from global resizing.
  `[relevance: Low]`
- **TikZ externalization** — replace `tikzpicture` source with precompiled PDF includes.
  `[relevance: High]` (maps directly onto our tikz-filter → SVG/PDF figure pipeline)
- **SVG/Inkscape support** — convert `\includesvg` to generated PDFs.
  `[relevance: Med]`
- **Produces a cleaned folder "ready to ZIP and upload to arXiv."** `[relevance: High]`

## Parity matrix

| feature | target requires/has it | our status | math-writing relevance | notable mechanism worth porting |
| --- | --- | --- | --- | --- |
| Self-contained source bundle (macros/sty included) | required | partial — vendored `research_draft.tex` (amsart + dzg-unified texmf), but no flatten-and-bundle step tracked | High | flatten `\input`/`\include` (include.lua already in pipeline) + collect dependent .sty into the bundle |
| Flattened sources (resolve `\input`/`\include`) | required (root-compile) | planned: Tier 2 (`include.lua` inclusion filter for multi-section papers) | High | include.lua already named for multi-section papers — extend to a flatten-for-arxiv mode |
| Precompiled `.bbl` baked in (no `.bib`) | required (canonical) | NOT tracked | High | latexmk produces `.bbl`; capture it into the bundle, drop `.bib` |
| latexmk multi-pass to resolve refs/cites | matches arXiv AutoTeX | planned: Tier 2 (latexmk-class export drivers) + reference-resolution requirement | High | our md→tex→latexmk path mirrors arXiv's own processor |
| Comment / `\todo` stripping | arxiv_latex_cleaner | NOT tracked | High | run arxiv_latex_cleaner as a plugin post-build |
| Unused-file / unused-image pruning | arxiv_latex_cleaner | NOT tracked | Med | — |
| Image resize / PNG→JPG / size <50MB | arxiv_latex_cleaner | NOT tracked | Med | — |
| TikZ externalization (source→precompiled PDF) | arxiv_latex_cleaner | overlaps Tier 3 tikz filter (compiles tikz→SVG) | High | our tikz filter already precompiles diagrams; emit PDF/EPS for the arxiv bundle instead of inline source |
| Figure-format compliance (PDF/PNG/JPG for pdfLaTeX) | required | partial — figures dir is tikz/SVG-centric | High | ensure exported figures are arXiv-acceptable raster/PDF, since arXiv won't convert |
| Final tarball "ready to upload" | arxiv_latex_cleaner output | NOT tracked | High | a dedicated export plugin emitting the cleaned tar |

## Gaps

Target requirements our catalogue does NOT track (net-new candidates) — this is the **largest gap cluster** of the three topics; arXiv export is essentially untracked beyond the generic latexmk-class export plumbing:

- **An arXiv-export plugin that runs `arxiv_latex_cleaner` over a built project** — strip comments, delete `\todo`/draft commands, prune unused files/images, resize images, and emit a cleaned folder/tarball.
  The export-plugin contract ([[../export-plugins-contract]]) makes this a natural standalone plugin (argv with `{input}`/`{output}`), but no such plugin is enumerated.
  `[relevance: High]`
- **`.bbl`-baking / bundle step** — arXiv's canonical requirement is to ship the precompiled `.bbl` (named to the main tex) and omit `.bib`. Our reference pipeline produces a PDF but does not track capturing the intermediate `.bbl` into a submission bundle.
  `[relevance: High]`
- **Source flattening into a single self-contained directory with bundled `.sty`/macros** — `include.lua` is tracked for multi-section inclusion, but "flatten + collect all dependent packages/macros so it compiles with no system style files" (arXiv's "we don't have your macros") is not an obligation.
  The MathJax macro tiers ([[../mathjax-macro-system-tiers-and-injection]]) and dzg-unified texmf are HTML/preview-side; the arXiv bundle needs the latex macros materialized into the tarball.
  `[relevance: High]`
- **Figure-format compliance gate for arXiv** — arXiv does no on-the-fly conversion; figures must already be PDF/PNG/JPG (pdfLaTeX) or EPS (DVI). Our figures pipeline is tikz/SVG-centric; an export-time conversion/validation step is untracked.
  `[relevance: Med]`
- **TikZ-externalization for the bundle** — our tikz filter precompiles to SVG for preview; the arXiv bundle wants precompiled PDF/EPS substituted for `tikzpicture` source (avoids shipping the tikz toolchain dependency to arXiv).
  The compile machinery exists; the arxiv-targeted variant is untracked.
  `[relevance: High]`

## Dispositions

- **arXiv hosted submission / account / endorsement workflow** — excluded, banned non-goal (hosted deployment, multi-user).
  The app's job ends at producing the upload-ready tarball.
- **In-browser TikZ rendering (TikZJax) for the bundle** — excluded, banned non-goal; bundle figures are precompiled via the existing filter toolchain, not rendered in-browser.
- **No gimmicks in this topic** — arxiv_latex_cleaner and AutoTeX are deterministic tooling; nothing AI/collab/telemetry to deprioritize.
- **Mapping note:** arxiv_latex_cleaner assumes a raw-tex project.
  In this app it runs on the pandoc-EMITTED latex (post `md → tex`), as a post-build export plugin — not on the markdown source.
