#!/usr/bin/env bash
# Pandoc renderer: markdown buffer on stdin -> standalone preview HTML on stdout.
# This is exactly the argv the app core used to build in render.rs::render_sync,
# now owned by the plugin. Render context is on argv ($1=base_dir, $2=base_url,
# $3=mathjax); the plugin's config (path/from_format/extra_args) arrives as JSON
# on PPE_PLUGIN_CONFIG. The core sets cwd = base_dir.
set -euo pipefail

base_dir="$1"
base_url="$2"
mathjax="$3"

# The core always sets PPE_PLUGIN_CONFIG; default to an empty object defensively.
# (Note: `${VAR:-{}}` is WRONG in bash — it closes at the first `}` and appends a
# stray `}`, breaking the JSON. Assign in two steps.)
cfg="${PPE_PLUGIN_CONFIG:-}"
[ -n "$cfg" ] || cfg='{}'
path="$(printf '%s' "$cfg" | jq -r '.path')"
from_format="$(printf '%s' "$cfg" | jq -r '.from_format')"
mapfile -t extra < <(printf '%s' "$cfg" | jq -r '.extra_args[]?')

# Local MathJax via the asset-protocol URL passed in as render context — never a
# CDN (decision A); --resource-path resolves relative images/includes against the
# open file's directory; the <base> variable lets the srcdoc webview resolve them.
exec "$path" \
    --from "$from_format" \
    --to html5 \
    --standalone \
    "--mathjax=$mathjax" \
    --resource-path "$base_dir" \
    "--variable=header-includes:<base href=\"$base_url\">" \
    "${extra[@]}"
