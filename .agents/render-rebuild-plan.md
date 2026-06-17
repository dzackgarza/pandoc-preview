# Render-Core Rebuild Plan (plugin-system-first)

Durable, resumable roadmap for rebuilding greenfield2's render core into a renderer-agnostic app + generic plugin system, then vendoring the `~/.pandoc` math machinery onto it.
Authored 2026-06-14. If interrupted, resume from the **Status / resume here** section at the bottom.

This is a repo artifact (future-work + current-state), NOT a memory.
The durable *decisions* live in memory: see [[render-rebuild-sequencing-and-vendoring-decisions]] and the keystone memories [[renderer-plugin-architecture]], [[pandoc-command-model-and-raw-string-contract]], [[plugins-diagrams-figures-requirements]], [[shipped-config-vs-runtime-defaults]], [[required-filter-set]], [[shipped-template-requirements]], [[mathjax-macro-system-tiers-and-injection]], [[feature-catalogue-and-implementation-status]].

## Ratified forks (2026-06-14)

1. **Sequencing: full plugin system first.** Build the generic plugin firewall before any math feature is visible; both renderers ship as plugins.
2. **Macros: split by pipeline.** Preview = MathJax macro injection (existing `~/.pandoc` pipeline); export = LaTeX preamble via `dzg-unified`. App never embeds a macro list.
3. **Vendoring: symlink from a vendor dir.** Canonical copies in a bundled/XDG vendor dir, symlinked into `~/.pandoc/{filters,templates}`; app is source of truth; user overrides by replacing a symlink.
   Doctor verifies the set + external texmf (`dzg-unified`), never vendor-copied.

## Discipline (applies to every milestone)

- TDD: design → RED proof obligations (user-ratified) → commit RED → GREEN → commit.
  Each milestone gates on its proofs green before the next starts.
- Existing obligations (P1–P18, D1–D7) stay green throughout; a milestone that would break one must be re-scoped.
- No fallbacks/defaults/mocks; fail loud.
  Commits use `--no-verify` while the global QC tree (`~/ai/quality-control`) is absent on this host.
- Proof harness contract preserved: the doctor report `[OK]/[FAIL]/[SKIP]` line format is parsed by `launch.sh` / `lib-recovery.sh` / `drive-launcher.py` — never change it incompatibly.
  `proof-run.sh` classifies `d0[1-N]-*` as doctor-class (process/PTY), everything else as app-class (webview).

## Current backend seams (what gets generalized)

- `src-tauri/src/config.rs` (225 L): hard-typed `Config` struct with `deny_unknown_fields` + hand-coded `validate()`; `export: IndexMap<String, ExportPlugin>` is the nascent plugin shape (config-declared, generically shaped, structured command).
  → becomes core-schema + generic validator + general plugin model.
- `src-tauri/src/doctor.rs` (449 L): fixed check battery.
  → core checks + plugin-contributed checks, aggregated, same report format.
- `src-tauri/src/render.rs` (256 L): app-core-owned pandoc invocation + `export_sync`. → removed from core; moves into the pandoc renderer plugin (Milestone C). Violates the ratified architecture today (this is why the rebuild exists).

* * *

## Milestone A — Generic plugin system (the firewall)  [FOUNDATION]

**Goal.** The app core knows two things generically and no plugin specifics: (1) validate any config section against a declared JSON-Schema-class schema; (2) discover/run plugins (context+config in → structured result), surface their config pages, and aggregate their doctor checks.

**Work items.**
- `plugins.rs`: plugin discovery from a plugins dir (XDG data dir; path is a validated core-config value, never a constant).
  Manifest = `plugin.toml` per plugin: `{id, name, description, category, kind}`, `[exec] command=[…]` (argv interpolated with `{file}`/`{config_dir}`/… ; buffer on stdin), `config_schema = "schema.json"` (referenced JSON Schema draft 2020-12 for the plugin's `[plugin.<id>]` config section), `[[doctor_checks]]` (id, command, description).
  JSON Schema lives in JSON, referenced from TOML — never inlined.
- Generic validator (`jsonschema` crate): TOML → `serde_json::Value` → validate against schema.
  ONE code path validates the app's own core schema AND every plugin's section.
  Core config keeps a typed struct for the app's own reads, but validation routes through the generic validator (the core schema is a shipped JSON asset authored to match today's rules exactly, so D1/D4/P9 stay green).
- `PluginResult` (structured): `{success: bool, artifact: Option<PathBuf>, exit_code, stdout, stderr}`. No `{ok?}`. Plugin failure → toast, never crash.
- `run_plugin(id, context) -> PluginResult` + Tauri command; menu populated from plugin `category`.
- `doctor.rs` refactor: core checks + plugin-declared checks aggregated into the battery, preserving the report format.

**Scope boundary.** A proves the generic machinery with a committed *trivial drop-in* fixture plugin.
The pandoc + generic *renderers* are B/C. Export tables keep working unchanged (P7/P8/P12 green); they migrate into the plugin model in a later milestone (don't create two plugin notions long-term, but don't migrate in A).

