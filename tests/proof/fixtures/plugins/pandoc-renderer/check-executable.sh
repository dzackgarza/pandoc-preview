#!/usr/bin/env bash
# Doctor check: the pandoc executable named in the canonical command resolves, is
# executable, and `--version` exits 0. Prints the version banner's first line to
# stdout, which the doctor captures as this check's detail (so the report still
# carries the real pandoc version, as the old core pandoc-executable check did).
# Milestone C: the config is the raw command STRING on PPE_PLUGIN_CONFIG
# ({"command": "..."}); the executable is its first shlex token. Fails loudly
# (nonzero exit) if it cannot run — e.g. a non-executable path.
set -euo pipefail

cfg="${PPE_PLUGIN_CONFIG:-}"
[ -n "$cfg" ] || cfg='{}'
command_str="$(printf '%s' "$cfg" | jq -r '.command')"
mapfile -t cmd < <(printf '%s' "$command_str" \
    | python3 -c 'import shlex,sys; [print(t) for t in shlex.split(sys.stdin.read())]')

exe="${cmd[0]}"
banner="$("$exe" --version)"
printf '%s\n' "$banner" | head -1
