#!/usr/bin/env bash
# Doctor check: the configured pandoc resolves, is executable, and `--version`
# exits 0. Prints the version banner's first line to stdout, which the doctor
# captures as this check's detail (so the report still carries the real pandoc
# version, as the old core pandoc-executable check did). Fails loudly (nonzero
# exit) if pandoc cannot run — e.g. a non-executable path.
set -euo pipefail

cfg="${PPE_PLUGIN_CONFIG:-}"
[ -n "$cfg" ] || cfg='{}'
path="$(printf '%s' "$cfg" | jq -r '.path')"
banner="$("$path" --version)"
printf '%s\n' "$banner" | head -1
