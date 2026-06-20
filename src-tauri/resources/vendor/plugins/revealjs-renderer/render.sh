#!/usr/bin/env bash
# Reveal.js slides renderer: markdown/latex buffer on stdin -> a standalone
# reveal.js DECK on stdout. The slides sibling of the html5 preview — the SAME
# render primitive with pandoc's revealjs writer + the reveal.js template. Self-
# contained (it owns its pandoc invocation); the app forwards only render context
# ($1=base_dir, $2=base_url, $3=mathjax, $4=bibliography, $5=csl) and the selected
# template basename ($6). cwd = base_dir. Fails loud (set -euo pipefail).
set -euo pipefail

base_dir="$1"
base_url="$2"
mathjax="$3"
bibliography="$4"
csl="$5"
# The user-selected reveal.js template BASENAME (default = manifest default_template,
# pandoc_revealjs_template.html), resolved against the templates dir below.
template_name="$6"

# The templates dir is the sibling of the global figures dir PANDOC_RESOURCE_PATH
# points at (e.g. ~/.pandoc/templates). The startup doctor gate guarantees the var
# is set, so no default, no guard.
: "${PANDOC_RESOURCE_PATH:?revealjs-renderer: PANDOC_RESOURCE_PATH must be set (the global figures dir)}"
pandoc_dir="$(dirname "$PANDOC_RESOURCE_PATH")"
template="$pandoc_dir/templates/$template_name"
if [ ! -f "$template" ]; then
    echo "revealjs-renderer: reveal.js template not found: $template" >&2
    exit 1
fi

# pandoc's revealjs writer emits the deck; --standalone --embed-resources make it a
# self-contained HTML deck the preview iframe shows. Citations resolve via citeproc
# against the same config-declared bibliography/csl the html5 preview uses. The
# render context (mathjax/base/resource-path/pagetitle) is layered exactly as the
# html5 renderer layers it.
exec pandoc \
    --from=markdown+lists_without_preceding_blankline \
    --to=revealjs \
    --standalone \
    --embed-resources \
    --citeproc \
    "--template=$template" \
    "--mathjax=$mathjax" \
    "--bibliography=$bibliography" \
    "--csl=$csl" \
    --resource-path "$base_dir:$PANDOC_RESOURCE_PATH" \
    "--metadata=pagetitle:$(basename "$base_dir")" \
    "--variable=header-includes:<base href=\"$base_url\">"
