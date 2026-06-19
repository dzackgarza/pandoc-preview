#!/usr/bin/env bash
# P108 (Phase F / F2) PDF export driver: pandoc (markdown -> standalone latex)
# then latexmk -lualatex. The plugin firewall invokes it as:
#   export.sh <file> <artifact>   with the real editor buffer on stdin and this
# plugin's [plugin.latexmk-pdf-export] config section on PPE_PLUGIN_CONFIG as
# {"command": "..."} (the raw pandoc markdown->latex command, mirroring the shipped
# pandoc-pdf-export contract).
#
# It does NOT choose the build working/output directory: the app core spawns this
# command with a current_dir, and latexmk writes its .aux/.fls/.log/.out/.pdf
# intermediates into THAT directory. Today the core sets current_dir = the source
# file's PARENT (render.rs/plugins.rs), so the intermediates land beside the
# thesis source — the litter P108's F2 isolation must eliminate. The F2 fix routes
# the build into an isolated temp dir (the app supplies the path; the driver's
# native -output-directory/-jobname / the core's current_dir does the isolation),
# and this same driver then writes its intermediates there instead — while the
# {artifact} (an absolute path) still lands at the user-chosen location and
# pandoc resolves the source's document-relative resources (fig/plot.png) against
# the source dir regardless of cwd.
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "latexmk-pdf-export/export.sh: expected <file> <artifact>, got $#" >&2
    exit 2
fi

file="$1"
artifact="$2"

if [ ! -f "$file" ]; then
    echo "latexmk-pdf-export/export.sh: source file does not exist: $file" >&2
    exit 3
fi

# The raw pandoc command (markdown -> standalone latex), canonical, from this
# plugin's own config section delivered on PPE_PLUGIN_CONFIG.
cfg="$PPE_PLUGIN_CONFIG"
command_str="$(printf '%s' "$cfg" | jq -r '.command')"

# Tokenize the raw command (quotes respected, NO shell expansion) — run it, do not
# interpret it. The first token is the executable (pandoc).
mapfile -t cmd < <(printf '%s' "$command_str" \
    | python3 -c 'import shlex,sys; [print(t) for t in shlex.split(sys.stdin.read())]')

# Produce the .tex in the CURRENT working directory (the dir the app core chose as
# current_dir for the build). latexmk's intermediates land alongside it.
base="$(basename "${file%.*}")"
tex="${base}.tex"
"${cmd[@]}" "$file" --output "$tex"

# Drive latexmk -lualatex over the produced .tex in the current working directory.
# latexmk writes ${base}.aux/.fls/.log/.out/.fdb_latexmk/.pdf into CWD.
latexmk -lualatex -interaction=nonstopmode "$tex" >/dev/null 2>&1

# Surface the produced PDF at the app-chosen {artifact} (an absolute path).
cp "${base}.pdf" "$artifact"
