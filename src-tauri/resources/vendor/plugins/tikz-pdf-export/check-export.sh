#!/usr/bin/env bash
# Doctor check (tikz-pdf-toolchain): the .tikz → pdf export needs pdflatex and the
# user-owned standalone-tikz.tex template. Refuses to boot if either is absent.
set -euo pipefail

command -v pdflatex > /dev/null 2>&1 || {
    echo "tikz pdf export needs pdflatex on PATH (compiles the wrapped tikz doc); not found" >&2
    exit 1
}

: "${PANDOC_RESOURCE_PATH:?check-export.sh: PANDOC_RESOURCE_PATH must be set (the global figures dir)}"
template="$(dirname "$PANDOC_RESOURCE_PATH")/templates/standalone-tikz.tex"
if [ ! -f "$template" ]; then
    echo "tikz pdf export template missing: $template" >&2
    exit 1
fi

echo "tikz pdf export path ready: pdflatex=$(command -v pdflatex) template=$template"
