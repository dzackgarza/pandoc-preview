# Phase H — Low-Priority QOL / Writing Comfort (implementation plan)

Durable, resumable roadmap for Phase H of the competitive-parity push: the writing-comfort residue — distraction-free / typewriter / readability modes, a three-way edit/preview/split view toggle, batch multi-format export, and a reading-time metric in the status cluster — plus an explicitly DEPRIORITIZED autocorrect/magic-quotes item that is a correctness hazard.
This is a repo artifact (future-work + current-state), NOT a memory; the durable *decisions* and the source inventory live in memory — see [[competitive-parity-roadmap]] ("## Phase H"), [[parity-research/zettlr]] (distraction-free / typewriter / readability; autocorrect/magic-quotes flagged hazardous in LaTeX-math source), and [[parity-research/pandoc-editor]] (three-way view modes; `batchConvert` multi-format export; reading-time metric).
If interrupted, resume from **Status / resume here** at the bottom.

Phase H is LAST by design.
It is recorded for completeness: cheap to build but low-leverage for mathematical research writing, and one item (autocorrect / magic quotes) is a CORRECTNESS RISK, not merely low value — smart-quote substitution can rewrite `"` inside `\text{}` and break `$…$`, corrupting the user's source.
Several of its deliverables REFINE surfaces that already ship (the 50/50 editor|preview split via dockview, the word-count status cluster, the `[export.<id>]` plugin menu) rather than greenfielding; this plan refines, it does not re-plan.
Each work item is kept deliberately tight — these are genuinely low-leverage and must not be allowed to bloat the phase.

## Source items (from the roadmap)

Copied faithfully from [[competitive-parity-roadmap]] "## Phase H — Low-priority QOL / writing-comfort", with the roadmap's status tags:

| Item | Status | Rel |
| --- | --- | --- |
| Distraction-free / typewriter / readability modes | net-new gap | Low |
| Three-way edit / preview / split view-mode toggle | refines Tier 0 (50/50 panes) | Low-Med |
| Batch / multi-format export in one action | net-new gap | Low-Med |
| Reading-time metric in the status cluster | refines Tier 0 (status cluster) | Low |
| Autocorrect / magic quotes — **deprioritized with caution**: smart-quote/autocorrect substitution can corrupt LaTeX-bearing math source (`"` inside `\text{}`, breaking `$…$`); a correctness risk, not just low value | net-new gap (do not prioritize) | Low |

Roadmap constraint carried forward verbatim: the autocorrect/magic-quotes item is *a correctness risk, not just low value* — see H.6 for the explicit caution and the recommendation NOT to build it (or to ship it OFF-by-default with hard math/code exclusion zones).

## Discipline

Mirrors [[render-rebuild-sequencing-and-vendoring-decisions]] / `render-rebuild-plan.md`:

