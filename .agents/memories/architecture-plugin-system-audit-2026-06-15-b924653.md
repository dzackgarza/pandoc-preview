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

## Addendum: Feature-Catalogue Integration Forecast

Addendum commit: `168fec00dc3b735289d884614b35842bea14b5ac`

Addendum timestamp: `2026-06-15T18:20:42+08:00`

Evidence boundary: the original audit evidence plus the feature catalogue now present at `.agents/memories/feature-catalogue-and-implementation-status.md`, the current source at `168fec00dc3b735289d884614b35842bea14b5ac`, and `.agents/render-rebuild-plan.md`. The feature catalogue was read after the original audit was committed, so it did not influence the original findings.

Reader task: predict which surfaces the requested features will need and whether the current architecture localizes or amplifies those changes.
This section is not an implementation plan.

### Forecast: The Feature List Requires A Platform, Not More One-Off Features

The catalogue's Tier 0 through Tier 8 list is broad enough that the app has to become an editor/workspace/rendering platform:

- editor features: folding, delimiter matching, indentation guides, comments, snippets, spellcheck, pandoc-aware highlighting, outline/TOC, status cluster, math insertion bar;
- rendering features: raw pandoc command fidelity, MathJax macros, filters/templates, theorem/callout/citation rendering, scroll sync, stale-render cancellation, slides mode, PDF preview;
- workspace features: project tree filtering, `xdg-open`, Ctrl+P quick open via dmenu/fzf-style browser, figures sidebar, figure registry, TikZ mode, figure insertion gallery;
- recovery features: autosave commits, tracked/untracked/no-repo state, save gates, external-modification refusal, session restore, close/file-switch guards;
- plugin features: dynamically populated menus, per-plugin configuration, plugin-managed exports, plugin-managed diagram tools, OS integrations behind the firewall, Zotero CAYW citation insertion;
- late externalization: preferences move out of the in-app GUI into a gum/kitty-style external manager.

The current architecture can prove command execution and renderer substitution, but most requested features need richer contracts: editor mutation, cursor/selection access, workspace indexing, menu contribution, lifecycle hooks, config-refresh events, artifact ownership, background processes, and state transitions.
Those contracts do not exist as first-class extension points.

Predicted overall blast radius: high unless the plugin and app-state boundaries are deepened before feature work resumes.
Without that, many features will be implemented by editing `src/App.svelte`, `src-tauri/src/plugins.rs`, `src-tauri/src/config.rs`, native menu construction, provisioning scripts, and the proof harness together.

### Tier 0 Editor And Math-Writing Features

Requested features include replacing the generic markdown toolbar with a math-research insertion bar, CodeMirror-native folding/snippets/autocomplete, spellcheck, pandoc-aware syntax highlighting, outline/TOC, status data, and live editor display settings.

Current fit:

- `Toolbar.svelte` is a fixed array of generic markdown buttons: `src/lib/components/Toolbar.svelte:10-24`.
- `App.svelte` dispatches toolbar actions by hardcoded string table: `src/App.svelte:439-458`.
- `App.svelte` owns editor state, current file, dirty flag, render scheduling, word/cursor counters, menu dispatch, and settings save in one component: `src/App.svelte:25-88`, `src/App.svelte:188-225`, `src/App.svelte:460-519`.
- `SIDEBAR_VIEWS` contains only the Explorer view, so outline/figures/search sidebars have no registry beyond editing the central component: `src/App.svelte:37-43`.

Predicted integration needs:

- a CodeMirror extension composition surface for folding, snippets, spellcheck, highlighting, comments, delimiter matching, indentation guides, and completion sources;
- a document/workspace index for labels, fenced divs, bibliography keys, outline entries, and cross-file `\cref` targets;
- a command/action model that can mutate the editor at cursor/selection, open a popup, launch a plugin, or insert generated source;
- sidebar/view registration that does not require editing `App.svelte` for every new view.

Predicted blast radius if added directly: high.
The math insertion bar alone would touch `Toolbar.svelte`, `EditorPane.svelte`, `App.svelte`, CodeMirror command APIs, workspace scanning, config/types, proof fixtures, and likely plugin execution for diagram/Zotero/clipboard actions.

Architectural pressure: the current code has good concrete UI pieces, but it lacks an editor-action registry and a workspace-domain model.
That makes feature work gravitate toward central dispatch tables and one-off editor methods.

