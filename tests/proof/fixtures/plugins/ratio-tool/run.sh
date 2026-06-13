#!/usr/bin/env bash
# ratio-tool fixture executable. Present so the manifest's [exec].command argv[0]
# resolves to a real executable (the plugin firewall and any executable doctor
# check require it). d08 validates ratio-tool's config schema and never runs it;
# this stays a real, minimal command rather than a stub.
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "ratio-tool/run.sh: expected <file> <artifact>, got $#" >&2
    exit 2
fi

printf 'RATIO-TOOL v1\n' > "$2"
