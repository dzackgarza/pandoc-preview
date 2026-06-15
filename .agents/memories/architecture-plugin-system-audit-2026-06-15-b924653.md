---
tags:
  - audit
  - architecture
  - plugin-system
  - blast-radius
  - maintainability
  - proof-quality
commit: b92465333c1ed0e9e38c18eda19d6bab2a550ac9
audited_at: 2026-06-15T07:56:36+08:00
status: audit
---

# Architecture and Plugin-System Audit

Commit: `b92465333c1ed0e9e38c18eda19d6bab2a550ac9`

Audit timestamp: `2026-06-15T07:56:36+08:00`

Evidence boundary: source, config manifests, runtime scripts, bundled plugins, proof tests, declared commands, dependency manifests, and the current official OpenCode plugin docs.
I deliberately did not read `README.md`, `.agents/render-rebuild-plan.md`, or any `.agents/memories/` memory bodies before drafting this report, to avoid accepting fluent internal explanations as evidence of intent.
I had seen the project memory filenames during the earlier startup pass; this report does not use those filenames as evidence.

External comparison baseline: the OpenCode plugin docs describe project/global and npm-loaded plugins, plugin load order, plugin dependencies, a context object with project/client/shell/worktree data, event hooks, tool execution hooks, custom tools, structured logging, and compaction hooks.
This is used only as a maturity comparison point, not as a target requirement.
Source: <https://opencode.ai/docs/plugins/>

## Overall Judgment

The codebase is not mostly generic slop.
It has several strong architectural traits: mature dependencies are already used for the editor, app shell, split panes, Tauri IPC, and real-webview proof; many boundaries fail loudly; the proof suite often drives real subprocesses, real files, and the actual Tauri webview.

The main risk before a large integration sprint is narrower: the project describes a plugin direction, but the current plugin architecture is still a command-execution firewall rather than a developed extension system.
It proves that commands can be discovered, validated, spawned, and used as renderers; it does not yet expose enough lifecycle, UI, editor, document, menu, or event surfaces to absorb many future feature integrations without editing core app code.

The dominant blast-radius hotspots are:

- `src/App.svelte`: central state and workflow hub for config, file tree, editor, preview, export, menu dispatch, dialogs, E2E hooks, and settings.
- `src-tauri/src/plugins.rs`: the one backend plugin executor and schema/check aggregator.
- The split between `[export.<id>]` command tables and discovered `plugin.toml` plugins.
- `scripts/first-run.sh` / `scripts/provision-proof.sh`: large product-behavior generators for config, plugin install, asset install, and proof scenarios.
- The proof harness functions that can exercise backend plugin features that the normal user UI does not expose.

## Finding: The Plugin System Is A Command Firewall, Not Yet A Rich Extension System

Severity: high architecture risk.

Evidence:

- The plugin manifest is essentially metadata plus one command, one configure command, one config schema, and doctor-check commands: `src-tauri/src/plugins.rs:44-80`.
- Only `kind = "command"` is supported; every other kind is rejected: `src-tauri/src/plugins.rs:142-151`.
- Runtime invocation is argv placeholder substitution plus subprocess spawn, stdin/stdout/stderr capture, and `PPE_PLUGIN_CONFIG`: `src-tauri/src/plugins.rs:315-390`, `src-tauri/src/plugins.rs:513-577`.
- OpenCode's current plugin surface includes event hooks, tool hooks, custom tools, context objects, load order, package dependencies, and structured logging.

Why it matters:

This architecture is good at isolating external command execution.
It is much less capable as an integration substrate.
Feature integrations that want to observe editor changes, contribute commands, extend menus, intercept save/export/render, provide live diagnostics, add sidebars, expose custom UI, or communicate structured data back to the app have no visible hook layer.
They become core changes, not plugin additions.

Blast radius:

A new nontrivial integration is likely to touch `plugins.rs`, `config.rs`, `lib.rs`, `App.svelte`, frontend types/API wrappers, provisioning scripts, and proof harness helpers.
That is too large for a conceptually small plugin feature.

Confidence: high.

## Finding: There Are Two Distinct Plugin Shapes

Severity: high architecture risk.

Evidence:

