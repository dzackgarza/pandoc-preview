#!/usr/bin/env bash
# Doctor check (latex-render-toolchain): the .tex preview render path is a hard
# dependency. render.sh runs pandoc's latex reader against an html template. This
# refuses to boot if pandoc is absent OR the template is missing. No fallback.
set -euo pipefail

command -v pandoc > /dev/null 2>&1 || {
    echo "latex preview render needs pandoc on PATH (pandoc --from latex --to html5); not found" >&2
    exit 1
}

: "${PANDOC_RESOURCE_PATH:?check-render.sh: PANDOC_RESOURCE_PATH must be set (the global figures dir)}"
template="$(dirname "$PANDOC_RESOURCE_PATH")/templates/pandoc_preview_template.html"
if [ ! -f "$template" ]; then
    echo "latex preview html template missing: $template" >&2
    exit 1
fi

echo "latex render path ready: pandoc=$(command -v pandoc) template=$template"
