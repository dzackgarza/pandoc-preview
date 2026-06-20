#!/usr/bin/env bash
# LaTeX renderer: a .tex document on stdin -> standalone preview HTML on stdout.
# The same render primitive as the markdown preview with the LaTeX reader
# (`pandoc --from latex --to html5`). Self-contained; the app forwards only render
# context ($1=base_dir, $2=base_url, $3=mathjax, $4=bibliography, $5=csl) and the
# selected html template basename ($6). cwd = base_dir. Fails loud.
set -euo pipefail

base_dir="$1"
base_url="$2"
mathjax="$3"
bibliography="$4"
csl="$5"
template_name="$6"

: "${PANDOC_RESOURCE_PATH:?latex-renderer: PANDOC_RESOURCE_PATH must be set (the global figures dir)}"
pandoc_dir="$(dirname "$PANDOC_RESOURCE_PATH")"
template="$pandoc_dir/templates/$template_name"
if [ ! -f "$template" ]; then
    echo "latex-renderer: html template not found: $template" >&2
    exit 1
fi

# pandoc reads the LaTeX document and emits standalone HTML wrapped in the html
# template; --embed-resources inlines images; --citeproc resolves \cite against the
# config-declared bibliography/csl; math is MathJax. The render context
# (mathjax/base/resource-path/pagetitle) is layered exactly as the html5 renderer
# layers it.
exec pandoc \
    --from=latex \
    --to=html5 \
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
