#!/usr/bin/env bash
# Provision one proof spec's hermetic environment from committed fixtures.
# Usage: provision-proof.sh <spec_dir> <spec> <run_id>
#
# Creates: an isolated XDG_CONFIG_HOME with a complete config.toml, and a
# per-run copy of the witness project (demo.md + a real 64x48 PNG). Writes
# manifest.json with the absolute paths the spec will assert against.
#
# The config is the canonical witness config: theme=dark, font_size=14,
# math=katex (P4), debounce_ms=200 (P2). P9 mutates it to font_size=18,
# theme=light through the real Settings UI.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SPEC_DIR="$1"
SPEC="$2"
RUN_ID="$3"

mkdir -p "$SPEC_DIR"/{home,xdg-config,xdg-cache,xdg-state}
ABS_SPEC_DIR="$(realpath "$SPEC_DIR")"

# ── Hermetic project copy (independent per spec, mutable by P6) ────────
PROJECT_DIR="$ABS_SPEC_DIR/project"
cp -r "$REPO_ROOT/tests/proof/fixtures/project" "$PROJECT_DIR"
DEMO_FILE="$PROJECT_DIR/demo.md"
if [ ! -f "$DEMO_FILE" ]; then
    echo "FATAL: witness demo.md missing at $DEMO_FILE" >&2
    exit 1
fi

# ── config.toml under the hermetic XDG_CONFIG_HOME ─────────────────────
PANDOC_BIN="$(command -v pandoc)"
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
    # math=katex (P4), debounce_ms=200 (P2).
    cat > "$CONFIG_PATH" <<EOF
[general]
theme = "dark"

[editor]
font_size = 14
line_wrapping = false
line_numbers = true

[preview]
debounce_ms = 200
math = "katex"

[pandoc]
path = "$PANDOC_BIN"
from_format = "markdown"
extra_args = []
EOF
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
