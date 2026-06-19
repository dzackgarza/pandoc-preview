#!/usr/bin/env bash
# P109 (Phase F / F3) RED BASELINE override for the latexmk-pdf-export driver's
# export.sh. scripts/provision-proof.sh copies this OVER the hermetic
# latexmk-pdf-export/export.sh for the p118 RED only, so the obligation's named PDF
# driver id (latexmk-pdf-export — the id the spec drives) runs a DELIBERATELY
# single-pass build today. The GREEN deliverable stops overriding (ships the real
# multi-pass latexmk export.sh as the configured PDF command), so the spec stays
# byte-stable across RED -> GREEN.
#
# The plugin firewall invokes it with the SAME 3-arg contract as the multi-pass
# driver:  export.sh <file> <artifact> <builddir>  with the real editor buffer on
# stdin and the [plugin.latexmk-pdf-export] config section (the raw pandoc
# markdown->latex command) on PPE_PLUGIN_CONFIG.
#
# It runs pandoc (markdown -> standalone latex) then EXACTLY ONE lualatex pass,
# with NO latexmk, NO BibTeX, NO re-run. A single lualatex pass:
#   - cannot resolve a FORWARD cross-reference (the \ref reads the prior run's
#     .aux, which has no entry for the LATER \label yet) -> renders the unresolved
#     marker (??);
#   - never invokes BibTeX, so no .bbl is built -> the \cite renders the
#     unresolved marker ([?]) with no author/year and no bibliography list.
# This is the obligation's "single LaTeX pass leaves BOTH unresolved" baseline.
# The GREEN latexmk driver's real /usr/bin/latexmk runs exactly-as-many-passes-as-
# needed and auto-invokes BibTeX (latexmk's default), resolving BOTH.
#
# The build-isolation contract (F2) is identical to the multi-pass driver: cwd =
# the source dir (so the source's relative resources and the config-declared bib
# resolve against it) while every intermediate is routed into the app-supplied
# {builddir} via -output-directory.
set -euo pipefail

if [ "$#" -ne 3 ]; then
    echo "p118 single-pass export.sh: expected <file> <artifact> <builddir>, got $#" >&2
    exit 2
fi

file="$1"
artifact="$2"
builddir="$3"

if [ ! -f "$file" ]; then
    echo "p118 single-pass export.sh: source file does not exist: $file" >&2
    exit 3
fi
if [ ! -d "$builddir" ]; then
    echo "p118 single-pass export.sh: app-supplied build dir does not exist: $builddir" >&2
    exit 4
fi

# The raw pandoc command (markdown -> standalone latex), canonical, from the
# [plugin.latexmk-pdf-export] config section delivered on PPE_PLUGIN_CONFIG.
cfg="$PPE_PLUGIN_CONFIG"
command_str="$(printf '%s' "$cfg" | jq -r '.command')"

# Tokenize the raw command (quotes respected, NO shell expansion) — run it, do not
# interpret it. The first token is the executable (pandoc).
mapfile -t cmd < <(printf '%s' "$command_str" \
    | python3 -c 'import shlex,sys; [print(t) for t in shlex.split(sys.stdin.read())]')

# Produce the .tex INTO the app-supplied build dir (never beside the source).
base="$(basename "${file%.*}")"
tex="$builddir/${base}.tex"
"${cmd[@]}" "$file" --output "$tex"

# Drive EXACTLY ONE lualatex pass into the build dir. No latexmk, no BibTeX, no
# re-run: the single-pass baseline. -interaction=nonstopmode keeps lualatex from
# blocking on the undefined references — it emits the PDF carrying ?? and [?].
lualatex -interaction=nonstopmode -output-directory="$builddir" "$tex" >/dev/null 2>&1 || true

# Surface the produced PDF (in the build dir) at the app-chosen {artifact}.
cp "$builddir/${base}.pdf" "$artifact"
