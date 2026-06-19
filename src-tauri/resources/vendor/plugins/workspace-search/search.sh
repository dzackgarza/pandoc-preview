#!/usr/bin/env bash
# The workspace-search firewall plugin executable (Phase E / E1 / P101+P102).
#
# The app core owns ZERO content-search knowledge: it discovers this plugin and
# runs it by id through the generic plugin firewall (plugins.rs run_plugin),
# exactly as it runs the renderer / lint / export plugins. ALL scanning is the
# REAL ripgrep binary (`rg --json`) — there is NO owned grep or indexer here.
#
# The app contributes the search REQUEST on stdin as JSON:
#   { "root": "<absolute project root>",
#     "scope": "<project-relative subdir, or empty for the whole project>",
#     "patterns": ["term1", "term2", ...] }   // ALL distinct literal terms
#                                             // (positive AND negated) the app's
#                                             // boolean grammar parsed out.
# The app translates Zettlr's boolean grammar (space=AND, |=OR, !=NOT,
# "phrase"=exact) into this flat literal-pattern set and does the per-file
# boolean evaluation + relevancy scoring on the parsed hits; this plugin's sole
# job is to run ripgrep and stream back its structured JSON event stream.
#
# It runs:  rg --json --fixed-strings -e p1 -e p2 ... -- <root>/<scope>
# from cwd=<root>, so the `match` events carry paths the app strips to
# project-relative. The raw `rg --json` event stream (begin/match/end/summary
# objects, one JSON object per line) is written verbatim to stdout; the app
# parses it into structured hits {path, line, col, text} and never sees a
# stringly blob. A missing rg binary is caught at doctor time (the contributed
# [[doctor_checks]] below), and a real rg failure exits nonzero so the firewall
# surfaces it (no silent empty result).
#
# Vendored shipped asset (the canonical copy lives here); scripts/first-run.sh
# and scripts/provision-proof.sh install it into the configured plugins dir
# alongside the pandoc-renderer / lint / export plugins (OSOT).
set -euo pipefail

# The firewall delivers the request on stdin.
request="$(cat)"

# Parse the request with jq (the app emits well-formed JSON; a malformed request
# is a loud jq failure, never a guessed default).
root="$(printf '%s' "$request" | jq -er '.root')"
scope="$(printf '%s' "$request" | jq -er '.scope')"

if [ ! -d "$root" ]; then
    echo "workspace-search: project root is not a directory: $root" >&2
    exit 3
fi

# The patterns become repeated `-e <pat>` args to rg. Read them NUL-safe so a
# pattern containing whitespace stays one argument.
rg_args=(--json --fixed-strings)
while IFS= read -r -d '' pat; do
    rg_args+=(-e "$pat")
done < <(printf '%s' "$request" | jq -j '.patterns[] | (. + "\u0000")')

# At least one pattern is required — an empty query is the app's responsibility
# to short-circuit, so reaching here with none is a loud error.
if [ "${#rg_args[@]}" -eq 2 ]; then
    echo "workspace-search: the request carries no patterns" >&2
    exit 4
fi

# The search path: the scoped subtree relative to the root, or the whole root.
# rg runs from cwd=root so its emitted paths are root-relative; the app strips
# any remaining prefix to render the project-relative result identity.
target="."
if [ -n "$scope" ]; then
    target="$scope"
fi

cd "$root"

# Run the REAL ripgrep. Its exit codes: 0 = matches found, 1 = no matches (a
# legitimate empty result, NOT an error), 2 = a real error. Map 1 -> success
# with an empty stream so "no hits" is distinguished from a broken search; let a
# real error (2) propagate as a loud failure.
set +e
rg "${rg_args[@]}" -- "$target"
status=$?
set -e
if [ "$status" -eq 0 ] || [ "$status" -eq 1 ]; then
    exit 0
fi
echo "workspace-search: ripgrep exited $status" >&2
exit "$status"
