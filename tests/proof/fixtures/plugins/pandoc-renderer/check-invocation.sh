#!/usr/bin/env bash
# Doctor check: probe a render with the FULL configured arg set
# (--from <from_format> --to html5 + extra_args, empty stdin) to prove the whole
# invocation contract, not just that the binary exists. Mirrors the old core
# pandoc-invocation check.
set -euo pipefail

cfg="${PPE_PLUGIN_CONFIG:-}"
[ -n "$cfg" ] || cfg='{}'
path="$(printf '%s' "$cfg" | jq -r '.path')"
from_format="$(printf '%s' "$cfg" | jq -r '.from_format')"
mapfile -t extra < <(printf '%s' "$cfg" | jq -r '.extra_args[]?')

"$path" --from "$from_format" --to html5 "${extra[@]}" < /dev/null > /dev/null
printf 'pandoc --from %s (+%d extra args) exited 0\n' "$from_format" "${#extra[@]}"
