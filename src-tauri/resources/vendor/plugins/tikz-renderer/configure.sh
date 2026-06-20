#!/usr/bin/env bash
# The tikz renderer plugin's [configure] command. The app spawns this detached
# (it owns no config UI and knows nothing of how the plugin configures itself).
# The tikz renderer has no app-owned config: how a tikz file renders is governed
# entirely by the user-owned template and the styles tree it imports. So
# "configure" opens that template for editing in a kitty popup — the choice of
# kitty/editor is the plugin's, invisible to the app. Editing the template (or the
# styles tree it \usepackage{dzg-tikz} pulls) is the whole configuration surface.
set -euo pipefail

# $1 is {config_dir} (the app's config dir); the template is user-owned and lives
# in the pandoc config dir derived from PANDOC_RESOURCE_PATH (the global figures
# dir), the same path the renderer reads it from. Fail loud if unset.
: "${PANDOC_RESOURCE_PATH:?tikz-renderer configure: PANDOC_RESOURCE_PATH must be set (the global figures dir)}"
template="$(dirname "$PANDOC_RESOURCE_PATH")/templates/standalone-tikz.tex"
if [ ! -f "$template" ]; then
    echo "FATAL: tikz render template missing: $template" >&2
    exit 1
fi

exec kitty --class pandoc-preview-configure -e "${EDITOR:-vi}" "$template"
