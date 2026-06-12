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
# --pdf-engine=lualatex. Appended to the config for the specs whose obligation
# is the plugin-shaped export surface (p07/p08/p12) and the doctor export-plugins
# check (d01). No other spec receives these tables: the current Config has
# deny_unknown_fields and no `export` field, so adding them to a green spec's
# config would change its boot behaviour.
emit_default_export_tables() {
    local out="$1"
    cat >> "$out" <<EOF

[export.html]
label = "HTML (self-contained)"
extension = "html"
command = [
  "pandoc", "--from", "markdown", "--standalone",
  "--embed-resources", "--mathjax",
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
d0[1-5]-*.spec.ts)
    CONFIG_DIR="$ABS_SPEC_DIR/xdg-config/pandoc-preview"
    CONFIG_PATH="$CONFIG_DIR/config.toml"

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

[pandoc]
path = "$pandoc_path"
from_format = "markdown"
extra_args = []
EOF
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
    d01-*) # valid env: every check OK, incl. the export-plugins check, so the
        # config carries the two shipped default [export.*] plugin tables that
        # check validates (export-plugins-contract.md, doctor-contract.md D1).
        write_valid_config "$PANDOC_BIN"
        emit_default_export_tables "$CONFIG_PATH"
        ;;
    d02-*) # no config: leave the config dir absent (gum first-run creates it)
        : ;;
    d03-*) # config carrying the exact observed stale key
        write_stale_key_config
        ;;
    d04-*) # invalid config: stale key -> config-schema fails the startup gate
        write_stale_key_config
        ;;
    d05-*) # valid config, but pandoc.path -> a real NON-executable file
        NONEXEC="$ABS_SPEC_DIR/not-pandoc"
        printf '#!/bin/sh\necho nope\n' > "$NONEXEC"
        chmod 0644 "$NONEXEC" # readable, NOT executable
        write_valid_config "$NONEXEC"
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

if [ "$SPEC" = "p10-first-run-bootable.spec.ts" ]; then
    # P10 boots from a config produced by the REAL first-run.sh, driven
    # through a real PTY answering the gum prompts. No canonical config is
    # written here; the script must produce it.
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

[pandoc]
path = "$PANDOC_BIN"
from_format = "markdown"
extra_args = []
EOF
fi

# ── Export-plugin config variant (p07/p08/p12 only) ────────────────────
# These three specs assert on the plugin-shaped export surface
# (export-plugins-contract.md), so their config carries the [export.*] tables.
# p07/p08 exercise the two shipped defaults; p12 adds the custom witness plugin.
# No other P-spec gets these tables (the current schema's deny_unknown_fields
# would change their boot behaviour).
case "$SPEC" in
p07-export-html.spec.ts | p08-export-pdf.spec.ts)
    emit_default_export_tables "$CONFIG_PATH"
    ;;
p12-export-custom-pipeline.spec.ts)
    emit_default_export_tables "$CONFIG_PATH"
    emit_witness_export_table "$CONFIG_PATH"
    ;;
esac

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
