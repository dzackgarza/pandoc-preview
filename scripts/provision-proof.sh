#!/usr/bin/env bash
# Provision one proof spec's hermetic environment from committed fixtures.
# Usage: provision-proof.sh <spec_dir> <spec> <run_id>
#
# Creates: an isolated XDG_CONFIG_HOME with a complete config.toml, and a
# per-run copy of the witness project (demo.md + a real 64x48 PNG). Writes
# manifest.json with the absolute paths the spec will assert against.
#
# The config is the canonical witness config: theme=dark, font_size=14,
# debounce_ms=200 (P2). Math is always MathJax (no config option). P9
# mutates it to font_size=18, theme=light through the real Settings UI.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SPEC_DIR="$1"
SPEC="$2"
RUN_ID="$3"

mkdir -p "$SPEC_DIR"/{home,xdg-config,xdg-cache,xdg-state,xdg-data}
ABS_SPEC_DIR="$(realpath "$SPEC_DIR")"

# The alternative-explorer roots (config [directories]) must EXIST: the config
# loader's ExistingDir type rejects a missing path at load, so every spec's
# hermetic home gets these dirs. install-assets later populates styles with the
# vendored .sty files (when a spec runs it); the empty dir suffices to load.
mkdir -p "$ABS_SPEC_DIR/home/.pandoc/styles" "$ABS_SPEC_DIR/home/.pandoc/figures"

PANDOC_BIN="$(command -v pandoc)"

# Absolute path to the committed P12 custom export plugin (an arbitrary
# executable, NOT pandoc). Referenced verbatim as argv[0] in [export.witness].
WITNESS_PLUGIN="$REPO_ROOT/tests/proof/fixtures/plugins/witness-export.sh"

# ── Export plugin tables (export-plugins-contract.md) ──────────────────
# The two shipped default plugins, written EXACTLY as the contract specifies:
# [export.html] with --embed-resources --mathjax, [export.pdf] with
# --pdf-engine=lualatex. Now that [export] is REQUIRED by the schema, EVERY
# valid provisioned config carries these tables (the canonical witness config
# and write_valid_config both call this); without them config-schema fails and
# the app never boots. p07/p08 exercise the defaults directly, d01's
# export-plugins check validates them, and p12 adds a custom witness plugin on
# top.
emit_default_export_tables() {
    local out="$1"
    cat >> "$out" <<EOF

[export.html]
label = "HTML (self-contained)"
extension = "html"
command = [
  "pandoc", "--from", "markdown", "--standalone",
  "--embed-resources", "--mathjax={mathjax}",
  "{input}", "--output", "{output}",
]

[export.pdf]
label = "PDF"
extension = "pdf"
command = [
  "pandoc", "--from", "markdown", "--standalone",
  "--pdf-engine=lualatex",
  "{input}", "--output", "{output}",
]
EOF
}

# The [directories] table (required schema field): the alternative-explorer roots
# under this spec's hermetic ~/.pandoc. Every valid synthesized config appends it
# (the canonical witness config and write_valid_config both call this); without it
# config-schema fails the ExistingDir/required-field check and the app never boots.
emit_directories() {
    local out="$1"
    cat >> "$out" <<EOF

[directories]
styles = "$ABS_SPEC_DIR/home/.pandoc/styles"
figures = "$ABS_SPEC_DIR/home/.pandoc/figures"
EOF
}

# Generic-plugin fixtures (Milestone A). The plugins dir is a core-config value
# (render-rebuild-plan.md), not a constant: each spec copies the committed
# fixtures into a hermetic plugins dir and wires [plugins].dir below.
PLUGINS_SRC="$REPO_ROOT/tests/proof/fixtures/plugins"
# The shipped pandoc renderer is NOT a test fixture: it is vendored app-owned
# code (the single source of truth scripts/first-run.sh installs for real). Specs
# that synthesize a config directly (rather than running first-run.sh) copy it
# from the SAME vendor source, so there is exactly one pandoc-renderer.
VENDOR_PLUGINS="$REPO_ROOT/src-tauri/resources/vendor/plugins"
# install_plugin_fixtures <dest-dir> <plugin-id>...  — copy the named plugin into a
# hermetic plugins dir. Test-only plugins (witness-tool, ratio-tool,
# generic-renderer) come from the committed fixtures; the shipped pandoc renderer
# comes from the vendor dir (OSOT). A plugin is discovered only if a valid
# [plugin.<id>] config section is also provided (its schema may require keys), so
# each spec installs exactly the plugins it configures.
install_plugin_fixtures() {
    local dest="$1"
    shift
    mkdir -p "$dest"
    local id src
    for id in "$@"; do
        if [ "$id" = "pandoc-renderer" ]; then
            src="$VENDOR_PLUGINS/$id"
        else
            src="$PLUGINS_SRC/$id"
        fi
        cp -r "$src" "$dest/"
    done
}

