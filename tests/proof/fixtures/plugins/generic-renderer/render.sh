#!/usr/bin/env bash
# Generic renderer (renderer-plugin-architecture.md escape hatch): markdown on
# stdin -> standalone HTML on stdout. Deliberately NOT pandoc. It stamps a marker
# (<meta name="rendered-by" content="generic-renderer">) that no pandoc invocation
# emits, so the B1 proof can show the active-renderer abstraction ran THIS renderer
# rather than the hardcoded pandoc path. Rendering is intentionally minimal (the
# escape hatch's contract is "any script md->HTML", not feature parity).
set -euo pipefail

md="$(cat)"

# First ATX heading -> <h1> (guarded; grep exits 1 when absent under set -e).
heading="$(printf '%s\n' "$md" | grep -m1 '^# ' | sed 's/^# //' || true)"

printf '<!DOCTYPE html>\n<html><head><meta charset="utf-8">\n'
printf '<meta name="rendered-by" content="generic-renderer">\n'
printf '</head><body>\n'
if [ -n "$heading" ]; then
    printf '<h1>%s</h1>\n' "$heading"
fi
printf '<pre class="generic-source">%s</pre>\n' "$md"
printf '</body></html>\n'
