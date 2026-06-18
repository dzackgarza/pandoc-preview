#!/usr/bin/env bash
# Pandoc renderer: markdown buffer on stdin -> standalone preview HTML on stdout.
# Milestone C: the plugin config is the RAW pandoc command STRING (canonical), on
# PPE_PLUGIN_CONFIG as {"command": "..."}. render.sh shlex-tokenizes it ONLY to
# exec it (run, not understand) and layers the volatile per-render context the app
# supplies on argv ($1=base_dir, $2=base_url, $3=mathjax, $4=bibliography,
# $5=csl). The command itself
# carries the document semantics: reader, writer (html5), --standalone, and
# --embed-resources (so images inline as data: URIs and the webview resolves no
# files). The core sets cwd = base_dir.
set -euo pipefail

base_dir="$1"
base_url="$2"
mathjax="$3"
# P84/C1: the ONE config-declared citation sources (config.editor.bibliography /
# .csl), forwarded by the app as render context. Layered onto the command as
# --bibliography / --csl exactly as --mathjax is — the canonical command string
# carries --citeproc and the citation metadata but NOT the bib/csl paths.
bibliography="$4"
csl="$5"

# The core always sets PPE_PLUGIN_CONFIG; default to an empty object defensively.
cfg="${PPE_PLUGIN_CONFIG:-}"
[ -n "$cfg" ] || cfg='{}'
command_str="$(printf '%s' "$cfg" | jq -r '.command')"

# Config-exposed style knobs ([plugin.pandoc-renderer.style]). figure_width is
# layered onto the render as a pandoc variable the template applies to images. The
# schema marks it required, so a valid (booted) config always carries it — no
# guard, same as .command above.
figure_width="$(printf '%s' "$cfg" | jq -r '.style.figure_width')"

# Tikz->SVG preview compile env (Phase D / D-0): the canonical command carries
# --lua-filter=.../tikzcd.lua, which compiles each tikzpicture/tikzcd block to a
# PDF (pdflatex) then an SVG (pdf2svg) and inlines the SVG into the preview HTML.
# That filter reads PANDOC_DIR/FIGURES_DIR/SVG_DIR from the environment (not baked
# into the command). The derivation is OSOT in tikz-env.sh, sourced here and by the
# doctor's check-invocation.sh so the filter sees the same env in both paths.
# shellcheck source=tikz-env.sh
. "$(dirname "${BASH_SOURCE[0]}")/tikz-env.sh"

# Tokenize the raw command with a shlex-class parser (quotes respected, NO shell
# expansion) — run it, do not interpret it. The first token is the executable.
mapfile -t cmd < <(printf '%s' "$command_str" \
    | python3 -c 'import shlex,sys; [print(t) for t in shlex.split(sys.stdin.read())]')

# Layer the volatile per-render context the app supplies: the local MathJax asset
# URL (never a CDN); the resource search path — the open file's directory (so
# document-relative resources resolve) AND the global figures dir from
# PANDOC_RESOURCE_PATH (so figures referenced relative to it, e.g.
# rendered/fig_X.svg, resolve and embed); a <base> for any reference the command
# does not embed; and the page title — pandoc reads the buffer on stdin (no
# filename), so without this the standalone writer warns "requires a nonempty
# <title>" every render. pagetitle is the open file's containing folder name
# (base_dir's basename) and is distinct from the document's own title metadata, so
# a title the document declares is never clobbered; and the figure width style knob
# (the template applies it to img max-width). None of this is stored in the
# canonical command. PANDOC_RESOURCE_PATH is guaranteed present here: the startup
# doctor gate (pandoc-resource-path check) refuses to boot the app without it.
exec "${cmd[@]}" \
    "--mathjax=$mathjax" \
    "--bibliography=$bibliography" \
    "--csl=$csl" \
    --resource-path "$base_dir:$PANDOC_RESOURCE_PATH" \
    "--metadata=pagetitle:$(basename "$base_dir")" \
    "--variable=figure-width:$figure_width" \
    "--variable=header-includes:<base href=\"$base_url\">"
