# AGENTS.md — Pandoc Preview

Tauri 2 (Rust) + Svelte 5 + Vite + Tailwind + CodeMirror 6 desktop editor: a CodeMirror
source pane on the left, a **live, real-pandoc-rendered** HTML preview on the right, built for
large mathematical research writing (theses, papers). All rendering is the user's real
configured `pandoc` command; the app owns no renderer knowledge. Single-user Linux desktop —
not cross-platform, not multi-user, not hosted. See `README.md` for build/run.

## HARD RULE #0 — Research-first, interop-first, never greenfield

**The FIRST question on ANY task — and at the start of EVERY step within a plan — before
writing a single line of code, is: "How do I write as little new code as possible, define
nothing new, and instead leverage an existing mature tool, an established data format, or a
reference implementation?"** Reinvention is the enemy in an app like this; owned surface is
debt.

Decision order, applied to every feature AND every individual work item:

1. **Leverage.** Can an existing, well-regarded tool / library / binary / format do this? Use
   it directly — run the real binary (ChkTeX, latexmk, arxiv_latex_cleaner), embed the
   maintained library (pdf.js, a real parser-combinator/grammar crate), invoke the real tool's
   own UI (Zotero CAYW, TikzIt/QTikz/Ipe). **Interop, not imitation.**
2. **Support the standard format.** If users already author this with an existing tool, support
   that tool's NATIVE files so they bring their existing work with ZERO porting — e.g. standard
   quicktex definition files, UltiSnips/LuaSnip/TextMate snippets, `.tikz`/`.tikzstyles`/`.tikzdefs`,
   `.bib`/CSL, ChkTeX config. The feature is "**support** a quicktex-like workflow," never
   "reimplement quicktex."
3. **Port.** If behaviour must genuinely be owned in-process, PORT a well-regarded reference
   implementation rather than designing fresh.
4. **Greenfield is never appropriate.** If you conclude something must be built from scratch,
   that is a signal you have not finished steps 1–3. There must ALWAYS be a reference
   implementation, published examples, or other repos using the same tools to anchor the design
   — **cite them in the plan before writing code.**

This is not advisory and not a one-time gate. **Every plan phase and every work item must begin
with the research step that answers "what already exists," and must name the tool / format /
reference implementation it leverages, supports, or ports.** A work item whose first action is
"write a new X" with no such research is rejected — send it back for the research step. A
"converter that flattens someone's existing file format into our bespoke shape" is a red flag:
prefer consuming the source format directly.

## HARD RULE #1 — reference the existing plans before you build anything

**Before greenfielding, scaffolding, or implementing ANY queued feature, you MUST first check
whether a pre-existing plan, milestone, or proof obligation already owns it — and then follow
or extend that plan instead of inventing a parallel implementation.** Adding a second,
unaware implementation of something already planned or built is the primary failure mode here.

Required procedure for any feature work:

1. **Find who owns the feature.** Locate it in the canonical artifacts below (search the
   feature catalogue and the plans). Every queued feature is already mapped to a tier, a
   milestone, or a phase plan with proposed proof obligations.
2. **Read that plan in full** before writing code. The plans name the exact code seams to
   touch, the existing utilities to REUSE, the sub-milestone order, and the proof obligations
   that gate each step. They explicitly call out what already exists so you do not rebuild it.
3. **Extend, do not duplicate.** If the plan says a capability already exists (e.g. composable
   completion P51, the snippet dictionary P52, the export-plugin contract, the tikz filter
   pipeline), attach to it. Do not add a competing path. If a plan is wrong or stale, fix the
   plan first and say so — do not silently fork.
4. **Honor the discipline** (every plan restates it): TDD — design → RED proof obligations
   (externally observable; user-ratified) → commit RED → GREEN → commit; existing obligations
   P1–P69 + doctor checks stay green throughout; no fallbacks / defaults / mocks / smoke tests
   — fail loud. The proposed obligations in the phase plans (P70–P124) are PROPOSALS pending
   user ratification; do not treat them as accepted until the user ratifies and they are
   written into `proof-obligations.md`.

