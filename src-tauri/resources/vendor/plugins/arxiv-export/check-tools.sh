#!/usr/bin/env bash
# Doctor check: the bundle toolchain this plugin hard-depends on resolves. The
# arXiv bundle pipeline flattens with the canonical latexpand flattener and tars
# the bundle, and materializes the dzg macro tier out of the configured
# macros_dir. A missing tool or macro source is a broken export environment, so
# this fails loudly (nonzero exit) rather than degrading.
set -euo pipefail

cfg="$PPE_PLUGIN_CONFIG"
macros_dir="$(printf '%s' "$cfg" | jq -er '.macros_dir')"

# latexpand — the canonical LaTeX flattener the bundle's flatten step runs.
latexpand_bin="$(command -v latexpand)"
# tar — the bundle archiver.
tar_bin="$(command -v tar)"
# uvx — the runner the figure-format gate (G4/P117) drives cairosvg through to
# convert SVG figures to arXiv-acceptable PDFs (inkscape/rsvg-convert are absent,
# cairosvg is not owned). A missing runner is a broken export environment.
uvx_bin="$(command -v uvx)" || {
    echo "arxiv-export/check-tools.sh: uvx not found on PATH — the figure-format gate needs cairosvg via the uvx runner to convert SVG figures, and the G5 pass needs arxiv_latex_cleaner via the uvx runner" >&2
    exit 4
}

# arxiv_latex_cleaner (G5/P118) — the REAL cleaner the bundle's final pass runs
# UNMODIFIED via the uvx runner. A missing shipped cleaner-config or an
# unreachable cleaner is a broken export environment, so fail loudly.
cleaner_config="$(dirname "$0")/cleaner-config.yaml"
if [ ! -f "$cleaner_config" ]; then
    echo "arxiv-export/check-tools.sh: shipped cleaner-config missing: $cleaner_config" >&2
    exit 5
fi
if ! "$uvx_bin" --from arxiv-latex-cleaner arxiv_latex_cleaner --help >/dev/null 2>&1; then
    echo "arxiv-export/check-tools.sh: arxiv_latex_cleaner not reachable via uvx — the G5 cleaner pass cannot run" >&2
    exit 6
fi

if [ ! -d "$macros_dir" ]; then
    echo "arxiv-export/check-tools.sh: macros source dir does not exist: $macros_dir" >&2
    exit 2
fi
macro_tier="$macros_dir/tier1-mathjax-simple.tex"
if [ ! -f "$macro_tier" ]; then
    echo "arxiv-export/check-tools.sh: macro tier missing: $macro_tier" >&2
    exit 3
fi

printf 'latexpand: %s, tar: %s, uvx: %s, arxiv_latex_cleaner: reachable, macros: %s\n' "$latexpand_bin" "$tar_bin" "$uvx_bin" "$macro_tier"
