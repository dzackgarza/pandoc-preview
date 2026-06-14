# Pandoc Command Model and Raw String Contract

**When this applies:** designing or reviewing the **pandoc renderer plugin** — its command storage, its self-owned `configure` command, or config validation.
The app core no longer owns any of this; it lives inside the pandoc renderer plugin ([Renderer Plugin Architecture](renderer-plugin-architecture)). Originally ratified 2026-06-13; **clauses 2–4 repealed and replaced 2026-06-14** (plugin-owned config via a spawned `configure` command — see below).

**The contract (within the pandoc renderer plugin):**

1. **The raw pandoc command string is canonical — always extractable, always input-able.
   Period.** The user develops the command in a terminal and pastes it in; the plugin must always be able to hand the exact working string back.
   The stored form of the pandoc renderer configuration IS this string.
   Structured config fields as stored truth (greenfield2's `pandoc.path` / `from_format` / `extra_args`) are **rejected** — any structured view is derived from the string, never a second source of truth.
2. **The plugin owns its own configuration entirely (REPLACES the 2026-06-13 semantic-deconstruction design; user ruling 2026-06-14).** The app is config-agnostic.
   Every plugin manifest declares a required `[configure] command`; the app exposes a "Configure <name>" action that merely **spawns that command** detached — no TTY handling, no terminal knowledge, no model of the config's editable shape in core.
   The plugin's command brings its own UI (the pandoc plugin launches a kitty popup running a gum script that sets the command and picks filters/templates).
   This is the VS Code extension model.
   The app's only structural read of the config is **validation on load** against the plugin's JSON Schema (the Milestone-A generic validator, unchanged) so a malformed section fails loud; it never parses the command to edit it.
3. **REPEALED (2026-06-14):** the "deconstruct the command into a typed model, round-trip property-test it, surface required flags as permanently-checked un-uncheckable checkboxes" mechanism.
   Rejected as architectural drift — the typed model existed only to power an *in-app* config editor, which is not the render pipeline (decoupling the renderer is already done in Milestone B: a renderer is an opaque shell command).
   Invariant enforcement (required reader-extensions/filters always present) now lives in the plugin's own `configure` script (it locks the required items) plus **doctor checks** that fail loud when a referenced filter/template is missing on disk — never command parsing in the app.
4. **No command parsing in the app, period (REPLACES the `lexopt`/`shlex` "parsing is library work" clause).** The app neither tokenizes nor interprets the pandoc command line.
   The renderer plugin's `render.sh` shlex-tokenizes the raw string only to *exec* it (run, not understand) with markdown on stdin; the app treats the command as opaque.
   No `lexopt`, no typed `PandocCommand`, no round-trip invariant.

**The generic renderer is the no-enforcement escape hatch.** A user who wants to run an arbitrary raw pandoc string (or any other command) with zero validation switches to the **generic renderer plugin**, whose only configuration is the raw script string (markdown on stdin → HTML on stdout).
All enforcement in this memory applies ONLY when the user has opted into the pandoc renderer plugin ([Renderer Plugin Architecture](renderer-plugin-architecture)).

**Shell-execution is no longer a contradiction.** Render ≠ export; a render never runs a latexmk-class pipeline.
How the command is spawned is internal to each renderer plugin (the pandoc plugin builds and spawns a pandoc argv; the generic plugin runs the user's script, which may itself be a shell pipeline, over stdin→stdout).
There is no app-global exec contract to settle.

**Verify:** (a) grep the app core for pandoc-specific structured keys AND for any command-line tokenizing/parsing of the pandoc command — neither may exist in core; (b) `[plugin.pandoc-renderer]` stores the raw command string as canonical config; (c) the plugin manifest declares a `[configure] command` and the app's "Configure" action spawns it (no in-app checkbox editor, no command parsing); (d) required filters/template are enforced by the plugin's gum `configure` script + fail-loud doctor checks (`required-filter`/`template-exists`), not by parsing; (e) the generic renderer runs a simple `markdown-it` script with no app changes ([Renderer Plugin Architecture](renderer-plugin-architecture)).

Related: [Renderer Plugin Architecture](renderer-plugin-architecture), [Required Filter Set](required-filter-set), [Rendering Pipeline Requirements: Filters, MathJax, References](rendering-pipeline-requirements-filters-mathjax-references), [Contract Invariants and Ownership Boundaries](contract-invariants-and-ownership-boundaries).
