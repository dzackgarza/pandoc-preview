# Phase G — Arxiv-Ready Export Pipeline (implementation plan)

Durable, resumable implementation plan for the **arXiv-ready export pipeline** of the Competitive Parity Roadmap.
This is a repo artifact (future-work + current-state), **NOT a memory** — the durable *decisions* live in memory.
Authored 2026-06-16. If interrupted, resume from the **Status / resume here** section at the bottom.

Phase context and prioritization come from [[competitive-parity-roadmap]] ("## Phase G"). The full target study — arXiv's hard-requirements list and the `arxiv_latex_cleaner` feature inventory — is [[parity-research/arxiv-export]]. The plumbing this builds **on** is the export-plugin contract [[export-plugins-contract]], the render/export pipeline requirements [[rendering-pipeline-requirements-filters-mathjax-references]], the feature catalogue [[feature-catalogue-and-implementation-status]], and the proof obligations [[proof-obligations]] (P8 discriminates the PDF engine; P12 honors a custom export pipeline verbatim).
This plan matches the style of [[render-rebuild-plan]] — TDD RED→GREEN per sub-milestone, hard dependencies fail loud, no fallbacks.

**Deliverable.** "Export to a fully arXiv-ready paper": a NEW standalone export target that runs on the **pandoc-EMITTED `.tex`** (post `md → tex`), not on the markdown source — it flattens the LaTeX project into a single self-contained directory, bakes the `.bbl` in (omitting `.bib`), externalizes TikZ to precompiled PDF/EPS, enforces arXiv figure-format compliance, runs `arxiv_latex_cleaner` to strip comments / draft commands / unused assets / dot-files, and emits a cleaned tarball **ready to upload to arXiv**.

**Priority rationale (high value, end-of-lifecycle).** Per the roadmap, arXiv export is the **largest single gap cluster** — essentially untracked beyond generic latexmk plumbing — yet it fires at the **END** of a paper's life.
So it is high-value but ranks *after* the daily-writing features (Phases A–F). It is planned now because the export-plugin surface it builds on (P7/P8/ P12, [[export-plugins-contract]]) is already shipped and stable; Phase G is purely additive on top of it.
It does **not** re-plan the generic export surface — it adds ONE new export target.

## Source items (from the roadmap)

Copied verbatim from [[competitive-parity-roadmap]] "## Phase G", with status tags.
Each item is a sub-capability of the single new arXiv export target; each runs on the pandoc-EMITTED `.tex`, as a post-build export plugin — **not** on the markdown source.