# Default renderer setup (Milestone B): install the shipped pandoc renderer plugin
# and append [plugins]/[renderer]/[plugin.pandoc-renderer]. The app core is
# renderer-agnostic; the preview is rendered by this plugin (the old core pandoc
# argv now lives in pandoc-renderer/render.sh). Milestone C: the plugin's config is
# the raw pandoc command STRING (canonical), not structured path/from_format/args.
emit_pandoc_renderer() {
    local config_path="$1" plugins_dir="$2" pandoc_path="$3"
    install_plugin_fixtures "$plugins_dir" pandoc-renderer
    # Milestone D: install the shipped filters into this spec's hermetic home and
    # reference them by absolute path in the canonical command. install-assets
    # symlinks the vendored filters (incl. utilities.lua) into $HOME/.pandoc/filters.
    env HOME="$ABS_SPEC_DIR/home" bash "$REPO_ROOT/scripts/install-assets.sh" > /dev/null
    local fdir="$ABS_SPEC_DIR/home/.pandoc/filters"
    local tpl="$ABS_SPEC_DIR/home/.pandoc/templates/pandoc_preview_template.html"
    # The bibliography citeproc resolves against. install-assets just symlinked the
    # vendored starter here; replace that symlink with the fixture, which carries
    # the keys the citation proof (p27) cites. --remove-destination replaces the
    # symlink instead of writing through it into the vendored starter.
    local bib="$ABS_SPEC_DIR/home/.pandoc/bib/references.bib"
    cp --remove-destination "$REPO_ROOT/tests/proof/fixtures/references.bib" "$bib"
    # The shipped alphabetic CSL (hyperlinked [Label] citations); install-assets
    # symlinked the vendored csl dir into $HOME/.pandoc/csl.
    local csl="$ABS_SPEC_DIR/home/.pandoc/csl/alpha-preview.csl"
    cat >> "$config_path" <<EOF

[plugins]
dir = "$plugins_dir"

[renderer]
active = "pandoc-renderer"

[plugin.pandoc-renderer]
command = "$pandoc_path --from markdown+lists_without_preceding_blankline --to html5 --standalone --embed-resources --citeproc --bibliography=$bib --csl=$csl --metadata=link-citations:true --metadata=reference-section-title:References --template=$tpl --lua-filter=$fdir/convert_amsthm_envs.lua --lua-filter=$fdir/obsidian_callouts.lua --lua-filter=$fdir/obsidian.lua"

[plugin.pandoc-renderer.style]
figure_width = "75%"
EOF
}

# The P12 custom plugin: an arbitrary user-defined [export.witness] entry whose
# command is the committed witness-export.sh, not pandoc. Proves the export
# surface runs the configured argv verbatim against the real source.
emit_witness_export_table() {
    local out="$1"
    cat >> "$out" <<EOF

[export.witness]
label = "Witness"
extension = "txt"
command = [
  "$WITNESS_PLUGIN",
  "{input}", "{output}",
]
EOF
}