- Export plugins are plain config tables with `label`, `extension`, and `command`: `src-tauri/src/config.rs:65-74`.
- Export execution reads `cfg.export`, substitutes `{input}`, `{output}`, and `{mathjax}`, and spawns the configured argv: `src-tauri/src/render.rs:109-165`.
- Renderer and tools plugins are discovered from a plugins directory via `plugin.toml`, validated against each plugin's JSON Schema, and executed through `plugins.rs`: `src-tauri/src/plugins.rs:114-180`.
- `first-run.sh` writes both plugin systems: `[plugin.pandoc-renderer]` for preview and `[export.html]` / `[export.pdf]` for export: `scripts/first-run.sh:159-200`.

Why it matters:

The same word, plugin, names two different extension contracts.
Export targets do not get manifest metadata, categories, doctor checks, plugin-owned config schemas, or configure commands.
Discovered plugins do not automatically become export targets or menu items.
Future integrations that span preview and export, such as citation processing, diagram rendering, build pipelines, or document transforms, must decide which plugin shape owns which part of the behavior.

Blast radius:

A cross-cutting feature will likely duplicate knowledge across config tables, plugin manifests, renderer scripts, export commands, doctor checks, provisioning, and proof cases.
The current split makes the "one plugin system enforces renderer agnosticism" story only partially true.

Confidence: high.

## Finding: Generic Tool Plugins Are Backend-Testable But Not User-Facing

Severity: high architecture risk.

Evidence:

- `plugins::run_plugin` and `plugins::configure_plugin` are exposed as Tauri commands: `src-tauri/src/lib.rs:152-168`.
- The normal app menu dynamically exposes configured export plugins, but the Tools menu contains only Settings: `src-tauri/src/lib.rs:42-50`, `src-tauri/src/lib.rs:90-96`.
- `App.svelte` exposes `runPlugin` and `configurePlugin` through the E2E-only `window.__PPE_E2E__` harness: `src/App.svelte:102-149`.
- `App.svelte` has `runPluginToPath`, but no normal user interaction reaches it in the inspected source: `src/App.svelte:406-415`.

Why it matters:

The proof suite can demonstrate that a generic plugin can be run by id, but that does not prove a usable plugin surface exists in the app.
For a feature sprint, this creates a false sense that tools-category plugins are integrated.
They are callable from tests and IPC, but not discoverable or invokable by the user-facing UI.

Blast radius:

Any real tools-plugin integration currently needs menu construction, frontend state, plugin discovery/listing, command dispatch, result rendering, errors/toasts/log routing, and tests.
The plugin executor alone does not localize that work.

Confidence: high.

## Finding: Plugin Metadata Is Required Before It Is Semantically Enforced

Severity: medium-high architecture risk.

Evidence:

- `name`, `description`, `category`, and `kind` are required manifest fields, but `PluginManifest` carries `#[allow(dead_code)]`; comments say category-driven menu work is later and fields are not yet read: `src-tauri/src/plugins.rs:35-43`.
- `render_active` finds the active renderer by id only; it does not verify that the plugin's category is `renderer`: `src-tauri/src/plugins.rs:532-541`.
- The doctor discovers plugins and runs each plugin's config/check rows, but does not separately validate that `[renderer].active` exists, is discovered, or points to a renderer-category plugin: `src-tauri/src/doctor.rs:318-345`.
- `config::validate` only checks that `renderer.active` is non-empty: `src-tauri/src/config.rs:204-210`.

Why it matters:

The config says `renderer.active` is a renderer plugin, but the executable contract does not enforce that invariant at startup.
A config can pass schema/value validation while the render path is the first place the active renderer id is resolved.
If a feature sprint adds plugin categories, menus, or plugin permissions, this gap becomes a class of bugs: metadata appears first-class, but behavior still treats it as decoration.

Search status for active-renderer proof:

- Searched: `src-tauri/src`, `src`, `tests/proof` with `rg` for `renderer.active`, `category`, `active renderer`, `plugin-config`, and `render_active`.
- Found: tests proving a valid generic renderer path and plugin config/doctor rows, but no test covering unknown active renderer id or a non-renderer-category plugin selected as renderer.
- Conclusion: based on inspected evidence, active-renderer/category coherence is not a proved startup invariant.
- Confidence: medium-high.
- Gaps: a generated config branch might exist in provisioning that I did not exhaustively classify as a dedicated negative test, but the searched test names and assertions did not expose one.

## Finding: Configure Commands Are Required Even For Plugins With Nothing To Configure

Severity: medium architecture risk.

Evidence:

