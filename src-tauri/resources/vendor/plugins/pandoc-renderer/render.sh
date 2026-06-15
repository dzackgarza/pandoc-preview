#!/usr/bin/env bash
# Pandoc renderer: markdown buffer on stdin -> standalone preview HTML on stdout.
# Milestone C: the plugin config is the RAW pandoc command STRING (canonical), on
# PPE_PLUGIN_CONFIG as {"command": "..."}. render.sh shlex-tokenizes it ONLY to
# exec it (run, not understand) and layers the volatile per-render context the app
# supplies on argv ($1=base_dir, $2=base_url, $3=mathjax). The command itself
# carries the document semantics: reader, writer (html5), --standalone, and
# --embed-resources (so images inline as data: URIs and the webview resolves no
# files). The core sets cwd = base_dir.
set -euo pipefail

base_dir="$1"
base_url="$2"
mathjax="$3"

# The core always sets PPE_PLUGIN_CONFIG; default to an empty object defensively.
cfg="${PPE_PLUGIN_CONFIG:-}"
[ -n "$cfg" ] || cfg='{}'
command_str="$(printf '%s' "$cfg" | jq -r '.command')"

# The global figures directory is owned by the environment (exported by ~/.pathrc
# as PANDOC_RESOURCE_PATH), not stored in the app. Documents reference figures
# relative to it (e.g. rendered/fig_X.svg). Required and fail loud if absent — a
# session that silently dropped every global figure is a bug, not something to
# paper over with a default.
: "${PANDOC_RESOURCE_PATH:?PANDOC_RESOURCE_PATH must be set (global figures resource dir; exported by ~/.pathrc)}"

# Tokenize the raw command with a shlex-class parser (quotes respected, NO shell
# expansion) — run it, do not interpret it. The first token is the executable.
mapfile -t cmd < <(printf '%s' "$command_str" \
    | python3 -c 'import shlex,sys; [print(t) for t in shlex.split(sys.stdin.read())]')

# Layer the volatile per-render context the app supplies: the local MathJax asset
# URL (never a CDN); the resource search path — the open file's directory (so
# document-relative resources resolve) AND the global figures dir from
# PANDOC_RESOURCE_PATH (so figures referenced relative to it, e.g.
# rendered/fig_X.svg, resolve and embed); and a <base> for any reference the
# command does not embed. None of this is stored in the canonical command.
exec "${cmd[@]}" \
    "--mathjax=$mathjax" \
    --resource-path "$base_dir:$PANDOC_RESOURCE_PATH" \
    "--variable=header-includes:<base href=\"$base_url\">"
