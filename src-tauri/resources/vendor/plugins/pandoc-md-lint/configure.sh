#!/usr/bin/env bash
# pandoc-md-lint's [configure] command. The app's "Configure" action SPAWNS this
# DETACHED as:  configure.sh <plugin_dir> <config_dir>  with the plugin's own
# [plugin.pandoc-md-lint] config section on PPE_PLUGIN_CONFIG. A real lint
# configurator brings up its own UI to edit the raw md->tex pandoc command; this
# stub is non-interactive and records the substituted paths it was launched with.
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "pandoc-md-lint/configure.sh: expected <plugin_dir> <config_dir>, got $#" >&2
    exit 2
fi

plugin_dir="$1"
config_dir="$2"

{
    printf 'CONFIGURE v1\n'
    printf 'plugin_dir: %s\n' "$plugin_dir"
    printf 'config_dir: %s\n' "$config_dir"
} > "$config_dir/pandoc-md-lint.configured"
