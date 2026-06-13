#!/usr/bin/env bash
# first-run.sh — interactive first-time setup for Pandoc Preview.
#
# Walks through every required config option with gum and writes the complete
# XDG config file. The app itself never generates, defaults, or repairs
# config: a missing or partial config is a hard startup error, and this
# script is the only sanctioned way to create one.
#
# Usage:
#   scripts/first-run.sh           create config; refuses if one exists
#   scripts/first-run.sh --force   overwrite an existing config

set -euo pipefail

for tool in gum pandoc; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "FATAL: required tool missing: $tool" >&2
        exit 1
    fi
done

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/pandoc-preview"
CONFIG_FILE="$CONFIG_DIR/config.toml"

FORCE=0
case "${1:-}" in
    "") ;;
    --force) FORCE=1 ;;
    *)
        echo "FATAL: unknown argument: $1 (only --force is accepted)" >&2
        exit 1
        ;;
esac

if [ -f "$CONFIG_FILE" ] && [ "$FORCE" -ne 1 ]; then
    echo "FATAL: $CONFIG_FILE already exists. Re-run with --force to overwrite." >&2
    exit 1
fi

gum style --border rounded --padding "1 2" --margin "1 0" --bold \
    "Pandoc Preview — first-time setup" \
    "Writes: $CONFIG_FILE"

# --- general ----------------------------------------------------------------

THEME=$(gum choose --header "UI theme" "dark" "light")

# --- editor -----------------------------------------------------------------

FONT_SIZE=$(gum input --header "Editor font size in px (8–48)" --value "14")
if ! [[ "$FONT_SIZE" =~ ^[0-9]+$ ]] || [ "$FONT_SIZE" -lt 8 ] || [ "$FONT_SIZE" -gt 48 ]; then
    echo "FATAL: font size must be an integer between 8 and 48, got: $FONT_SIZE" >&2
    exit 1
fi

LINE_WRAPPING=false
gum confirm "Soft-wrap long lines in the editor?" --default=true && LINE_WRAPPING=true

LINE_NUMBERS=false
gum confirm "Show line numbers in the editor gutter?" --default=true && LINE_NUMBERS=true

# --- preview ----------------------------------------------------------------

DEBOUNCE_MS=$(gum input --header "Preview render debounce in ms (0–10000)" --value "400")
if ! [[ "$DEBOUNCE_MS" =~ ^[0-9]+$ ]] || [ "$DEBOUNCE_MS" -gt 10000 ]; then
    echo "FATAL: debounce must be an integer between 0 and 10000, got: $DEBOUNCE_MS" >&2
    exit 1
fi

# --- pandoc -----------------------------------------------------------------

PANDOC_DETECTED=$(command -v pandoc)
PANDOC_PATH=$(gum input --header "Pandoc executable (name on PATH or absolute path)" --value "$PANDOC_DETECTED")
if ! command -v "$PANDOC_PATH" >/dev/null 2>&1; then
    echo "FATAL: pandoc executable not found or not executable: $PANDOC_PATH" >&2
    exit 1
fi

FROM_FORMAT=$(gum input --header "Pandoc input format (--from), e.g. markdown, markdown+emoji" --value "markdown")
if [ -z "$FROM_FORMAT" ]; then
    echo "FATAL: input format must not be empty" >&2
    exit 1
fi

EXTRA_ARGS_RAW=$(gum write --header "Extra pandoc arguments, one per line (Esc to finish, leave empty for none)" || true)

EXTRA_ARGS_TOML=""
while IFS= read -r line; do
    line=$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [ -z "$line" ] && continue
    escaped=${line//\\/\\\\}
    escaped=${escaped//\"/\\\"}
    if [ -n "$EXTRA_ARGS_TOML" ]; then
        EXTRA_ARGS_TOML+=", "
    fi
    EXTRA_ARGS_TOML+="\"$escaped\""
done <<<"$EXTRA_ARGS_RAW"

# --- confirm and write -------------------------------------------------------

SUMMARY="theme=$THEME font_size=$FONT_SIZE line_wrapping=$LINE_WRAPPING line_numbers=$LINE_NUMBERS
debounce_ms=$DEBOUNCE_MS
pandoc=$PANDOC_PATH from=$FROM_FORMAT extra_args=[$EXTRA_ARGS_TOML]"

gum style --border rounded --padding "1 2" --margin "1 0" "$SUMMARY"

if ! gum confirm "Write this config to $CONFIG_FILE?"; then
    echo "Aborted; no config written." >&2
    exit 1
fi

mkdir -p "$CONFIG_DIR"
cat >"$CONFIG_FILE" <<EOF
# Pandoc Preview configuration.
# Created by scripts/first-run.sh — every key is required; the app refuses
# to start on a missing or partial config. Edit values here or via the
# in-app Settings dialog (Tools → Settings…).

[general]
# UI theme: "dark" or "light".
theme = "$THEME"

[editor]
# Editor font size in px (8–48).
font_size = $FONT_SIZE
# Soft-wrap long lines.
line_wrapping = $LINE_WRAPPING
# Show line numbers in the gutter.
line_numbers = $LINE_NUMBERS

[preview]
# Editor idle time in ms before the preview re-renders (0–10000).
# Math is always MathJax (no option): KaTeX cannot cover pandoc's full
# math syntax range.
debounce_ms = $DEBOUNCE_MS

[pandoc]
# Pandoc executable: bare name resolved via PATH or an absolute path.
path = "$PANDOC_PATH"
# Input format passed to pandoc --from.
from_format = "$FROM_FORMAT"
# Extra arguments appended verbatim to every pandoc invocation.
extra_args = [$EXTRA_ARGS_TOML]

# Export targets are config-owned plugins: each [export.<id>] table is a
# complete compilation command. {input}/{output} are substituted per-argument;
# the process runs with cwd = the source file's parent. These two are the
# shipped defaults — add, edit, or replace them with any pipeline you need
# (custom filters, templates, latexmk, your own build script).

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

gum style --bold --foreground 2 "Config written to $CONFIG_FILE"
