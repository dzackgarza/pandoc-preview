#!/usr/bin/env bash
# Doctor check for the recording-picker plugin (P104 / Phase E / E3; the A3
# [[doctor_checks]] mechanism): pick.sh must be present and executable, jq (the
# config parser) must be present, and the REAL fzf binary the production picker
# runs MUST be on PATH. A missing fzf is a LOUD doctor FAIL — never a silent
# no-op picker at runtime.
set -euo pipefail

if [ "$#" -ne 1 ]; then
    echo "recording-picker/check-picker.sh: expected <plugin_dir>, got $#" >&2
    exit 2
fi

plugin_dir="$1"

if [ ! -x "$plugin_dir/pick.sh" ]; then
    echo "recording-picker: pick.sh is missing or not executable in $plugin_dir" >&2
    exit 3
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "recording-picker: jq is not on PATH (the config parser is missing)" >&2
    exit 4
fi

if ! command -v fzf >/dev/null 2>&1; then
    echo "recording-picker: fzf is not on PATH (the interactive picker cannot run)" >&2
    exit 1
fi

# Surface the real fzf version banner as the OK detail.
fzf --version | head -n 1
