# Phase F — PDF Preview, Gummi Parity, Faster Export Feedback (implementation plan)

Durable, resumable roadmap for Phase F of the competitive-parity push: a continuous live
PDF-preview pane (pdf.js) driven by a compile-on-idle PDF path, temp-directory build
isolation, multi-pass (latexmk/rubber) auto-orchestration, an explicit auto/manual +
fast/full compile control, inline warning surfacing tied to source locations, and a
quick-feedback slides preview. This is a repo artifact (future-work + current-state), NOT a
memory; the durable *decisions* and the source inventory live in memory — see
[[competitive-parity-roadmap]] ("## Phase F"), [[parity-research/gummi]] (continuous live PDF
preview, compile-on-idle, latexmk/rubber multi-pass, temp-directory build isolation),
[[parity-research/overleaf]] (embedded PDF.js viewer, auto/manual + fast/draft toggle,
bidirectional SyncTeX click-jump, inline warnings), [[parity-research/vimtex]] (forward/inverse
SyncTeX, pplatex log), [[export-plugins-contract]], [[render-rebuild-sequencing-and-vendoring-decisions]],
[[reference-source-preview-scroll-sync]] (the `sourcepos` reader gate), and
[[preview-iframe-and-asset-resolution]]. If interrupted, resume from **Status / resume here**
at the bottom.

Phase F delivers the user's named asks — "modes for previewing PDFs", "partially replace
Gummi", "slide modes with quick feedback", and "feedback faster than a compile" on the export
side. It ranks SIXTH in the parity ordering because PDF preview is a heavyweight,
late-lifecycle surface (a real LaTeX build loop, not the existing single-pass HTML render),
its highest-value sub-feature (bidirectional source↔PDF jump) is HARD-GATED on an unresolved
product decision, and most of the daily-writing wins (lint, snippets, citations, figures,
navigation — Phases A–E) land first and are independent of it. Much of this is already the
Tier-2 "PDF preview Gummi parity" milestone ([[feature-catalogue-and-implementation-status]]);
the parity work adds the bidirectional jump and the build-hygiene mechanisms. The keystone
architectural fact: **the PDF path is just another configured command** — it fits the existing
`[export.<id>]` / pandoc-suite plugin model exactly (it produces a `.pdf` artifact on disk),
so the app core grows a *viewer* and a *compile-on-idle scheduler*, NOT a build pipeline. The
app never hardcodes a compile recipe — it runs the configured one and surfaces
command/output/exit status, exactly as P8/P11 already require for one-shot export.

## Source items (from the roadmap)

Copied faithfully from [[competitive-parity-roadmap]] "## Phase F — PDF preview, Gummi parity,
faster export feedback", with the roadmap's status tags:

