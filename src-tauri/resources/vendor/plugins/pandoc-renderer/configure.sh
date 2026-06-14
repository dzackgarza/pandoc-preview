#!/usr/bin/env bash
# The pandoc renderer plugin's [configure] command (C3). The app spawns this
# detached (it owns no config UI and knows nothing of how the plugin configures
# itself); it opens a kitty popup running the gum wizard. The choice of kitty+gum
# is entirely the plugin's — invisible to the app.
set -euo pipefail

config_dir="$1"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec kitty --class pandoc-preview-configure -e "$here/configure-wizard.sh" "$config_dir"