# ── Doctor (D-series) provisioning ─────────────────────────────────────
# The D-series asserts on the doctor battery at the process/launcher level,
# not the webview. Each D-spec needs a purpose-built (often broken) config —
# broken environments are the doctor's product surface — and no witness
# project. Provisioning writes the doctor-shaped config, then a lean manifest.
case "$SPEC" in
d[0-9][0-9]-*.spec.ts)
    CONFIG_DIR="$ABS_SPEC_DIR/xdg-config/pandoc-preview"
    CONFIG_PATH="$CONFIG_DIR/config.toml"
    PLUGINS_DIR="$ABS_SPEC_DIR/plugins"

    write_valid_config() {
        local pandoc_path="$1"
        mkdir -p "$CONFIG_DIR"
        cat > "$CONFIG_PATH" <<EOF
[general]
theme = "dark"

[editor]
font_size = 14
line_wrapping = false
line_numbers = true

[preview]
debounce_ms = 200
EOF
        # [export] is REQUIRED by the schema: every valid config carries the two
        # shipped default plugin tables (export-plugins-contract.md).
        emit_default_export_tables "$CONFIG_PATH"
        emit_directories "$CONFIG_PATH"
        # The pandoc renderer is the active renderer (its checks are the doctor's
        # pandoc-executable/pandoc-invocation rows; D1/D5 assert on them).
        emit_pandoc_renderer "$CONFIG_PATH" "$PLUGINS_DIR" "$pandoc_path"
    }

    # The exact observed stale key regression (schema removed 'math').
    write_stale_key_config() {
        mkdir -p "$CONFIG_DIR"
        cat > "$CONFIG_PATH" <<EOF
[general]
theme = "dark"
math = "mathjax"

[editor]
font_size = 14
line_wrapping = false
line_numbers = true

[preview]
debounce_ms = 200

[pandoc]
path = "$PANDOC_BIN"
from_format = "markdown"
extra_args = []
EOF
    }

    case "$SPEC" in
    d01-* | d16-*) # valid env: every check OK, incl. the export-plugins check, which
        # validates the two shipped default [export.*] plugin tables that
        # write_valid_config now writes (export-plugins-contract.md, D1). d16
        # reuses the same valid env but is launched with PANDOC_RESOURCE_PATH unset
        # (spawnDoctor resourcePath:null), so the ONLY failing check is the
        # pandoc-resource-path startup check.
        write_valid_config "$PANDOC_BIN"
        ;;
    d02-*) # no config: leave the config dir absent. The spec drives the launcher,
        # which routes into the real first-run.sh; first-run.sh itself creates the
        # plugins dir and installs the shipped renderer (it is NOT injected here —
        # that injection used to mask the bug d14 now guards).
        ;;
    d03-*) # config carrying the exact observed stale key; recovers via the real
        # first-run.sh (which installs the renderer itself — no injection here).
        write_stale_key_config
        ;;
    d04-*) # invalid config: stale key -> config-schema fails the startup gate
        # (bare binary; no recovery, no boot, so no renderer needed).
        write_stale_key_config
        ;;
    d06-*) # existing stale/invalid config: `just setup` must reconfigure it via the
        # real first-run.sh (which installs the renderer itself — no injection here).
        write_stale_key_config
        ;;
    d07-*) # existing config-class-invalid config: `just dev` must recover it via the
        # real first-run.sh (which installs the renderer itself — no injection here).
        write_stale_key_config
        ;;
    d05-*) # valid config, but pandoc.path -> a real NON-executable file
        NONEXEC="$ABS_SPEC_DIR/not-pandoc"
        printf '#!/bin/sh\necho nope\n' > "$NONEXEC"
        chmod 0644 "$NONEXEC" # readable, NOT executable
        write_valid_config "$NONEXEC"
        ;;
    d08-*) # A2: generic plugin-config schema validation. Valid core config plus
        # two discovered fixture plugins with DIFFERENT schemas — witness-tool's
        # section conforms, ratio-tool's `ratio = 5` violates its schema (max 1).
        # The witness-tool.marker is created so witness-tool's own checks all pass
        # and the ONLY failing check is plugin-config:ratio-tool.
        write_valid_config "$PANDOC_BIN"
        install_plugin_fixtures "$PLUGINS_DIR" witness-tool ratio-tool
        touch "$CONFIG_DIR/witness-tool.marker"
        cat >> "$CONFIG_PATH" <<EOF

[plugin.witness-tool]
greeting = "hi"

[plugin.ratio-tool]
ratio = 5
EOF
        ;;
    d09-*) # A3: plugin-contributed doctor checks join the battery. Valid core
        # config plus the witness-tool fixture; both plugin sections conform.
        # The witness-tool.marker file is deliberately NOT created, so the
        # contributed witness-tool-marker check FAILs on its real condition while
        # witness-tool-runnable passes.
        write_valid_config "$PANDOC_BIN"
        install_plugin_fixtures "$PLUGINS_DIR" witness-tool ratio-tool
        cat >> "$CONFIG_PATH" <<EOF

[plugin.witness-tool]
greeting = "hi"

[plugin.ratio-tool]
ratio = 0.5
EOF
        ;;
    d11-*) # C4/D3: required-filter check. Valid env (write_valid_config installs the
        # filters via emit_pandoc_renderer), then remove a required filter that is
        # NOT command-referenced (tikzcd, deferred to F) so required-filter is the
        # SOLE failing check — the command still runs, only the required set is short.
        write_valid_config "$PANDOC_BIN"
        rm -f "$ABS_SPEC_DIR/home/.pandoc/filters/tikzcd.lua"
        ;;
    d13-*) # C3: the gum configurator must LOCK the required filters in. Start from a
        # valid env whose command LACKS the required filters; the wizard re-adds them.
        mkdir -p "$CONFIG_DIR"
        cat > "$CONFIG_PATH" <<EOF
