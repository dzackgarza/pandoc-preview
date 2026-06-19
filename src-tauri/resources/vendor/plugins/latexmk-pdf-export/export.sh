#!/usr/bin/env bash
# P108 (Phase F / F2) PDF export driver: pandoc (markdown -> standalone latex)
# then latexmk -lualatex. The plugin firewall invokes it as:
#   export.sh <file> <artifact> <builddir>   with the real editor buffer on stdin
# and this plugin's [plugin.latexmk-pdf-export] config section on
# PPE_PLUGIN_CONFIG as {"command": "..."} (the raw pandoc markdown->latex command,
# mirroring the shipped pandoc-pdf-export contract).
#
# BUILD ISOLATION (F2) is done HERE, by latexmk's OWN native -output-directory
# flag — the build-engine isolation lever lives in this plugin, NOT in the
# build-engine-agnostic app core. The app SUPPLIES the per-run isolated build
# directory as {builddir} (substituted into our argv) and spawns this driver with
# current_dir = the SOURCE FILE'S PARENT. So:
#   - cwd = the source dir, hence the source's document-relative resources
#     (\input{...}, \includegraphics{fig/plot.png}) resolve NATIVELY at compile
#     time, exactly as a hand-run build beside the source would;
#   - latexmk -output-directory="$builddir" routes EVERY intermediate
#     (.aux/.fls/.log/.out/.fdb_latexmk and the build .pdf) INTO the build dir, so
#     none of them land beside the thesis source;
#   - the produced PDF is then copied from the build dir to the app-chosen
#     {artifact} (an absolute path the user selected), so the one-shot export
#     artifact still lands at its chosen location (P8).
# The core injects NO TeX env var (no TEXINPUTS) and does NOT cwd into the build
# dir — it is build-engine-agnostic; the -output-directory mechanism is the
# plugin's.
set -euo pipefail

if [ "$#" -ne 3 ]; then
    echo "latexmk-pdf-export/export.sh: expected <file> <artifact> <builddir>, got $#" >&2
    exit 2
fi

file="$1"
artifact="$2"
builddir="$3"

if [ ! -f "$file" ]; then
    echo "latexmk-pdf-export/export.sh: source file does not exist: $file" >&2
    exit 3
fi
if [ ! -d "$builddir" ]; then
    echo "latexmk-pdf-export/export.sh: app-supplied build dir does not exist: $builddir" >&2
    exit 4
fi

# The raw pandoc command (markdown -> standalone latex), canonical, from this
# plugin's own config section delivered on PPE_PLUGIN_CONFIG.
cfg="$PPE_PLUGIN_CONFIG"
command_str="$(printf '%s' "$cfg" | jq -r '.command')"

# Tokenize the raw command (quotes respected, NO shell expansion) — run it, do not
# interpret it. The first token is the executable (pandoc).
mapfile -t cmd < <(printf '%s' "$command_str" \
    | python3 -c 'import shlex,sys; [print(t) for t in shlex.split(sys.stdin.read())]')

# Produce the .tex INTO the app-supplied build dir (never beside the source), so
# even the generated .tex does not litter the source tree.
base="$(basename "${file%.*}")"
tex="$builddir/${base}.tex"
"${cmd[@]}" "$file" --output "$tex"

# Drive latexmk -lualatex over the produced .tex, routing ALL intermediates into
# the app-supplied build dir via latexmk's native -output-directory flag. We run
# with cwd = the source dir (the core spawned us there), so latexmk's engine
# resolves the document's relative resources (\input/\includegraphics) against the
# source dir while writing .aux/.fls/.log/.out/.fdb_latexmk/.pdf into "$builddir".
# Tell the TeX engine to emit UNWRAPPED log lines (max_print_line large) so each
# diagnostic — notably the persistent "LaTeX Warning: Reference ... undefined on
# input line N." — lands on ONE physical line in the .log. The default 79-column
# wrap splits a warning across lines, which would corrupt both the verbatim
# latex-log line and the log parser's line recovery (P111). This is engine output
# formatting, not command knowledge.
export max_print_line=10000
latexmk -lualatex -interaction=nonstopmode -output-directory="$builddir" "$tex" >/dev/null 2>&1

# Surface the lualatex engine log on this driver's stderr so the app's compile-log
# pane (the P11 raw-log surface) carries the engine's REAL diagnostics — most
# importantly the persistent "LaTeX Warning: Reference ... undefined ..." line a
# multi-pass build cannot resolve (P111). The structured Problems layer parses
# these warnings from the SAME log; a clean build's .log carries none, so no
# phantom warning is fabricated. The .log is the authoritative engine log latexmk
# wrote into the build dir.
enginelog="$builddir/${base}.log"
if [ -f "$enginelog" ]; then
    cat "$enginelog" >&2
fi

# Surface the produced PDF (in the build dir) at the app-chosen {artifact} (an
# absolute path outside the build dir and the source tree).
cp "$builddir/${base}.pdf" "$artifact"
