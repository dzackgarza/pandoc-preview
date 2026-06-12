#!/usr/bin/env bash
# Custom export plugin used by P12. It is NOT pandoc: it is an arbitrary
# executable that the user wired into [export.witness].command. The whole point
# is to prove the export surface runs the configured argv verbatim against the
# REAL source file, not a hard-coded pandoc pipeline.
#
# Invocation contract (mirrors export-plugins-contract.md placeholder rules):
#   witness-export.sh <input> <output>
# where the configured command array is
#   ["<abs>/witness-export.sh", "{input}", "{output}"]
# and the app substitutes {input}/{output} per-argument.
#
# The output is DERIVED FROM THE INPUT so a hard-coded implementation (one that
# ignores the configured argv, runs pandoc, or writes a fixed string) cannot
# produce it: it embeds the input's first ATX heading line and the SHA-256 of
# the input's exact bytes. The spec recomputes both from the real on-disk input
# in an independent process and asserts the witness file carries them.
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "witness-export.sh: expected <input> <output>, got $#" >&2
    exit 2
fi

input="$1"
output="$2"

if [ ! -f "$input" ]; then
    echo "witness-export.sh: input file does not exist: $input" >&2
    exit 3
fi

# First ATX heading line of the real input (the unicode discriminator).
heading="$(grep -m1 '^# ' "$input")"
# SHA-256 of the input's exact bytes (independent of any transformation).
digest="$(sha256sum "$input" | cut -d' ' -f1)"

{
    printf 'WITNESS-EXPORT v1\n'
    printf 'heading: %s\n' "$heading"
    printf 'sha256: %s\n' "$digest"
} > "$output"