[general]
theme = "dark"

[editor]
font_size = 14
line_wrapping = false
line_numbers = true

[preview]
debounce_ms = 200
EOF
        emit_default_export_tables "$CONFIG_PATH"
        emit_directories "$CONFIG_PATH"
        install_plugin_fixtures "$PLUGINS_DIR" pandoc-renderer
        env HOME="$ABS_SPEC_DIR/home" bash "$REPO_ROOT/scripts/install-assets.sh" > /dev/null
        cat >> "$CONFIG_PATH" <<EOF

[plugins]
dir = "$PLUGINS_DIR"

[renderer]
active = "pandoc-renderer"

[plugin.pandoc-renderer]
command = "$PANDOC_BIN --from markdown --to html5 --standalone --embed-resources"

[plugin.pandoc-renderer.style]
figure_width = "75%"
EOF
        ;;
    d14-*) # The REAL first-run.sh output must pass the doctor on its own. Drive
        # the real script through a PTY (no canonical config written here) and
        # deliberately inject NOTHING afterward: unlike d02/d03/d06/d07/p10, we do
        # NOT install_plugin_fixtures. What the doctor sees is exactly what
        # first-run.sh produced — including whether it created the plugins dir and
        # installed the shipped renderer the config points at.
        "$REPO_ROOT/scripts/drive-first-run.py" \
            "$REPO_ROOT/scripts/first-run.sh" \
            "$ABS_SPEC_DIR/xdg-config" \
            "$ABS_SPEC_DIR/home"
        if [ ! -f "$CONFIG_PATH" ]; then
            echo "FATAL: first-run.sh did not write $CONFIG_PATH" >&2
            exit 1
        fi
        ;;
    d15-*) # Valid config (every config-class + export check passes) whose
        # [plugins].dir points at a directory that does NOT exist -> the ONLY
        # failing doctor check is `plugins`. This is the state the pre-fix
        # first-run.sh left behind. `just dev` must route it into reconfiguration
        # (which now creates the dir + installs the renderer), not dead-end as an
        # unrecoverable "non-config" failure. We install NO plugin here.
        mkdir -p "$CONFIG_DIR"
        cat > "$CONFIG_PATH" <<EOF
[general]
theme = "dark"

[editor]
font_size = 14
line_wrapping = false
line_numbers = true

[preview]
debounce_ms = 200
EOF
        emit_default_export_tables "$CONFIG_PATH"
        emit_directories "$CONFIG_PATH"
        # The filters/template must be installed so the command first-run.sh writes
        # during recovery is runnable (every recovery spec does this).
        env HOME="$ABS_SPEC_DIR/home" bash "$REPO_ROOT/scripts/install-assets.sh" > /dev/null
        cat >> "$CONFIG_PATH" <<EOF

[plugins]
dir = "$CONFIG_DIR/plugins"

[renderer]
active = "pandoc-renderer"

[plugin.pandoc-renderer]
command = "$PANDOC_BIN --from markdown --to html5 --standalone --embed-resources"

[plugin.pandoc-renderer.style]
figure_width = "75%"
EOF
        ;;
    esac

    jq -n \
        --arg runId "$RUN_ID" \
        --arg spec "$SPEC" \
        --arg runDir "$ABS_SPEC_DIR" \
        --arg xdgConfigHome "$ABS_SPEC_DIR/xdg-config" \
        --arg configPath "$CONFIG_PATH" \
        '{runId: $runId, spec: $spec, runDir: $runDir,
          xdgConfigHome: $xdgConfigHome, configPath: $configPath}' \
        > "$SPEC_DIR/manifest.json"

    echo "provisioned $SPEC (doctor) at $ABS_SPEC_DIR"
    exit 0
    ;;
esac

# ── Hermetic project copy (independent per spec, mutable by P6) ────────
PROJECT_DIR="$ABS_SPEC_DIR/project"
cp -r "$REPO_ROOT/tests/proof/fixtures/project" "$PROJECT_DIR"
DEMO_FILE="$PROJECT_DIR/demo.md"
if [ ! -f "$DEMO_FILE" ]; then
    echo "FATAL: witness demo.md missing at $DEMO_FILE" >&2
    exit 1
fi

# ── config.toml under the hermetic XDG_CONFIG_HOME ─────────────────────
CONFIG_DIR="$ABS_SPEC_DIR/xdg-config/pandoc-preview"
CONFIG_PATH="$CONFIG_DIR/config.toml"
mkdir -p "$CONFIG_DIR"

