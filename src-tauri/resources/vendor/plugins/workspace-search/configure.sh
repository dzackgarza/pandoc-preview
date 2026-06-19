#!/usr/bin/env bash
# The workspace-search configurator. The app's "Configure" action SPAWNS this
# detached with {plugin_dir}/{config_dir} substituted. The plugin owns its own
# configuration; this shipped stub is non-interactive (workspace-search has no
# user-tunable config — the schema is the empty object), recording the
# substituted paths so an implementation that ignores the manifest cannot
# fabricate the effect.
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "workspace-search/configure.sh: expected <plugin_dir> <config_dir>, got $#" >&2
    exit 2
fi

plugin_dir="$1"
config_dir="$2"

printf 'workspace-search configure: plugin_dir=%s config_dir=%s\n' \
    "$plugin_dir" "$config_dir" > "$config_dir/workspace-search.configured"
