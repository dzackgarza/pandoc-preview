#!/usr/bin/env bash
# Doctor check (P109 / Phase F / F3): the multi-pass PDF driver this plugin runs
# is the REAL latexmk binary — it runs exactly-as-many-passes-as-needed and
# auto-invokes BibTeX by its OWN default behaviour, so the app/plugin orchestrates
# NO passes itself. The deliverable's hard dependency is therefore the latexmk
# executable: this check resolves the SAME driver argv[0] (latexmk) export.sh
# spawns, confirms it is executable, and that `latexmk -v` exits 0. A missing or
# non-runnable latexmk is a broken multi-pass-export environment, so this FAILS
# LOUDLY (nonzero exit) — never a soft default to a single-pass / bare-engine path.
#
# Unlike check-engine.sh (pandoc-pdf-export), the driver is NOT a token of the
# raw command on PPE_PLUGIN_CONFIG (that config carries only the pandoc
# markdown->latex command); latexmk is the multi-pass driver hardcoded in
# export.sh. So this check resolves latexmk on PATH directly — the same name
# export.sh invokes.
set -euo pipefail

driver="latexmk"

exe="$(command -v "$driver" || true)"
if [ -z "$exe" ]; then
    echo "latexmk-pdf-export/check-latexmk.sh: multi-pass driver '$driver' does not resolve on PATH" >&2
    exit 2
fi
if [ ! -x "$exe" ]; then
    echo "latexmk-pdf-export/check-latexmk.sh: '$exe' is not executable" >&2
    exit 3
fi

banner="$("$exe" -v)"
printf '%s driver: %s\n' "$driver" "$(printf '%s\n' "$banner" | head -1)"
