#!/usr/bin/env bash
# Beamer slides PDF export. The generic export firewall invokes:
#   export.sh <file> <artifact>   with cwd = the source file's parent.
# Slides→pdf is the SAME pdf render with the beamer writer + the beamer template;
# self-contained (it owns its pandoc/lualatex invocation). Fails loud.
set -euo pipefail

file="$1"
artifact="$2"

if [ ! -f "$file" ]; then
    echo "beamer-pdf-export/export.sh: source file does not exist: $file" >&2
    exit 1
fi

: "${PANDOC_RESOURCE_PATH:?beamer-pdf-export: PANDOC_RESOURCE_PATH must be set (the global figures dir)}"

# pandoc reads the markdown source and produces a beamer slide-deck PDF via
# lualatex against pandoc's OWN built-in beamer template (no machine-specific
# template file — robust out of the box; a user-supplied beamer template is a
# selector enhancement, not baked here). The source's directory is on the resource
# path so document-relative figures resolve.
exec pandoc \
    "$file" \
    --from=markdown \
    --to=beamer \
    --pdf-engine=lualatex \
    --resource-path "$(dirname "$file"):$PANDOC_RESOURCE_PATH" \
    -o "$artifact"
