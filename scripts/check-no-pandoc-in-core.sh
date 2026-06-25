#!/usr/bin/env bash
# B2 architecture-hygiene gate (Milestone B): the app core owns NO renderer
# knowledge — all pandoc command knowledge lives inside the pandoc renderer
# plugin, never in src-tauri/src (renderer-plugin-architecture.md,
# pandoc-command-model-and-raw-string-contract.md "verify (a)").
#
# This is an ARCHITECTURE/ownership-boundary check, deliberately NOT a tests/proof
# behavioral spec (the global rule bans source-content meta-assertions in the
# proof suite). B1 (p20) carries the behavioral proof: a leak into core would
# break the generic renderer's "works with no app changes" property. This gate is
# the cheap structural backstop.
#
# It forbids pandoc COMMAND-LINE flag tokens in the core. Config-key names and the
# product name ("Pandoc Preview") are not command knowledge and are allowed.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE="$REPO_ROOT/src-tauri/src"

# Pandoc CLI flags / writer tokens that constitute pandoc command knowledge.
PATTERN='--from\b|--to\b|--standalone|--resource-path|--mathjax|--lua-filter|--filter\b|--template|--pdf-engine|--embed-resources|html5'

# Match in CODE only: drop comment-only lines (Rust //, ///, //!) — prose that
# explains a flag (e.g. the export placeholder contract) is not command knowledge.
# A real argv token (`"--from"`) lives on a code line and is still caught.
hits="$(grep -rnE -- "$PATTERN" "$CORE" | grep -vE ':[0-9]+:[[:space:]]*//' || true)"
if [ -n "$hits" ]; then
    echo "FAIL: pandoc command knowledge found in the app core (src-tauri/src)." >&2
    echo "It must live only inside the pandoc renderer plugin (Milestone B)." >&2
    echo "$hits" >&2
    exit 1
fi

echo "OK: no pandoc command knowledge in the app core (src-tauri/src)."