### Recovery And Save-Gate Features

Requested features include save-as-real-git-commit, XDG recovery repo autosave commits, tracked/untracked/no-repo state, durable identity before path-consuming actions, external-modification conflict detection, session restore, and unsaved-change guards.

Current fit:

- `fsops.rs` exposes direct read/write/create/rename/delete commands over paths: `src-tauri/src/fsops.rs:58-106`.
- `saveCurrent` writes editor content directly to `currentFile`: `src/App.svelte:283-292`.
- `exportToPath` and `runPluginToPath` save dirty buffers opportunistically before invoking external work: `src/App.svelte:384-415`.
- `resolveDirty` offers a save prompt but always returns `true` after the prompt path; it is not a durable state-machine owner: `src/App.svelte:257-266`.

Predicted integration needs:

- a document identity/state machine that distinguishes buffer identity, disk path, git tracking state, recovery snapshot state, and external fingerprint;
- one save gate used by save, export, plugin runs, diagram launches, file switch, app close, and quick-open;
- recovery and session state in an owned backend module, not ad hoc frontend booleans;
- proof that every path-consuming action goes through the same gate.

Predicted blast radius if added directly: very high.
Recovery touches `fsops.rs`, `App.svelte`, plugin/export paths, file-tree operations, status bar, config/state directories, launcher recovery behavior, and most proof classes.

Architectural pressure: current file IO is simple and direct.
That is correct for the early app, but the requested recovery features require file operations to become mediated domain actions.
If this lands as wrappers around existing path commands, future agents will have many bypasses to miss.

### Render Pipeline, Exports, Slides, And PDF Preview

Requested features include renderer-agnostic piping, pandoc plugin ownership, filter/template install, MathJax macro behavior, theorem/TikZ/citation features, scroll sync, stale-render cancellation, export plugins, slides mode, PDF preview, and Gummi-like PDF parity.

Current fit:

- `render_active` selects a plugin by id and pipes buffer to its command: `src-tauri/src/plugins.rs:507-593`.
- Active renderer selection checks only id lookup, not category coherence: `src-tauri/src/plugins.rs:532-541`.
- Export remains a separate `[export.<id>]` config model: `src-tauri/src/config.rs:17-23`, `src-tauri/src/lib.rs:42-50`, `src/App.svelte:380-435`.
- Plugin config reaches scripts as JSON, but the plugin contract returns only success/artifact/exit/stdout/stderr for tools and stdout HTML for renderers: `src-tauri/src/plugins.rs:91-100`, `src-tauri/src/plugins.rs:481-485`.

Predicted integration needs:

- one plugin contract for renderers, exports, diagrams, slides, and tools, rather than split discovered-plugin and export-table models;
- plugin category enforcement and category-specific capabilities;
- structured render lifecycle data: start/cancel/complete, source mapping, diagnostics, produced artifacts, and preview-side messages;
- plugin-owned artifact contracts for HTML/PDF/slides/figures instead of only stdout or one declared output path;
- config refresh after plugin configure commands mutate TOML.

Predicted blast radius if the split remains: high.
Each render/export feature will duplicate facts across Rust config validation, native menus, frontend export dispatch, plugin manifests, shell scripts, first-run/provisioning, doctor checks, and tests.

Architectural pressure: the current renderer-plugin path is a valuable foundation, but export and plugin actions still live in adjacent models.
The feature list explicitly wants export types and diagram integrations to be standalone plugins.
The current split makes that a migration prerequisite, not a late cleanup.

### Workspace, Figures, Diagram Tools, And OS Integrations

Requested features include `.gitignore`-aware tree behavior, filtering, unknown-file `xdg-open`, right-click actions, Ctrl+P quick-open through dmenu/fzf-style UI, a global figures directory, figure sidebar, TikZ mode, figure gallery, right-click-to-edit, and diagram tools as plugins.

Current fit:

- The backend recursively builds its own tree and skips dotfiles unconditionally: `src-tauri/src/fsops.rs:15-43`.
- File-tree state, sidebar views, prompts, and file operations are coordinated in `App.svelte`: `src/App.svelte:228-378`.
- The plugin firewall can run a command with `{file}` and `{artifact}`, but it does not own workspace indexing, item context menus, file-type handlers, background caches, or sidebars: `src-tauri/src/plugins.rs:315-410`.

