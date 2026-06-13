# Render-Core Rebuild Plan (plugin-system-first)

Durable, resumable roadmap for rebuilding greenfield2's render core into a
renderer-agnostic app + generic plugin system, then vendoring the `~/.pandoc`
math machinery onto it. Authored 2026-06-14. If interrupted, resume from the
**Status / resume here** section at the bottom.

This is a repo artifact (future-work + current-state), NOT a memory. The durable
*decisions* live in memory: see
[[render-rebuild-sequencing-and-vendoring-decisions]] and the keystone memories
[[renderer-plugin-architecture]], [[pandoc-command-model-and-raw-string-contract]],
[[plugins-diagrams-figures-requirements]], [[shipped-config-vs-runtime-defaults]],
[[required-filter-set]], [[shipped-template-requirements]],
[[mathjax-macro-system-tiers-and-injection]], [[feature-catalogue-and-implementation-status]].

## Ratified forks (2026-06-14)

1. **Sequencing: full plugin system first.** Build the generic plugin firewall
   before any math feature is visible; both renderers ship as plugins.
2. **Macros: split by pipeline.** Preview = MathJax macro injection (existing
   `~/.pandoc` pipeline); export = LaTeX preamble via `dzg-unified`. App never
   embeds a macro list.
3. **Vendoring: symlink from a vendor dir.** Canonical copies in a bundled/XDG
   vendor dir, symlinked into `~/.pandoc/{filters,templates}`; app is source of
   truth; user overrides by replacing a symlink. Doctor verifies the set +
   external texmf (`dzg-unified`), never vendor-copied.

## Discipline (applies to every milestone)

- TDD: design → RED proof obligations (user-ratified) → commit RED → GREEN →
  commit. Each milestone gates on its proofs green before the next starts.
- Existing obligations (P1–P18, D1–D7) stay green throughout; a milestone that
  would break one must be re-scoped.
- No fallbacks/defaults/mocks; fail loud. Commits use `--no-verify` while the
  global QC tree (`~/ai/quality-control`) is absent on this host.
- Proof harness contract preserved: the doctor report `[OK]/[FAIL]/[SKIP]`
  line format is parsed by `launch.sh` / `lib-recovery.sh` / `drive-launcher.py`
  — never change it incompatibly. `proof-run.sh` classifies `d0[1-N]-*` as
  doctor-class (process/PTY), everything else as app-class (webview).

## Current backend seams (what gets generalized)

- `src-tauri/src/config.rs` (225 L): hard-typed `Config` struct with
  `deny_unknown_fields` + hand-coded `validate()`; `export: IndexMap<String,
  ExportPlugin>` is the nascent plugin shape (config-declared, generically
  shaped, structured command). → becomes core-schema + generic validator +
  general plugin model.
- `src-tauri/src/doctor.rs` (449 L): fixed check battery. → core checks +
  plugin-contributed checks, aggregated, same report format.
- `src-tauri/src/render.rs` (256 L): app-core-owned pandoc invocation +
  `export_sync`. → removed from core; moves into the pandoc renderer plugin
  (Milestone C). Violates the ratified architecture today (this is why the
  rebuild exists).

---

## Milestone A — Generic plugin system (the firewall)  [FOUNDATION]

**Goal.** The app core knows two things generically and no plugin specifics:
(1) validate any config section against a declared JSON-Schema-class schema;
(2) discover/run plugins (context+config in → structured result), surface their
config pages, and aggregate their doctor checks.

**Work items.**
- `plugins.rs`: plugin discovery from a plugins dir (XDG data dir; path is a
  validated core-config value, never a constant). Manifest = `plugin.toml` per
  plugin: `{id, name, description, category, kind}`, `[exec] command=[…]`
  (argv interpolated with `{file}`/`{config_dir}`/… ; buffer on stdin),
  `config_schema = "schema.json"` (referenced JSON Schema draft 2020-12 for the
  plugin's `[plugin.<id>]` config section), `[[doctor_checks]]` (id, command,
  description). JSON Schema lives in JSON, referenced from TOML — never inlined.
- Generic validator (`jsonschema` crate): TOML → `serde_json::Value` → validate
  against schema. ONE code path validates the app's own core schema AND every
  plugin's section. Core config keeps a typed struct for the app's own reads,
  but validation routes through the generic validator (the core schema is a
  shipped JSON asset authored to match today's rules exactly, so D1/D4/P9 stay
  green).
