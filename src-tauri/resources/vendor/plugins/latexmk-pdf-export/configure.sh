#!/usr/bin/env bash
# P108 (Phase F / F2) configure fixture. The app's "Configure" action spawns this
# DETACHED as:  configure.sh <plugin_dir> <config_dir>  with this plugin's own
# [plugin.latexmk-pdf-export] config section on PPE_PLUGIN_CONFIG. Non-interactive;
# it only needs to exist (the [configure] required manifest field).
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "latexmk-pdf-export/configure.sh: expected <plugin_dir> <config_dir>, got $#" >&2
    exit 2
fi

plugin_dir="$1"
config_dir="$2"

{
    printf 'CONFIGURE v1\n'
    printf 'plugin_dir: %s\n' "$plugin_dir"
    printf 'config_dir: %s\n' "$config_dir"
} > "$config_dir/latexmk-pdf-export.configured"