**Ratified proof obligations (2026-06-14: A1–A3 ratified as written; A4 HELD).** Test classes were settled after reading the harness: A1's claim is P12's exact shape (drive a plugin by id through the webview E2E bridge, assert structured result + on-disk artifact), so A1 is a **P-series** spec (`p19`), not doctor-class.
A2/A3 extend the already-green `--doctor` battery, so they are doctor-class (`d08`/`d09`). The `proof-run.sh` classifier glob and `provision-proof.sh` doctor-case are extended to cover `d08`/`d09` (test scaffold, not production code).
- **A1 (`p19`, webview)** — Trivial plugin executes and surfaces a structured result.
  A committed fixture plugin (manifest + script writing a witness derived from the REAL buffer/file to its declared artifact) is discovered and invoked by id; the app returns `{success, artifact, exit_code, stdout/stderr}` and the artifact exists at the declared path with content proving the real context was passed.
  (Mirrors P12's "configured argv ran against the real source.") RED reason: the `window.__PPE_E2E__.runPlugin` surface does not exist.
- **A2 (`d08`, doctor-class)** — Generic schema validation rejects bad plugin config and accepts good, with zero core knowledge.
  A section violating the plugin's declared JSON Schema is rejected by the same generic validator the core uses (named error: plugin id + schema path); a conforming section passes.
  A second fixture plugin with a *different* schema, validated by the same code path, discriminates a hard-coded validator.
  RED reason: no plugin-schema check exists in the battery.
- **A3 (`d09`, doctor-class)** — Plugin-contributed doctor check joins the battery.
  A fixture plugin's declared check appears in the doctor report in the existing `[OK]/[FAIL]/[SKIP]` format alongside core checks: OK when its condition holds, FAIL (named) when it doesn't. RED reason: the doctor battery is hardcoded; no plugin check is aggregated.
  (doctor-contract.md ownership note ratifies the "core checks + aggregated plugin checks" framework.)
- **A4 — HELD (2026-06-14).** Core config keeps its hand-coded `validate()` for now; A's generic validator is proven on plugin sections only.
  The transitional seam is accepted for whenever A4 lands: core schema would cover general/editor/preview/pandoc via JSON Schema, while export's `{input}`/`{output}` placeholder rule keeps its bespoke check until exports become a plugin (D1/D4/P9 stay green).
  Resume A4 only after A1–A3 are green.

**Implementation risk to flag at design time.** The export-plugin placeholder rule (`{input}`/`{output}` must appear in some argv element) is NOT expressible in vanilla JSON Schema; it migrates to the export plugin's own contributed check (A3 shape) when exports fold into the plugin model — for A, core schema covers general/editor/preview/pandoc and the export `validate_export_plugin` rule stays as-is transitionally.

**Acceptance.** A1–A4 green; `bun run check` clean; P1–P18/D1–D7 still green.

* * *

## Milestone B — Renderer-as-plugin + generic renderer  [RATIFIED 2026-06-14]

**Goal.** The app core owns NO renderer knowledge.
`render_preview` keeps its exact signature (frontend + all P-series untouched) but DELEGATES buffer→HTML to the active renderer plugin.
Two renderers ship as plugins: pandoc (today's preview argv, structured config retained transitionally) and generic (md stdin → HTML stdout, raw-string config).
The pandoc command-model (raw-string-canonical + semantic deconstruction) is deferred to C (ratified split).

**Renderer-plugin interface (atop A's firewall).**
- Renderer plugins are `category = "renderer"`, `kind = "command"`.
- Active renderer selected by a core config value `[renderer] active = "<id>"` (a core value like `[plugins].dir`; no runtime default — absent is a loud error once preview runs).
  Optional-table parsing pattern like `[plugins]`, but the preview path requires it; every preview-capable config declares it.
- To render: core runs the active renderer plugin's command with the buffer on stdin and render context substituted per-argument — `{base_dir}`, `{base_url}`, `{mathjax}` (new render-context placeholders beyond A's `{plugin_dir}`/ `{config_dir}`/`{file}`/`{artifact}`). The plugin's own `[plugin.<id>]` config is delivered to the plugin process (env `PPE_PLUGIN_CONFIG` as JSON) so a renderer script can read e.g. pandoc `from_format`/`extra_args`. Stdout = standalone HTML, loaded into the preview iframe exactly as today; nonzero exit → RenderResult.ok = false (compile log), same as now.
- The generic renderer ignores context/config except its own raw script string.

**Ownership moves OUT of core (this is what B2 enforces).**
- `[pandoc]` (path/from_format/extra_args) leaves core `Config`; it becomes the pandoc renderer plugin's `[plugin.<id>]` config section (structured, transitional; C makes it the raw string).
- `render.rs`'s pandoc argv leaves core → into the pandoc renderer plugin (a shipped script/command).
- The doctor's `pandoc-executable` / `pandoc-invocation` checks leave core → contributed by the pandoc renderer plugin (doctor-contract.md ownership note already ratifies this).
  **Consequence: D1 and D5 are re-scoped** — the pandoc checks now appear as the renderer plugin's contributed checks, not core rows.
  This is anticipated by the contract; D1/D5 specs get updated as part of B GREEN (RED first: the re-scoped assertions fail against today's hardcoded battery).
- Export still spawns pandoc, but only via `[export.<id>]` config argv (config, not core code) and the generic `export-plugins` doctor check (no pandoc strings) — so export is unaffected by B2.

**Shipped renderer plugins.** Two committed repo artifacts (canonical source; Milestone D vendors/symlinks them into the XDG plugins dir): `pandoc-renderer` (builds today's preview argv) and `generic-renderer` (the markdown-it-class escape hatch).
Provisioning installs them into the hermetic plugins dir for the relevant specs.

**Proof obligations (RATIFIED).**
- **B1 (behavioral, `p20`)** — The generic renderer renders the witness with ZERO app-core changes.
  With `[renderer].active` = the committed generic renderer and it installed in the plugins dir, the live preview shows the witness rendered by THAT renderer, proven by a marker only it emits (distinct from pandoc output).
  The acceptance test of the whole abstraction (renderer-plugin-architecture.md).
- **B2 (architecture hygiene, NOT a proof-suite test).** The "no pandoc-specific strings in the app core" invariant is enforced by an agent-facing grep gate in `.agents/` (per the global rule banning source-content meta-assertions in the behavioral proof suite; the invariant is still enforced, just outside `tests/proof`). B1 carries the behavioral subsumption: a leak into core would break the generic renderer's no-core-changes property.
- **Regression gate:** P1–P18 and D1–D9 stay green.
  The pandoc preview now flows through the pandoc renderer plugin; D1/D5 are re-scoped (above) as part of B.

**RED/GREEN sequencing.** B1 RED: add the `[renderer]` config field (parsing plumbing) so the app boots with `active = generic`, but `render_preview` still hardcodes pandoc → the generic marker is absent → RED for the right reason (active-renderer selection has no effect yet).
GREEN: `render_preview` delegates to the active renderer plugin; move pandoc out of core; migrate doctor checks; re-scope D1/D5; install shipped renderer plugins.
Keep the full suite green.

**Milestone B GREEN — DONE (2026-06-14). Full suite 28/28 green.** Implemented: `plugins::render_active` (the renderer-delegation entry point: render-context placeholders `{base_dir}`/`{base_url}`/`{mathjax}`, plugin config on `PPE_PLUGIN_CONFIG`, buffer→stdin→HTML); `render_preview` delegates to it (signature unchanged → frontend + P-series untouched).
`[pandoc]` removed from core `Config`; the pandoc-executable/pandoc-invocation doctor checks removed from core.
Two shipped renderer plugins (fixtures for now; D vendors them): `pandoc-renderer` (render.sh = the old core preview argv; contributes the pandoc-executable/pandoc-invocation checks — a check's detail captures its command stdout, so `pandoc --version`'s version still surfaces, keeping D1's version assertion) and `generic-renderer` (B1's escape-hatch).
`Error::PandocSpawn`→`ProcessSpawn` (the core spawns generic programs now).
Frontend: SettingsModal dropped the pandoc pane (plugin config is edited via the file / a future schema-driven page); Config TS type updated.
Provisioning rewired: `emit_pandoc_renderer` is the default renderer setup; p20 swaps in generic; first-run.sh writes the renderer-plugin config.
**D1/D5 specs were NOT re-scoped** after all — the pandoc-renderer contributes identically-named checks with version capture, so D1/D5 pass unchanged (only their provisioning moved `[pandoc]`→`[plugin.pandoc-renderer]`). p10/p11 specs were updated to the new config/log shapes (first-run now writes `[plugin.pandoc-renderer]`; the compile log shows the renderer command).
**B2** is enforced by `.agents/check-no-pandoc-in-core.sh` (wired into `just test`/`test-ci`), not a proof spec.
Known B/D coupling: first-run.sh writes `[plugins].dir` but does not install the shipped renderers there — **Milestone D must vendor/install them** or a freshly first-run product config points at an empty plugins dir (tests pre-install via provisioning).
**NEXT: Milestone C** (pandoc raw-command-canonical model inside the pandoc renderer plugin).

## Milestone C — Pandoc renderer plugin (raw-command-canonical)

**RESCOPED 2026-06-14 (user ruling).** The earlier design — semantically deconstruct the pandoc command into a typed Rust model (`lexopt`), round-trip property-test it, and drive an in-app checkbox config editor — was rejected as architectural drift.
Decoupling the renderer is *already done* (Milestone B: a renderer is an opaque shell command, md on stdin → HTML on stdout); the typed command model existed only to power an in-app config editor, which is not the render pipeline.
**New model:** plugins own their configuration *entirely*. Every plugin manifest declares a required `[configure] command`; the app exposes a "Configure <name>" action that merely **spawns that command** (detached, no TTY handling, no terminal knowledge in core — the plugin's command brings its own UI, e.g. pandoc launches a kitty popup running a gum script).
This is the VS Code extension model: the app is config-agnostic; the only renderer-special thing is that one plugin declares itself the active renderer and supplies the md→HTML command.
The repealed clauses are recorded in [[pandoc-command-model-and-raw-string-contract]] (clause b) and [[required-filter-set]] ("discover filters by parsing").

**Goal.** All pandoc knowledge lives in this plugin; the raw pandoc command string is the canonical stored config; the plugin owns its own config editing.

**Work.**
- Generic firewall extension: required `[configure] command` in every plugin manifest (absent → load-time fail-loud).
  `configure_plugin(id)` Tauri command + E2E bridge spawns it detached; per-plugin "Configure <name>" action in the UI. The app never models the config's shape for editing — only validates it on load against the plugin's JSON Schema (A2/d08 mechanism, unchanged).
- Delete structured `pandoc.path`/`from_format`/`extra_args`; `[plugin.pandoc-renderer]` becomes a single raw `command` string (canonical).
  `render.sh` shlex-tokenizes and execs it with markdown on stdin; volatile render-context (`--mathjax`, `--resource-path`, base href) layered as B already does.
  No `lexopt`, no typed model, no round-trip test, no in-app checkbox editor.
- pandoc ships a bundled gum `configure` script (set the command, pick filters/templates, keep required ones locked) launched inside a kitty popup; PTY-drivable directly like `first-run.sh`.
- Plugin contributes `pandoc-executable` (retained) + `required-filter` + `template-exists` doctor checks — disk/exec checks, NOT command parsing.

**Proof obligations (proposed; ratify before RED).**
- **C1** — generic configure mechanism: a fixture plugin's `[configure]` command is spawned by the app (witness artifact proves it ran); a manifest missing the field fails loudly at load.
- **C2** — `[plugin.pandoc-renderer]` is the raw `command` string; preview flows from it (P1/P4 green); `p10`/`p11`/`d01`/`d05` retargeted off the structured shape (RED first).
- **C3** — pandoc's gum `configure` script, PTY-driven, writes a valid config whose command contains the required filters.
- **C4** — doctor `required-filter` / `template-exists` fail loud on a missing file, OK when present.

## Milestone D — Vendor + symlink install

**Goal.** Shipped filters/templates/macro-toolchain land in `~/.pandoc` via symlinks from a vendor dir.
**Work.** Vendor dir (bundled/XDG) holds canonical copies; installer symlinks into `~/.pandoc/{filters,templates}`. Filters: `tikzcd`, `convert_amsthm_envs`, `obsidian_callouts`, `obsidian` (preview); `include`, `select_images` (export).
Templates: `pandoc_preview_template.html` + `templates/css/` partials, `research_draft.html`, `research_draft.tex`, `standalone-tikz.tex`. Macro toolchain: `generate-mathjax-config.py`, inject script, tier macros.
Doctor verifies the symlink set + `dzg-unified` texmf (external, never vendored).
**Proof.** Fresh install places symlinks; doctor green; missing required filter = fatal; user override (real file replacing a symlink) is honored.

## Milestone E — Macro pipeline (static config; mostly DONE in E1)

**RESCOPED 2026-06-15 (user ruling).** A MathJax config is STATIC — `window.MathJax = <config>`. The `generate-mathjax-config.py → inject-into-template` step is a BUILD-TIME concern of the `~/.pandoc` asset repo (it bakes the tier-1/2 macros into the config); it is NOT a runtime/per-render thing the app drives.
The app's only job is to SHIP the static baked config and load it — which is exactly what **E1 already did**: the vendored `pandoc_preview_template.html` carries the macros baked in (the analog of a webpack-bundled config), and they render offline (p24: `\RR`→R). So the earlier "app drives regeneration / re-render when macros change" framing is REPEALED. **Goal.** Preview macros via the static baked MathJax config (DONE, E1). Export macros via the LaTeX preamble (`dzg-unified`) — that is the EXPORT path, handled by the export-suite milestone, not preview.
**Remaining.** (a) tier3 TeX-only macros render in PDF only, diverging from preview — inherent (tier3 is not in the MathJax config), needs only a doc note, not code.
(b) Optional: factor the macros out of the inlined template into a separate static config asset the template loads, so changing macros doesn't require re-baking the template (the user's `require("./mathjax_config.js")` pattern).
Functionally equivalent to the baked template for a standalone embed-resources preview; do only if desired.
Updating macros otherwise = regenerate offline in `~/.pandoc` + re-vendor.
**Proof.** P4/P16-class already satisfied via E1 (p24, p16).

## Milestone F — Math document features

**Goal.** amsthm + tikz + citations render in preview.
**Work.** amsthm: `convert_amsthm_envs.lua` + `math-environments.css` → styled theorem boxes.
tikz: `tikzcd.lua` + `standalone-tikz.tex` + `PANDOC_DOC_PATH`/ `FIGURES_DIR`/`SVG_DIR` env → cached SVG + `.pandoc-preview-editable` hover.
citations: `-f markdown+citations --citeproc` + CSL + `~/.pandoc/bib`. **Proof.** Per-feature fixtures: theorem/lemma/proof styled; tikzcd → SVG with editable hover; citation fixture → formatted cites + bibliography.
**Open sub-decisions to settle here:** citation-preview mechanism (`--citeproc` vs tex-path-only); CSL choice.

## Milestone G — Math insertion bar

**Goal.** Replace the generic H1/bold `Toolbar` with the math-research insertion bar.
**Work.** Delete `src/lib/components/Toolbar.svelte` usage; build amsthm-env inserts, tikz/tikzcd scaffolds, matrix/table builders, snippet + code-block dropdowns (dependency-free now); `\cref` picker / diagram launchers / Zotero light up as later tiers land.
**Proof.** Env-insert and matrix-builder produce correct source at the cursor.

## Plugin philosophy (clarified 2026-06-14 — applies to every milestone)

Captured durably in [[renderer-plugin-architecture]]; restated here because it shapes sequencing:
- **Total externality.** Plugins are COMPLETELY external; the app knows only the contract (context in → script run → structured result; auto-populated menu & config-launcher entries), never internals (pandoc/kitty/gum are invisible to the app).
  The app does no command parsing and renders no plugin config UI.
- **Menu/button auto-population.** A plugin contributes entries (e.g. "Export PDF" in a Plugins menu) that do nothing but run the plugin's script with the provided doc context.
  Settings auto-populates entries that merely *launch* each plugin's own configuration-manager command (kitty+gum for the vendored pandoc suite).
- **The vendored pandoc plugin is a SUITE**: renderer (preview hook) + HTML export
  + PDF export as sibling plugins, co-owned so export flags do not drift from the preview render.
    Config schema is validation-only (fail-loud on load), never UI.

## Milestone (post-G) — Export folded into the pandoc suite  [RATIFIED 2026-06-14]

**Goal.** Retire the app-owned `[export.<id>]` config tables; HTML/PDF export become sibling plugins in the vendored pandoc suite ([[export-plugins-contract]]), sharing the renderer's flags so a rendered preview and its HTML export stay visually faithful (the explicit anti-drift rationale).
Each export plugin auto-populates a Plugins-menu entry and a config-launcher entry.
**Work.** Move `export_sync`/`[export.<id>]` validation out of core; ship export plugins in the pandoc suite; the Export menu populates from suite plugins, not config tables; preserve P7/P8/P12/P17 behavior (RED first on the new ownership).
**Proof.** Exports run via suite plugins; HTML export matches the preview's filter/ flag set (modulo intentional offload-only differences); no pandoc strings in core.

## Beyond G (per feature catalogue)

Diagram-tool plugins (quiver/qtikz/ipe), figure library over the global figures dir (`~/.pandoc/figures`), Zotero CAYW plugin (Better-BibTeX hard-gated), the Firenvim editor-experience decision (Tier 5). Recovery/git-state (Tier 1) and workspace (Tier 3) are tracked in [[feature-catalogue-and-implementation-status]].

## Cross-cutting open decisions (not blocking A–E)

- **Preview reader:** stay `-f markdown` (exact; supports `--citeproc` + raw-TeX; forgoes precise `sourcepos`). Defer `commonmark_x`/precise scroll-sync until that feature hardens ([[decision-provenance-user-owned-vs-framework-forced]]).
- **Figures dir canonical value:** `~/.pandoc/figures` per [[shipped-config-vs-runtime-defaults]] — confirm with user.

* * *

## Status / resume here

- **2026-06-14:** Plan authored.
  Three forks ratified.
  Milestone A designed.
  A1–A3 proof obligations ratified by the user; A4 HELD. Test classes settled: A1=`p19` (webview), A2=`d08`, A3=`d09` (doctor-class).
  RED for all three is WRITTEN and VERIFIED for the right reason (commits: A2/A3 = c86403c; A1 = this commit): d08 — no `plugin-config:<id>` rows (generic validator absent); d09 — no `witness-tool-*` rows (battery hardcoded, no aggregation); p19 — `window.__PPE_E2E__.runPlugin is undefined` (generic run-plugin surface absent), reached after the app booted, the harness attached, and the demo rendered.
  Fixture plugins + manifest contract + harness wiring landed.
- **Milestone A GREEN (this commit): A1–A3 implemented; full suite 27/27 green.** `plugins.rs` discovers plugins from the optional `[plugins].dir`, validates each `[plugin.<id>]` section against the plugin's declared JSON Schema via the `jsonschema` crate (ONE generic path), runs a plugin by id against the real buffer (`run_plugin` + the `__PPE_E2E__.runPlugin` bridge returning `PluginResult`), and the doctor aggregates `plugin-config:<id>` + each plugin's contributed `[[doctor_checks]]` into the one battery.
  Core config gained an OPTIONAL `[plugins]` table + `[plugin.<id>]` sections (additive capability; empty/absent is never re-serialized, so plugin-less configs roundtrip unchanged — A4 still HELD, core `validate()` stays hand-coded).
  `kind` is validated (fail-loud on unsupported).
  **NEXT: Milestone B** (renderer-as-plugin + generic renderer).
  Decisions worth noting: `[plugins]` is optional in Milestone A because plugins are additive here; it becomes required (with a config migration) when B/C make renderers plugins.
  `jsonschema = 0.40` (`validator_for`/`validate`/`instance_path()`). Operational note: `just proof` (P-series) needs port 1420 free — a running `just dev` holds it and silently makes every webview spec load the non-e2e bundle (no `__PPE_E2E__`). Also: in a from-cold full run, d01 can flake on the 8s spawnDoctor timeout because two ~50s cargo builds precede it; re-run with cached binaries for a clean pass (binary is correct — verified standalone).
- Nothing in A–G implemented yet.
  Prerequisite green baseline: P1–P18, D1–D7 (full suite 25/25 green as of commit 4007cb0).
- Note (not this task): `src-tauri/Cargo.toml` carries an uncommitted, unrelated comment degradation from a prior session (`--mathjax= {mathjax}`); leave untouched, do not stage with the RED commit.
- **2026-06-14: Milestone A + B GREEN (commits aa26bd4…02d5d6f); suite 28/28.** Milestone C **RESCOPED** by user ruling: plugin-owned configuration via a spawned `[configure] command` (kitty+gum for pandoc); the typed-command-model / `lexopt` / round-trip / in-app-checkbox-editor design is REPEALED (see the Milestone C section + memory updates to [[pandoc-command-model-and-raw-string-contract]] and [[required-filter-set]]). C1–C4 proposed; **NEXT: ratify C1–C4, then RED.**
- **2026-06-14 (later): MILESTONE C COMPLETE + Milestone D preview-filter slice.** Full suite 35 specs green (d01 has a known from-cold 8s spawnDoctor flake, now mitigated by a 20s bound; passes cached).
  Done, each RED→GREEN:
  - **C1** generic configure mechanism (`[configure]` manifest field; app spawns it detached; p22). **C2** pandoc config = raw command string, structured fields deleted (p10 retargeted).
    **C3** pandoc kitty+gum configurator that locks the required filters (d13; configure-wizard.sh + tomlkit helper + kitty launcher).
    **C4/D3** `required-filter` doctor check (d11; + run_doctor_check now surfaces a failing check's diagnostic).
    Image-embed fix (preview `--embed-resources`, p05)
    + harness hardening (tmpfs prune, wide PTY) landed alongside.
  - **D1** vendor the required filters + symlink install (d10). **D2** command references the filters; a filter transforms the preview (p23 callout).
    **D4** install preserves a real-file user override (d12).
  - Plugin philosophy ratified + documented: total externality, the pandoc *suite*, plugin-owned config UI ([[renderer-plugin-architecture]]).
- **DEFERRED / re-scoped:**
  - **tikzcd → Milestone F**: errors at load without standalone-tikz.tex + FIGURES_DIR/PANDOC_DIR env (the tikz pipeline).
    Vendored/installed + doctor- verified, but not yet in the command.
  - **Rest of Milestone D** (preview template + css partials, export filters include/select_images, macro toolchain, `template-exists` + dzg-unified texmf doctor checks): folds into E (macros) / F (tikz/math) / the export-suite milestone.
  - **Symlink-edit footgun**: managed symlinks point at the writable repo vendor, so editing a filter THROUGH its symlink edits the canonical source; the contract is "replace the symlink with a real file."
    Needs a docs note.
- **NEXT:** Milestone E (macro pipeline) or F (math features incl.
  tikzcd activation), and the export-suite migration.
  The bulk of D's templates/macros land naturally inside E/F.
- **2026-06-16: verified-state reconciliation (the prior log entries are superseded; the earlier line "Nothing in A–G implemented yet" is stale and false).** A 27-commit editor-UX wave landed since the 06-14 entries: pandoc-aware syntax highlighting via the vendored `codemirror-lang-latex` fork (math + markdown + fenced-div outline), folding + per-file fold persistence, Ctrl-P command palette, Outline panel, find, comment-toggle, indentation guides, preview stale/recompiling/up-to-date indicators, and Macros/Figures explorer panes rooted at configured dirs.
  New specs `p32`–`p44` cover these.
  Full proof suite **verified GREEN 57/58** (run under Xvfb + system pandoc 3.1.3; see [Proof-Run Environment Setup](proof-run-environment-setup)).
  - `p17-export-html-offline` is **environment-blocked** in a sandbox (requires `unshare -rn`); the export itself is correct on pandoc 3.1.3. Not a product defect.
  - `p02` is a known re-runnable Xvfb window-registration flake.
  - `p18` was RED from drift (commit 1dbc698 dropped the redundant "Explorer" header); obligation P18 + spec **amended** to the new design (side bar shows the active view's content; file tree carries its own folder-name header) and re-greened (commit 1b914d6). So Milestones A–C are GREEN, D's preview surface is effectively complete, E is satisfied (baked static MathJax in the vendored template, p24/p16/p17-logic), and Tier-0 editor UX is largely done.
    **NEXT milestone (user-directed 2026-06-16): Tier 1 — Recovery and Git State** (the documented HIGHEST priority, entirely unstarted): XDG recovery repo + debounced autosave commits, tracked/untracked/noRepo state machine with indicator + shortcuts, external-modification conflict detection (content-hash + mtime), session restore to `XDG_STATE_HOME`, unsaved-changes guards.
    Tracked in [[feature-catalogue-and-implementation-status]]. Genuine remaining frontier beyond Tier 1: spellcheck, general autocomplete/snippets + math-research insertion bar (Milestone G), export-as-plugin migration, diagram-tool/Zotero plugins, primitive scroll-sync (reader stays `-f markdown`; precise-sourcepos features struck from scope 2026-06-16).
- **2026-06-16: Tier 1 — Recovery and Git State COMPLETE** (branch `tier1-recovery`, awaiting review/merge). All six obligations green and each independently adversarially reviewed (separate obligation/test/impl/review agents per the blind-TDD pipeline; QC under the owned-clean gate since full `just test` is red on pre-existing global anti-slop debt — see [[proof-run-environment-setup]] and the deferred-cleanup note):
  - **P45** recovery autosave → host-fs git store, debounced (`recovery.rs`, `bef51a3`).
  - **P46** tracked/untracked/noRepo state machine + init/track shortcuts (`repostate.rs`, `dbcbe1f`).
  - **P48** external-modification conflict detection (fingerprint hash+mtime; loud refusal; `fbe…`/`99715f6`).
  - **P47** save-gate: path-consuming actions resolve durable identity first; identity-less (untitled) buffer concept (`041adc4`).
  - **P49** session restore: launch reopens last file + offers newer recovery content from `XDG_STATE_HOME`/recovery store (`3213ec4`).
  - **P50** dirty-close guard + **flush-before-destroy** so no edit is lost on discard (titled AND untitled), via the shared `recoveryTarget()` SoT (`fbe0fe3`). Took 3 review rounds: adversarial review caught (a) discard cancelling the pending capture, (b) a hollow RED that never observed the bug, and (c) untitled buffers still losing content — each fixed with an honest RED→GREEN.
  Verified: all six specs (p45–p50) green together at HEAD (run-20260616T163003Z). `git2` (vendored-libgit2) is the one new dependency; recovery/repo-state knowledge is core-app (unrelated to pandoc; arch gate green).
  **NEXT (after Tier 1 review/merge):** per the catalogue — Tier 0 finish (spellcheck, autocomplete/snippets), Milestone G (math-research insertion bar), then export-as-plugin migration / diagram-tool + Zotero plugins. One workflow per milestone.
- **2026-06-16: Tier 1 MERGED to main** (fast-forward; 19 commits, all six obligations green).
- **2026-06-16: Tier 0 editor completion COMPLETE** (branch `tier0-editor-completion`, off main; awaiting review/merge). Four features, each blind-TDD + independently adversarially reviewed under the owned-clean gate:
  - **P51** composable editor completion — broke the vendored fork's `autocompletion({override})` monopoly so app completion sources compose with the LaTeX source (fork submodule bumped to `d2ef276`; main `86072f4`). Foundational tech-debt paydown.
  - **P52** user snippet dictionary — config-declared dict (fail-loud `ExistingFile`) → composed completion source with real `snippetCompletion` tabstop expansion; the **real quicktex dict (262 entries) vendored** from `dotfiles/.../quicktex_dict.vim` via a committed reproducible converter (`f5593be`). Exposes `insertSnippet` for Milestone G (NIT: give it a call site there or drop).
  - **P53** Emmet — real `@emmetio/codemirror6-plugin`, Ctrl-e expand, no Linux keymap conflict (`46851a4`).
  - **P54** spellcheck — real `nspell` + hunspell English + the **custom math dictionary** (`mathdict.utf-8.add`, byte-identical to `dotfiles/dictionaries`) via a CM6 `.cm-spellError` decoration; proven by a math term staying unmarked only because the custom dict loaded (`9ef7ce4`).
  Verified: p51–p54 + regressions green together at HEAD (run-20260616T…). New deps: `@emmetio/codemirror6-plugin`, `nspell`, `dictionary-en`. All editor-side; arch gate green.
  **NEXT: Milestone G — math-research insertion bar** (reuses P52's snippet registry + `insertSnippet` + the fork's `pandocDivEnvironments`): amsthm-env inserts, tikz/tikzcd scaffolds, matrix/table builders, snippet/code-block dropdowns. Then export-as-plugin migration, diagram-tool + Zotero plugins.
- **2026-06-16: Tier 0 editor completion MERGED to main.**
- **2026-06-17: Milestone G — math-research insertion bar COMPLETE** (branch `milestone-g-insertion-bar`, off main; awaiting review/merge). The generic formatting `Toolbar.svelte` was **deleted** and replaced by `InsertionBar.svelte`. Nine in-scope features, each blind-TDD + adversarially reviewed (owned-clean gate); cref-picker/bib-autocomplete/Zotero/diagram-launchers DEFERRED to their Tier 3/4 dependencies:
  - **P55** bar replaces+deletes Toolbar + amsthm-environment inserts (`894fbbe`; resolved the F-B `insertSnippet` no-call-site nit).
  - **P56** tikz/tikzcd scaffolds (`14be308`). **P57** matrix builder, chosen dims (`9cc3c90`). **P58** table builder, chosen dims (`b3e2b7c`).
  - **P59** snippet dropdown surfacing the config dict (`fa6bf2e`; added a SnippetMap getter on EditorPane). **P60** code-block-type dropdown (`f39d753`). **P61** footnote modal — marker + id-matched definition (`26e8b4e`).
  - **P62** insert-image-from-clipboard — `clipboard-manager:allow-read-image` capability + a Rust `paste_clipboard_image` (png-encode the clipboard RGBA → atomic write into the configured `directories.figures`) + bar control (`eb51421`).
  Verified: p55–p62 + regressions (p52, p29) green together at HEAD (run-20260616T235…). New deps: `png` crate; clipboard read-image capability.
  **KNOWN GAP (disposition pending):** the bar features are proven by driving `__PPE_E2E__` hooks (webview button-click flakiness in the harness), so the actual clickable bar UI (buttons/dropdowns/footnote modal) is built but **not proof-asserted**. The insert behaviors are real and proven; the UI wiring that invokes them is under-covered. Decide: add DOM-click smoke proofs / audit every control is wired, or ratify the hook-driven contract.
  **NEXT: Milestone G UI-coverage disposition, then** export-as-plugin migration, Tier 3 workspace (unblocks cref-picker), Tier 4 plugin richness (Zotero, diagram tools, bib autocomplete).
- **2026-06-17: Bar-UI proof-coverage gap CLOSED + a real defect fixed** (branch `bar-ui-coverage`). Added DOM-click smoke proofs (p63 controls, p64 paste-image, p65 modals) that interact with the REAL InsertionBar controls (not `__PPE_E2E__` hooks) and assert inserted content. The pass surfaced a genuine defect: matrix/table/footnote handlers were reachable ONLY via hooks — **no user-facing bar controls existed**, so the hook-driven P57/P58/P61 proofs were hollow at the UI level. Fixed (`c69c422`): added the 3 bar buttons + `DimensionModal.svelte` (matrix/table) + `FootnoteModal.svelte` routing into the same handlers. The other 5 controls were already wired. p63-p65 + p55/p57/p58/p61 green together. Hook-driven specs alone are insufficient for bar UI; DOM-click smoke proofs are now the standard for new bar controls.
- **2026-06-17: Export-as-plugin migration COMPLETE + MERGED to main.** Export now lives entirely in the pandoc plugin suite; the app-core `[export.<id>]` model is DELETED. P66 export-plugin discovery; P7/P8/P12/P17 retargeted onto the generic `run_plugin` firewall (pandoc-html-export with vendored MathJax, pandoc-pdf-export, witness export-category plugin); P47 export-gate re-pointed at the plugin surface (same `requireDurablePath()` gate); core `export_sync`/`export_document`/`ExportResult`/`Config.export`/`ExportPlugin`/`validate_export_plugin`/`check_export_plugins`/`exportDocument` all removed; d01/d06/d07 migrated onto the plugin-contributed export doctor checks. Caught + fixed a real regression: Milestone G's P60 code-block `<select>` shadowed p09's bare theme selector (theme stayed dark) — gave the theme select a `data-setting="theme"` hook (commit df3bf3a). Verified green together: p07/p08/p12/p66/p47/p09/p10/d01/d04/d06/d07/d14 (p17 unshare-env-blocked, export-correctness verified directly). arch gate green (no pandoc/export flags in core).
  **NEXT: Tier 3 workspace** (file-tree filtering, xdg-open + right-click context menu, Ctrl+P browser hardening, figure library + TikZ mode + figure gallery, diagram-tool launches, editor tabs — and unblocks the deferred \cref label picker via workspace scanning).