- `PluginResult` (structured): `{success: bool, artifact: Option<PathBuf>,
  exit_code, stdout, stderr}`. No `{ok?}`. Plugin failure → toast, never crash.
- `run_plugin(id, context) -> PluginResult` + Tauri command; menu populated from
  plugin `category`.
- `doctor.rs` refactor: core checks + plugin-declared checks aggregated into the
  battery, preserving the report format.

**Scope boundary.** A proves the generic machinery with a committed *trivial
drop-in* fixture plugin. The pandoc + generic *renderers* are B/C. Export tables
keep working unchanged (P7/P8/P12 green); they migrate into the plugin model in
a later milestone (don't create two plugin notions long-term, but don't migrate
in A).

**Ratified proof obligations (2026-06-14: A1–A3 ratified as written; A4 HELD).**
Test classes were settled after reading the harness: A1's claim is P12's exact
shape (drive a plugin by id through the webview E2E bridge, assert structured
result + on-disk artifact), so A1 is a **P-series** spec (`p19`), not doctor-class.
A2/A3 extend the already-green `--doctor` battery, so they are doctor-class
(`d08`/`d09`). The `proof-run.sh` classifier glob and `provision-proof.sh`
doctor-case are extended to cover `d08`/`d09` (test scaffold, not production code).
- **A1 (`p19`, webview)** — Trivial plugin executes and surfaces a structured
  result. A committed fixture plugin (manifest + script writing a witness derived
  from the REAL buffer/file to its declared artifact) is discovered and invoked
  by id; the app returns `{success, artifact, exit_code, stdout/stderr}` and the
  artifact exists at the declared path with content proving the real context was
  passed. (Mirrors P12's "configured argv ran against the real source.")
  RED reason: the `window.__PPE_E2E__.runPlugin` surface does not exist.
- **A2 (`d08`, doctor-class)** — Generic schema validation rejects bad plugin
  config and accepts good, with zero core knowledge. A section violating the
  plugin's declared JSON Schema is rejected by the same generic validator the
  core uses (named error: plugin id + schema path); a conforming section passes.
  A second fixture plugin with a *different* schema, validated by the same code
  path, discriminates a hard-coded validator. RED reason: no plugin-schema check
  exists in the battery.
- **A3 (`d09`, doctor-class)** — Plugin-contributed doctor check joins the battery.
  A fixture plugin's declared check appears in the doctor report in the existing
  `[OK]/[FAIL]/[SKIP]` format alongside core checks: OK when its condition holds,
  FAIL (named) when it doesn't. RED reason: the doctor battery is hardcoded; no
  plugin check is aggregated. (doctor-contract.md ownership note ratifies the
  "core checks + aggregated plugin checks" framework.)
- **A4 — HELD (2026-06-14).** Core config keeps its hand-coded `validate()` for
  now; A's generic validator is proven on plugin sections only. The transitional
  seam is accepted for whenever A4 lands: core schema would cover
  general/editor/preview/pandoc via JSON Schema, while export's `{input}`/`{output}`
  placeholder rule keeps its bespoke check until exports become a plugin (D1/D4/P9
  stay green). Resume A4 only after A1–A3 are green.

**Implementation risk to flag at design time.** The export-plugin placeholder
rule (`{input}`/`{output}` must appear in some argv element) is NOT expressible
in vanilla JSON Schema; it migrates to the export plugin's own contributed check
(A3 shape) when exports fold into the plugin model — for A, core schema covers
general/editor/preview/pandoc and the export `validate_export_plugin` rule stays
as-is transitionally.

**Acceptance.** A1–A4 green; `bun run check` clean; P1–P18/D1–D7 still green.

---

## Milestone B — Renderer-as-plugin + generic renderer  [RATIFIED 2026-06-14]

**Goal.** The app core owns NO renderer knowledge. `render_preview` keeps its
exact signature (frontend + all P-series untouched) but DELEGATES buffer→HTML to
the active renderer plugin. Two renderers ship as plugins: pandoc (today's preview
argv, structured config retained transitionally) and generic (md stdin → HTML
stdout, raw-string config). The pandoc command-model (raw-string-canonical +
semantic deconstruction) is deferred to C (ratified split).

**Renderer-plugin interface (atop A's firewall).**
- Renderer plugins are `category = "renderer"`, `kind = "command"`.
- Active renderer selected by a core config value `[renderer] active = "<id>"`
  (a core value like `[plugins].dir`; no runtime default — absent is a loud error
  once preview runs). Optional-table parsing pattern like `[plugins]`, but the
  preview path requires it; every preview-capable config declares it.
- To render: core runs the active renderer plugin's command with the buffer on
  stdin and render context substituted per-argument — `{base_dir}`, `{base_url}`,
  `{mathjax}` (new render-context placeholders beyond A's `{plugin_dir}`/
  `{config_dir}`/`{file}`/`{artifact}`). The plugin's own `[plugin.<id>]` config is
  delivered to the plugin process (env `PPE_PLUGIN_CONFIG` as JSON) so a renderer
  script can read e.g. pandoc `from_format`/`extra_args`. Stdout = standalone HTML,
  loaded into the preview iframe exactly as today; nonzero exit → RenderResult.ok
  = false (compile log), same as now.
- The generic renderer ignores context/config except its own raw script string.

**Ownership moves OUT of core (this is what B2 enforces).**
- `[pandoc]` (path/from_format/extra_args) leaves core `Config`; it becomes the
  pandoc renderer plugin's `[plugin.<id>]` config section (structured, transitional;
  C makes it the raw string).
- `render.rs`'s pandoc argv leaves core → into the pandoc renderer plugin (a
  shipped script/command).
