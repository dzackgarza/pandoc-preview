#!/usr/bin/env bash
# The reveal.js renderer plugin's [configure] command. The app spawns this detached.
# The renderer has no app-owned config: how the deck looks is governed by the
# reveal.js template. So "configure" opens that template for editing in a kitty
# popup (the choice of kitty/editor is the plugin's, invisible to the app).
set -euo pipefail

: "${PANDOC_RESOURCE_PATH:?revealjs-renderer configure: PANDOC_RESOURCE_PATH must be set (the global figures dir)}"
template="$(dirname "$PANDOC_RESOURCE_PATH")/templates/pandoc_revealjs_template.html"
if [ ! -f "$template" ]; then
    echo "FATAL: reveal.js template missing: $template" >&2
    exit 1
fi

exec kitty --class pandoc-preview-configure -e "${EDITOR:-vi}" "$template"