- `PluginManifest.configure` is required for every plugin: `src-tauri/src/plugins.rs:51-57`.
- The generic renderer fixture satisfies the contract with `[configure] command = ["true"]`: `tests/proof/fixtures/plugins/generic-renderer/plugin.toml:23-27`.
- The ratio-tool schema fixture also carries `[configure] command = ["true"]`: `tests/proof/fixtures/plugins/ratio-tool/plugin.toml:146-150`.

Why it matters:

The manifest shape encodes "every plugin has a configure command" as a hard invariant even when the plugin has no real configuration workflow.
That creates no-op plugin commands as contract filler.
The blast radius shows up whenever a new simple plugin is added: it must supply a semantically meaningless configure surface or become invalid.

Confidence: high.

## Finding: Plugin Configuration Is Validated Structurally But Edited Outside The App's State Model

Severity: medium-high architecture risk.

Evidence:

- Settings preserves plugin sections but intentionally does not edit them: `src/lib/components/SettingsModal.svelte:17-25`.
- The only Settings panes are `general`, `editor`, and `preview`: `src/lib/components/SettingsModal.svelte:21-30`, `src/lib/components/SettingsModal.svelte:78-104`.
- Configure commands are detached subprocesses; the app does not wait for completion: `src-tauri/src/plugins.rs:460-467`.
- The frontend API exposes `configurePlugin`, but the normal UI path inspected does not call it; only the E2E harness does: `src/lib/api.ts:35-41`, `src/App.svelte:147-149`.

Why it matters:

This is a reasonable early OS-integration direction for bespoke software, especially with kitty/gum.
The architectural risk is that plugin configuration lives outside the app's state refresh loop.
Detached configuration can mutate the TOML while the app keeps an old `config` object, stale menus, stale renderer choice, or stale plugin data until some later reload path.

Blast radius:

Any integration that wants a coherent configure-and-refresh cycle needs changes in backend plugin execution, frontend config state, menu rebuilds, settings UX, and proof harness behavior.

Confidence: medium-high.

## Finding: `App.svelte` Is The Main Change-Propagation Hotspot

Severity: high maintainability risk.

Evidence:

- `App.svelte` owns config, config path, project root, file tree, current file, dirty state, prompt modal state, preview HTML/log/status, MathJax URL, active tab, word/cursor counts, editor binding, split panes, and E2E bridge state: `src/App.svelte:25-88`.
- The same file owns render scheduling and error handling: `src/App.svelte:188-225`.
- It owns project/file operations: `src/App.svelte:230-283`.
- It owns export/plugin execution and save-dialog routing: `src/App.svelte:384-435`.
- It owns toolbar and native-menu dispatch: `src/App.svelte:439-505`.
- It owns settings save and render rescheduling: `src/App.svelte:509-518`.

Why it matters:

This is the highest local blast-radius point in the frontend.
Many future features will want one or more of these concerns: editor state, document path, project tree, preview status, plugin invocation, menu commands, settings, or proof hooks.
Because they converge in one component, feature work will naturally accrete there.

This is not a claim that the file is broken.
It is a change-propagation finding: the current shape makes `App.svelte` the place where unrelated integrations will compete.

Confidence: high.

## Finding: File Management Is Bespoke And Recursive

Severity: medium architecture risk.

Evidence:

- The backend builds the full tree recursively and skips dotfiles: `src-tauri/src/fsops.rs:15-43`.
- File operations are app-owned Tauri commands: read, write, create file, create directory, rename, delete: `src-tauri/src/fsops.rs:46-106`.
- The frontend tree builds its own context menu and string path manipulation: `src/lib/components/FileTree.svelte:29-39`, `src/lib/components/FileTree.svelte:87-96`.
- `App.svelte` also does path string manipulation for file names and parent directories using slash slicing: `src/App.svelte:85-86`.

Why it matters:

The app has taken ownership of a file manager.
For a small Overleaf-like document editor this can be acceptable.
For a larger integration sprint, it means search, recent files, project indexing, ignored files, symlink policy, file watching, command-palette navigation, binary/text filtering, large trees, and dotfile behavior all become app-owned concerns.

Blast radius:

Any serious project-navigation feature likely touches Rust fsops, Svelte tree components, `App.svelte`, tests, and maybe OS dialog behavior.

Confidence: medium-high.

## Finding: Product Behavior Is Split Across Rust, Svelte, Bash, Python, TOML, JSON Schema, And Lua

Severity: medium maintainability risk.