PLUGINS_DIR="$ABS_SPEC_DIR/plugins"
if [ "$SPEC" = "p10-first-run-bootable.spec.ts" ]; then
    # P10 boots from a config produced by the REAL first-run.sh, driven through a
    # real PTY answering the gum prompts. No canonical config is written here; the
    # script must produce it — INCLUDING the plugins dir and the shipped renderer it
    # installs there. Nothing is injected afterward (the old injection masked the
    # bug d14 now guards): the booted app's renderer-agnostic core delegates the
    # preview to whatever first-run.sh genuinely left behind.
    "$REPO_ROOT/scripts/drive-first-run.py" \
        "$REPO_ROOT/scripts/first-run.sh" \
        "$ABS_SPEC_DIR/xdg-config" \
        "$ABS_SPEC_DIR/home"
    if [ ! -f "$CONFIG_PATH" ]; then
        echo "FATAL: first-run.sh did not write $CONFIG_PATH" >&2
        exit 1
    fi
else
    # ── User snippet dictionary (P52) ──────────────────────────────────
    # P52 declares the snippet dictionary by a CONFIG-OWNED path, not a hardcoded
    # list. Provision a hermetic copy of the committed FIXTURE dict (the spec owns
    # it) and emit an extra `[editor].snippet_dictionary` line pointing config at
    # it, so the snippets the editor offers are exactly this dict's — a different
    # dict would offer different snippets. The dict carries one entry,
    # mthm -> "::: {.theorem}\n$0\n:::" (a CM6 $0-tabstop snippet body). For every
    # other spec this stays empty, so the canonical [editor] block is byte-for-byte
    # what it was before.
    EDITOR_EXTRA=""
    case "$SPEC" in
    p52-snippet-dictionary.spec.ts | p59-snippet-dropdown.spec.ts | p63-insertion-bar-controls.spec.ts)
        # P52 (autocomplete-popup path) and P59 (insertion-bar dropdown path) both
        # declare the snippet dictionary by a CONFIG-OWNED path. They share the
        # SAME committed fixture dict (tests/proof/fixtures/snippets/p52-snippets.json,
        # mthm -> "::: {.theorem}\n$0\n:::"): pointing config at it makes those the
        # snippets surfaced, so a different dict would surface different triggers —
        # the config-owned property both obligations name. P59 reads this same
        # config-declared path back to prove the bar's dropdown triggers come from
        # the dict (not a hardcoded list), so the fixture is the single source of
        # truth for both specs. P63 reuses the same dict to drive the bar's snippet
        # <select> through a REAL DOM selectOption (coverage-hardening of the same
        # dropdown P59 proves via the hook).
        SNIPPETS_DIR="$ABS_SPEC_DIR/home/.pandoc/snippets"
        mkdir -p "$SNIPPETS_DIR"
        SNIPPET_DICT="$SNIPPETS_DIR/p52-snippets.json"
        cp "$REPO_ROOT/tests/proof/fixtures/snippets/p52-snippets.json" "$SNIPPET_DICT"
        EDITOR_EXTRA="snippet_dictionary = \"$SNIPPET_DICT\""
        ;;
    p54-spellcheck.spec.ts)
        # P54 declares the custom math dictionary by a CONFIG-OWNED path, not a
        # hardcoded list. Provision a hermetic copy of the committed FIXTURE
        # wordlist (the spec owns it; first entry `cohomology`, a real
        # algebraic-geometry term standard English spellcheck flags) and point
        # `[editor].spell_dictionary` at it, so a checker run WITHOUT this
        # dictionary would wrongly flag `cohomology` — which the math-term
        # assertion catches. The base English dictionary ships vendored in-bundle.
        DICTS_DIR="$ABS_SPEC_DIR/home/.pandoc/dictionaries"
        mkdir -p "$DICTS_DIR"
        SPELL_DICT="$DICTS_DIR/p54-mathdict.txt"
        cp "$REPO_ROOT/tests/proof/fixtures/dictionaries/p54-mathdict.txt" "$SPELL_DICT"
        EDITOR_EXTRA="spell_dictionary = \"$SPELL_DICT\""
        ;;
    esac

    # Canonical witness config: theme=dark, font_size=14 (P9 base),
    # debounce_ms=200 (P2).
    cat > "$CONFIG_PATH" <<EOF
[general]
theme = "dark"

[editor]
font_size = 14
line_wrapping = false
line_numbers = true
$EDITOR_EXTRA

