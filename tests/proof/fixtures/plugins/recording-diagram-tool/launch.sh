#!/usr/bin/env bash
# Diagram-tool recording launch fixture (P96 / D-7). The plugin firewall launches
# it (configure_plugin-shaped, detached) as:
#   launch.sh <file> <config_dir>
# where <file> is the figure's tracked editable SOURCE path the dual-asset
# registry resolved for the edit action, and <config_dir> is the app's real
# config dir.
#
# A real Ipe/Inkscape GUI cannot be asserted headless, so instead of opening a
# window this thin script RECORDS the source path it was handed to a sentinel file
# under the config dir. The P96 spec reads that sentinel by an INDEPENDENT process
# and asserts the recorded path is the figure's editable SOURCE (fig.svg), NOT the
# included render — proving the edit action launched the editor on the source. An
# implementation that launches on the render, ignores the registry, or fails to
# substitute {file} cannot fabricate the source path here.
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "recording-diagram-tool/launch.sh: expected <file> <config_dir>, got $#" >&2
    exit 2
fi

file="$1"
config_dir="$2"

if [ ! -d "$config_dir" ]; then
    echo "recording-diagram-tool/launch.sh: config dir does not exist: $config_dir" >&2
    exit 3
fi

# Record the exact path the edit action launched the editor on. The sentinel is a
# fixed name under the config dir the spec reconstructs independently. A missing
# source path is a loud error: the registry must resolve the figure to a real
# tracked source, never a silent empty launch.
if [ -z "$file" ]; then
    echo "recording-diagram-tool/launch.sh: empty source path — registry did not resolve a tracked source" >&2
    exit 4
fi

printf '%s' "$file" > "$config_dir/recording-diagram-tool.launched-on"
