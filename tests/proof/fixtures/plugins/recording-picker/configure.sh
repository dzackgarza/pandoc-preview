#!/usr/bin/env bash
# Picker configure fixture (P104/C1). The app's "Configure" action spawns this
# DETACHED as:  configure.sh <plugin_dir> <config_dir>. A real picker's configure
# command would bring up its own UI; this fixture is non-interactive and only
# needs to exist (it is the [configure] required manifest field). The decisive
# P104 observable is the downstream effect of the returned selection (the buffer
# folding / the file opening), not this configure command.
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "recording-picker/configure.sh: expected <plugin_dir> <config_dir>, got $#" >&2
    exit 2
fi

plugin_dir="$1"
config_dir="$2"

{
    printf 'CONFIGURE v1\n'
    printf 'plugin_dir: %s\n' "$plugin_dir"
    printf 'config_dir: %s\n' "$config_dir"
} > "$config_dir/recording-picker.configured"
