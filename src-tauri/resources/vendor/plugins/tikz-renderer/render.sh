#!/usr/bin/env bash
# tikz renderer: tikz source on stdin -> standalone preview HTML (inline SVG) on
# stdout. The one render primitive applied to a tikz file: wrap the source in the
# user-owned template and compile. The template (~/.pandoc/templates/
# standalone-tikz.tex) OWNS its preamble via \usepackage{dzg-tikz} against the
# centralized styles tree — the app injects nothing. cwd is the open file's dir
# (set by the core); $1 repeats it for the document-relative TEXINPUTS root.
# Fails loud (set -euo pipefail; nonzero exit -> the core marks the render failed
# and surfaces the compile log).
set -euo pipefail

base_dir="$1"
# The user-selected template BASENAME (the render-target selector; default = this
# renderer's manifest default_template, standalone-tikz.tex), resolved against the
# templates dir below.
template_name="$2"

# The installed pandoc config dir (holding templates/ and the styles/ tree) is
# derived from PANDOC_RESOURCE_PATH (the global figures dir), exactly as the html5
# renderer derives it. The startup doctor gate (pandoc-resource-path) guarantees
# the var is set before the app boots, so no default, no guard — fail loud if a
# caller somehow runs without it.
: "${PANDOC_RESOURCE_PATH:?tikz-renderer: PANDOC_RESOURCE_PATH must be set (the global figures dir)}"
pandoc_dir="$(dirname "$PANDOC_RESOURCE_PATH")"
template="$pandoc_dir/templates/$template_name"
if [ ! -f "$template" ]; then
    echo "tikz-renderer: user-owned template not found: $template" >&2
    exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The tikz source the editor is showing, delivered on stdin.
cat > "$work/body.tex"

# Wrap the source in the user-owned template at its single $body$ marker (the
# QTikz TemplateReplaceText model). Direct substitution, not a pandoc reader pass:
# pandoc --from latex DISCARDS a raw tikzpicture, so the source must be inserted
# verbatim. The marker is matched literally, so source carrying $ math passes
# through uninterpreted.
python3 - "$template" "$work/body.tex" "$work/fig.tex" <<'PY'
import sys

template_path, body_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
template = open(template_path, encoding="utf-8").read()
body = open(body_path, encoding="utf-8").read()

# The body marker is a line that is exactly `$body$` (matching the QTikz
# TemplateReplaceText line + pandoc's $body$ convention). Matching the whole line
# — not a bare substring — means a comment that merely mentions the token does not
# get clobbered. Exactly one such line must exist.
lines = template.splitlines(keepends=True)
slots = [i for i, ln in enumerate(lines) if ln.strip() == "$body$"]
if len(slots) != 1:
    sys.exit(
        "tikz-renderer: template must have exactly one $body$ marker line, found "
        f"{len(slots)}: {template_path}"
    )
lines[slots[0]] = body if body.endswith("\n") else body + "\n"
open(out_path, "w", encoding="utf-8").write("".join(lines))
PY

# Compile. The template owns its preamble; pdflatex resolves dzg-tikz.sty and the
# rest of the styles tree via TEXINPUTS (the open file's dir first so a
# document-relative \input/\includegraphics resolves, then the centralized styles
# tree). pdflatex chatter goes to stderr (the compile log) so stdout carries only
# the HTML.
export TEXINPUTS="$base_dir:$pandoc_dir/styles//::"
if ! pdflatex -interaction=nonstopmode -halt-on-error -output-directory="$work" "$work/fig.tex" >&2; then
    echo "tikz-renderer: pdflatex failed compiling the tikz file" >&2
    exit 1
fi
pdf2svg "$work/fig.pdf" "$work/fig.svg"

# Standalone HTML embedding the inline SVG (the RenderResult.html contract, same
# shape the html5 renderer returns into the preview iframe).
printf '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>%s</title></head>\n<body>\n' "$(basename "$base_dir")"
cat "$work/fig.svg"
printf '\n</body></html>\n'
