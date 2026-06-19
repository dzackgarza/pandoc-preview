#!/usr/bin/env bash
# Doctor check for the workspace-search plugin (Phase E / E1; the A3/d09
# [[doctor_checks]] mechanism): the REAL ripgrep binary this plugin runs MUST be
# present and runnable, and jq (the request parser) MUST be present. A missing rg
# is a LOUD doctor FAIL — never a silent empty search at runtime.
#
# On success the check prints rg's own version banner so the report carries the
# real version the plugin will run (the same discipline pandoc-executable uses).
set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
    echo "workspace-search: jq is not on PATH (the request parser is missing)" >&2
    exit 2
fi

if ! command -v rg >/dev/null 2>&1; then
    echo "workspace-search: ripgrep (rg) is not on PATH (content search cannot run)" >&2
    exit 1
fi

# Surface the real version banner as the OK detail.
rg --version | head -n 1
