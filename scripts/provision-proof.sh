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

mkdir -p "$SPEC_DIR"/{home,xdg-config,xdg-cache,xdg-state}
ABS_SPEC_DIR="$(realpath "$SPEC_DIR")"

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
    cat >> "$config_path" <<EOF

[plugins]
dir = "$plugins_dir"

[renderer]
active = "pandoc-renderer"

[plugin.pandoc-renderer]
command = "$pandoc_path --from markdown+lists_without_preceding_blankline --to html5 --standalone --embed-resources --citeproc --bibliography=$bib --template=$tpl --lua-filter=$fdir/convert_amsthm_envs.lua --lua-filter=$fdir/obsidian_callouts.lua --lua-filter=$fdir/obsidian.lua"
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
    d01-*) # valid env: every check OK, incl. the export-plugins check, which
        # validates the two shipped default [export.*] plugin tables that
        # write_valid_config now writes (export-plugins-contract.md, D1).
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
        install_plugin_fixtures "$PLUGINS_DIR" pandoc-renderer
        env HOME="$ABS_SPEC_DIR/home" bash "$REPO_ROOT/scripts/install-assets.sh" > /dev/null
        cat >> "$CONFIG_PATH" <<EOF

[plugins]
dir = "$PLUGINS_DIR"

[renderer]
active = "pandoc-renderer"

[plugin.pandoc-renderer]
command = "$PANDOC_BIN --from markdown --to html5 --standalone --embed-resources"
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
    # Canonical witness config: theme=dark, font_size=14 (P9 base),
    # debounce_ms=200 (P2).
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
    # [export] is REQUIRED by the schema (export-plugins-contract.md): every
    # valid config carries the two shipped default plugin tables. Without them
    # the config would fail config-schema and the app would never boot.
    emit_default_export_tables "$CONFIG_PATH"
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
    --arg configPath "$CONFIG_PATH" \
    --arg project "$PROJECT_DIR" \
    --arg demoFile "$DEMO_FILE" \
    '{runId: $runId, spec: $spec, runDir: $runDir,
      xdgConfigHome: $xdgConfigHome, configPath: $configPath,
      project: $project, demoFile: $demoFile}' \
    > "$SPEC_DIR/manifest.json"

echo "provisioned $SPEC at $ABS_SPEC_DIR"
