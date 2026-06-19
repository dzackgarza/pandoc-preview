#!/usr/bin/env bash
# Picker firewall PICK fixture (P104 / Phase E / E3). The plugin firewall runs it
# (plugins.rs run_plugin, by id) as:
#   pick.sh <config_dir>
# feeding the CANDIDATE LIST on stdin (one candidate per line — the app's command
# catalog for the palette, or the workspace file list for quick-open; each line is
# `<token>` or `<token>\t<label>`, the token being the command id / file path the
# app dispatches on) and reading the chosen candidate LINE off stdout.
#
# A real interactive fzf TUI cannot be driven headless (the same constraint as the
# D-7 diagram-tool GUI launch, P96), so instead of opening a TUI this thin script
# reads its CANDIDATE CHOICES from a config-declared SELECTION FILE (one configured
# token per line) and emits, on stdout, the FIRST stdin candidate line whose token
# equals ANY configured token. The P104 spec configures that selection file and
# asserts the OBSERVABLE downstream effect — the buffer actually folding / the file
# actually opening — proving the app fed the real candidate set through this
# firewall AND ran the returned selection. An app that never runs the picker,
# ignores its stdout, or only lists candidates cannot produce that downstream
# effect.
#
# Both surfaces share ONE selection file: the palette candidate set carries the
# command id (`fold_all`) and never a file path, while the quick-open candidate
# set carries the file path and never `fold_all`. So a file holding BOTH tokens
# deterministically yields the correct pick for each surface from the candidate
# set the app actually fed — without the picker branching on which surface invoked
# it (the surface is implied by the candidate set on stdin).
#
# The configured selection lives in <config_dir>/<basename of the
# `selection_file` config value> — written by provisioning. The plugin receives
# the selection-file BASENAME on PPE_PLUGIN_CONFIG (the same channel
# plugins.rs::run_plugin delivers a plugin's [plugin.<id>] config section on), so
# the app's config — not a hardcoded path — names the file. A missing or empty
# selection, or a configured selection that matches NO candidate, is a LOUD error
# (the app must have fed a real candidate set containing a configured choice).
set -euo pipefail

if [ "$#" -ne 1 ]; then
    echo "recording-picker/pick.sh: expected <config_dir>, got $#" >&2
    exit 2
fi

config_dir="$1"

if [ ! -d "$config_dir" ]; then
    echo "recording-picker/pick.sh: config dir does not exist: $config_dir" >&2
    exit 3
fi

# The [plugin.recording-picker] config section arrives on PPE_PLUGIN_CONFIG as
# JSON (the channel plugins.rs::run_plugin uses for a plugin's own config). It
# declares `selection_file`, the basename of the configured selection file under
# the config dir. A missing config / key is a loud error: the picker must be
# configured with a deterministic selection for the headless proof.
if [ -z "${PPE_PLUGIN_CONFIG:-}" ]; then
    echo "recording-picker/pick.sh: PPE_PLUGIN_CONFIG is empty — no plugin config delivered" >&2
    exit 4
fi
selection_basename="$(printf '%s' "$PPE_PLUGIN_CONFIG" | jq -er '.selection_file')"
selection_path="$config_dir/$selection_basename"

if [ ! -f "$selection_path" ]; then
    echo "recording-picker/pick.sh: configured selection file does not exist: $selection_path" >&2
    exit 5
fi

# Read the configured tokens (one per line) into an array. An empty file is a loud
# error: the picker must be configured with at least one deterministic choice.
mapfile -t configured < "$selection_path"
if [ "${#configured[@]}" -eq 0 ]; then
    echo "recording-picker/pick.sh: configured selection is empty at $selection_path" >&2
    exit 6
fi

# Read the candidate list off stdin and emit the FIRST line whose TOKEN (the text
# before an optional TAB) equals ANY configured token. Emitting a line that was
# actually present on stdin proves the app fed the real candidate set through the
# firewall — the picker cannot return a selection the app never offered.
while IFS= read -r line; do
    token="${line%%$'\t'*}"
    for want in "${configured[@]}"; do
        [ -z "$want" ] && continue
        if [ "$token" = "$want" ]; then
            printf '%s\n' "$line"
            exit 0
        fi
    done
done

# No configured token matched any candidate the app fed in — a loud error, never a
# silent empty pick (which would let a palette that lists NOTHING pass).
echo "recording-picker/pick.sh: no configured selection in $selection_path matched a candidate on stdin" >&2
exit 7
