#!/usr/bin/env bash
# Doctor check: probe the FULL raw HTML export command (empty stdin) to prove the
# whole invocation contract, not just that the binary exists. The command is the
# raw string on PPE_PLUGIN_CONFIG ({"command": "..."}); run it verbatim
# (shlex-tokenized). Fails loudly if the command cannot run.
set -euo pipefail

cfg="$PPE_PLUGIN_CONFIG"
command_str="$(printf '%s' "$cfg" | jq -r '.command')"
mapfile -t cmd < <(printf '%s' "$command_str" \
    | python3 -c 'import shlex,sys; [print(t) for t in shlex.split(sys.stdin.read())]')

"${cmd[@]}" < /dev/null > /dev/null
printf 'pandoc HTML export command (%d tokens) exited 0\n' "${#cmd[@]}"
