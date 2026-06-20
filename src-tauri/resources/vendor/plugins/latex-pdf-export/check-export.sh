#!/usr/bin/env bash
# Doctor check (latex-pdf-toolchain): the .tex → pdf export needs latexmk + lualatex.
# Refuses to boot if either is absent. No fallback.
set -euo pipefail

missing=()
for tool in latexmk lualatex; do
    command -v "$tool" > /dev/null 2>&1 || missing+=("$tool")
done
if [ "${#missing[@]}" -ne 0 ]; then
    echo "latex pdf export toolchain incomplete; missing: ${missing[*]} (latexmk drives lualatex over the .tex)" >&2
    exit 1
fi

echo "latex pdf export path ready: latexmk=$(command -v latexmk) lualatex=$(command -v lualatex)"