Evidence:

- The source line inventory has large product scripts: `scripts/provision-proof.sh` at 522 lines, `scripts/proof-run.sh` at 295 lines, `scripts/first-run.sh` at 230 lines.
- `first-run.sh` writes the user config, plugin directory, renderer plugin, and export defaults: `scripts/first-run.sh:134-220`.
- The pandoc renderer plugin uses Bash, `jq`, and Python shlex tokenization to convert a raw command string into argv: `src-tauri/resources/vendor/plugins/pandoc-renderer/render.sh:16-30`.
- The configurator uses kitty and gum and writes a raw command string: `src-tauri/resources/vendor/plugins/pandoc-renderer/configure.sh:1-10`, `src-tauri/resources/vendor/plugins/pandoc-renderer/configure-wizard.sh:24-58`.
- The proof provisioner writes multiple config/plugin branches by spec name: `scripts/provision-proof.sh:160-210`, `scripts/provision-proof.sh:410-425`.

Why it matters:

This repo intentionally uses OS-level tools and command boundaries, which is often the right direction for bespoke local software.
The risk is ownership diffusion: the user-visible product contract is not contained in one language or one plugin API. Feature integration work must understand which layer owns each behavior, or it will duplicate facts across shell generation, Rust validation, frontend types, plugin schema, and tests.

Blast radius:

Config or plugin-contract changes propagate through `first-run.sh`, `provision-proof.sh`, Rust config structs, TS types, plugin manifests, schema files, and proof specs.

Confidence: high.

## Finding: Raw Command Strings Are Canonical In The Pandoc Renderer Plugin

Severity: medium maintainability risk.

Evidence:

- The pandoc renderer plugin schema requires a single string field, `command`: `src-tauri/resources/vendor/plugins/pandoc-renderer/schema.json:1-14`.
- `render.sh` reads `.command`, tokenizes it with Python `shlex.split`, and runs the result: `src-tauri/resources/vendor/plugins/pandoc-renderer/render.sh:16-30`.
- `configure-wizard.sh` builds one command string by concatenating executable, format, template, required filters, and extra args: `src-tauri/resources/vendor/plugins/pandoc-renderer/configure-wizard.sh:24-58`.
- `configure-pandoc-toml.py` exists specifically to read/update `[plugin.pandoc-renderer].command`.

Why it matters:

The raw command string is simple and user-editable, but it is a weaker domain model than the rest of the codebase.
Pandoc command semantics become string semantics.
The renderer plugin owns the parsing, but tests and provisioners still need to reason about whether required flags, templates, bibliography, filters, and MathJax are present.

Blast radius:

Every new pandoc-specific feature that needs command structure risks becoming string inspection or string reconstruction across shell, Python, and tests.

Confidence: medium.

## Finding: Some Low-Level Fail-Open Shapes Exist In Plugin Scripts

Severity: low-medium generic slop.

Evidence:

- `plugins.rs::config_json` converts a serialization failure into `{}`: `src-tauri/src/plugins.rs:214-220`.
- The pandoc renderer scripts also replace missing `PPE_PLUGIN_CONFIG` with `{}`: `src-tauri/resources/vendor/plugins/pandoc-renderer/render.sh:16-19`, `src-tauri/resources/vendor/plugins/pandoc-renderer/check-executable.sh:11-13`, `src-tauri/resources/vendor/plugins/pandoc-renderer/check-invocation.sh:27-29`.
- `configure-wizard.sh` uses `gum write ... || true` for extra args: `src-tauri/resources/vendor/plugins/pandoc-renderer/configure-wizard.sh:37`.

Why it matters:

These are not the highest-value issues.
They do, however, contradict the otherwise strong fail-loud posture.
The highest-risk instance is `config_json`: if a plugin config value cannot be represented as JSON, the plugin sees an empty object instead of the real invalid value.

Confidence: medium.

## Test-Suite Assessment

The proof suite is unusually strong in several places.
It uses real Tauri webview proof, real subprocesses, real files, real exported artifacts, real plugin fixtures, and independent oracles.
Examples:

