#!/usr/bin/env bash
# Doctor check: the pandoc executable named in this plugin's raw md->tex command
# resolves, is executable, and --version exits 0. The config is the raw command
# STRING on PPE_PLUGIN_CONFIG ({"command": "..."}); the executable is its first
# shlex token. Prints the version banner's first line as this check's detail.
# Fails loudly (nonzero exit) if it cannot run.
set -euo pipefail

cfg="$PPE_PLUGIN_CONFIG"
command_str="$(printf '%s' "$cfg" | jq -er '.command')"
mapfile -t cmd < <(printf '%s' "$command_str" \
    | python3 -c 'import shlex,sys; [print(t) for t in shlex.split(sys.stdin.read())]')

exe="${cmd[0]}"
banner="$("$exe" --version)"
printf '%s\n' "$banner" | head -1
