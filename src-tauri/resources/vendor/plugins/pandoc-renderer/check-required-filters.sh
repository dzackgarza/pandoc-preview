#!/usr/bin/env bash
# Doctor check: every REQUIRED HTML-preview filter resolves in ~/.pandoc/filters.
# A missing required filter is a FATAL validation failure (required-filter-set.md):
# the pandoc renderer is broken without these. The required SET is the pandoc
# plugin's own knowledge (the app owns none of it). Fails loud, naming the missing
# filter(s) on stderr so the doctor report says exactly which is absent.
set -euo pipefail

# utilities.lua is not loaded as a --lua-filter; it is a require dependency of
# tikzcd.lua (loaded via package.path from ~/.pandoc/filters). tikzcd errors at
# load without it, so it is just as required as the filters proper.
REQUIRED=(tikzcd.lua utilities.lua convert_amsthm_envs.lua obsidian_callouts.lua obsidian.lua)
dir="$HOME/.pandoc/filters"

missing=()
for f in "${REQUIRED[@]}"; do
    # -e follows symlinks: an absent file OR a broken symlink both fail.
    [ -e "$dir/$f" ] || missing+=("$f")
done

if [ "${#missing[@]}" -ne 0 ]; then
    echo "missing required filter(s) in $dir: ${missing[*]}" >&2
    exit 1
fi
printf 'all %d required filters present in %s\n' "${#REQUIRED[@]}" "$dir"
