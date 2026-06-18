#!/usr/bin/env bash
# Doctor check: the REAL chktex and lacheck binaries this linter wraps are present
# and runnable. The interop half of the tool (pandoc md->tex then chktex/lacheck
# on the .tex) requires both; a missing binary is a LOUD failure (nonzero exit +
# stderr naming the absent tool), never a silently-degraded lint that drops the
# LaTeX-native warnings. Prints the chktex version banner's first line as detail.
set -euo pipefail

command -v chktex > /dev/null || {
    echo "chktex not found on PATH — the pandoc-md-lint tool wraps the real /usr/bin/chktex" >&2
    exit 3
}
command -v lacheck > /dev/null || {
    echo "lacheck not found on PATH — the pandoc-md-lint tool wraps the real /usr/bin/lacheck" >&2
    exit 4
}

chktex --version | head -1