[preview]
debounce_ms = 200
EOF
    # [export] is REQUIRED by the schema (export-plugins-contract.md): every
    # valid config carries the two shipped default plugin tables. Without them
    # the config would fail config-schema and the app would never boot.
    emit_default_export_tables "$CONFIG_PATH"
    emit_directories "$CONFIG_PATH"
    # Renderer setup (Milestone B): the core is renderer-agnostic and delegates the
    # preview to the active renderer plugin. Default = pandoc renderer (keeps the
    # preview byte-identical to the old core path); p20 swaps in the generic
    # renderer to prove the abstraction.
    case "$SPEC" in
    p20-generic-renderer.spec.ts)
        install_plugin_fixtures "$PLUGINS_DIR" generic-renderer
        cat >> "$CONFIG_PATH" <<EOF

[plugins]
dir = "$PLUGINS_DIR"

[renderer]
active = "generic-renderer"
EOF
        ;;
    *)
        emit_pandoc_renderer "$CONFIG_PATH" "$PLUGINS_DIR" "$PANDOC_BIN"
        ;;
    esac
fi

# ── Custom export plugin (p12 only) ────────────────────────────────────
# P12 asserts the export surface runs an ARBITRARY configured argv against the
# real source, so its config additionally carries a user-defined [export.witness]
# plugin whose command is the committed witness-export.sh (not pandoc).
case "$SPEC" in
p12-export-custom-pipeline.spec.ts)
    emit_witness_export_table "$CONFIG_PATH"
    ;;
p19-plugin-run-by-id.spec.ts)
    # A1: the generic plugin firewall runs a tools plugin by id. The canonical
    # config above already set up the pandoc renderer + [plugins].dir (so the
    # preview works); here we ADD the witness-tool plugin into that same dir and
    # its config section. The witness-tool.marker is created so witness-tool's
    # contributed doctor checks pass and the app boots; the spec then drives
    # runPlugin by id.
    install_plugin_fixtures "$PLUGINS_DIR" witness-tool
    touch "$CONFIG_DIR/witness-tool.marker"
    cat >> "$CONFIG_PATH" <<EOF

[plugin.witness-tool]
greeting = "hi"
EOF
    ;;
p22-configure-plugin-spawn.spec.ts)
    # C1: plugins own their configuration. The canonical config above set up the
    # pandoc renderer + [plugins].dir (so the preview works); here we ADD the
    # witness-tool plugin (whose manifest declares a [configure] command) into
    # that same dir and its config section, so the spec can drive configurePlugin
    # by id. The marker is created so witness-tool's contributed doctor checks
    # pass and the app boots.
    install_plugin_fixtures "$PLUGINS_DIR" witness-tool
    touch "$CONFIG_DIR/witness-tool.marker"
    cat >> "$CONFIG_PATH" <<EOF

[plugin.witness-tool]
greeting = "hi"
EOF
    ;;
p07-export-html.spec.ts)
    # P7 (export-as-plugin migration): HTML export is the shipped pandoc-html-export
    # export-category plugin, discovered from [plugins].dir and run BY ID through the
    # generic firewall (proof-obligations.md migration rulings 2026-06-17;
    # export-plugins-contract.md). The canonical config above already set up the
    # pandoc renderer + [plugins].dir (so the preview works); here we ADD the shipped
    # pandoc-html-export plugin into that SAME dir (vendored alongside pandoc-renderer,
    # OSOT) and its [plugin.pandoc-html-export] config section — the raw HTML export
    # command the plugin runs (mirroring [plugin.pandoc-renderer].command). The spec
    # then drives runPlugin('pandoc-html-export', target) and asserts the produced
    # artifact carries the P1 witnesses and a self-contained data: image URI.
    #
    # RED today: the shipped pandoc-html-export plugin does NOT exist yet (the only
    # vendored plugin is pandoc-renderer), so it is NOT in the plugins dir and
    # discover() never finds it. run_plugin returns "no plugin with id
    # \"pandoc-html-export\" in the plugins dir", no artifact is written, and the spec
    # fails at the existsSync(target) gate — the absent plugin, not a weakened
    # assertion. GREEN: the implementer vendors the pandoc-html-export plugin
    # (cloning the pandoc-renderer plugin shape: plugin.toml/render.sh/schema.json/
    # configure) and installs it here by adding it to the vendored-plugin id list in
    # install_plugin_fixtures (so it is sourced from $VENDOR_PLUGINS, OSOT), then
    # adding `install_plugin_fixtures "$PLUGINS_DIR" pandoc-html-export` on the line
    # above. For the RED the plugin is absent from $VENDOR_PLUGINS, so it cannot be
    # installed and the plugins dir does not contain it — discover() never finds it.
    cat >> "$CONFIG_PATH" <<EOF

