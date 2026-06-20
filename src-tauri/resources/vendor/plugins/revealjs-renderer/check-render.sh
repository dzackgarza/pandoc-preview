#!/usr/bin/env bash
# Doctor check (revealjs-render-toolchain): the reveal.js slides render path is a
# hard dependency, not an optional extra. render.sh runs pandoc's revealjs writer
# against the reveal.js template. This refuses to boot if pandoc is absent OR the
# template is missing, naming the gap once and loudly. No fallback, no silent skip.
#
# Inherits the app process environment, so it resolves the same PATH /
# PANDOC_RESOURCE_PATH the renderer will see. exit 0 = OK; nonzero with a
# diagnostic on stderr = FAIL.
set -euo pipefail

command -v pandoc > /dev/null 2>&1 || {
    echo "reveal.js slides render needs pandoc on PATH (pandoc --to revealjs emits the deck); not found" >&2
    exit 1
}

: "${PANDOC_RESOURCE_PATH:?check-render.sh: PANDOC_RESOURCE_PATH must be set (the global figures dir)}"
template="$(dirname "$PANDOC_RESOURCE_PATH")/templates/pandoc_revealjs_template.html"
if [ ! -f "$template" ]; then
    echo "reveal.js template missing: $template (the deck template the renderer builds against)" >&2
    exit 1
fi

# First non-empty stdout line becomes the doctor detail (run_doctor_check).
echo "reveal.js render path ready: pandoc=$(command -v pandoc) template=$template"