| Item | Status | Rel |
| --- | --- | --- |
| Continuous live PDF preview / compile-on-idle for the PDF path (pdf.js viewer) | maps Tier 2 ("PDF preview Gummi parity") | High |
| Bidirectional SyncTeX-style click-jump source↔compiled PDF; inverse search (click rendered element → source line) as a first-class action, beyond the filter-tagged hover-to-edit | refines Tier 2 (scroll sync / hover-to-edit) — gated on `sourcepos` reader decision | High |
| Temp-directory build isolation — route latexmk `-jobname` to a temp dir so `.aux`/`.log` never litter the thesis source tree (the export-plugin contract currently runs in the source's parent dir) | net-new gap | Med |
| `rubber`/latexmk multi-pass auto-orchestration — "run exactly as many passes as needed, auto-invoke BibTeX/Makeindex" as a first-class option; the substance of "references done right" | refines Tier 2 (reference resolution) | Med |
| Explicit auto/manual compile toggle + fast/draft vs full compile distinction for the export path | refines Tier 2 (render lifecycle) | Med |
| Inline WARNING surfacing (not just errors) tied to source locations, in the same pane as the compile control | refines Tier 2 / P11 | Med |
| Slides (beamer/revealjs) fast-feedback preview — a separate renderer plugin already planned; the parity ask is QUICK feedback for the slide path | maps Tier 2 (slides mode) | Med |

Roadmap framing carried forward verbatim, from [[parity-research/gummi]] Gaps: *Gummi routes
latexmk `-jobname` to a temp dir so `.aux`/`.log`/`.pdf` never litter the source tree; our
export-plugin contract runs with `cwd = source file's parent directory`
([[export-plugins-contract]]), which WILL scatter latex aux files next to the user's thesis.*
And: *rubber "run exactly as many passes as needed, auto-invoke BibTeX/Makeindex" is the
substance of "references done right" but is not pinned as an obligation.*

**Scope boundary — VIEWER + SCHEDULER, not a build pipeline.** The PDF *compile* is a
configured `[export.<id>]`-shaped command (today's `[export.pdf]` is already pandoc →
lualatex; a latexmk/rubber multi-pass command is a config swap, not new core code). Phase F
adds three app-core capabilities and nothing else: (1) an embedded **pdf.js viewer** pane that
renders a `.pdf` produced on disk; (2) a **compile-on-idle scheduler** that drives that
configured PDF command on a debounce, distinct from the existing HTML-render debounce; (3)
**temp-directory build isolation** so the artifacts land outside the source tree. The app does
NOT learn what latexmk/rubber/BibTeX are — those are the plugin's argv. This is the same
total-externality discipline B/C established for the renderer
([[renderer-plugin-architecture]]).

## Discipline

Mirrors [[render-rebuild-sequencing-and-vendoring-decisions]] / `render-rebuild-plan.md` and
the sibling phase plans (`phase-a`…`phase-e`):

- **Interop-first / research-first (AGENTS.md HARD RULE #0) governs every work item.** Each
  sub-milestone BEGINS by researching the existing tool / library / binary / format / reference
  implementation that already does this, and names what it leverages, supports, or ports —
  before any build step. Greenfield is rejected: a work item whose first action is "write a new
  X" with no such research is sent back for the research step. Phase F's anchors: embed the
  maintained pdf.js (Mozilla) library (do not write a PDF renderer); run the real latexmk /
  rubber build-driver binaries (do not orchestrate passes ourselves); parse the standard SyncTeX
  format with an existing SyncTeX parser library (do not invent a mapping); use latexmk's own
  `-outdir`/`-jobname` for build isolation (its native mechanism, as Gummi does); leverage an
  existing latex-log parser (pplatex / TexLogParser-class, from Phase A) for warning surfacing.
- TDD: design → RED proof obligations (externally observable, user-ratified) → commit RED →
  GREEN → commit. Each sub-milestone gates on its proofs green before the next starts.
- The existing obligations **P1–P69** and the doctor battery (D-series) stay green throughout.
  A sub-milestone that would break one must be re-scoped. In particular: **P8** (export PDF
  discriminates the engine via `pdfinfo` Producer) and **P11** (raw compile log reflects the
  real subprocess) are NOT weakened — the PDF-preview compile path reuses the SAME export
  command boundary, so the temp-dir and multi-pass work must keep P8's artifact-on-disk +
  engine-discrimination contract intact. **P7/P12/P17** (HTML/custom-pipeline/offline export)
  are likewise untouched: Phase F adds a PDF *viewer*, it does not change what HTML export
  emits.
- No fallbacks / defaults / mocks; fail loud. A PDF compile that exits nonzero surfaces the
  command + stderr + exit status in the log pane and shows a failed-compile indicator — it
  NEVER shows a stale PDF as if fresh, and NEVER silently swallows the failure (the
  fail-open trap [[export-plugins-contract]] already records for the `--mathjax` CDN case).
  A missing pdf.js asset, an unresolvable temp dir, or an absent configured PDF plugin is a
  loud error, never a blank pane. Single-user Linux desktop; no multi-platform, no runtime
  mode flags beyond the user-facing auto/manual + fast/full toggles (which are
  config-persisted state, not build-target switches).
- Proof obligations are EXACT externally-observable happy-path states, admissible only if they
  FAIL on a plausibly broken app. A PDF-preview proof must read a **real compiled PDF** off
  disk through an independent process (`pdfinfo`/`pdftotext`) and carry the witness text —
  exactly P8's discipline — so it fails on a faked/blank viewer, a stale artifact, or an
  unwired compile. The reserved block is **P107–P113**. These are PROPOSALS only — do NOT edit
  `proof-obligations.md`; ratify with the user before writing RED.

## Current code seams (what gets touched/extended)

Verified against the working tree (2026-06-16, branch `milestone-g-insertion-bar`).

- **`src-tauri/src/render.rs`** — `export_sync` (L116–165) is the existing one-shot export
  boundary: resolves an `[export.<id>]` entry by id, substitutes `{input}`/`{output}`/`{mathjax}`
  per-argument, spawns argv with **`current_dir(&dir)` = the source file's parent** (L156).
  *This `current_dir` is the exact line the temp-dir-isolation work changes* — the build must
  run in (or `-jobname`/`-output-directory` into) a temp dir so `.aux`/`.log`/`.pdf` never land
  beside the thesis, and the produced `.pdf` is then surfaced to the viewer. `format_log`
  (L60–78) is the shared log formatter P11 asserts; the inline-warning work parses its output,
  it does not mutate it. `ExportResult { ok, log }` (L54–58) is the structured result the
  compile-on-idle scheduler consumes; it likely grows an `artifact: Option<PathBuf>` so the
  frontend learns the produced PDF path (mirrors `PluginResult.artifact`).
- **`src-tauri/src/config.rs`** — `ExportPlugin` (L137–149: `label`, `extension`, `command`),
  `validate_export_plugin` (L165), and `PLACEHOLDER_INPUT`/`OUTPUT`/`MATHJAX` (L152–160). The
  PDF-preview path is configured here. A temp-dir convention may add a `{builddir}` / `{outdir}`
  placeholder (validated alongside the existing ones, [[export-plugins-contract]] already
  anticipates app-substituted placeholders). The auto/manual + fast/full toggle state and a
  `pdf_preview` plugin id selector live in `[preview]` (L245) next to `debounce_ms`. The
  `Directories` table (L52–66; `figures`, `styles`) is the precedent for any new configured
  path (a temp/build root, if not OS-temp-derived).
- **`src-tauri/src/plugins.rs`** — `render_active` is the renderer-delegation entry point;
  `run_plugin` returns the structured `PluginResult { success, artifact, exit_code, stdout,
  stderr }`. The slides-preview path is a **renderer/exporter plugin** here (revealjs/beamer is
  "just a different pandoc command" per [[feature-catalogue-and-implementation-status]] Tier-2
  slides). The PDF compile may ultimately fold into the pandoc suite as a sibling plugin (the
  post-G export-as-plugin milestone), so Phase F should keep the PDF command flowing through a
  plugin-shaped boundary, not a bespoke PDF code path.
- **`src/App.svelte`** — `scheduleRender`/`doRender` (L632–664) is the existing HTML
  compile-on-idle loop: a `renderTimer` debounce + a `renderSeq` latest-wins guard + a
  `RenderStatus` state machine. *The PDF compile-on-idle scheduler is the structural sibling of
  this* — a SEPARATE debounce timer (the recovery autosave at L500 is the precedent for a
  second independent debounce), its own latest-wins sequence guard, feeding a PDF render-status.
  `exportToPath` (L1057–1081) is the export command path the menu + E2E hook share; the
  PDF-preview compile reuses this boundary. `buildCommands` (L626–628) auto-populates the
  command palette from `config.export` — the auto/manual toggle + "recompile PDF" land as
  commands here. `mathjaxUrl` resolution + `convertFileSrc` (L645–648) is the asset-protocol
  precedent for serving the produced PDF bytes to pdf.js.
- **`src/lib/components/PreviewPane.svelte`** — the tabbed pane (Preview | Compile Log) with
  the `data-status` render-status cluster (L40–63) and the `srcdoc` iframe (L67–73). The PDF
  viewer is a THIRD tab (Preview | PDF | Compile Log) OR a swappable preview mode; it carries
  its own status cluster (the existing `RenderStatus` shape — `idle`/`stale`/`rendering`/`ok`/
  `error` — applies verbatim to the PDF compile). The inline-warning surfacing extends the
  Compile Log tab (or a sibling "Problems" list) with parsed warning entries that carry a
  source line and click-to-jump.
- **`src/lib/api.ts`** — `exportDocument` (L107) / `renderPreview` (L101) are the IPC seams.
  Phase F adds a `compilePdf`/`renderPdfPreview` command (the compile-on-idle PDF driver
  returning the artifact path + log) and, gated, a `synctexForward`/`synctexInverse` pair.
  `convertFileSrc` already serves on-disk bytes to the webview.
- **`src/lib/dockview.ts`** — the editor|preview Splitview. A PDF viewer pane either replaces
  the preview pane's content by mode, or is a peer tab in `PreviewPane`; no new pane geometry is
  required (P13–P15 splitter obligations stay green either way).
- **`src/lib/types.ts`** — `RenderStatus` (L99) is reused for the PDF compile; `Config.preview`
  (L37, `debounce_ms`) grows the auto/manual + fast/full + `pdf_preview` plugin-id fields,
  mirrored from the Rust `Preview` struct.
- **pdf.js** — the embedded viewer is a **new vendored dependency** (`pdfjs-dist`), the named
  candidate. It is app-owned UI (a viewer), NOT a plugin: it renders an artifact the configured
  plugin produced. Its worker + cmaps ship as app resources (the MathJax-bundle precedent in
  `render.rs` L26: a version-pinned local asset, never a CDN), so the viewer works offline like
  P16/P17 require of MathJax.

## Work items (ordered sub-milestones)

Ordered so each sub-milestone is independently provable and green-gates the next. F1–F4 are
reader-AGNOSTIC and unblocked. F5 is the HARD GATE. F6 is independent.

### F1 — Embedded pdf.js viewer renders a configured-command PDF (compile-on-idle)

*Research-first:* embed the maintained **pdf.js** (Mozilla) library via `pdfjs-dist` for the
viewer — do NOT write a PDF renderer; Overleaf and Gummi both surface a real pdf-rendering
component, not a bespoke one. The compile-on-idle scheduler PORTS the structure of the existing
HTML `scheduleRender`/`doRender` loop already in `App.svelte`, not a fresh design.

The headline. Vendor `pdfjs-dist` (+ worker/cmaps as offline app resources). Add a PDF viewer
surface to `PreviewPane.svelte` (a third tab / preview mode). Add a **compile-on-idle scheduler**
in `App.svelte` — a debounce timer SEPARATE from the HTML `renderTimer`, with its own
latest-wins `renderSeq`-style guard and its own `RenderStatus` cluster — that drives the
configured PDF command through the existing `exportToPath`/`export_sync` boundary to a per-run
output path, then loads the produced `.pdf` into pdf.js via `convertFileSrc`. The compile is
the configured `[export.<id>]` command (today's `[export.pdf]`), NOT a hardcoded recipe. On a
nonzero exit, the status cluster shows failed-compile and the log pane carries the command +
stderr + exit status (P11 shape); the viewer never shows a stale PDF as fresh.

*Proves:* **P107**. *Reader-agnostic; unblocked.*

### F2 — Temp-directory build isolation (clean source tree)

*Research-first:* use **latexmk's own `-outdir`/`-jobname`** native build-isolation mechanism —
the exact mechanism Gummi uses (`-jobname` routed to `C_TMPDIR`, verified in
`src/compile/latexmk.c`, [[parity-research/gummi]]) — do NOT invent an aux-file-shuffling scheme.
The app only supplies the temp/build path (a validated placeholder); the driver's own flags do
the isolation.

Today `export_sync` spawns with `current_dir = source's parent` (L156), scattering
`.aux`/`.log`/`.fls`/`.pdf` beside the thesis. Route the build into a temp/build directory: the
compile runs with its working/output directory in a temp location (`-output-directory`/`-jobname`
is the plugin's argv concern; the app supplies the path via a validated `{builddir}` placeholder
or an OS-temp-derived dir), the produced PDF is surfaced to the viewer from there, and the
source tree stays clean. The one-shot export path (P8) gets the same isolation — its artifact
still lands at the user-chosen `{output}`, but the intermediates do not litter the source dir.

*Proves:* **P108**. *Keeps P8 green (artifact + engine discrimination unchanged). Reader-agnostic.*

### F3 — Multi-pass (latexmk/rubber) auto-orchestration as a configured driver

*Research-first:* run the real **latexmk / rubber** build-driver binaries — they already "run
exactly as many passes as needed" and auto-invoke BibTeX/Makeindex (latexmk's default; rubber's
explicit promise, [[parity-research/gummi]]). Do NOT orchestrate compile passes ourselves; the
deliverable is a vendored configured command whose argv IS the real driver, plus a doctor check
that its argv[0] resolves to that executable.

The "references done right" substance: a configured PDF command that runs *exactly as many
passes as needed* and auto-invokes BibTeX/Makeindex (latexmk's default behavior; rubber's
explicit promise). This is primarily a **shipped-config + doctor** deliverable — a vendored
`[export.<id>]` (or pandoc-suite sibling) whose command is a latexmk/rubber driver, proven by a
citation/cross-reference fixture that ONLY resolves after multiple passes (a forward reference
+ a `\cite` that a single pass leaves as `??`). The app core is unchanged; F3 proves the
plugin-shaped command produces a fully-resolved PDF. A doctor check confirms the configured
driver's argv[0] resolves to an executable (the `export-plugins` check precedent
[[export-plugins-contract]]).

*Proves:* **P109**. *Reader-agnostic; depends on F2 (so the multi-pass intermediates are isolated).*

### F4 — Auto/manual toggle + fast/full compile distinction; inline warning surfacing

*Research-first:* for inline warning surfacing, leverage an **existing latex-log parser**
(pplatex / TexLogParser-class, the same parser layer Phase A's structured-log work names —
[[parity-research/vimtex]], [[parity-research/overleaf]]) — do NOT write a bespoke log parser.
The toggle controls are config-persisted state selecting between configured commands, not new
build machinery.

Two user-facing controls in the PDF preview pane, persisted in `[preview]` config: (a) an
**auto/manual** toggle gating whether the F1 compile-on-idle scheduler fires (manual = a
"Recompile PDF" command, the Overleaf Recompile-button analog) and (b) a **fast/draft vs full**
selection choosing between two configured PDF commands (a draft single-pass vs the F3 full
multi-pass driver). Plus **inline warning surfacing**: parse the compile log
(pplatex/log-parser-class) into structured `{line, severity, message}` entries — WARNINGS as
well as errors — shown in the compile pane and (where a source line is recoverable) clickable to
jump the editor cursor. NOTE: mapping a *latex* warning line back to a *markdown* source line is
subject to the same `sourcepos` limitation as F5 for precise jumps; F4's honest floor is
surfacing the warning + its latex-log line, with markdown-line jump GATED (see F5).

*Proves:* **P110** (toggle + fast/full) and **P111** (inline warnings). *Reader-agnostic for
surfacing; the markdown-line jump clause inherits F5's gate.*

### F5 — Bidirectional SyncTeX click-jump source↔PDF [HARD GATE]

*Research-first:* parse the standard **SyncTeX** format with an existing SyncTeX parser library
(the `.tex`↔PDF position map latexmk emits via `-synctex=1`, as Gummi/vimtex/Overleaf all
consume) — do NOT invent a position mapping. BUT the bidirectional source↔PDF jump remains the
REAL gate below: the missing link is markdown→tex line mapping, which is the unresolved pandoc
`sourcepos` reader decision — SyncTeX interop does not unblock it.

**This sub-milestone is BLOCKED on an unresolved product decision and MUST NOT be hand-waved.**
Bidirectional jump (forward: editor cursor → PDF location; inverse: click rendered PDF element →
markdown source line) requires a source-position map from the *markdown* buffer to the *compiled
PDF*. SyncTeX maps `.tex`↔PDF, but our `.tex` is *pandoc-emitted* from markdown — the missing
link is markdown→tex line mapping, which is exactly the **`sourcepos` reader gate**
([[reference-source-preview-scroll-sync]]): pandoc emits per-element source positions ONLY for
the CommonMark-family readers (`commonmark`/`commonmark_x`/`gfm`), and the app's shipped default
`-f markdown` does NOT support `sourcepos` (it errors), with no Lua-filter workaround. Switching
the preview/export reader to `commonmark_x` to obtain `sourcepos` LOSES `+citations` and
raw-LaTeX environment parsing — both first-class for math research — and collides with the
"exactly what the pandoc CLI produces" invariant if the user's real command uses `-f markdown`.
**This is the same open decision in [[decision-provenance-user-owned-vs-framework-forced]] that
gates scroll-sync Stage 1.**

Therefore F5 is split exactly as the scroll-sync memory splits Stage 1:
- **F5-blocked (until the user rules on the reader):** precise bidirectional click-jump (forward
  cursor→PDF page-coordinate, inverse PDF-click→markdown-line). Do NOT implement against a
  guessed reader. Resolution path: (i) user ratifies `commonmark_x+sourcepos` as the
  PDF-compile reader (accepting the citation/raw-tex tradeoff, possibly via a dedicated
  PDF-preview pandoc→tex step distinct from the export command), at which point markdown→tex→PDF
  line mapping becomes constructible (sourcepos `data-pos` → tex line via a synctex-aware
  intermediate); OR (ii) user accepts that precise jump is out of scope and F5-blocked is struck.
- **F5-floor (unblocked, optional):** the EXISTING filter-tagged hover-to-edit
  (`.pandoc-preview-editable` postMessage) is the inverse-search analog for *filter-tagged*
  elements only (tikz/callouts) and already works in the HTML preview; it does NOT generalize to
  arbitrary PDF elements (vimtex's inverse search is universal — the gap the roadmap names).

*Proves:* **P112** — RATIFY THE READER DECISION FIRST. Until then, F5 carries NO green
obligation; the gate is the deliverable. Flag this to the user explicitly at sequencing time.

### F6 — Slides (beamer/revealjs) fast-feedback preview

*Research-first:* the slide deck is produced by the **real pandoc** reveal.js/beamer writer
(slides are "just a different pandoc command", [[feature-catalogue-and-implementation-status]]
Tier-2) rendered by the maintained reveal.js library pandoc already targets — do NOT build a
slide renderer. F6 only wires that existing renderer plugin into F1's scheduler.

The parity ask is QUICK feedback for the slide path, not a new editor mode. Slides are "just a
different pandoc command with reveal.js output" ([[feature-catalogue-and-implementation-status]]
Tier-2) — a separate renderer/exporter plugin ([[renderer-plugin-architecture]]). F6 wires the
slides renderer plugin into the SAME compile-on-idle scheduler F1 built, so editing re-renders
the slide deck on idle into the preview (reveal.js HTML into the existing iframe, the fast path)
— quick feedback, distinct from a full beamer→PDF compile. The deliverable is the
fast-feedback loop, not a slide authoring UI.

*Proves:* **P113**. *Independent of F1–F5; depends only on F1's scheduler abstraction.*

## Proposed proof obligations (P107–P113)

PROPOSALS — ratify with the user before writing RED; do NOT edit `proof-obligations.md`. Each
is an exact externally-observable happy-path state, admissible only if it FAILS on a plausibly
broken app. They map to the next webview spec family `p63`+ (the obligations doc tracks specs
separately; spec numbering is the test author's, not fixed here). Witnesses reuse the shared
fixture (`demo.md`: `# Geometry of Numbers — Café`, `Minkowski bound`, `$\zeta(2)=\pi^2/6$`).

- **P107 — Live PDF preview renders a real compiled PDF.** With the PDF preview pane active and
  the configured PDF compile command set, open `demo.md`; after the compile-on-idle debounce a
  PDF is produced on disk and shown in the embedded pdf.js viewer. An independent process
  (`pdfinfo`/`pdftotext`) reads the produced PDF file off disk: it is a valid PDF
  (`%PDF-` magic, `pdfinfo` parses `Pages:`) whose extracted text contains "Geometry of Numbers"
  and "Minkowski bound", AND the viewer DOM shows a rendered page canvas (pdf.js produced
  pixels). Admissible because it fails on a blank/faked viewer (no rendered page canvas), a stale
  artifact (the PDF on disk predates the edit / lacks the witnesses), an unwired compile (no PDF
  file is produced), and a viewer fed a non-PDF blob (pdfinfo refuses it).

- **P108 — PDF build artifacts do not litter the source tree.** After a PDF compile of a project
  whose source file lives in directory `D`, an independent process listing `D` finds NO new
  latex intermediate files (`*.aux`, `*.log`, `*.fls`, `*.out`, the build `*.pdf`) created in `D`
  — the intermediates live in the isolated build/temp directory instead — while the user-chosen
  one-shot export `{output}` PDF (P8) still appears at its chosen path. Admissible because it
  fails on the current `current_dir = source parent` behavior (aux files appear in `D`), and on
  an isolation that also misplaces the user-requested export artifact (P8's output is missing
  from its chosen path).

- **P109 — Multi-pass driver fully resolves references.** With the configured PDF command set to
  the vendored latexmk/rubber multi-pass driver, compile a fixture containing a `\cite` (with a
  config-declared bib) AND a forward cross-reference that a SINGLE pass leaves unresolved. The
  produced PDF's extracted text shows the citation rendered (author/year, not a raw `[?]`/`(??)`)
  and the cross-reference resolved to a real number — proving more than one pass + BibTeX ran.
  Admissible because it fails on a single-pass command (the PDF carries `??`/unresolved-citation
  markers), and on a driver that never invokes BibTeX (the citation stays unrendered).

- **P110 — Auto/manual + fast/full compile controls are honored.** (a) With the PDF preview set
  to MANUAL, editing the buffer does NOT trigger a PDF recompile (the on-disk PDF is unchanged
  after the debounce window elapses) until the explicit "Recompile PDF" command runs, after which
  a fresh PDF appears. (b) With AUTO set, editing triggers a recompile within the debounce. (c)
  Switching FAST→FULL changes which configured command runs, observable in the compile log
  (the command line differs) and in the artifact (FULL resolves references P109-style; FAST does
  not). Admissible because it fails on an ignored toggle (manual still auto-recompiles; or the
  fast/full selection runs the same command regardless), proven by the on-disk PDF + the logged
  command line.

- **P111 — Inline warnings are surfaced from the real compile log.** A compile that emits a
  LaTeX/pandoc WARNING (not an error) — e.g. an undefined-reference or overfull-hbox warning from
  a fixture engineered to warn — surfaces that warning as a structured entry (severity = warning,
  the warning message text, the latex-log line) in the compile/problems pane, distinct from a
  hard error and distinct from the raw log dump (P11). Admissible because it fails when only
  errors are surfaced (the warning is dropped), when warnings are shown only as raw log text with
  no structured severity/line (no parsed entry exists), and when a clean compile fabricates a
  phantom warning (the entry appears with no warning in the real subprocess output). NOTE: the
  markdown-source-line jump clause is GATED on P112's reader decision — P111's floor is the
  latex-log line, not the markdown line.

- **P112 — Bidirectional source↔PDF click-jump [GATED — DO NOT WRITE RED UNTIL THE READER
  DECISION IS RATIFIED].** Forward: placing the editor cursor on a discriminating source line and
  invoking forward-jump scrolls/highlights the corresponding location in the PDF viewer. Inverse:
  clicking a discriminating rendered element in the PDF viewer moves the editor cursor to its
  source line. This obligation is BLOCKED on the `[[decision-provenance-user-owned-vs-framework-forced]]`
  reader decision ([[reference-source-preview-scroll-sync]]): precise markdown→PDF mapping needs
  `sourcepos`, which needs a CommonMark reader, which loses `+citations` + raw-LaTeX environments.
  The obligation's exact discriminators (which element, which line, tolerance) are settled ONLY
  after the user rules on the reader; until then this is a gate, not a test. Admissible (once
  unblocked) because it fails on a viewer with no jump wiring (cursor/click has no effect on the
  other pane) and on a proportional-only guess that lands in the wrong element.

- **P113 — Slides fast-feedback preview re-renders on idle.** With the slides renderer plugin
  active, editing `demo.md` (containing a slide-separator structure) re-renders the reveal.js
  deck into the preview within the debounce, and the preview DOM contains the reveal.js slide
  structure (`section`/`.reveal` markers) carrying the edited witness text. Admissible because it
  fails on a slides path that does not re-render on idle (the edit is absent from the deck after
  the debounce), on a plugin that emits ordinary single-document HTML instead of a reveal.js deck
  (no slide structure), and on an unwired slides command (the preview is empty).

## Verification

Same vehicle as P1–P69 ([[proof-obligations]] "Verification vehicle"): the real app on a real
display via `tauri-plugin-playwright`, hermetic per-run temp project dirs + `XDG_CONFIG_HOME`,
disk assertions by independent processes, pandoc/lualatex/latexmk as hard dependencies (fail
loud, never skip). PDF assertions reuse P8's exact toolchain — `pdfinfo` for validity/metadata,
`pdftotext` for witness text — read by independent processes so the proof cannot be satisfied by
a faked viewer. The pdf.js viewer's rendered-canvas assertion reads the live preview DOM.
Per-sub-milestone RED is committed and observed to fail FOR THE RIGHT REASON before GREEN (the
spec naming convention `p63`+ follows the existing `tests/proof/pNN-*.spec.ts` layout). The
proof harness `[OK]/[FAIL]/[SKIP]` report format is preserved.

Regression gate every sub-milestone: **P1–P69 + D-series stay green** — especially P8 (PDF
export discrimination), P11 (raw log), P7/P12/P17 (HTML/custom/offline export), P13–P15
(splitter geometry), P43 (preview status cluster).

## Sequencing & dependencies

- **F1 first** (the viewer + compile-on-idle scheduler is the foundation everything else hangs
  off). Reader-agnostic, unblocked.
- **F2 → F3** (temp-dir isolation before the multi-pass driver, so multi-pass intermediates are
  already isolated). Both reader-agnostic.
- **F4** after F1 (it gates/extends F1's scheduler + parses F1's log). Reader-agnostic for the
  toggle + warning surfacing; its markdown-line-jump clause inherits F5's gate.
- **F5 is the HARD GATE — flag it to the user before any F5 work.** It is BLOCKED on the
  `sourcepos`/reader product decision ([[decision-provenance-user-owned-vs-framework-forced]],
  [[reference-source-preview-scroll-sync]]). Do not implement precise bidirectional jump against
  a guessed reader; the resolution is a user ruling, not an engineering workaround. F1–F4 and F6
  ship a fully usable PDF-preview product WITHOUT F5.
- **F6** depends only on F1's scheduler abstraction; independent of F2–F5. Can land any time
  after F1.
- **Cross-phase:** F3's multi-pass "references done right" overlaps Phase G (arXiv export's
  `.bbl`-baking + latexmk plumbing) and the Tier-2 reference-resolution requirement — keep the
  vendored latexmk/rubber driver config OSOT so Phase G reuses it. The PDF compile command should
  flow through a plugin-shaped boundary so the post-G export-as-plugin migration
  ([[export-plugins-contract]]) folds it into the pandoc suite without rework. Phase F is
  independent of Phases A–E (lint/snippets/citations/figures/navigation) and can interleave.

## Status / resume here

- **2026-06-16: Plan authored.** Phase F scoped against the verified working tree (branch
  `milestone-g-insertion-bar`): seams confirmed in `render.rs` (`export_sync` `current_dir` =
  source parent, L156, the temp-dir target; `format_log` L60; `ExportResult` L54), `config.rs`
  (`ExportPlugin` + placeholders L137–160; `Preview` L245), `App.svelte` (`scheduleRender`/
  `doRender` HTML compile-on-idle L632–664, the scheduler sibling; `exportToPath` L1057, the
  export boundary; `buildCommands` L626), `PreviewPane.svelte` (tabbed pane + `RenderStatus`
  cluster), `api.ts` (`exportDocument`/`renderPreview` IPC seams). Six sub-milestones F1–F4 + F6
  reader-AGNOSTIC and unblocked; **F5 (bidirectional jump) HARD-GATED** on the
  `sourcepos`/reader decision — recorded as a gate, not hand-waved.
- **NEXT:** ratify P107–P113 with the user (and explicitly surface the F5/P112 reader gate as a
  decision the user must make before F5 can have a test). Then F1 RED → GREEN. pdf.js
  (`pdfjs-dist`) is the one new app-owned dependency (a viewer, not a plugin); its worker/cmaps
  ship as offline app resources (the MathJax-bundle precedent), so the viewer satisfies the
  offline premise P16/P17 hold MathJax to.
- **Nothing in F1–F6 implemented yet.** Prerequisite green baseline: P1–P69 + D-series (per the
  render-rebuild-plan status log; Milestone G insertion bar P55–P62 green on this branch).