- The doctor's `pandoc-executable` / `pandoc-invocation` checks leave core →
  contributed by the pandoc renderer plugin (doctor-contract.md ownership note
  already ratifies this). **Consequence: D1 and D5 are re-scoped** — the pandoc
  checks now appear as the renderer plugin's contributed checks, not core rows.
  This is anticipated by the contract; D1/D5 specs get updated as part of B GREEN
  (RED first: the re-scoped assertions fail against today's hardcoded battery).
- Export still spawns pandoc, but only via `[export.<id>]` config argv (config,
  not core code) and the generic `export-plugins` doctor check (no pandoc strings)
  — so export is unaffected by B2.

**Shipped renderer plugins.** Two committed repo artifacts (canonical source;
Milestone D vendors/symlinks them into the XDG plugins dir): `pandoc-renderer`
(builds today's preview argv) and `generic-renderer` (the markdown-it-class
escape hatch). Provisioning installs them into the hermetic plugins dir for the
relevant specs.

**Proof obligations (RATIFIED).**
- **B1 (behavioral, `p20`)** — The generic renderer renders the witness with ZERO
  app-core changes. With `[renderer].active` = the committed generic renderer and
  it installed in the plugins dir, the live preview shows the witness rendered by
  THAT renderer, proven by a marker only it emits (distinct from pandoc output).
  The acceptance test of the whole abstraction (renderer-plugin-architecture.md).
- **B2 (architecture hygiene, NOT a proof-suite test).** The "no pandoc-specific
  strings in the app core" invariant is enforced by an agent-facing grep gate in
  `.agents/` (per the global rule banning source-content meta-assertions in the
  behavioral proof suite; the invariant is still enforced, just outside
  `tests/proof`). B1 carries the behavioral subsumption: a leak into core would
  break the generic renderer's no-core-changes property.
- **Regression gate:** P1–P18 and D1–D9 stay green. The pandoc preview now flows
  through the pandoc renderer plugin; D1/D5 are re-scoped (above) as part of B.

**RED/GREEN sequencing.** B1 RED: add the `[renderer]` config field (parsing
plumbing) so the app boots with `active = generic`, but `render_preview` still
hardcodes pandoc → the generic marker is absent → RED for the right reason
(active-renderer selection has no effect yet). GREEN: `render_preview` delegates
to the active renderer plugin; move pandoc out of core; migrate doctor checks;
re-scope D1/D5; install shipped renderer plugins. Keep the full suite green.

**Milestone B GREEN — DONE (2026-06-14). Full suite 28/28 green.** Implemented:
`plugins::render_active` (the renderer-delegation entry point: render-context
placeholders `{base_dir}`/`{base_url}`/`{mathjax}`, plugin config on
`PPE_PLUGIN_CONFIG`, buffer→stdin→HTML); `render_preview` delegates to it (signature
unchanged → frontend + P-series untouched). `[pandoc]` removed from core `Config`;
the pandoc-executable/pandoc-invocation doctor checks removed from core. Two shipped
renderer plugins (fixtures for now; D vendors them): `pandoc-renderer` (render.sh =
the old core preview argv; contributes the pandoc-executable/pandoc-invocation
checks — a check's detail captures its command stdout, so `pandoc --version`'s
version still surfaces, keeping D1's version assertion) and `generic-renderer`
(B1's escape-hatch). `Error::PandocSpawn`→`ProcessSpawn` (the core spawns generic
programs now). Frontend: SettingsModal dropped the pandoc pane (plugin config is
edited via the file / a future schema-driven page); Config TS type updated.
Provisioning rewired: `emit_pandoc_renderer` is the default renderer setup; p20
swaps in generic; first-run.sh writes the renderer-plugin config. **D1/D5 specs were
NOT re-scoped** after all — the pandoc-renderer contributes identically-named checks
with version capture, so D1/D5 pass unchanged (only their provisioning moved
`[pandoc]`→`[plugin.pandoc-renderer]`). p10/p11 specs were updated to the new
config/log shapes (first-run now writes `[plugin.pandoc-renderer]`; the compile log
shows the renderer command). **B2** is enforced by `.agents/check-no-pandoc-in-core.sh`
(wired into `just test`/`test-ci`), not a proof spec.
Known B/D coupling: first-run.sh writes `[plugins].dir` but does not install the
shipped renderers there — **Milestone D must vendor/install them** or a freshly
first-run product config points at an empty plugins dir (tests pre-install via
provisioning). **NEXT: Milestone C** (pandoc raw-command-canonical model inside the
pandoc renderer plugin).

## Milestone C — Pandoc renderer plugin (raw-command-canonical)

**Goal.** All pandoc knowledge lives in this plugin; the raw pandoc command
string is the canonical stored config.
**Work.** Delete structured `pandoc.path`/`from_format`/`extra_args`; store the
raw command string. Semantic deconstruction via `lexopt`-class parsing (known
subset: `--lua-filter`/`-L`, `--template`, `-f`/`-t` + extensions, enforced
flags; ordered opaque pass-through bag), round-trip property-tested over real
commands (incl. `~/.pandoc` `compile-pandoc`). Config page: flag checkboxes,
required flags/filters permanently-checked + un-uncheckable + hover-explained
(gum-drivable). Plugin contributes pandoc-executable / required-filter /
template-exists doctor checks.
**Proof.** Round-trip property test; required-flag checkbox state; the P1-class
preview obligations now flow through the plugin.

## Milestone D — Vendor + symlink install

**Goal.** Shipped filters/templates/macro-toolchain land in `~/.pandoc` via
symlinks from a vendor dir.
**Work.** Vendor dir (bundled/XDG) holds canonical copies; installer symlinks
into `~/.pandoc/{filters,templates}`. Filters: `tikzcd`, `convert_amsthm_envs`,
`obsidian_callouts`, `obsidian` (preview); `include`, `select_images` (export).
Templates: `pandoc_preview_template.html` + `templates/css/` partials,
`research_draft.html`, `research_draft.tex`, `standalone-tikz.tex`. Macro
toolchain: `generate-mathjax-config.py`, inject script, tier macros. Doctor
verifies the symlink set + `dzg-unified` texmf (external, never vendored).
**Proof.** Fresh install places symlinks; doctor green; missing required filter
= fatal; user override (real file replacing a symlink) is honored.

## Milestone E — Macro pipeline (split model)

**Goal.** Preview macros via MathJax injection; export macros via LaTeX preamble.
**Work.** Drive `generate-mathjax-config.py` → inject into
`pandoc_preview_template.html` between the `<!--MATHJAX_MACROS_START/END-->`
markers; re-render when macros change; app embeds no macro list. Export path
carries macros through `dzg-unified` in `research_draft.tex`.
**Proof.** P4/P16-class — witness math typesets with the user's macros, offline,
through the vendored preview template; tier3 TeX-only macros render in PDF only
(by design).

## Milestone F — Math document features

**Goal.** amsthm + tikz + citations render in preview.
**Work.** amsthm: `convert_amsthm_envs.lua` + `math-environments.css` → styled
theorem boxes. tikz: `tikzcd.lua` + `standalone-tikz.tex` + `PANDOC_DOC_PATH`/
`FIGURES_DIR`/`SVG_DIR` env → cached SVG + `.pandoc-preview-editable` hover.
citations: `-f markdown+citations --citeproc` + CSL + `~/.pandoc/bib`.
**Proof.** Per-feature fixtures: theorem/lemma/proof styled; tikzcd → SVG with
editable hover; citation fixture → formatted cites + bibliography.
**Open sub-decisions to settle here:** citation-preview mechanism (`--citeproc`
vs tex-path-only); CSL choice.

## Milestone G — Math insertion bar

**Goal.** Replace the generic H1/bold `Toolbar` with the math-research insertion
bar.
**Work.** Delete `src/lib/components/Toolbar.svelte` usage; build amsthm-env
inserts, tikz/tikzcd scaffolds, matrix/table builders, snippet + code-block
dropdowns (dependency-free now); `\cref` picker / diagram launchers / Zotero
light up as later tiers land.
**Proof.** Env-insert and matrix-builder produce correct source at the cursor.

## Beyond G (per feature catalogue)

Diagram-tool plugins (quiver/qtikz/ipe), figure library over the global figures
dir (`~/.pandoc/figures`), Zotero CAYW plugin (Better-BibTeX hard-gated), export
plugins folded into the plugin model, the Firenvim editor-experience decision
(Tier 5). Recovery/git-state (Tier 1) and workspace (Tier 3) are tracked in
[[feature-catalogue-and-implementation-status]].

## Cross-cutting open decisions (not blocking A–E)

- **Preview reader:** stay `-f markdown` (exact; supports `--citeproc` +
  raw-TeX; forgoes precise `sourcepos`). Defer `commonmark_x`/precise scroll-sync
  until that feature hardens ([[decision-provenance-user-owned-vs-framework-forced]]).
- **Figures dir canonical value:** `~/.pandoc/figures` per
  [[shipped-config-vs-runtime-defaults]] — confirm with user.

---

## Status / resume here

- **2026-06-14:** Plan authored. Three forks ratified. Milestone A designed.
  A1–A3 proof obligations ratified by the user; A4 HELD. Test classes settled:
  A1=`p19` (webview), A2=`d08`, A3=`d09` (doctor-class). RED for all three is
  WRITTEN and VERIFIED for the right reason (commits: A2/A3 = c86403c; A1 = this
  commit): d08 — no `plugin-config:<id>` rows (generic validator absent); d09 — no
  `witness-tool-*` rows (battery hardcoded, no aggregation); p19 —
  `window.__PPE_E2E__.runPlugin is undefined` (generic run-plugin surface absent),
  reached after the app booted, the harness attached, and the demo rendered.
  Fixture plugins + manifest contract + harness wiring landed.
- **Milestone A GREEN (this commit): A1–A3 implemented; full suite 27/27 green.**
  `plugins.rs` discovers plugins from the optional `[plugins].dir`, validates each
  `[plugin.<id>]` section against the plugin's declared JSON Schema via the
  `jsonschema` crate (ONE generic path), runs a plugin by id against the real
  buffer (`run_plugin` + the `__PPE_E2E__.runPlugin` bridge returning `PluginResult`),
  and the doctor aggregates `plugin-config:<id>` + each plugin's contributed
  `[[doctor_checks]]` into the one battery. Core config gained an OPTIONAL
  `[plugins]` table + `[plugin.<id>]` sections (additive capability; empty/absent
  is never re-serialized, so plugin-less configs roundtrip unchanged — A4 still
  HELD, core `validate()` stays hand-coded). `kind` is validated (fail-loud on
  unsupported). **NEXT: Milestone B** (renderer-as-plugin + generic renderer).
  Decisions worth noting: `[plugins]` is optional in Milestone A because plugins
  are additive here; it becomes required (with a config migration) when B/C make
  renderers plugins. `jsonschema = 0.40` (`validator_for`/`validate`/`instance_path()`).
  Operational note: `just proof` (P-series) needs port 1420 free — a running
  `just dev` holds it and silently makes every webview spec load the non-e2e
  bundle (no `__PPE_E2E__`). Also: in a from-cold full run, d01 can flake on the 8s
  spawnDoctor timeout because two ~50s cargo builds precede it; re-run with cached
  binaries for a clean pass (binary is correct — verified standalone).
- Nothing in A–G implemented yet. Prerequisite green baseline: P1–P18, D1–D7
  (full suite 25/25 green as of commit 4007cb0).
- Note (not this task): `src-tauri/Cargo.toml` carries an uncommitted, unrelated
  comment degradation from a prior session (`--mathjax= {mathjax}`); leave
  untouched, do not stage with the RED commit.
