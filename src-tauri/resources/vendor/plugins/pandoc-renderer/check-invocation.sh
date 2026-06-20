#!/usr/bin/env bash
# Doctor check: probe a render with the FULL canonical command (empty stdin) to
# prove the whole invocation contract, not just that the binary exists. Mirrors
# the old core pandoc-invocation check. Milestone C: the command is the raw string
# on PPE_PLUGIN_CONFIG ({"command": "..."}); run it verbatim (shlex-tokenized).
set -euo pipefail

cfg="${PPE_PLUGIN_CONFIG:-}"
[ -n "$cfg" ] || cfg='{}'
command_str="$(printf '%s' "$cfg" | jq -r '.command')"
mapfile -t cmd < <(printf '%s' "$command_str" \
    | python3 -c 'import shlex,sys; [print(t) for t in shlex.split(sys.stdin.read())]')

"${cmd[@]}" < /dev/null > /dev/null
printf 'pandoc render command (%d tokens) exited 0\n' "${#cmd[@]}"