If no plan owns the feature, that is a signal to STOP and write/extend a plan (and get it
ratified), not a license to greenfield.

## Canonical planning artifacts (the single sources of truth)

| Artifact | What it owns |
| --- | --- |
| `.agents/memories/feature-catalogue-and-implementation-status.md` | The living tiered checklist (Tier 0–8) + implementation status for the WHOLE feature contract. Start here to find which tier/plan owns a feature. |
| `.agents/memories/proof-obligations.md` | The accepted external proof obligations **P1–P69** (the contract that must stay green). |
| `.agents/memories/competitive-parity-roadmap.md` | The prioritized competitive-parity follow-up **Phases A–H**, each tagged net-new-gap / refines-Tier / maps-Tier, backed by per-program studies under `.agents/memories/parity-research/`. |
| `.agents/render-rebuild-plan.md` | The render-core rebuild plan (plugin-system-first, Milestones A–G) — the renderer/plugin/vendoring foundation. |
| `.agents/plans/phase-{a..h}-*.md` | **Full implementation plans for each parity phase** (code seams, work items, proposed obligations P70–P124, verification). |

### Phase plan → feature area map

| Plan | Owns | Proposed obligations |
| --- | --- | --- |
| `.agents/plans/phase-a-lint-fast-feedback.md` | Static lint (delimiter/math-mode balance, regex rules, typographic), structured compile-log diagnostics — feedback faster than a compile | P70–P76 |
| `.agents/plans/phase-b-snippet-engine.md` | Snippet ENGINE depth (math-mode-only expansion, autotrigger, regex/mirror tabstops) + the quicktex dictionary migration | P77–P83 |
| `.agents/plans/phase-c-citations.md` | Citation + label/`\cref` completion (metadata fuzzy-match, tooltip, per-file bib override, references sidebar) | P84–P89 |
| `.agents/plans/phase-d-figures-tikz.md` | Figure & TikZ management: the tikz-subset parser (foundation), shared `.tikzstyles`/`.tikzdefs`, owned-tikz round-trip, Ipe dual-asset registry | P90–P99 |
| `.agents/plans/phase-e-project-navigation.md` | Large-project navigation: workspace full-text search, section/env motions, command palette, frontmatter editor | P100–P106 |
| `.agents/plans/phase-f-pdf-preview-gummi.md` | PDF preview + Gummi parity + faster export feedback (SyncTeX jump, temp-dir builds, multi-pass orchestration) | P107–P113 |
| `.agents/plans/phase-g-arxiv-export.md` | Arxiv-ready export pipeline (arxiv_latex_cleaner plugin, `.bbl` baking, source flattening, tikz externalization) | P114–P119 |
| `.agents/plans/phase-h-qol.md` | Low-priority QOL (distraction-free/typewriter modes, view toggle, batch export; autocorrect deprioritized with a correctness caution) | P120–P124 |

## Durable decisions & memory

Durable decisions, contracts, and architecture live as **iwe-indexed memories** in
`.agents/memories/` (managed with `iwe`; see the global memory guidance). Read the relevant
memory before changing a subsystem — keystones include `renderer-plugin-architecture`,
`pandoc-command-model-and-raw-string-contract`, `plugins-diagrams-figures-requirements`,
`shipped-config-vs-runtime-defaults`, `decision-provenance-user-owned-vs-framework-forced`,
and `product-destination-what-done-looks-like` (the non-goals list). Plans reference these by
`[[slug]]`. Agent-facing artifacts (this file, plans, QC scripts, the agent justfile) live
under `.agents/`; never expose them in the user-facing `justfile`.

## Build / test surface

All workflows route through `just` (see `README.md` and `.agents/justfile`): `just deps`,
`just setup` (gum first-run → writes the XDG config; the app refuses to start without a
complete `config.toml`), `just dev`, `just build`. Proofs run the real app on a real display
via the `tauri-plugin-playwright` harness — real pandoc, real filesystem, hermetic
`XDG_CONFIG_HOME`, independent-process disk assertions, no mocks or skips.
