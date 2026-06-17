#!/usr/bin/env bash
# P12 custom-export fixture executable. It is NOT pandoc: it is an arbitrary
# executable the user wired into the "witness" export-category plugin's
# [exec].command. The point is to prove the export surface runs the configured
# argv verbatim against the REAL source file, not a hard-coded pandoc pipeline.
#
# The plugin firewall (plugins.rs run_plugin_sync) invokes it as:
#   export.sh <file> <artifact>   with the real editor buffer on stdin.
# {file} is the real on-disk source path; {artifact} is the app-provided output.
#
# The output is DERIVED FROM THE INPUT so a hard-coded implementation (one that
# ignores the configured argv, runs pandoc, or writes a fixed string) cannot
# produce it: it embeds the input's first ATX heading line and the SHA-256 of the
# input's exact bytes. The spec recomputes both from the real on-disk input in an
# independent process and asserts the witness file carries them.
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "witness/export.sh: expected <file> <artifact>, got $#" >&2
    exit 2
fi

file="$1"
artifact="$2"

if [ ! -f "$file" ]; then
    echo "witness/export.sh: source file does not exist: $file" >&2
    exit 3
fi

# First ATX heading line of the real input (the unicode discriminator).
heading="$(grep -m1 '^# ' "$file")"
# SHA-256 of the input's exact bytes (independent of any transformation).
digest="$(sha256sum "$file" | cut -d' ' -f1)"

{
    printf 'WITNESS-EXPORT v1\n'
    printf 'heading: %s\n' "$heading"
    printf 'sha256: %s\n' "$digest"
} > "$artifact"
