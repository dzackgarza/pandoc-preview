#!/usr/bin/env bash
# Doctor check (tikz-render-toolchain): the tikz file render path is a hard
# dependency, not an optional extra. render.sh wraps the source in the user-owned
# standalone-tikz.tex template and compiles it (pdflatex -> pdf2svg). This check
# refuses to boot if either converter is absent OR the user-owned template is
# missing, naming the gap once and loudly instead of failing per-render. No
# fallback, no silent skip. (This folds the old pandoc-renderer "tikz-toolchain"
# check, now that tikz rendering is its own primitive — "the standalone template
# resolves and the toolchain that compiles it is present".)
#
# Inherits the app process environment (run_doctor_check does not clear it), so it
# resolves the same PATH / PANDOC_RESOURCE_PATH the renderer will see. exit 0 = OK;
# nonzero with a diagnostic on stderr = FAIL.
set -euo pipefail

missing=()
for tool in pdflatex pdf2svg; do
    command -v "$tool" > /dev/null 2>&1 || missing+=("$tool")
done
if [ "${#missing[@]}" -ne 0 ]; then
    echo "tikz file render toolchain incomplete; missing: ${missing[*]} (pdflatex compiles the standalone tikz doc, pdf2svg converts it to an inline SVG)" >&2
    exit 1
fi

: "${PANDOC_RESOURCE_PATH:?check-render.sh: PANDOC_RESOURCE_PATH must be set (the global figures dir)}"
template="$(dirname "$PANDOC_RESOURCE_PATH")/templates/standalone-tikz.tex"
if [ ! -f "$template" ]; then
    echo "tikz render template missing: $template (the user-owned standalone-tikz.tex the renderer wraps each tikz file in)" >&2
    exit 1
fi

# First non-empty stdout line becomes the doctor detail (run_doctor_check).
echo "tikz render path ready: pdflatex=$(command -v pdflatex) pdf2svg=$(command -v pdf2svg) template=$template"
