#!/usr/bin/env bash
# The pandoc renderer's configuration manager (C3). The app launches this in a
# kitty popup (configure.sh); it is also driven directly through a PTY in tests.
# It edits the RAW pandoc command (raw-string-canonical) and LOCKS the required
# HTML-preview filters in — they are always written, regardless of operator input
# (required-filter-set.md). All pandoc knowledge lives here, not in the app.
set -euo pipefail

config_dir="$1"
config_path="$config_dir/config.toml"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
toml="$here/configure-pandoc-toml.py"

# Prefill from the current command (the plugin parses its own command).
IFS=$'\t' read -r cur_exe cur_fmt < <("$toml" read "$config_path")

exe="$(gum input --header "Pandoc executable" --value "$cur_exe")"
[ -n "$exe" ] || {
    echo "FATAL: pandoc executable must not be empty" >&2
    exit 1
}
fmt="$(gum input --header "Input format (--from)" --value "$cur_fmt")"
[ -n "$fmt" ] || {
    echo "FATAL: input format must not be empty" >&2
    exit 1
}
extra_raw="$(gum write --header "Extra pandoc arguments, one per line (Esc to finish, empty for none)" || true)"

# Required HTML-preview filters — LOCKED: always written, never optional
# (required-filter-set.md). tikzcd joins this set in Milestone F (it needs its
# template + env before it can load).
filters_dir="$HOME/.pandoc/filters"
required=(convert_amsthm_envs obsidian_callouts obsidian)
filter_args=""
for f in "${required[@]}"; do
    filter_args+=" --lua-filter=$filters_dir/$f.lua"
done

# Citation pipeline — LOCKED, like the filters: the preview renders preprint-style
# citations (citeproc + the shipped alphabetic CSL, hyperlinked) with a separated
# "References" bibliography. Always written so reconfiguring never silently drops it.
bibliography="$HOME/.pandoc/bib/references.bib"
csl="$HOME/.pandoc/csl/alpha-preview.csl"
citation_args="--citeproc --bibliography=$bibliography --csl=$csl --metadata=link-citations:true --metadata=reference-section-title:References"

extra_args=""
while IFS= read -r line; do
    line="$(printf '%s' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [ -z "$line" ] && continue
    extra_args+=" $line"
done <<<"$extra_raw"

template="$HOME/.pandoc/templates/pandoc_preview_template.html"
command="$exe --from $fmt --to html5 --standalone --embed-resources $citation_args --template=$template$filter_args$extra_args"
"$toml" write "$config_path" "$command"

gum style --bold --foreground 2 "Pandoc renderer command updated."
echo "CONFIGURE_PANDOC_OK"
