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

# An existing config is re-runnable: `just setup` (no --force) offers a gum
# confirm to overwrite and reconfigure, so a stale config (e.g. one predating a
# schema change) can be redone in place. --force skips the confirm — that is
# the path the recovery gate (lib-recovery.sh) uses after its own confirm, and
# the one drive-first-run.py's fresh/P10 path uses. Declining aborts loudly.
if [ -f "$CONFIG_FILE" ] && [ "$FORCE" -ne 1 ]; then
    if ! gum confirm "Config already exists at $CONFIG_FILE. Overwrite and reconfigure?"; then
        echo "FATAL: reconfiguration declined; existing config left unchanged." >&2
        exit 1
    fi
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

# Build the canonical pandoc command (Milestone C): the raw string the pandoc
# renderer plugin runs verbatim. Document semantics live here (reader, writer,
# --standalone, --embed-resources so images inline and the preview resolves no
# files); the plugin layers volatile render context (mathjax/resource-path/base)
# at render time. Extra args entered above are appended verbatim.
EXTRA_ARGS_CMD=""
while IFS= read -r line; do
    line=$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [ -z "$line" ] && continue
    EXTRA_ARGS_CMD+=" $line"
done <<<"$EXTRA_ARGS_RAW"

FILTERS_DIR="$HOME/.pandoc/filters"
# Roots for the alternative-explorer panes: the macros pane browses the styles
# directory, the figures pane browses the figures directory.
STYLES_DIR="$HOME/.pandoc/styles"
FIGURES_DIR="$HOME/.pandoc/figures"
PREVIEW_TEMPLATE="$HOME/.pandoc/templates/pandoc_preview_template.html"
BIBLIOGRAPHY="$HOME/.pandoc/bib/references.bib"
# The shipped alphabetic citation style (hyperlinked [Label] citations).
CSL="$HOME/.pandoc/csl/alpha-preview.csl"
# Obsidian fidelity: lists may follow a paragraph with no blank line in a vault;
# the extension makes pandoc parse them as lists (Obsidian does). Citeproc resolves
# [@key] citations against the installed bibliography (override it with your own).
FROM_FORMAT_EXT="$FROM_FORMAT+lists_without_preceding_blankline"
# tikzcd.lua is intentionally NOT referenced yet: it errors at load without its
# standalone-tikz.tex template + PANDOC_DIR/FIGURES_DIR env, which is the Milestone
# F tikz pipeline. It is still vendored/installed; it joins the command in F.
# Citations render preprint-style: --csl gives bracketed alphabetic labels,
# --metadata link-citations hyperlinks them to the bibliography, and
# reference-section-title gives the bibliography a separated "References" heading.
PANDOC_COMMAND="$PANDOC_PATH --from $FROM_FORMAT_EXT --to html5 --standalone --embed-resources --citeproc --bibliography=$BIBLIOGRAPHY --csl=$CSL --metadata=link-citations:true --metadata=reference-section-title:References --template=$PREVIEW_TEMPLATE --lua-filter=$FILTERS_DIR/convert_amsthm_envs.lua --lua-filter=$FILTERS_DIR/obsidian_callouts.lua --lua-filter=$FILTERS_DIR/obsidian.lua$EXTRA_ARGS_CMD"
# Escape for a TOML basic string ("..."): backslash first, then double-quote.
PANDOC_COMMAND_TOML=${PANDOC_COMMAND//\\/\\\\}
PANDOC_COMMAND_TOML=${PANDOC_COMMAND_TOML//\"/\\\"}

# --- confirm and write -------------------------------------------------------

SUMMARY="theme=$THEME font_size=$FONT_SIZE line_wrapping=$LINE_WRAPPING line_numbers=$LINE_NUMBERS
debounce_ms=$DEBOUNCE_MS
pandoc command=$PANDOC_COMMAND"

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

# Roots for the alternative-explorer panes (the macros pane browses styles, the
# figures pane browses figures). Both are required absolute paths.
[directories]
styles = "$STYLES_DIR"
figures = "$FIGURES_DIR"

# The app is renderer-agnostic: the preview is produced by a renderer plugin
# discovered from the plugins directory below. The shipped pandoc renderer houses
# all pandoc knowledge; the pandoc executable/format/args you set are its config.
[plugins]
# Directory plugins (renderers, tools) are discovered from.
dir = "$CONFIG_DIR/plugins"

[renderer]
# Active renderer plugin id. The pandoc renderer is the shipped default; switch to
# "generic-renderer" to run an arbitrary markdown->HTML script with no enforcement.
active = "pandoc-renderer"

[plugin.pandoc-renderer]
# The canonical pandoc command (raw string). The plugin runs it verbatim with the
# markdown buffer on stdin -> preview HTML on stdout; volatile render context
# (--mathjax/--resource-path/<base>) is layered by the plugin, not stored here.
# Edit it directly or via the plugin's own Configure action.
command = "$PANDOC_COMMAND_TOML"

# Stylistic knobs the renderer layers onto every preview (render.sh -> pandoc
# --variable). figure_width caps figure/diagram width in the preview; edit it to
# taste (e.g. "100%" for full width).
[plugin.pandoc-renderer.style]
figure_width = "75%"

# Export is entirely the pandoc plugin suite: the shipped pandoc-html-export and
# pandoc-pdf-export export-category plugins, discovered from [plugins].dir and run
# by id through the generic firewall. Each carries its OWN raw pandoc command
# (the individually-managed raw command); the plugin's export.sh runs it verbatim,
# layering only the volatile per-export context ({file}/{artifact} and, for HTML,
# the plugin-local MathJax bundle). Edit the command, or replace it via the
# plugin's own Configure action.
[plugin.pandoc-html-export]
command = "$PANDOC_PATH --from markdown --to html5 --standalone --embed-resources"

[plugin.pandoc-pdf-export]
command = "$PANDOC_PATH --from markdown --standalone --pdf-engine=lualatex"
EOF

# Install the shipped pandoc filters the command references (Milestone D):
# symlink the vendored canonical copies into $HOME/.pandoc/filters. Output is
# silenced so it cannot interfere with the PTY driver's prompt matching.
"$(dirname "${BASH_SOURCE[0]}")/install-assets.sh" > /dev/null

# Install the shipped renderer plugin into the configured plugins dir. The config
# above points [plugins].dir at "$CONFIG_DIR/plugins"; the app is renderer-agnostic
# and discovers the active renderer from there, so the plugins dir must exist and
# carry the pandoc renderer or the very next gate (the doctor's plugins check) fails
# on a freshly configured system. The renderer is app-owned code vendored as the
# single source of truth; symlink its directory so updates stay atomic, preserving a
# real-directory user override (a real dir where the managed symlink would go).
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RENDERER_VENDOR="$REPO_ROOT/src-tauri/resources/vendor/plugins/pandoc-renderer"
if [ ! -d "$RENDERER_VENDOR" ]; then
    echo "FATAL: vendored renderer plugin missing: $RENDERER_VENDOR" >&2
    exit 1
fi
PLUGINS_DIR="$CONFIG_DIR/plugins"
mkdir -p "$PLUGINS_DIR"
RENDERER_DEST="$PLUGINS_DIR/pandoc-renderer"
if [ -e "$RENDERER_DEST" ] && [ ! -L "$RENDERER_DEST" ]; then
    echo "preserve (user override): $RENDERER_DEST" >&2
else
    ln -sfn "$RENDERER_VENDOR" "$RENDERER_DEST"
fi

# Install the shipped export-category plugins. Export is entirely the pandoc
# plugin suite: pandoc-html-export and pandoc-pdf-export are app-owned vendored
# code (the single source of truth), symlinked into the plugins dir so updates
# stay atomic and a real-directory user override is preserved. The
# [plugin.<id>].command sections written above are validated against each
# plugin's schema by the generic plugin-config check.
for export_plugin in pandoc-html-export pandoc-pdf-export; do
    EXPORT_VENDOR="$REPO_ROOT/src-tauri/resources/vendor/plugins/$export_plugin"
    if [ ! -d "$EXPORT_VENDOR" ]; then
        echo "FATAL: vendored export plugin missing: $EXPORT_VENDOR" >&2
        exit 1
    fi
    EXPORT_DEST="$PLUGINS_DIR/$export_plugin"
    if [ -e "$EXPORT_DEST" ] && [ ! -L "$EXPORT_DEST" ]; then
        echo "preserve (user override): $EXPORT_DEST" >&2
    else
        ln -sfn "$EXPORT_VENDOR" "$EXPORT_DEST"
    fi
done

gum style --bold --foreground 2 "Config written to $CONFIG_FILE"
