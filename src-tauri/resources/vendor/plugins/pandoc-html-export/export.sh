#!/usr/bin/env bash
# HTML export plugin executable. The plugin firewall invokes it as:
#   export.sh <file> <artifact>   with the real editor buffer on stdin and the
# plugin's [plugin.pandoc-html-export] config section on PPE_PLUGIN_CONFIG as
# {"command": "..."}.
#
# It carries its OWN independent raw pandoc command (ruling 2, 2026-06-17),
# delivered on PPE_PLUGIN_CONFIG (canonical, individually managed). export.sh
# shlex-tokenizes it ONLY to exec it (run, not understand) and layers the volatile
# per-export context: the plugin-LOCAL MathJax bundle (ruling 1 — vendored inside
# this plugin dir, never an AppHandle resource path or a CDN), the real source
# {file} as pandoc's input (so document-relative resources resolve against the
# source dir, which the core sets as cwd, and --embed-resources inlines them as
# data: URIs), and the {artifact} output path. None of this is in core; the app
# core owns no pandoc/export command knowledge.
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "pandoc-html-export/export.sh: expected <file> <artifact>, got $#" >&2
    exit 2
fi

file="$1"
artifact="$2"

if [ ! -f "$file" ]; then
    echo "pandoc-html-export/export.sh: source file does not exist: $file" >&2
    exit 3
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The plugin-LOCAL MathJax bundle (vendored inside this plugin dir). Referenced
# locally so the artifact's math renders with no external network or AppHandle
# resource dependency (ruling 1).
mathjax="$here/mathjax/tex-full-svg-a11y.min.js"

# The raw pandoc command (canonical, from this plugin's own config section). The
# core always sets PPE_PLUGIN_CONFIG to this plugin's [plugin.pandoc-html-export]
# section; the schema marks `command` required, so a booted config always carries
# it.
cfg="$PPE_PLUGIN_CONFIG"
command_str="$(printf '%s' "$cfg" | jq -r '.command')"

# Tokenize the raw command with a shlex-class parser (quotes respected, NO shell
# expansion) — run it, do not interpret it. The first token is the executable.
mapfile -t cmd < <(printf '%s' "$command_str" \
    | python3 -c 'import shlex,sys; [print(t) for t in shlex.split(sys.stdin.read())]')

# Read the real source as input (so fig/plot.png resolves against the source dir
# and --embed-resources inlines it), layer the plugin-local MathJax asset, and
# write the artifact.
exec "${cmd[@]}" \
    "--mathjax=$mathjax" \
    "$file" \
    --output "$artifact"
