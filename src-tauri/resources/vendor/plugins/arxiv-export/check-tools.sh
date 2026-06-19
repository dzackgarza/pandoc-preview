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

if [ ! -d "$macros_dir" ]; then
    echo "arxiv-export/check-tools.sh: macros source dir does not exist: $macros_dir" >&2
    exit 2
fi
macro_tier="$macros_dir/tier1-mathjax-simple.tex"
if [ ! -f "$macro_tier" ]; then
    echo "arxiv-export/check-tools.sh: macro tier missing: $macro_tier" >&2
    exit 3
fi

printf 'latexpand: %s, tar: %s, macros: %s\n' "$latexpand_bin" "$tar_bin" "$macro_tier"
