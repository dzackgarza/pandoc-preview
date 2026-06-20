#!/usr/bin/env bash
# The latex renderer plugin's [configure] command. The app spawns this detached.
# The render's config surface is the html template; "configure" opens it for
# editing in a kitty popup (the choice of kitty/editor is the plugin's).
set -euo pipefail

: "${PANDOC_RESOURCE_PATH:?latex-renderer configure: PANDOC_RESOURCE_PATH must be set (the global figures dir)}"
template="$(dirname "$PANDOC_RESOURCE_PATH")/templates/pandoc_preview_template.html"
if [ ! -f "$template" ]; then
    echo "FATAL: html template missing: $template" >&2
    exit 1
fi

exec kitty --class pandoc-preview-configure -e "${EDITOR:-vi}" "$template"