- Generic plugin run proof computes an expected heading and SHA-256 from the real input and asserts the plugin artifact and structured result: `tests/proof/p19-plugin-run-by-id.spec.ts:44-95`.
- Generic renderer proof distinguishes the active renderer using a marker that Pandoc would not emit: `tests/proof/p20-generic-renderer.spec.ts:24-41`.
- Plugin config schema proof validates two different plugin sections against their own schemas: `tests/proof/d08-plugin-config-schema.spec.ts:26-55`.
- Plugin doctor proof asserts both OK and FAIL contributed checks from real conditions: `tests/proof/d09-plugin-doctor-check.spec.ts:23-49`.
- Configure proof observes a real disk witness from a spawned plugin command: `tests/proof/p22-configure-plugin-spawn.spec.ts:35-68`.

Weaknesses:

- The generic plugin and configure proofs use E2E-only bridge calls for surfaces that are not exposed in normal UI: `src/App.svelte:130-149`. This proves backend mechanics, but not user-facing plugin usability.
- Plugin tests prove a handful of curated paths, not a plugin extension matrix.
  The suite has good proofs for one generic renderer, one tool plugin, schema validation, doctor rows, and configure spawn.
  It does not establish category enforcement, active-renderer startup coherence, menu contribution, plugin listing, structured UI result handling, plugin lifecycle hooks, or config refresh after detached configuration.
- Several architecture-relevant checks are comments plus targeted specs, not systemic invariants.
  For example, config/export/plugin tables are written by provisioning branches, but there is no single contract test that enumerates all config-producing paths and proves they agree on one plugin model.
- The export-offline proof consciously decouples part of the assertion from the app and mirrors app-side `{mathjax}` resolution independently; the test itself records this as proof debt: `tests/proof/p17-export-html-offline.spec.ts:230-233`.
- The suite is acceptance-heavy.
  That is valuable for this app, but it means architectural drift can pass as long as the curated flows still work.
  The missing class is extension-surface proof: tests that ask, "what must a future plugin be able to do without changing app core?"

Search status for skips/mocks:

- Searched: `tests`, `src`, `src-tauri/src`, and `scripts` for `skip`, `xfail`, `smoke`, `mock`, `stub`, `fake`, and related proof-red-flag terms.
- Found: no `test.skip`, `test.only`, or obvious mock-based proof path in the inspected spec files; many exact-string assertions, but most are checking real subprocess output, rendered DOM, or artifact content rather than only source text.
- Conclusion: based on inspected evidence, the test suite's main weakness is not mocks or skips; it is incomplete architectural coverage of plugin extension surfaces.
- Confidence: medium-high.
- Gaps: I did not execute the suite during this audit, so this is a structural audit of test code, not a fresh runtime pass/fail claim.

## Debt Summary

| Risk | Assessment |
| --- | --- |
| Change propagation | High: `App.svelte`, split plugin models, provisioning scripts, and plugin executor are blast-radius hotspots. |
| Knowledge duplication | Medium-high: plugin/export/render/config facts recur across Rust, Svelte, Bash, Python, TOML, JSON Schema, tests, and provisioning. |
| Accidental complexity | Medium: command firewall is simple, but extension semantics are pushed into surrounding glue. |
| Dependency ownership | Medium: mature dependencies are used well in editor/split/Tauri/proof areas; file management and plugin lifecycle remain app-owned. |
| Domain model distortion | Medium: export plugins and discovered plugins share vocabulary but not contract; raw Pandoc command strings are canonical for a structured domain. |
| Proof weakness | Medium: real-boundary proof is strong, but future-extension invariants are under-proved. |

## Notable Non-Findings

- I did not find evidence that the codebase is broadly stuffed with mocks, fake proof paths, or skip-gated tests.
- I did not find a renderer hard-code in the current preview path; preview delegates to `plugins::render_active`.
- I did not find a lack of mature dependencies in the obvious UI/editor/runtime places: CodeMirror, dockview-core, Tauri, Playwright, Svelte, and JSON Schema are all used.
- I did not treat stale comments or comment drift as audit findings; those are below the requested architectural level.

Search status for these non-findings:

- Searched: file inventory, Rust/TS/Svelte symbol overviews, `rg` scans over source/tests/scripts, dependency manifests, and selected line-anchored source reads.
- Found: strong real-boundary proof patterns and mature dependencies; no broad mock/skip pattern in inspected test code.
- Conclusion: the codebase is structurally serious, but the plugin abstraction is not yet mature enough to absorb a large feature-integration sprint with low blast radius.
- Confidence: medium-high.
- Gaps: I did not run `just test`; I also intentionally avoided repo memory bodies and docs before this report, so this judgment may miss documented intentions that are not encoded in source or tests.