Predicted integration needs:

- a workspace index that can answer file search, gitignore filtering, figure registry, label/reference extraction, and usage tracking;
- an OS-action/plugin-action contribution model for context menus, quick-open, `xdg-open`, external diagram tools, and figure editing;
- background process ownership for stale figure rendering, probably outside the UI process;
- typed file-kind handling, so unknown files, markdown files, TikZ source files, PDFs, SVGs, and bibliography files do not become path-string conditionals in `App.svelte`.

Predicted blast radius if added directly: very high.
The feature set crosses backend file operations, frontend tree/sidebar UI, command dispatch, plugin API, external process handling, config, proof provisioning, and OS-specific scripts.

Architectural pressure: the current file tree is a concrete implementation, not a workspace subsystem.
That is enough for the present file explorer, but not enough for search, quick-open, figures, diagram ownership, and cross-document reference features.

### Zotero And Citation Features

Requested features include bib autocomplete, Zotero CAYW invocation from the editor, insertion of the returned citation at cursor, optional Better BibTeX hard requirement, external Zotero item/PDF follow actions, and citation rendering in preview/export.

Current fit:

- Plugins cannot mutate the editor or return a typed insertion command.
  `run_plugin` returns a generic process result and optional artifact: `src-tauri/src/plugins.rs:91-100`, `src-tauri/src/plugins.rs:394-410`.
- `runPluginToPath` is not user-facing in the normal UI and requires a target artifact path: `src/App.svelte:406-415`.
- Editor mutation lives behind ad hoc `EditorPane` methods invoked from `toolbarAction`, not behind a public command bus: `src/App.svelte:439-458`.

Predicted integration needs:

- plugin action results that can request editor insertion/replacement at cursor, not only artifact creation;
- a citation source contract for bibliography files and Zotero/Better BibTeX availability;
- a UI action surface that can launch CAYW, receive text, insert it, and then trigger render without making Zotero a core app dependency;
- doctor checks that fail loudly on missing/misconfigured Better BibTeX export if that becomes required.

Predicted blast radius if added directly: high.
A direct Zotero feature would touch editor command APIs, `App.svelte`, plugin execution, config validation, doctor, tests, and possibly render/export flags.

Architectural pressure: Zotero is a clear test of whether "plugin-defined integration" is real.
With the current contract, a Zotero plugin can be executed, but it cannot naturally contribute an editor command that inserts citation text into the current buffer.

### Preferences Externalization

Requested late-stage behavior moves Preferences out of the app GUI entirely, managed by a gum+kitty popup.

Current fit:

- `SettingsModal.svelte` still owns general/editor/preview settings in-app: `src/lib/components/SettingsModal.svelte:17-30`, `src/lib/components/SettingsModal.svelte:77-104`.
- Plugin configure commands are already external and detached, but they do not refresh app state after completion: `src-tauri/src/plugins.rs:412-477`.
- `saveSettings` updates the frontend `config` object and reschedules render only for in-app saves: `src/App.svelte:509-518`.

Predicted integration needs:

- a single config reload/refresh path after any external configuration command;
- menu/config-launcher entries generated from app and plugin config owners;
- removal or demotion of in-app settings without losing live-apply behavior for editor display settings;
- proof that external config edits update menus, renderer choice, and preview state without restart where required.

Predicted blast radius if added directly: medium-high.
It touches SettingsModal, `App.svelte` config state, plugin configure, menu construction, first-run/config scripts, and tests.

Architectural pressure: the app has begun externalizing plugin config, but app config still has a separate GUI model.
The requested end state wants one philosophy: config is owned by external managers and validated by the app.

### Plugin-System Changes Likely Needed Before Clean Feature Additions

The catalogue makes the Tier 4 plugin system an early gate, not a late deliverable.
The current command firewall needs more extension surface before it can absorb later features cleanly.

Likely needed capability classes:

- discovery exposed to the frontend: list installed plugins, categories, names, descriptions, actions, configure commands, output/artifact declarations, and status;
- category enforcement: renderer plugins, export plugins, diagram plugins, workspace tools, editor actions, and config managers should be distinguishable contracts, not labels on the same command kind;
- menu/action contribution: native menus, toolbar entries, sidebar/context-menu entries, command palette/quick-open actions, and settings/config-launcher entries generated from plugin declarations;
- richer context: current file, project root, buffer, selection/cursor, config dir, plugin dir, workspace index location, figures dir, bibliography path, and requested output paths;
- richer result envelope: insert text, replace selection, open artifact with `xdg-open`, refresh tree, refresh config, set render log, show toast, or report diagnostics;
- lifecycle hooks: on file open, before save, after save, before render, after render, before export, after export, on config changed, and doctor/proof hooks;
- isolated plugin proof surfaces: each plugin should be QC-able against its contract without driving the whole app, while the app still has end-to-end proofs that extension points are visible to users.

Without these capabilities, feature work will likely accrete as hardcoded cases in `App.svelte` and `plugins.rs`. That would contradict the stated goal that exports, diagram tools, Zotero, and OS integrations live behind the plugin firewall.

### App-Core Refactoring Pressure

The largest predictable architecture change is not "more plugins" alone.
The app core also needs smaller ownership boundaries so a feature can land where it belongs:

- document/session state: current file, dirty state, durable identity, external fingerprint, recovery snapshot, save gate;
- render lifecycle: debounce, cancellation, status/log, active renderer, source mapping, preview messages;
- workspace model: tree, search index, file kinds, figures, labels, bibliography, recent/session restore;
- command dispatcher: menu, toolbar, editor actions, plugin actions, keybindings, command palette;
- configuration state: load/save/reload, external configure completion, validation, menu rebuild;
- proof harness: user-facing extension-surface proofs separated from backend-only executor proofs.

Current `App.svelte` owns too many of these concerns for the feature list's size.
The problem is not that one file is long.
The problem is that unrelated feature classes will need to edit the same state hub, increasing merge risk, regression risk, and agent confusion.

### Dependency And OS Ownership Forecast

Many requested features have mature owners outside this app:

- CodeMirror extensions should own folding, autocomplete/snippets, delimiter matching, comment toggling, indentation guides, and much of syntax highlighting.
- dmenu/fzf-style quick-open should be an OS-level/plugin action, not an in-app file-selector subsystem.
- `xdg-open` should own unknown-file opening.
- kitty+gum should own external config managers.
- systemd or a small external worker should own background figure-cache refresh.
- Zotero/Better BibTeX should own citation picking/export state; the app should invoke and insert.
- pdf.js or another viewer should own PDF display if PDF preview enters the app.

The current architecture sometimes follows this direction, especially for renderer commands and gum setup.
The risk is inconsistency: if some integrations are external plugins while others become app-owned UI/code paths, future agents will lose the rule for where a feature belongs.

### Feature-Risk Matrix

| Feature class | Clean integration prerequisite | Likely blast radius today |
| --- | --- | --- |
| CodeMirror editor affordances | Editor extension registry and command bus | Medium-high: `EditorPane`, `Toolbar`, `App.svelte`, config, tests |
| Math insertion bar | Editor action model plus workspace labels/bib index | High: editor APIs, toolbar/action UI, workspace scanner, plugins, tests |
| Recovery/git state | Document identity/save-gate state machine | Very high: fsops, app state, plugin/export gates, status, tests |
| Renderer/export/slides plugins | Unified plugin model with category contracts | High: config, plugins, render/export, menus, scripts, proof |
| Figures/diagram tools | Workspace index, artifact registry, plugin context/actions | Very high: file tree, plugin API, render pipeline, background worker, UI |
| Zotero CAYW | Plugin result can insert editor text at cursor | High: plugin API, editor command bus, config/doctor, render/export |
| Preferences externalization | Config reload and external configure lifecycle | Medium-high: settings, config, plugin configure, menu rebuild |
| PDF preview | Viewer dependency boundary and artifact lifecycle | Medium-high: export/render artifacts, preview pane, plugin result model |

### Addendum Judgment

The current architecture is directionally aligned with the requested product: renderer agnosticism, fail-loud config, real subprocess proof, and OS-level configuration are all visible.
It is not yet conducive to clean addition of the full feature catalogue because its extension system is still narrower than the features require.

The most important predicted blocker is not any single missing feature.
It is that the future features need stable app-owned domains and plugin-owned capabilities, while the present app exposes a command runner plus a central frontend coordinator.
Until that gap closes, each feature risks increasing the blast radius of the next feature.

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