- **Interop-first / research-first governs every work item (`AGENTS.md` HARD RULE #0).** Each item below BEGINS with the research step that answers "what already exists" and NAMES the concrete existing tool / library / CM6 extension / format / reference implementation it leverages, supports, or ports — before any code.
  These are cheap UI conveniences and must be near-zero owned code: lean on published CodeMirror 6 extensions/decorations and existing in-app machinery, never build from scratch.
  A work item whose first action is "write a new X" with no such research is rejected — greenfield is never the answer here.
- TDD: design → RED proof obligations (externally observable, user-ratified) → commit RED → GREEN → commit.
  Each sub-milestone gates on its proofs green before the next starts.
- The existing obligations P1–P69 and the doctor battery (D-series) stay green throughout.
  A sub-milestone that would break one must be re-scoped.
  In particular the view-mode work must not break P13/P14/P15 (splitter tracks the pointer; tab switch and sidebar toggle preserve the editor:preview ratio) — the three-way toggle HIDES a dockview pane, it does not destroy/rebuild the splitview, so the surviving split's ratio is preserved when both panes return.
  Display options remain config-owned and round-trip through XDG TOML (P9).
- No fallbacks / defaults / mocks; fail loud.
  A view-mode persisted to config is validated on load (an unknown mode value is a loud config error, the `deny_unknown_fields` / `validate()` pattern in `config.rs`), never silently coerced to a default.
  Single-user Linux desktop; no multi-platform, no runtime mode flags beyond the config-owned ones.
- Proof obligations are EXACT externally-observable happy-path states, admissible only if they FAIL on a plausibly broken app.
  The reserved block is **P120–P124**. These are PROPOSALS for user ratification; this plan does NOT edit `proof-obligations.md`.
- Commits may use `--no-verify` while the global QC tree is absent on this host (the standing render-rebuild note); the per-obligation Playwright proof is the gate.

## Current code seams (what gets touched/extended)

Grounded by reading the actual files; cite `file:symbol`.

- **`src/lib/dockview.ts` : `createSplitLayout`** — the editor|preview layout is a horizontal `SplitviewComponent` with two panels (`addPanel({id:'editor'})` / `addPanel({id:'preview'})`, `dockview.ts:75`), each exposing a `data-pane` element the Svelte editor/preview wrappers portal into.
  **This is the three-way view-mode seam.** A view mode of `editor` / `preview` / `split` is realized by SHOWING/HIDING a panel (dockview `SplitviewComponent` supports per-view visibility) — never by tearing down and rebuilding the splitview (that would lose the P13/P15 ratio and the portal targets).
  The function returns `{editorPane, previewPane, dispose}`; Phase H extends it to expose a `setView(mode)` that toggles panel visibility and re-`layout()`s, returning the surviving panes unchanged so the portals stay mounted.
- **`src/App.svelte`** — owns the live layout and status state.
  `splitContainer`/`split` (`App.svelte:188`) hold the `SplitLayout`; `onMount` builds it (`App.svelte:455`) and wires `editorPaneEl`/`previewPaneEl` portals.
  `wordCount` is `$state(0)` (`App.svelte:173`), recomputed on every edit (`content.split(/\s+/).filter(Boolean).length`, `App.svelte:489`/ `:790`) and passed to `<StatusBar {wordCount}>` (`App.svelte:1518`). The command palette is populated in a `cmds` list (`App.svelte:622` `show_preview`/`show_log`; `App.svelte:626` `export:<id>` per configured plugin) — the natural home for `view:editor` / `view:preview` / `view:split` commands and an `export:all` batch command.
  The `__PPE_E2E__` hook object (`App.svelte:238`, already carries `exportTo`) is where Phase H view-mode + batch-export hooks register.
  `exportDoc(id)` / `exportToPath(pluginId, target)` (`App.svelte:1057`) is the single export path the batch action loops over.
- **`src/lib/components/StatusBar.svelte`** — the status cluster.
  Renders `{wordCount} words`
  + `Ln/Col` (`StatusBar.svelte:88`). The reading-time metric is a sibling `<span>` here, DERIVED from the already-present `wordCount` (`$derived`, words ÷ a config-owned WPM) — no new buffer scan, no new App state beyond threading the WPM through.
    Refines, not re-plans.
- **`src/lib/components/EditorPane.svelte`** — the CodeMirror 6 setup site.
  Distraction-free / typewriter / readability are EDITOR presentation concerns realized as CM6 extensions in `Compartment`s (the established `spellCompartment` post-mount-reconfigure pattern): a typewriter scroll-margin extension (keep the caret line centered), a readability decoration layer (sentence-level `Decoration`s), and a distraction-free is mostly an App-shell CSS state (hide sidebar/insertion-bar/status-bar) coordinated from App.svelte, with an optional current-paragraph dimming decoration in the editor.
  These are the H.1 seam; they reuse the same `Compartment` + reconfigure machinery P54's spellcheck uses.
- **`src-tauri/src/config.rs` : `Editor`** (`config.rs:218`) — the typed, `deny_unknown_fields` display-options section already holding `font_size`/`line_wrapping`/`line_numbers`/ `snippet_dictionary`/`spell_dictionary`, all validated by `validate()` (`config.rs:257`, the OSOT for config-values invariants, called by both `save_config` and the doctor's `config-values` check).
  Phase H's config-owned options (the persisted view mode, the reading-time WPM, the comfort-mode toggles) are additions HERE, validated on the same path, round-tripped through XDG TOML by `save_config` (`config.rs:342`) — keeping P9 green.
  **Display options + the status cluster already exist; this REFINES that section.**
- **`src-tauri/src/config.rs` : `[export.<id>]` / `ExportPlugin` / `validate_export_plugin`** (`config.rs:29`/`:140`/`:165`) — the export model is an ordered `IndexMap` of config-owned plugins, each a full command with `{input}`/`{output}` placeholders; the Export menu and the palette's `export:<id>` entries iterate it.
  **The batch-export item composes over this existing surface** — it runs the SAME `exportToPath` per plugin in one action, writing N outputs; it adds no new export mechanism and does not touch `validate_export_plugin`. This is exactly the catalogue's "plugin-composable later" disposition.

## Work items (ordered sub-milestones)

Ordered by independence and leverage.
H.2 (view-mode) and H.4 (reading-time) are the highest-leverage, smallest, and touch disjoint seams; H.3 (batch export) composes existing machinery; H.1 (comfort modes) is the largest CM6 surface and lowest leverage; H.6 (autocorrect) is DEPRIORITIZED and likely NOT built.

### H.1 — Distraction-free / typewriter / readability modes — P120

**Research-first.** Do NOT build these CM6 behaviours from scratch — research the published CodeMirror 6 examples/extensions first and leverage them.
Typewriter scrolling is a known CM6 recipe (`EditorView.scrollMargins` / scroll-into-view centering, as shown in published CM6 typewriter-mode examples — the same mechanism Zettlr's typewriter mode realizes); readability coloring is a CM6 `Decoration` layer over sentence spans (a thin decoration, not a new engine); distraction-free is App-shell CSS state (hide chrome), not editor infra.
All three reconfigure through the established `Compartment` machinery already in `EditorPane.svelte` (P54 spellcheck).
Name the published CM6 example(s) leveraged in the RED commit; greenfield rejected.

**Goal.** Three independent presentation modes: distraction-free (hide sidebar / insertion bar / status bar, optionally dim non-current paragraphs), typewriter (keep the caret line vertically centered), readability (sentence-level coloring).
Each is a config-owned toggle that round-trips through XDG TOML; each is realized via CM6 `Compartment`s + an App-shell CSS state, NOT a layout rebuild.

**Concrete work.**
- `EditorPane.svelte`: add `typewriterCompartment` + `readabilityCompartment` next to `spellCompartment`; configure post-mount from config.
  Typewriter = a scroll-margin / `EditorView.scrollMargins`-class extension centering the caret line.
  Readability = a `Decoration` layer marking sentence spans (a pure sentence-splitter over visible text; math/code spans excluded via the fork's syntax info, the same predicate Phase A/B share).
- `App.svelte`: a `viewComfort` $state driving a distraction-free CSS class on the shell (hide `ActivityBar`/`InsertionBar`/`StatusBar` when active); command-palette entries `comfort:distraction-free` / `comfort:typewriter` / `comfort:readability` toggling each.
- `config.rs::Editor`: a `[editor.comfort]` sub-table of booleans (distraction_free, typewriter, readability), validated in `validate()`, threaded via the `Config` TS type.

**Reuse.** the `Compartment` + post-mount-reconfigure pattern (`spellCompartment`, `EditorPane.svelte`); the math/code-zone predicate from the fork; the config-validation path (`config.rs::validate`). **Files.** edit `EditorPane.svelte`, `App.svelte`, `config.rs`, `src/types.ts`/`src/lib/types.ts`. **Depends on.** nothing (independent).

### H.2 — Three-way edit / preview / split view-mode toggle — P121

**Research-first.** This is LAYOUT STATE over infra that already ships, not new infrastructure.
Leverage the existing `dockview` `SplitviewComponent` per-view visibility API already created by `createSplitLayout` (`dockview.ts:75`) — show/hide the editor or preview panel.
The three-way toggle (editor / preview / split — the same edit/preview/split mode amar-jay/pandoc-editor exposes) is realized by toggling that existing panel visibility plus a config-owned enum; no new layout engine, no new panes.
Name the dockview visibility API in the RED commit; greenfield rejected.

**Goal.** A single view-mode toggle cycling editor-only / preview-only / split, realized by showing/hiding a dockview panel (NEVER rebuilding the splitview), persisted config-owned and restored on launch.
Refines the existing 50/50 split.

**Concrete work.**
- `dockview.ts`: add `setView(mode: 'editor'|'preview'|'split')` to `SplitLayout` that toggles the editor/preview panel visibility and re-`layout()`s; the returned `editorPane`/ `previewPane` elements and their portal mounts are UNCHANGED (so P13/P15 ratio survives a round-trip back to `split`).
- `App.svelte`: a `viewMode` $state; call `split.setView(viewMode)`; command-palette entries `view:editor` / `view:preview` / `view:split`; register a `setViewMode(mode)` / `viewMode()` pair on `__PPE_E2E__` (`App.svelte:238`).
- `config.rs::Editor` (or a `[view]` section): a config-owned `view_mode` enum (`editor`/`preview`/`split`), `deny_unknown_fields`-validated (unknown = loud error), restored at launch and round-tripped by `save_config` (P9).

**Reuse.** the existing `SplitviewComponent` visibility API (`dockview.ts`); the command-list pattern (`App.svelte:622`); the config round-trip (`save_config`, P9). **Files.** edit `dockview.ts`, `App.svelte`, `config.rs`, TS `Config` type.
**Depends on.** nothing (independent of H.1).

### H.3 — Batch / multi-format export in one action — P122

**Research-first.** Add NO new export path — COMPOSE the existing per-type export plugins.
The `[export.<id>]` `IndexMap` of config-owned plugins (`config.rs:29`) and the single `exportToPath` path (`App.svelte:1057`) already exist; batch is a LOOP over them (the same shape as amar-jay/pandoc-editor's `batchConvert` multi-format export).
It reuses each plugin's real command, touches no export mechanism, and leaves `validate_export_plugin` unchanged.
Name the existing export-plugin surface it composes in the RED commit; greenfield rejected.

**Goal.** One action exports the current document to ALL configured `[export.<id>]` targets, writing N real output files in one invocation.
Composes the existing per-plugin export path; no new export mechanism.

**Concrete work.**
- `App.svelte`: an `exportAll()` that iterates `Object.keys(config.export)` and calls the existing `exportToPath(id, target)` per plugin (each target derived from the chosen base name + the plugin's `extension`), gated by the SAME save-gate (P47) the single export uses — an identity-less buffer resolves a destination first, never a silent partial run.
  A command-palette entry `export:all`; register `exportAll(baseDir)` on `__PPE_E2E__`.
- No `config.rs` change: the batch reads the existing `IndexMap<String, ExportPlugin>`; `validate_export_plugin` (`config.rs:165`) is untouched.

**Reuse.** `exportToPath` / `exportDoc` (`App.svelte:1057`); the export `IndexMap` ordering (`config.rs:29`); the save-gate (P47) and the `exportTo` E2E hook (`App.svelte:242`). **Files.** edit `App.svelte`. **Depends on.** nothing (composes existing export plugins).

### H.4 — Reading-time metric in the status cluster — P123

**Research-first.** No new scan, no new state — a TRIVIAL derivation in the existing status cluster.
The `wordCount` state (`App.svelte:173`) and the `StatusBar` cluster (`StatusBar.svelte:88`) already exist; reading-time is `ceil(words / wpm)` as a `$derived` sibling span (the same word-count-÷-WPM reading-time metric amar-jay/pandoc-editor surfaces), the WPM config-owned.
Name the existing word-count state it derives from in the RED commit; greenfield rejected.

**Goal.** The status cluster shows an estimated reading time DERIVED from the already-tracked word count and a config-owned words-per-minute, alongside the existing word count.

**Concrete work.**
- `config.rs::Editor`: a `reading_wpm: u32` (config-owned, range-validated in `validate()` like `font_size`/`debounce_ms` — the OSOT ranges in `config.rs:251`), round-tripped (P9).
- `StatusBar.svelte`: a `readingWpm` prop + a `$derived` `readingMinutes = Math.ceil(wordCount / readingWpm)` rendered as a sibling `<span>` to `{wordCount} words` (`StatusBar.svelte:89`). No new buffer scan — reuses `wordCount` (`App.svelte:173`).

**Reuse.** the existing `wordCount` state + `StatusBar` props (`App.svelte:1514`); the range-validation OSOT (`config.rs::validate`); the XDG round-trip (P9). **Files.** edit `StatusBar.svelte`, `App.svelte`, `config.rs`, TS `Config` type.
**Depends on.** nothing (independent; refines the existing status cluster).

### H.5 — Reserved / consolidation — (folds into P120–P123)

**Goal.** No new obligation; consolidation slot.
Verify the comfort modes (H.1), view toggle (H.2), batch export (H.3), and reading-time (H.4) all coexist and that P13/P14/P15 and the existing display-options round-trip (P9) remain green with the new config-owned options present.
P124 below is the reserved spare if any consolidation surface is promoted.

### H.6 — Autocorrect / magic quotes — DEPRIORITIZED, CORRECTNESS HAZARD — (NOT a P-obligation)

**Research-first (and the recommendation is still DO NOT BUILD).** Even the research step here does not license greenfielding a substitution engine: were this ever built despite the hazard below, the only admissible form leverages an EXISTING, well-regarded typography/smart-quote library (e.g. a maintained typographic-substitution extension — the Zettlr autocorrect/magic- quotes feature is the prior art, NOT a thing to reimplement) WRAPPED with hard math/code-span exclusion (the same fork-syntax predicate H.1/Phase A/B share), OFF by default.
The recommendation does not change: do not build it.
Building a bespoke substitution table from scratch is doubly rejected — both greenfield AND a correctness hazard.

**Recommendation: DO NOT BUILD.** This item is recorded with a LOUD CAUTION. Smart-quote / autocorrect substitution is hazardous in LaTeX-bearing mathematical source: a `"` rewritten to a curly `“…”` inside `\text{…}` or a math `$…$` zone CORRUPTS the source the user typed — turning compilable LaTeX into broken input, silently.
This is a correctness risk, not a low-value nicety.
The same hazard applies to autocorrect tables that rewrite `--`, `...`, or ASCII operators that may sit inside math.

If it is ever built despite this, the ONLY admissible form is:
- **OFF by default**, a config-owned opt-in toggle (`deny_unknown_fields`-validated, P9).
- **Hard exclusion zones**: substitution NEVER fires inside `$…$` / `$$…$$` / `\(…\)` / `\[…\]` math, inside fenced/inline code, or inside `\text{}`-class arguments — enforced via the fork's syntax info (the SAME math/code-zone predicate H.1's readability layer and Phase A/B use), not a regex approximation.
  A substitution that fires in a math zone is a bug, not an edge case.
- A proof obligation, were one ratified, would have to assert the NEGATIVE: a `"`/`--`/`...` inside `$…$` and inside `\text{}` is left BYTE-IDENTICAL after the autocorrect pass, while the same token in prose is substituted.
  That negative-zone guarantee is the whole point; without it the feature is a corruption engine.

**Disposition for this plan: deprioritized, not built.** No P-obligation is allocated to it.
Recorded here so a future synthesis does not mistake its absence for an oversight.
The correctness risk is the reason it is excluded, documented per the roadmap's standing caution.

## Proposed proof obligations (P120–P124)

PROPOSALS for user ratification (this plan does NOT edit `proof-obligations.md`). Each is an exact externally-observable happy-path state, driven by the real app via the `tauri-plugin-playwright` harness, observing real DOM/editor/disk/config state.
Admissible only if it FAILS on a plausibly broken app.

- **P120 — Comfort modes change the editor presentation and round-trip through config.** Enabling typewriter mode (via the command/toggle) moves the caret line toward the vertical center of the editor viewport (observed: the caret line's offset from the viewport top is within a centered band, vs. its un-centered position with the mode off); enabling distraction-free mode removes the sidebar / insertion bar / status bar from the DOM (or hides them, observed via their absence/visibility); and the enabled modes, after a save + relaunch under a hermetic `XDG_CONFIG_HOME`, are still active (config round-trip).
  **Admissible** because it fails on: no comfort extensions (typewriter does not center the caret line; distraction-free leaves the chrome visible); and on a non-persisted toggle (the modes reset after relaunch because the config did not round-trip — P9 class).

- **P121 — Three-way view toggle hides a pane and preserves the split ratio on return.** Setting view mode to `editor` hides the preview pane (observed: the `data-pane="preview"` element has zero measured width / is not laid out) while the editor occupies the full width; setting it to `preview` hides the editor; setting it back to `split` restores BOTH panes at the SAME ratio they held before (within a few px), and the mode persists across relaunch (config round-trip).
  **Admissible** because it fails on: no view toggle (both panes always show, `editor`/`preview` modes have no effect on the measured pane widths); a rebuild-based toggle that loses the ratio (returning to `split` yields a reset 50/50 instead of the prior ratio — the P15 regression a naive teardown causes); and a non-persisted mode.

- **P122 — Batch export writes one real file per configured target in a single action.** With two or more `[export.<id>]` plugins configured (e.g. html + pdf), invoking the single batch-export action writes a real, non-empty output file for EVERY configured target into the chosen directory, each named with that plugin's `extension`, each produced by that plugin's real command (verified by an independent process reading the directory and finding N files whose contents are the real export bytes, not zero-length).
  **Admissible** because it fails on: no batch action (only one or zero files are written); a batch that skips targets (fewer than N files appear); and an empty-write (a file exists but holds no export bytes — the command did not actually run for that target).
  It does not weaken P7/P8/P12 — the per-plugin export specs run unchanged; this proves the LOOP over them.

- **P123 — Reading-time metric reflects the word count and the config WPM.** With a buffer of a known word count and a config-owned `reading_wpm`, the status cluster shows a reading-time value equal to `ceil(words / wpm)` (observed in the status-bar DOM); editing the buffer to change the word count updates the displayed reading time; and pointing config at a DIFFERENT `reading_wpm` makes the SAME buffer show a different reading time.
  **Admissible** because it fails on: no reading-time metric (the status cluster shows only the word count); a hardcoded WPM (changing the config WPM does not change the displayed time — the config is dead); and a stale metric (editing the buffer does not update the displayed reading time).

- **P124 — RESERVED.** Spare within the Phase-H block (e.g. a readability-mode coloring observable, or a consolidation surface promoted from H.5). Not specified until needed.
  Reserved here so the obligation number is not reused.
  Note: autocorrect/magic quotes (H.6) is DEPRIORITIZED and is deliberately NOT allocated an obligation — if it is ever built, its obligation must assert the NEGATIVE math/code-zone non-substitution guarantee (H.6).

## Verification

End-to-end proof, no shortcuts (mirrors `proof-obligations.md` "Verification vehicle"):

- **Real app on a real display via `tauri-plugin-playwright`.** Each P120–P123 spec lands in `tests/proof/` following the established blind-TDD pattern; drive stable `__PPE_E2E__` hooks (`setViewMode`/`viewMode`, the comfort toggles, `exportAll`) and observe REAL surfaces — measured pane widths via `tests/proof/support/layout.ts` (the same measurement P13/P15 use), real status-bar DOM, real on-disk export files read by an independent process.
- **Real config drives the options.** P120/P121/P123 use a hermetic `XDG_CONFIG_HOME` with a real `config.toml`; the persist/relaunch and "different config → different result" clauses prove the config is load-bearing and round-trips (the P9 invariant, unchanged).
- **Real export subprocesses for the batch.** P122 runs the real configured `[export.<id>]` commands (real pandoc/lualatex per plugin) and asserts N real output files — no synthetic artifacts, the same fail-loud disk assertions P7/P8/P12 use.
- **Regression gate.** P1–P69 and the doctor battery run green throughout; P13/P14/P15 run UNCHANGED to prove the view-mode toggle did not break splitter tracking or ratio preservation; P9 runs to prove the new config-owned options round-trip; P7/P8/P12 prove the batch composes the per-plugin export path without weakening it.

## Sequencing & dependencies

```
H.2 (P121, view-mode toggle)   ── independent, smallest, highest-leverage
H.4 (P123, reading-time)       ── independent, refines status cluster
H.3 (P122, batch export)       ── independent, composes existing [export.<id>] plugins
H.1 (P120, comfort modes)      ── independent, largest CM6 surface, lowest leverage
H.5 (consolidate)              ── after H.1–H.4
H.6 (autocorrect/magic quotes) ── DEPRIORITIZED / NOT built (correctness hazard); no obligation
```

- All four built items (H.1–H.4) touch DISJOINT seams (`dockview.ts`/view-state, `StatusBar.svelte`, `App.svelte` export loop, `EditorPane.svelte` compartments) and can be built in any order or in parallel by separate agents without contending — but the leverage order is H.2 → H.4 → H.3 → H.1.
- H.6 is excluded; it is documented as a correctness hazard, not sequenced.
- Phase H is the LAST parity phase; nothing depends on it.

## Status / resume here

**Not started — RED obligations P120–P123 pending user ratification (P124 reserved spare; H.6 deprioritized, no obligation).** Design complete; seams grounded in the real files: the editor|preview dockview split at `dockview.ts:createSplitLayout` (`addPanel` editor/ preview, the view-mode visibility seam); the word-count status cluster at `StatusBar.svelte:89` fed by `App.svelte:173`/`:489`; the `[export.<id>]` plugin model + `exportToPath` (`config.rs:29`, `App.svelte:1057`) the batch loops; the display-options config section `config.rs::Editor` (`config.rs:218`) + `validate()` (`config.rs:257`) + XDG round-trip `save_config` (`config.rs:342`, P9); the CM6 `Compartment` post-mount-reconfigure pattern in `EditorPane.svelte` for the comfort modes.

**Biggest risk.** The autocorrect / magic-quotes item (H.6) is a CORRECTNESS HAZARD: smart-quote substitution can rewrite `"` inside `\text{}` and break `$…$`, silently corrupting the user's LaTeX-bearing source.
The plan's disposition is NOT to build it; if it is ever built it must be OFF-by-default with hard math/code exclusion zones enforced via the fork's syntax info and a NEGATIVE-zone proof obligation.
A secondary risk is that H.2's three-way toggle must HIDE a dockview pane, never rebuild the splitview — a teardown-based toggle would regress P15 (ratio preservation), so `setView` must preserve the panes and their portal mounts.

**Next action.** Ratify P120–P123 with the user, then RED H.2 (`p114` spec: setting view mode to `editor` zeroes the preview pane width and returning to `split` restores the prior ratio; fails because no view-mode toggle exists — both panes always show).
Commit RED before any GREEN.

- **2026-06-20: decisions RATIFIED (controller, "execute all phases, no stops"); Phases A–G shipped to main.** Executing on branch `phase-h-qol` (the LAST parity phase).
  - **Obligations P120–P123 as drafted (ceiling P119 from Phase G); P124 reserved spare.** Specs continue **p128+** (Phase G used p122–p127). Build order H.2 (P121) → H.4 (P123) → H.3 (P122) → H.1 (P120) — disjoint seams.
  - **H.6 (autocorrect / magic quotes) is NOT BUILT** — a correctness hazard (smart-quote substitution corrupting `"` inside `\text{}` / `$…$` LaTeX-bearing source), per the roadmap's standing caution and this plan's disposition. No obligation. Recorded so its absence is not mistaken for an oversight.
  - Near-zero owned code: lean on published CM6 extensions (typewriter scroll-margin, readability decorations), the existing dockview `SplitviewComponent` visibility API, the existing `exportToPath` loop, and the existing `wordCount` state — refine, don't greenfield. New config options are `deny_unknown_fields`-validated + XDG-round-tripped (P9). The view toggle HIDES a dockview pane, never rebuilds the splitview (P13/P15 ratio preserved).
  - Each blind-TDD via Workflow; full-suite gate before merge.
