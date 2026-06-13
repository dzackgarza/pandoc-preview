#!/usr/bin/env bash
# Generic-plugin fixture executable (Milestone A, A1/p19). The plugin firewall
# invokes it as:  run.sh <file> <artifact>  with the real editor buffer on stdin.
#
# It emits a witness DERIVED FROM THE REAL SOURCE so a hardcoded implementation
# (one that ignores the configured argv, runs something fixed, or writes a
# constant) cannot fabricate it: the input's first ATX heading line and the
# SHA-256 of the input's exact bytes. The p19 spec recomputes both independently
# from the real on-disk input and asserts the artifact carries them.
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "witness-tool/run.sh: expected <file> <artifact>, got $#" >&2
    exit 2
fi

file="$1"
artifact="$2"

if [ ! -f "$file" ]; then
    echo "witness-tool/run.sh: source file does not exist: $file" >&2
    exit 3
fi

# First ATX heading line of the real source (the discriminator).
heading="$(grep -m1 '^# ' "$file")"
# SHA-256 of the source's exact bytes (independent of any transformation).
digest="$(sha256sum "$file" | cut -d' ' -f1)"

{
    printf 'WITNESS-TOOL v1\n'
    printf 'heading: %s\n' "$heading"
    printf 'sha256: %s\n' "$digest"
} > "$artifact"
