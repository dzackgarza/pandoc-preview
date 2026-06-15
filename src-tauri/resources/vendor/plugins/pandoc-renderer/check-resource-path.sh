#!/usr/bin/env bash
# Doctor check (pandoc-resource-path): the global figures resource directory must
# be configured and present. PANDOC_RESOURCE_PATH (exported by ~/.pathrc) carries
# the directory the preview renderer searches for figures referenced relative to
# the global figures dir (e.g. rendered/fig_X.svg). The app cannot render those
# figures without it, so the startup gate refuses to boot when this check fails —
# surfacing the misconfiguration once, loudly, instead of once per failed render.
#
# Inherits the app process environment (run_doctor_check does not clear it), so it
# observes exactly the PANDOC_RESOURCE_PATH the renderer will see. exit 0 = OK;
# nonzero with a diagnostic on stderr = FAIL.
set -euo pipefail

if [ -z "${PANDOC_RESOURCE_PATH:-}" ]; then
    echo "PANDOC_RESOURCE_PATH is not set (the global figures resource dir; export it from ~/.pathrc)" >&2
    exit 1
fi

# Every entry on the :-separated search path must be an existing directory; a var
# pointing at a missing or mistyped dir would silently drop figures again.
IFS=':' read -ra entries <<< "$PANDOC_RESOURCE_PATH"
for dir in "${entries[@]}"; do
    if [ ! -d "$dir" ]; then
        echo "PANDOC_RESOURCE_PATH entry is not a directory: $dir" >&2
        exit 1
    fi
done

# First non-empty stdout line becomes the doctor detail (run_doctor_check).
echo "PANDOC_RESOURCE_PATH=$PANDOC_RESOURCE_PATH"
