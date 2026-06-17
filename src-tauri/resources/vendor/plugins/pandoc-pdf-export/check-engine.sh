#!/usr/bin/env bash
# Doctor check: the PDF engine the raw export command configures
# (--pdf-engine=<engine>) resolves on PATH, is executable, and --version exits 0.
# The config is the raw command STRING on PPE_PLUGIN_CONFIG ({"command": "..."});
# the engine is the value of its --pdf-engine token. lualatex is a hard dependency
# of PDF export — a missing engine is a broken export environment, so this fails
# loudly (nonzero exit) rather than degrading to pandoc's implicit pdflatex.
set -euo pipefail

cfg="$PPE_PLUGIN_CONFIG"
command_str="$(printf '%s' "$cfg" | jq -r '.command')"

# Extract the configured engine from the raw command's --pdf-engine=<engine>
# token (shlex-tokenized so quoting is respected). A PDF export command with no
# --pdf-engine fails loudly: the engine is the discriminating contract.
engine="$(printf '%s' "$command_str" | python3 -c '
import shlex, sys
toks = shlex.split(sys.stdin.read())
for t in toks:
    if t.startswith("--pdf-engine="):
        print(t.split("=", 1)[1])
        break
')"

if [ -z "$engine" ]; then
    echo "pandoc-pdf-export/check-engine.sh: raw command declares no --pdf-engine" >&2
    exit 2
fi

banner="$("$engine" --version)"
printf '%s engine: %s\n' "$engine" "$(printf '%s\n' "$banner" | head -1)"