| Item | Status | Rel |
| --- | --- | --- |
| arXiv-export plugin running `arxiv_latex_cleaner` over the built project — strip comments, delete `\todo`/draft commands, prune unused `.tex`/images, resize images, emit a cleaned folder/tarball "ready to upload" | net-new gap | High |
| `.bbl`-baking + bundle step — ship the precompiled `.bbl` named to the main tex, omit `.bib` (arXiv's canonical requirement); capture latexmk's intermediate `.bbl` into the bundle | net-new gap | High |
| Source flattening into a single self-contained directory with bundled `.sty`/macros (arXiv: "we don't have your macros") — extend the already-named `include.lua` to a flatten-for-arxiv mode | refines Tier 2 (include.lua) | High |
| TikZ-externalization for the bundle — substitute precompiled PDF/EPS for `tikzpicture` source (the tikz filter already precompiles for preview; emit PDF/EPS instead) | refines Tier 3 (tikz filter) | High |
| Figure-format compliance gate — ensure exported figures are arXiv-acceptable (PDF/PNG/JPG for pdfLaTeX; EPS for DVI); arXiv does NO on-the-fly conversion and our pipeline is SVG/tikz-centric | net-new gap | Med |

arXiv hard requirements that the proof obligations below encode as externally-observable properties of the REAL tarball (from [[parity-research/arxiv-export]] §"arXiv hard requirements"): self-contained sources (all custom `.sty`/`.cls`/macros bundled); a `.bbl` named to match the main `.tex` with no `.bib`; root-of-directory compilation; auxiliary files removed; figures already in a processor-acceptable format (no on-the-fly conversion); no hidden/dot files or dot-prefixed directories; under the 50 MB cap.

## Discipline

Matches [[render-rebuild-plan]] "Discipline":

- **Interop-first / research-first governs EVERY work item (AGENTS.md HARD RULE #0).** Each sub-milestone below BEGINS with the research step that answers "what already exists" and NAMES the concrete existing tool / binary / format / reference implementation it leverages, supports, or ports — never "write a new X." The app's job is to ORCHESTRATE real tools (`arxiv_latex_cleaner`, `latexmk`, the existing `include.lua`, the existing `tikzcd.lua` precompile) and validate arXiv-acceptance of their output; it owns as little glue as possible, and any owned glue cites a reference implementation.
  A work item whose first action is greenfield is rejected — send it back for the research step.
- **TDD per sub-milestone.** design → RED proof obligations (user-ratified) → commit RED → GREEN → commit.
  Each sub-milestone gates on its proofs green before the next starts.
- **P1–P69 stay green throughout.** Phase G is purely additive (a new export target + new filters + an installed cleaner); a change that would break an existing obligation must be re-scoped.
  In particular P7/P8/P12 (the generic export surface) are untouched — the arXiv target is a SIBLING `[export.<id>]` entry, not a rewrite of `export_sync`.
- **No fallbacks / defaults / mocks; fail loud.** `arxiv_latex_cleaner` is a **hard dependency**: if it is absent, the export fails loudly with the exact provisioning command — it is NEVER skipped, never substituted with a hand-rolled comment-stripper, never made optional.
  `latexmk` / `pdflatex` are likewise hard deps (already required by P8). Single-user Linux; no multi-platform / fail-open paths.
- **arxiv_latex_cleaner provisioning.** It is NOT installed on this host (verified: `which arxiv_latex_cleaner` → not found; `import arxiv_latex_cleaner` → ImportError).
  It is a Python tool on PyPI (`arxiv-latex-cleaner`, google-research).
  It is provisioned through `uvx` (`uvx --from arxiv-latex-cleaner arxiv_latex_cleaner …`), the approved runner pathway — never a `pip install` prelude, never a `try import` shim.
  The plugin's argv (config-owned) is what carries the `uvx` invocation; the app does not hardcode it (export-plugin contract: the entire command is config).
- **Proof harness contract preserved.** The `[OK]/[FAIL]/[SKIP]` doctor report format and the `proof-run.sh` classifier glob are not changed incompatibly; new doctor-class specs extend the glob the same way `d08`/`d09` did.
- **Proof admissibility.** Each obligation is an EXACT externally-observable happy-path state that FAILS on a broken app.
  An arXiv-bundle proof inspects the REAL emitted tarball with an INDEPENDENT process: a baked `.bbl` named to the main `.tex` is present, NO `.bib` is present, comments are stripped, NO dot-files / dot-directories exist, and every figure is in an arXiv-acceptable format (PDF/PNG/JPG). A proof that merely asserts "the cleaner ran" or "an endpoint exists" is inadmissible.

## Current code seams (what gets touched/extended)

Read and confirmed against the real tree.
The arXiv target lands on the EXISTING export-plugin surface — nothing in core is rewritten.

- **`src-tauri/src/render.rs` — `export_sync` (lines 116–165).** This is how an export plugin is invoked today: it loads config, resolves the `[export.<id>]` entry by id (unknown id → loud error), substitutes `{input}`/`{output}`/`{mathjax}` per-argument (substring), and spawns the configured argv with cwd = the source file's parent dir.
  The arXiv target is a NEW `[export.arxiv]` entry whose `command` is a SCRIPT (shipped in the pandoc suite) that performs the md→tex→flatten→.bbl-bake→tikz-externalize→figure-gate→cleaner→tar pipeline.
  **`export_sync` itself is NOT modified** — it already runs an arbitrary argv verbatim (this is exactly the P12 contract).
  `{output}` for this target is the tarball path; the script writes the tarball there.
  The arXiv pipeline is multi-step, so the shipped command is a single orchestrating script (like the user's `~/.pandoc compile-pandoc`), not a bare pandoc call.
- **`src-tauri/src/config.rs` — `ExportPlugin` (lines 137–149), `validate_export_plugin` (165–200), placeholders (151–160).** The `[export.<id>]` plugin model: `IndexMap<String, ExportPlugin>` with `{label, extension, command}`; validation requires `{input}`+`{output}` to appear in the argv, non-empty label/extension, argv ≥ 1. The arXiv entry's `extension` is `tar.gz` (or `tar`), `label` is "arXiv bundle", and `command` references `{input}`/`{output}`. **No new config type is introduced** — the arXiv target IS an `ExportPlugin`. (Any arXiv-specific tuning — image px cap, `commands_to_delete`, the cleaner's config file — lives in the cleaner's own config asset shipped with the suite, invoked from the script's argv, NOT in `ExportPlugin`. This keeps the export contract unchanged.)
- **`src-tauri/resources/vendor/pandoc-config/filters/include.lua` (confirmed present).** The multi-section inclusion filter (Albert Krewinkel's include-files.lua, already in the pipeline, named in [[rendering-pipeline-requirements-filters-mathjax-references]]). Phase G adds a **flatten-for-arxiv mode**: resolve every `\input`/`\include` (and pandoc-level includes) into ONE self-contained `.tex` at the bundle root, and collect the dependent `.sty`/macro files (from `dzg-unified` / `research_draft.tex`'s amsart preamble) INTO the bundle dir so it compiles with no system style files.
  The existing filter resolves markdown includes; the flatten step resolves the LaTeX-level includes on the EMITTED `.tex` plus materializes the macros.
  Sibling export filter `select_images.lua` (also confirmed present) is the model for the unused-image pruning the cleaner subsumes.
- **`src-tauri/resources/vendor/pandoc-config/filters/tikzcd.lua` (confirmed present).** Already precompiles `tikzpicture`/tikzcd to PDF then SVG for preview (via `standalone-tikz.tex`, `pdflatex` + convert; env `PANDOC_DIR`/`FIGURES_DIR`/`SVG_DIR`). Phase G's TikZ-externalization reuses THIS machinery but emits the precompiled **PDF/EPS** into the bundle and substitutes a `\includegraphics` for the `tikzpicture` source, so the bundle ships no tikz toolchain dependency to arXiv.
  The compile core already exists; the arXiv variant selects PDF output and rewrites the emitted `.tex`.
- **`scripts/first-run.sh` (export tables at lines 199–214) + `scripts/provision-proof.sh`.** first-run writes the two shipped export plugins (`[export.html]`, `[export.pdf]`); Phase G adds the shipped `[export.arxiv]` entry here.
  provision-proof.sh's `emit_witness_export_table` pattern (used by P12) is the model for wiring the hermetic arXiv export table for the new specs.
  The shipped arXiv orchestration script + cleaner config asset are vendored under `resources/vendor/pandoc-config/` and installed via `scripts/install-assets.sh` (the existing symlink-install path, d10/d12).
- **`tests/proof/` + `scripts/proof-run.sh`.** New specs `p70`+ (P114–P119 obligations) drive the arXiv export by plugin id through `exportByPlugin(page, 'arxiv', target)` — the SAME E2E command path P12 uses (`window.__PPE_E2E__.exportTo`). Doctor-class specs (`d17`+) extend the classifier glob for the `arxiv_latex_cleaner`-present / required-asset doctor checks.
  The arXiv bundle is unpacked and inspected by INDEPENDENT processes (`tar`, `pdfinfo`, `file`, `find`) — never the app's report.

## Work items (ordered sub-milestones)

Ordered so each sub-milestone's proof can stand on the prior one's GREEN. The whole pipeline is one shipped orchestration script grown incrementally; the proofs target the externally-observable tarball property each step adds.

### G1 — md→tex emission + flatten-for-arxiv (self-contained single dir)

**Research-first:** leverage `pandoc … -t latex` for md→tex (the app's real renderer, already owned) and REUSE the EXISTING `include.lua` already in the pipeline for include-resolution — extend its mode, do not write a new flattener.
Before owning any LaTeX-level flattening glue, research the established latex-flatteners `latexpand` and `flatex` as reference implementations (and cite whichever the extended mode follows); prefer reusing them or following their resolution algorithm over a fresh design.
Greenfield rejected.

The foundation: the arXiv export target exists as a shipped `[export.arxiv]` plugin whose script runs `pandoc … -t latex` to emit the `.tex`, then flattens `\input`/`\include` into ONE root `.tex` and **materializes the dependent `.sty`/macros into the bundle dir** (arXiv: "we don't have your macros"). Extend `include.lua` to a flatten-for-arxiv mode for the LaTeX-level includes; collect the macro/sty set from the `research_draft.tex`/`dzg-unified` preamble into the bundle root.
Output at this stage: a directory that compiles to PDF with NO system style files.
**Proof: P114.**

### G2 — `.bbl`-baking + bundle (ship `.bbl`, omit `.bib`)

**Research-first:** leverage the real `latexmk` binary (already a hard dep via P8) to run the multi-pass BibTeX/biber build and PRODUCE the `.bbl` — capture latexmk's own intermediate `.bbl`; own no bibliography processing.
Greenfield rejected.

Run `latexmk` (multi-pass, BibTeX/biber as needed) inside the flattened bundle to resolve references and produce the intermediate `.bbl`; capture it into the bundle **named to the main `.tex`** (`main.tex` → `main.bbl`); DELETE the `.bib` from the bundle.
This is arXiv's canonical requirement (arXiv reads `.bbl` directly; a missing required `.bib` BLOCKS submission).
Reuses the latexmk-class driver model already required for P8 and [[rendering-pipeline-requirements-filters-mathjax-references]]'s md→tex→latexmk path.
**Proof: P115.**

### G3 — TikZ-externalization for the bundle (precompiled PDF/EPS, no tikz source)

**Research-first:** leverage the EXISTING `tikzcd.lua` filter's precompile core (already `pdflatex`-compiles `tikzpicture`/tikzcd for preview) — reuse that machinery, selecting PDF/EPS output for the bundle; own no new tikz compiler.
Greenfield rejected.

Drive `tikzcd.lua`'s existing compile core to emit precompiled **PDF** (pdfLaTeX target) for every `tikzpicture`/tikzcd, write those PDFs into the bundle, and rewrite the emitted `.tex` so each diagram is a `\includegraphics{<fig>.pdf}` instead of inline tikz source.
The bundle then ships no tikz toolchain dependency.
(In-browser TikZJax for the bundle is a banned non-goal — [[parity-research/arxiv-export]] Dispositions; bundle figures are precompiled via the existing filter toolchain.)
**Proof: P116.**

### G4 — Figure-format compliance gate (arXiv-acceptable raster/vector only)

**Research-first:** leverage real conversion binaries (e.g. `rsvg-convert`/`inkscape` SVG→PDF, ImageMagick) for any format coercion — own no image converter, only the orchestration that picks the binary and the loud-fail gate validating arXiv-acceptance.
Greenfield rejected.

arXiv does NO on-the-fly conversion and our pipeline is SVG/tikz-centric.
This gate ensures every figure in the bundle is PDF/PNG/JPG (pdfLaTeX target): convert any SVG/other to a compliant format, and FAIL LOUDLY (export non-zero, named offending file) if a figure cannot be made compliant — never ship a bundle arXiv will reject.
**Proof: P117.**

### G5 — arxiv_latex_cleaner pass (strip comments / draft commands / unused assets / dot-files)

**Research-first:** leverage the REAL `google-research/arxiv-latex-cleaner` tool, run unmodified via `uvx --from arxiv-latex-cleaner` — it already strips comments, prunes unused `.tex`/images, resizes images, and removes dot-files.
Own NO comment-stripper / pruner / resizer; the app only invokes the tool and validates its output.
Greenfield (a hand-rolled cleaner) is explicitly rejected and never substituted.

Run `arxiv_latex_cleaner` (via `uvx --from arxiv-latex-cleaner …`, hard dependency, fail loud if the runner pathway is blocked) over the bundle: strip `%` comments and `comment`/`iffalse` blocks, delete configured draft commands (`\todo{}` etc. via `commands_to_delete`), prune unused `.tex`/images, resize images under the px cap, and remove auxiliary/dot files — producing the cleaned folder "ready to upload."
The cleaner's config (image cap, `commands_to_delete`, regex rules) is a shipped asset referenced from the plugin's argv, NOT app config.
**Proof: P118.**

### G6 — Final tarball "ready to upload"

**Research-first:** leverage the real `tar`/gzip binary for packaging — own no archiver.
The only owned surface here is the orchestration that calls `tar` and the independent-process validation of arXiv-acceptance (P119). Greenfield rejected.

Tar the cleaned bundle to `{output}` (the chosen `.tar.gz` path): main `.tex` + `.bbl` at the root, all `.sty`/macros bundled, figures compliant, NO `.bib`, NO `.aux`/`.log`/`.out`, NO hidden/dot files or dot-prefixed directories, under 50 MB. This is the single externally-uploadable artifact.
**Proof: P119** (the end-to-end bundle-integrity proof; subsumes the per-step properties but asserts them all on the ONE real tarball).

## Proposed proof obligations (P114–P119)

**PROPOSALS ONLY — do NOT edit [[proof-obligations]].** Reserved block **P114–P119** (P62 is the current max; this is the next free block after intervening phases reserve their own ranges — the exact numbering is ratified with the user before RED, as with every prior milestone).
Spec families: webview specs `p70`+ (driven by `exportByPlugin(page, 'arxiv', target)`); doctor-class specs `d17`+ for the dependency/asset checks.
Each is admissible only because it FAILS on a broken app, and each inspects the REAL emitted tarball with an INDEPENDENT process.

- **P114 — Flattened self-contained bundle compiles with no system styles.** Export the witness project to an arXiv bundle.
  An independent process unpacks the tarball into a directory with NO access to the user's texmf/system style files (e.g. compile with `TEXMFHOME` pointed at an empty dir) and runs `latexmk`/`pdflatex` from the bundle ROOT: a valid PDF is produced whose extracted text contains the witness ("Geometry of Numbers", "Minkowski bound"). The bundle's root `.tex` contains NO unresolved `\input`/`\include`, and every custom `.sty`/macro the document uses is present as a real file in the bundle.
  *Admissible because it fails on a bundle that left `\input`s unresolved (compile errors on the missing section files), and on a bundle that did not materialize the macros (compile errors on undefined `\RR`/`\coxeterblacknode` because the system styles are absent).*

- **P115 — `.bbl` baked in, named to the main tex, no `.bib`.** Export to an arXiv bundle for a witness project with at least one `\cite`. An independent process unpacking the tarball finds a `<main>.bbl` whose basename equals the main `.tex`'s basename, whose contents include the cited entry's formatted reference, AND finds NO `.bib` file anywhere in the bundle.
  *Admissible because it fails on a bundle that shipped the `.bib` instead of the `.bbl` (the `.bib` is present — arXiv's blocking case), on a `.bbl` named differently from the main tex (arXiv would not read it), and on an empty/absent `.bbl` (the citation was never resolved into the bundle).*

- **P116 — TikZ externalized to precompiled PDF, no tikz source in the bundle.** Export a witness project containing a `tikzcd`/`tikzpicture` to an arXiv bundle.
  An independent process finds, in the bundle, a real precompiled figure file (PDF, non-zero, a valid PDF per `pdfinfo`), finds the bundle's root `.tex` references it via `\includegraphics`, and finds NO `\begin{tikzpicture}`/ tikzcd source remaining in any `.tex` of the bundle.
  *Admissible because it fails on a bundle that left the tikz source inline (the `tikzpicture` environment is still present — shipping the tikz toolchain dependency to arXiv), and on a dangling `\includegraphics` whose target file was never written.*

- **P117 — Every bundled figure is in an arXiv-acceptable format.** Export a witness project whose source references an SVG (or other non-arXiv) figure to an arXiv bundle.
  An independent process enumerates every figure referenced by the bundle's `.tex` and confirms each on-disk figure file is PDF/PNG/JPG (verified by `file`/magic bytes, not extension), with NO `.svg` remaining among the bundled/referenced figures.
  Independently, exporting a project with a figure that CANNOT be made compliant fails LOUDLY (export exit non-zero, the offending filename named in the log), and no tarball is produced.
  *Admissible because it fails on a bundle that shipped an SVG arXiv would not convert (an `.svg` is present and referenced), and on a silent pass-through that emits a tarball despite a non-convertible figure (the loud-failure clause).*

- **P118 — arxiv_latex_cleaner stripped comments, draft commands, and dot-files.** Export a witness project whose `.tex` (post-emission) carries a `% SECRET COMMENT`, a `\todo{fix this}`, and an unused image to an arXiv bundle.
  An independent process unpacking the tarball finds: NO `%`-comment line containing "SECRET COMMENT" in any bundled `.tex`, NO `\todo` command remaining, the unused image absent, and NO hidden/dot files or dot-prefixed directories anywhere in the bundle.
  Independently, with `arxiv_latex_cleaner` unavailable (the `uvx` pathway blocked), the export fails LOUDLY naming the missing dependency — it is never skipped.
  *Admissible because it fails on a bundle the cleaner never touched (the SECRET COMMENT / `\todo` / unused image / a `.git` dir survive), and on a fail-open that emits a "cleaned" tarball when the cleaner is absent (the loud-dependency clause).*

- **P119 — End-to-end arXiv-ready tarball integrity.** Export the witness project to an arXiv bundle at a chosen `.tar.gz` path.
  An independent process asserts, on the ONE real tarball, ALL of: it exists at exactly that path and is a valid gzip tar; the main `.tex` is at the root; a `<main>.bbl` named to the main tex is present and NO `.bib` is present (P115); NO `.aux`/ `.log`/`.out`/`.dvi` auxiliary files (arXiv: remove auxiliaries); NO hidden/dot files or dot-prefixed directories (arXiv: avoid dot-files); every referenced figure is PDF/PNG/JPG (P117); the total uncompressed size is under 50 MB; and unpacking + compiling from the root with no system styles yields the witness PDF (P114). *Admissible because it fails on any single arXiv hard-requirement violation in the real emitted artifact — a `.bib` present, an `.aux` left in, a `.git`/dot-dir shipped, an SVG figure, a non-self-contained bundle, or an over-size bundle — none of which a smoke "the export ran" check would catch.*

## Verification

Same vehicle as [[proof-obligations]] "Verification vehicle": the real app on a real display via `tauri-plugin-playwright` (Xvfb), hermetic per-run temp project + `XDG_CONFIG_HOME`, disk assertions by INDEPENDENT processes, no mocks/skips/forced-error-modes.
Phase G specifics:

- **Independent tarball inspection.** Every bundle proof unpacks `{output}` with `tar` in a fresh temp dir and asserts on the extracted tree with `find` (dot-files/dirs, `.bib`, auxiliaries), `file`/magic-byte checks (figure formats), `pdfinfo` (figure PDF validity, final compile), byte/string reads (`.bbl` naming + contents, comment/`\todo` absence), and `du` (50 MB cap) — never the app's report.
- **Hermetic self-contained compile.** P114/P119's "compiles with no system styles" runs `latexmk`/`pdflatex` from the bundle root with `TEXMFHOME` pointed at an empty dir, proving the bundle is genuinely self-contained (not silently relying on the host texmf).
- **Hard dependencies, fail loud.** `latexmk`, `pdflatex` (present on host), and `arxiv_latex_cleaner` (provisioned via `uvx --from arxiv-latex-cleaner`, NOT installed on host today) are hard deps.
  The doctor-class specs (`d17`+) assert the cleaner is reachable through the configured argv and the shipped orchestration script + cleaner-config asset are installed (the d10/d12 symlink-install pattern).
  P118's loud-dependency clause proves the export refuses to fail open when the cleaner is unavailable.
- **Regression gate.** Full P1–P69 suite stays green; the arXiv specs are additive (`p70`+, `d17`+); the `proof-run.sh` classifier glob is extended for the new doctor-class specs exactly as `d08`/`d09` extended it.

## Sequencing & dependencies

- **Prerequisite GREEN baseline:** the generic export surface (P7/P8/P12), the md→tex/latexmk path ([[rendering-pipeline-requirements-filters-mathjax-references]]), the tikz filter (`tikzcd.lua`, Milestone F / P56-class), and `include.lua` in the pipeline.
  The export-plugin contract ([[export-plugins-contract]]) is the surface this builds ON; do NOT re-plan it.
- **Internal order:** G1 (flatten) → G2 (.bbl) → G3 (tikz externalize) → G4 (figure gate) → G5 (cleaner) → G6 (tar).
  Each later step's proof relies on the prior step's GREEN bundle.
  G2 needs G1's flattened bundle; G3/G4 operate on the figures in that bundle; G5 runs over the whole bundle; G6 packages the cleaned result.
  P119 is the capstone end-to-end proof.
- **Hard external dependency to provision FIRST:** `arxiv_latex_cleaner` via `uvx` — provision and verify reachability before G5 RED, never plow past its absence (it is the keystone of the cleaner pass).
  `latexmk`/`pdflatex` already present.
- **Cross-phase coupling:** the flatten-for-arxiv `include.lua` mode and the macro-materialization step share the `dzg-unified`/`research_draft.tex` preamble with the export-suite milestone ([[render-rebuild-plan]] "Export folded into the pandoc suite"); the arXiv target SHOULD ship as a sibling in the pandoc suite once exports fold into the plugin model, but it can land first as an `[export.arxiv]` config entry (the current transitional model, identical to P7/P8/P12) and migrate with the rest.
- **Banned non-goals (do not re-open):** arXiv hosted-submission/account/endorsement workflow (the app's job ENDS at the upload-ready tarball); in-browser TikZJax for the bundle.
  Both are recorded exclusions in [[parity-research/arxiv-export]] "Dispositions".

## Status / resume here

- **2026-06-16:** Plan authored.
  Source items copied from [[competitive-parity-roadmap]] Phase G; full target study read ([[parity-research/arxiv-export]]). Code seams inspected and confirmed against the real tree: `render.rs::export_sync` (lines 116–165) runs an arbitrary configured argv verbatim (the P12 contract — the arXiv target is a new `[export.arxiv]` entry, not a core change); `config.rs::ExportPlugin`/`validate_export_plugin` is the unchanged plugin model; `include.lua`, `select_images.lua`, `tikzcd.lua` confirmed present under `src-tauri/resources/vendor/pandoc-config/filters/`; shipped export tables in `scripts/first-run.sh` (lines 199–214); the P12 spec + `exportByPlugin` E2E path are the proof model.
  `latexmk`/`pdflatex` present on host; **`arxiv_latex_cleaner` NOT installed** — must be provisioned via `uvx --from arxiv-latex-cleaner`, fail loud if absent.
- **NOTHING in G1–G6 implemented yet.** Six sub-milestones designed; proof obligations **P114–P119 proposed (not ratified)** — ratify with the user before any RED, per the standing TDD discipline.
  [[proof-obligations]] is NOT edited by this plan.
- **NEXT:** ratify P114–P119 numbering + wording with the user; provision `arxiv_latex_cleaner` via `uvx` and verify reachability; then begin G1 RED (flatten-for-arxiv `include.lua` mode + the shipped `[export.arxiv]` orchestration script), keeping P1–P69 green.
