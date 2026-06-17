#!/usr/bin/env bash
# Export-as-plugin fixture executable (P66). The plugin firewall invokes it as:
#   export.sh <file> <artifact>   with the real editor buffer on stdin.
#
# It emits a witness DERIVED FROM THE REAL SOURCE so a hardcoded implementation
# (one that ignores the configured argv, runs a fixed command, or writes a
# constant) cannot fabricate it: the input's first ATX heading line and the
# SHA-256 of the input's exact bytes.
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "witness-export-plugin/export.sh: expected <file> <artifact>, got $#" >&2
    exit 2
fi

file="$1"
artifact="$2"

if [ ! -f "$file" ]; then
    echo "witness-export-plugin/export.sh: source file does not exist: $file" >&2
    exit 3
fi

heading="$(grep -m1 '^# ' "$file")"
digest="$(sha256sum "$file" | cut -d' ' -f1)"

{
    printf 'WITNESS-EXPORT-PLUGIN v1\n'
    printf 'heading: %s\n' "$heading"
    printf 'sha256: %s\n' "$digest"
} > "$artifact"
