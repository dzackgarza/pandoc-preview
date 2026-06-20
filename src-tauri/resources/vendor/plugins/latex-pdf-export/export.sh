#!/usr/bin/env bash
# LaTeX → PDF export. The generic export firewall invokes:
#   export.sh <file> <artifact> <builddir>   with cwd = the source file's parent.
# A .tex is already a complete LaTeX document, so this just compiles it with
# latexmk -lualatex — NO pandoc step. Build isolation is latexmk's own
# -output-directory into the app-supplied {builddir} (no intermediates beside the
# source); the produced PDF is copied to the app-chosen {artifact}. Fails loud.
set -euo pipefail

if [ "$#" -ne 3 ]; then
    echo "latex-pdf-export/export.sh: expected <file> <artifact> <builddir>, got $#" >&2
    exit 2
fi
file="$1"
artifact="$2"
builddir="$3"

if [ ! -f "$file" ]; then
    echo "latex-pdf-export/export.sh: source file does not exist: $file" >&2
    exit 3
fi
if [ ! -d "$builddir" ]; then
    echo "latex-pdf-export/export.sh: app-supplied build dir does not exist: $builddir" >&2
    exit 4
fi

# Unwrapped engine log lines so each diagnostic lands on one physical line (the
# log-parser contract, as in latexmk-pdf-export).
export max_print_line=10000

# Compile the .tex directly. cwd = the source dir (the core spawned us there) so
# the document's relative \input/\includegraphics resolve; -output-directory routes
# every intermediate (.aux/.fls/.log/.fdb_latexmk/.pdf) into "$builddir".
base="$(basename "${file%.*}")"
latexmk -lualatex -interaction=nonstopmode -output-directory="$builddir" "$file" >&2

# Surface the produced PDF (in the build dir) at the app-chosen {artifact}.
cp "$builddir/${base}.pdf" "$artifact"
