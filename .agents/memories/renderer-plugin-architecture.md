# Renderer Plugin Architecture

**When this applies:** any work on the render/preview pipeline, the settings/config surface, the plugin system, or any decision about where renderer-specific knowledge lives.
User-ratified 2026-06-13; **substantially clarified 2026-06-14** (total externality, the pandoc plugin *suite*, plugin-launched config managers — see below).
This is the keystone that reorganizes the entire render model.

**Core ruling: the app is renderer-agnostic; the renderer is a swappable plugin.** The application core owns NO renderer-specific knowledge.
Turning the editor buffer into preview HTML is delegated entirely to a renderer plugin.
The point is small blast radius — pandoc specifics can be updated in isolation without touching the app.

**Total externality (user, 2026-06-14): plugins are COMPLETELY external to the app; the app knows only the CONTRACT, never any plugin internals.** The app cannot and must not know whether a renderer is pandoc, a `markdown-it` script, or a script that reverses the input — and must not know a plugin configures itself with kitty + gum, fzf, an AGS GUI, or anything else.
The contract is the whole of the app's knowledge:
- **Context in:** the app provides each plugin a pre-populated context (the file path, the buffer/doc contents, doc metadata/internals) that the script may canonically use.
- **Behavior:** for a renderer, markdown on stdin → something the preview pane can reasonably render on stdout (the app may require *parseability*, nothing more); for other plugins, an arbitrary script run with the context.
- **Auto-population:** plugins auto-populate app menus/buttons.
  "Export PDF" is nothing more than a Plugins-menu entry that runs the script a plugin supplies.
  Each plugin also supplies a **configuration manager command**; the app auto-populates a settings entry that merely *launches* it (kitten+gum for the vendored pandoc plugin — invisible to the app).
  This exists precisely so the app owns NO settings/configuration windows and forces NO config-UI schema.
  (A declared JSON schema is used ONLY for load-time validation/fail-loud, never to render UI — see below.)
  The app's fallback position for any "tight integration" is a plugin, not app-owned code.

**The vendored pandoc plugin is a SUITE of cooperating plugins, not one plugin (user, 2026-06-14).** "Pandoc functionality out of the box" ships as several orchestrated plugins: the **renderer** (hooks the preview pipeline) AND **separate export plugins** (HTML, PDF). Export is owned by the pandoc suite, NOT the app, specifically to prevent **render↔export drift**: if the app owned export pipelines while the plugin owned rendering, the HTML/PDF export flags would diverge from the preview flags and require error-prone manual syncing.
Co-ownership keeps export visually faithful to the preview.
(A *little* drift is expected and fine — e.g. filters that exist only to offload app-owned work; the surprise to avoid is export looking noticeably different from the preview.)
This supersedes the app-owned `[export.<id>]` config-table model ([Export Plugins Contract](export-plugins-contract)).

**Plugins own their own configuration — and own the config *editing UI* too.** Renderer configuration AND validation live in the plugin, not the app.
A plugin declares its own config schema (JSON-Schema-class) which the app uses ONLY to validate that plugin's config section *generically* on load (the shipped app holds no plugin-specific validation logic, and validates its own core schema the same generic way) — fail-loud on a malformed section.
**The app does NOT render a config page from the schema** (superseded 2026-06-14): config *editing* is done by the plugin's own launched configuration-manager command (see "Total externality" above; for the pandoc plugin, a kitty popup running gum).
The plugin also contributes its own diagnostic checks to the doctor battery.
Full API-floor consequences in [Plugins, Diagrams, Figures Requirements](plugins-diagrams-figures-requirements); config-generation/offloading rules in [Shipped Config vs Runtime Defaults](shipped-config-vs-runtime-defaults).

**Two reference renderers (the abstraction MUST support both):**

- **Pandoc renderer plugin** — houses ALL pandoc knowledge: which flags exist, which are mandatory for happy-path output, the filters/templates it ships with.
  Its stored config is the **raw pandoc command string** (canonical), which its own `render.sh` shlex-runs verbatim ([Pandoc Command Model and Raw String Contract](pandoc-command-model-and-raw-string-contract)). The app neither parses nor understands that command.
  Required flags/filters are enforced by the plugin's own gum configuration manager (it locks them in) plus fail-loud doctor checks — **NOT** by app-side parsing or an app-rendered checkbox page.
  The "semantic deconstruction into a typed model / round-trip / un-uncheckable checkboxes" design was **REPEALED 2026-06-14** ([Pandoc Command Model and Raw String Contract](pandoc-command-model-and-raw-string-contract), clauses 2–4). This is the renderer member of the pandoc *suite* (see above); HTML/PDF export are sibling plugins in the same suite.
- **Generic renderer plugin** — requires only a script that accepts markdown on stdin and produces HTML on stdout.
  NO app-exposed configuration or preferences except the raw string (the script/command) itself.
  Zero validation, zero restrictions.
  This is the escape hatch: a user who wants to run their own raw pandoc string with no enforcement switches to the generic renderer.

**Acceptance test of the whole design:** you can supply an alternative renderer that is a simple script — e.g. `markdown-it` — and it works through the generic renderer with no app changes.
If that fails, the renderer abstraction has leaked into the app core.

**This dissolves the old render-command shell-execution contradiction.** Render is NOT export.
A render never runs a latexmk pipeline — that is the EXPORT path, its own plugin surface ([Rendering Pipeline Requirements: Filters, MathJax, References](rendering-pipeline-requirements-filters-mathjax-references)). The "shell: true pipes vs direct spawn" question is now internal to each renderer plugin: the pandoc plugin builds and spawns a pandoc argv; the generic plugin runs the user's script (which may itself be a shell pipeline) over stdin→stdout.
There is no app-global render-exec contract left to settle.

**Enforced-flags mechanism — RESOLVED, then RE-RESOLVED 2026-06-14.** Required flags/filters are enforced inside the pandoc plugin's own configuration manager (the gum wizard locks them in) and verified by the plugin's fail-loud doctor checks (`required-filter`/`template-exists`). The earlier "always-on checkboxes on an app-rendered config page" answer is superseded along with the whole app-rendered-config-page idea (the app renders no plugin config UI). A user who wants zero enforcement uses the generic renderer.

Related: [Pandoc Command Model and Raw String Contract](pandoc-command-model-and-raw-string-contract), [Plugins, Diagrams, Figures Requirements](plugins-diagrams-figures-requirements), [Rendering Pipeline Requirements: Filters, MathJax, References](rendering-pipeline-requirements-filters-mathjax-references), [Decision Provenance: User-Owned vs Framework-Forced](decision-provenance-user-owned-vs-framework-forced), [Feature Catalogue and Implementation Status](feature-catalogue-and-implementation-status).
