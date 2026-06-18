# Sourced helper: export the tikz->SVG compile environment the canonical pandoc
# command's tikzcd.lua filter reads. Sourced (not executed) by every script that
# runs the canonical command — render.sh (live preview) and check-invocation.sh
# (the doctor probe) — so the filter sees the SAME env in both, and the OSOT
# derivation lives in exactly one place.
#
# tikzcd.lua reads three directories at load/compile time:
#   PANDOC_DIR  — installed pandoc config dir holding templates/ (standalone-tikz.tex,
#                 read at filter LOAD) and styles/ (dzg-tikz.sty on TEXINPUTS).
#   FIGURES_DIR — the global figures dir.
#   SVG_DIR     — where compiled figure SVGs are written (figures/rendered).
# All derive from PANDOC_RESOURCE_PATH (the global figures dir), which the startup
# doctor gate (pandoc-resource-path check) guarantees is set and exists before the
# app boots — so no default, no guard: a missing var would already have failed the
# gate. Fail loud here too if a caller somehow sources this without it.
: "${PANDOC_RESOURCE_PATH:?tikz-env.sh: PANDOC_RESOURCE_PATH must be set (the global figures dir)}"
export FIGURES_DIR="$PANDOC_RESOURCE_PATH"
export PANDOC_DIR="$(dirname "$FIGURES_DIR")"
export SVG_DIR="$FIGURES_DIR/rendered"