[plugin.pandoc-html-export]
command = "$PANDOC_BIN --from markdown+lists_without_preceding_blankline --to html5 --standalone --embed-resources"
EOF
    ;;
p66-export-plugin-discovery.spec.ts)
    # P66: export is a discovered plugin in the pandoc suite. The canonical config
    # above set up the pandoc renderer + [plugins].dir (so the preview works); here
    # we ADD the export-category fixture plugin into that SAME dir and its config
    # section — and deliberately NO [export.witness-export-plugin] app-core table.
    # The plugin declares category="export", a generic `extension` manifest field
    # ("wexp"), and a contributed doctor check. The ONLY way it can surface in the
    # menu/command-palette and in the doctor battery is via category-aware discovery
    # of the plugin manifest, never via the app-core [export.<id>] config table.
    install_plugin_fixtures "$PLUGINS_DIR" witness-export-plugin
    cat >> "$CONFIG_PATH" <<EOF

[plugin.witness-export-plugin]
command = "true"
EOF
    ;;
p49-session-restore.spec.ts)
    # P49 — launch restores the last session and offers newer recovery content.
    #
    # A true two-instance relaunch is infeasible in this harness: run_app_spec
    # launches exactly ONE app instance and the Playwright fixture attaches to
    # its socket; there is no in-harness primitive to spawn a second instance and
    # observe its webview. So we provision, on the HOST FILESYSTEM and BEFORE the
    # single launch, exactly the durable state a prior session would have left —
    # then observe whether the launched app honors it. This is faithful, not a
    # mock: the app boots against a clean hermetic XDG with NO prior in-app
    # activity, so reopening the last file and offering the newer recovery content
    # can ONLY come from reading this real host-fs state.
    #
    # Two real host-fs artifacts are provisioned:
    #
    #  (1) SESSION STATE under $XDG_STATE_HOME/pandoc-preview/session.json — the
    #      last project + last file a prior session persisted. Per the contract
    #      (recovery-and-git-state-requirements.md) session state lives on the
    #      host fs under XDG_STATE_HOME, never browser storage. This is the
    #      stable observable contract the implementer must read on launch.
    #
    #  (2) A RECOVERY STORE AHEAD OF DISK under
    #      $XDG_DATA_HOME/pandoc-preview/recovery/<session_id>/ — a REAL git repo
    #      built exactly as src-tauri/src/recovery.rs builds it (the buffer
    #      committed as a blob under the recovery filename), holding the NEWER
    #      buffer: the on-disk demo.md content PLUS an unsaved edit. The on-disk
    #      demo.md is left as the STALE older content (the plain fixture copy), so
    #      a restore that loads disk would be observably wrong.
    #
    # The spec discovers the newer recovery bytes content-addressably (it does not
    # hardcode them), asserts they are ahead of disk, then asserts the accepted
    # restore loads exactly those bytes into the editor buffer.
    SESSION_ID="p49-session"
    # The tree entry name recovery.rs records the buffer blob under
    # (recovery.rs: BUFFER_ENTRY = "buffer", no extension). Kept in sync with the
    # app's recovery store layout so this provisioned repo is a faithful replica
    # of what the app's own autosave would write. The spec reads the buffer bytes
    # content-addressably from the object database, so it does not depend on this
    # name — but the provisioned repo must still match the real store shape.
    RECOVERY_FILENAME="buffer"
    RECOVERY_DIR="$ABS_SPEC_DIR/xdg-data/pandoc-preview/recovery/$SESSION_ID"

    # The NEWER buffer = stale on-disk demo.md + an unsaved edit. Built from the
    # ACTUAL on-disk bytes so "ahead of disk" is a real content delta, not an
    # invented file. The sentence carries non-ASCII so a lossy restore is caught.
    NEWER_BUFFER="$ABS_SPEC_DIR/p49-newer-buffer.md"
    cp "$DEMO_FILE" "$NEWER_BUFFER"
    printf '\n\nUnsaved recovery edit — Café ζ naïve.\n' >> "$NEWER_BUFFER"

    # Build the recovery store as a REAL git repo, mirroring recovery.rs exactly:
    # the buffer is committed as a blob at RECOVERY_FILENAME. An independent
    # process (this provisioning) writes it; the app and the spec both read it
    # content-addressably from the object database (p45's discipline).
    mkdir -p "$RECOVERY_DIR"
    git -C "$RECOVERY_DIR" init -q
    git -C "$RECOVERY_DIR" config user.email "recovery@pandoc-preview.localhost"
    git -C "$RECOVERY_DIR" config user.name "pandoc-preview recovery"
    cp "$NEWER_BUFFER" "$RECOVERY_DIR/$RECOVERY_FILENAME"
    git -C "$RECOVERY_DIR" add "$RECOVERY_FILENAME"
    git -C "$RECOVERY_DIR" commit -q -m "autosave: $DEMO_FILE"

    # Session state: the last project + last file + the recovery session id, on
    # the host fs under XDG_STATE_HOME. The implementer reads this on launch to
    # reopen the last file and locate the session's recovery store.
    SESSION_STATE_DIR="$ABS_SPEC_DIR/xdg-state/pandoc-preview"
    mkdir -p "$SESSION_STATE_DIR"
    jq -n \
        --arg project "$PROJECT_DIR" \
        --arg file "$DEMO_FILE" \
        --arg sessionId "$SESSION_ID" \
        '{project: $project, file: $file, sessionId: $sessionId}' \
        > "$SESSION_STATE_DIR/session.json"
    ;;
