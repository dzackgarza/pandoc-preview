#!/usr/bin/env bash
# P12 custom-export configure fixture (C1; required manifest field). The app's
# "Configure" action spawns this DETACHED as:  configure.sh <plugin_dir> <config_dir>
# with the plugin's own [plugin.witness] config section on PPE_PLUGIN_CONFIG. A real
# export plugin's configure command brings up its own UI; this fixture is
# non-interactive and only needs to exist (it is the [configure] required field).
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "witness/configure.sh: expected <plugin_dir> <config_dir>, got $#" >&2
    exit 2
fi

plugin_dir="$1"
config_dir="$2"

{
    printf 'CONFIGURE v1\n'
    printf 'plugin_dir: %s\n' "$plugin_dir"
    printf 'config_dir: %s\n' "$config_dir"
} > "$config_dir/witness.configured"
