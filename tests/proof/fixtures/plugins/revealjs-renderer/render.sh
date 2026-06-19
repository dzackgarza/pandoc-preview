#!/usr/bin/env bash
# Reveal.js slides renderer (Phase F / F6 / P113): markdown buffer on stdin -> a
# standalone reveal.js DECK on stdout. The sibling of pandoc-renderer/render.sh,
# differing ONLY in the pandoc WRITER (the canonical command carries
# `--to revealjs` with `--embed-resources`, not `--to html5`). The plugin config is the RAW
# pandoc command STRING (canonical), on PPE_PLUGIN_CONFIG as {"command": "..."};
# render.sh shlex-tokenizes it ONLY to exec it (run, not understand) and layers the
# volatile per-render context the app supplies on argv ($1=base_dir, $2=base_url,
# $3=mathjax). pandoc's own revealjs writer emits the deck structure
# (<div class="reveal"><div class="slides"><section>…) — this fixture builds NO
# slide renderer. The core sets cwd = base_dir.
set -euo pipefail

base_dir="$1"
base_url="$2"
mathjax="$3"

# The core always sets PPE_PLUGIN_CONFIG to this plugin's config section.
cfg="${PPE_PLUGIN_CONFIG:-}"
[ -n "$cfg" ] || cfg='{}'
command_str="$(printf '%s' "$cfg" | jq -r '.command')"

# Tokenize the raw command with a shlex-class parser (quotes respected, NO shell
# expansion) — run it, do not interpret it. The first token is the executable.
mapfile -t cmd < <(printf '%s' "$command_str" \
    | python3 -c 'import shlex,sys; [print(t) for t in shlex.split(sys.stdin.read())]')

# Layer the volatile per-render context the app supplies: the local MathJax asset
# URL (never a CDN); the resource search path (the open file's directory so
# document-relative resources resolve); a <base> for references the deck does not
# embed; and the page title (pandoc reads stdin, no filename, so the standalone
# writer needs a nonempty title). None of this is stored in the canonical command.
exec "${cmd[@]}" \
    "--mathjax=$mathjax" \
    --resource-path "$base_dir" \
    "--metadata=pagetitle:$(basename "$base_dir")" \
    "--variable=header-includes:<base href=\"$base_url\">"
