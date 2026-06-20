#!/usr/bin/env bash
# Doctor check (beamer-export-toolchain): the beamer pdf export path is a hard
# dependency. export.sh runs pandoc --to beamer via lualatex against the beamer
# template. This refuses to boot if pandoc or lualatex is absent OR the template is
# missing. No fallback.
set -euo pipefail

missing=()
for tool in pandoc lualatex; do
    command -v "$tool" > /dev/null 2>&1 || missing+=("$tool")
done
if [ "${#missing[@]}" -ne 0 ]; then
    echo "beamer pdf export toolchain incomplete; missing: ${missing[*]} (pandoc --to beamer + lualatex)" >&2
    exit 1
fi

# pandoc's built-in beamer template is used (no machine-specific template file), so
# the only hard deps are pandoc + lualatex, checked above.
echo "beamer export path ready: pandoc=$(command -v pandoc) lualatex=$(command -v lualatex) (pandoc built-in beamer template)"
