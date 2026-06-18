#!/usr/bin/env bash
# Doctor check (tikz-toolchain): the tikz->SVG preview compile pipeline is a hard
# dependency of the renderer, not an optional extra. The canonical command loads
# tikzcd.lua, which compiles every tikzpicture/tikzcd block to a PDF (pdflatex)
# then an SVG (pdf2svg). If either converter is absent, a document containing a
# tikz block would fail mid-render — so the startup gate refuses to boot, naming
# the missing tool once and loudly, instead of failing per-render. There is no
# fallback and no silent skip: a missing tikz toolchain is a FATAL gate failure.
#
# Inherits the app process environment (run_doctor_check does not clear it), so it
# resolves exactly the PATH the renderer will see. exit 0 = OK; nonzero with a
# diagnostic on stderr = FAIL.
set -euo pipefail

missing=()
for tool in pdflatex pdf2svg; do
    command -v "$tool" > /dev/null 2>&1 || missing+=("$tool")
done

if [ "${#missing[@]}" -ne 0 ]; then
    echo "tikz->SVG compile toolchain incomplete; missing: ${missing[*]} (required by tikzcd.lua: pdflatex compiles the standalone tikz doc, pdf2svg converts it to an inline SVG)" >&2
    exit 1
fi

# First non-empty stdout line becomes the doctor detail (run_doctor_check).
echo "tikz toolchain present: pdflatex=$(command -v pdflatex) pdf2svg=$(command -v pdf2svg)"
