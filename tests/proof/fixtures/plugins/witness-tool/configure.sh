#!/usr/bin/env bash
# Generic-plugin configure fixture (C1/p22). The app's "Configure" action spawns
# this DETACHED as:  configure.sh <plugin_dir> <config_dir>  with the plugin's own
# [plugin.witness-tool] config section on PPE_PLUGIN_CONFIG.
#
# A real plugin's configure command brings up its own UI (the pandoc renderer
# opens a kitty popup running gum). This fixture is non-interactive: it writes a
# witness into the REAL config dir carrying the substituted {plugin_dir} and
# {config_dir} it was launched with, so an implementation that ignores the
# manifest, runs a fixed command, or fails to substitute placeholders cannot
# fabricate it. The p22 spec recomputes both paths independently and asserts them.
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "witness-tool/configure.sh: expected <plugin_dir> <config_dir>, got $#" >&2
    exit 2
fi

plugin_dir="$1"
config_dir="$2"

if [ ! -d "$config_dir" ]; then
    echo "witness-tool/configure.sh: config dir does not exist: $config_dir" >&2
    exit 3
fi

{
    printf 'CONFIGURE v1\n'
    printf 'plugin_dir: %s\n' "$plugin_dir"
    printf 'config_dir: %s\n' "$config_dir"
} > "$config_dir/witness-tool.configured"
