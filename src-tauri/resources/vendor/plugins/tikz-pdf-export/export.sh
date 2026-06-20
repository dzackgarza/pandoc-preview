#!/usr/bin/env bash
# TikZ → PDF export. The generic export firewall invokes:
#   export.sh <file> <artifact> <builddir>   with cwd = the source file's parent.
# Wraps the .tikz source in the user-owned standalone-tikz.tex template (it owns its
# preamble via \usepackage{dzg-tikz}) at the $body$ marker and compiles it with
# pdflatex into the app-supplied {builddir}; the produced PDF is copied to the
# app-chosen {artifact}. Fails loud.
set -euo pipefail

if [ "$#" -ne 3 ]; then
    echo "tikz-pdf-export/export.sh: expected <file> <artifact> <builddir>, got $#" >&2
    exit 2
fi
file="$1"
artifact="$2"
builddir="$3"

if [ ! -f "$file" ]; then
    echo "tikz-pdf-export/export.sh: source file does not exist: $file" >&2
    exit 3
fi
if [ ! -d "$builddir" ]; then
    echo "tikz-pdf-export/export.sh: app-supplied build dir does not exist: $builddir" >&2
    exit 4
fi

: "${PANDOC_RESOURCE_PATH:?tikz-pdf-export: PANDOC_RESOURCE_PATH must be set (the global figures dir)}"
pandoc_dir="$(dirname "$PANDOC_RESOURCE_PATH")"
template="$pandoc_dir/templates/standalone-tikz.tex"
if [ ! -f "$template" ]; then
    echo "tikz-pdf-export: user-owned template not found: $template" >&2
    exit 5
fi

# Wrap the tikz source in the template at its single $body$ marker line (matching a
# whole line, so a comment that mentions the token is not clobbered).
python3 - "$template" "$file" "$builddir/fig.tex" <<'PY'
import sys

template_path, body_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
template = open(template_path, encoding="utf-8").read()
body = open(body_path, encoding="utf-8").read()
lines = template.splitlines(keepends=True)
slots = [i for i, ln in enumerate(lines) if ln.strip() == "$body$"]
if len(slots) != 1:
    sys.exit(
        "tikz-pdf-export: template must have exactly one $body$ marker line, found "
        f"{len(slots)}: {template_path}"
    )
lines[slots[0]] = body if body.endswith("\n") else body + "\n"
open(out_path, "w", encoding="utf-8").write("".join(lines))
PY

# Compile to PDF. The template owns its preamble; pdflatex resolves dzg-tikz.sty +
# the styles tree via TEXINPUTS (the source dir first, then the centralized styles
# tree); -output-directory routes intermediates into the build dir.
export TEXINPUTS="$(dirname "$file"):$pandoc_dir/styles//::"
pdflatex -interaction=nonstopmode -halt-on-error -output-directory="$builddir" "$builddir/fig.tex" >&2
cp "$builddir/fig.pdf" "$artifact"