p29-global-figures-resource.spec.ts)
    # P29: a figure that exists ONLY in the global figures dir
    # ($HOME/.pandoc/figures), referenced relative to that dir (rendered/global.png).
    # It is deliberately NOT placed under the project, so it can resolve only
    # through the global figures dir on the resource path — which the renderer
    # learns from PANDOC_RESOURCE_PATH (run_app_spec sets it to this hermetic
    # figures dir, mirroring the GUI session's ~/.pathrc export). The committed
    # fixture is a real 80x32 PNG (distinct from P5's 64x48) the spec decodes.
    FIGS_DIR="$ABS_SPEC_DIR/home/.pandoc/figures/rendered"
    mkdir -p "$FIGS_DIR"
    cp "$REPO_ROOT/tests/proof/fixtures/global-figures/rendered/global.png" "$FIGS_DIR/"
    printf '\n![globalfig](rendered/global.png)\n' >> "$DEMO_FILE"
    ;;
esac

# ── lualatex font-cache warmup (p08 only) ──────────────────────────────
# Each run's HOME is a fresh empty dir, so the FIRST lualatex invocation
# rebuilds the luaotfload font database (written under
# $HOME/.config/texlive/<year>/texmf-var/luatex-cache), which takes far longer
# than the spec's artifact poll window. Warm it here by running the exact
# shipped [export.pdf] plugin command once under the spec's hermetic env.
# This is environment provisioning (same class as pre-building the app
# binary), NOT the proof: the spec still drives the app's own export and
# asserts on the artifact that export produces. Fails loudly if the command
# cannot produce a PDF — a broken lualatex is a broken proof environment.
if [ "$SPEC" = "p08-export-pdf.spec.ts" ]; then
    WARMUP_PDF="$ABS_SPEC_DIR/lualatex-warmup.pdf"
    # cwd = the source file's parent, mirroring the app's export contract.
    (
        cd "$PROJECT_DIR"
        env HOME="$ABS_SPEC_DIR/home" \
            XDG_CONFIG_HOME="$ABS_SPEC_DIR/xdg-config" \
            XDG_CACHE_HOME="$ABS_SPEC_DIR/xdg-cache" \
            XDG_STATE_HOME="$ABS_SPEC_DIR/xdg-state" \
            pandoc --from markdown --standalone --pdf-engine=lualatex \
            "$DEMO_FILE" --output "$WARMUP_PDF"
    )
    if [ ! -s "$WARMUP_PDF" ]; then
        echo "FATAL: lualatex warmup produced no PDF at $WARMUP_PDF" >&2
        exit 1
    fi
    rm -f "$WARMUP_PDF"
fi

jq -n \
    --arg runId "$RUN_ID" \
    --arg spec "$SPEC" \
    --arg runDir "$ABS_SPEC_DIR" \
    --arg xdgConfigHome "$ABS_SPEC_DIR/xdg-config" \
    --arg xdgDataHome "$ABS_SPEC_DIR/xdg-data" \
    --arg xdgStateHome "$ABS_SPEC_DIR/xdg-state" \
    --arg configPath "$CONFIG_PATH" \
    --arg project "$PROJECT_DIR" \
    --arg demoFile "$DEMO_FILE" \
    '{runId: $runId, spec: $spec, runDir: $runDir,
      xdgConfigHome: $xdgConfigHome, xdgDataHome: $xdgDataHome,
      xdgStateHome: $xdgStateHome,
      configPath: $configPath, project: $project, demoFile: $demoFile}' \
    > "$SPEC_DIR/manifest.json"

echo "provisioned $SPEC at $ABS_SPEC_DIR"
