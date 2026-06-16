#!/usr/bin/env bash
# install-assets.sh — install the pandoc assets into ~/.pandoc as SYMLINKS.
# The pandoc assets (templates, filters, csl, bib) are owned by the pandoc-config
# repo, consumed here at a COMMIT-PINNED version via the git submodule at
# src-tauri/resources/vendor/pandoc-config. This script symlinks each into
# ~/.pandoc so a fresh machine is provisioned from the pinned config; a user
# override — a REAL file where a symlink would go — is preserved, never clobbered
# (so a developer whose ~/.pandoc already IS pandoc-config keeps their live copy).
# Fails loud on any real error.
#
# The pandoc-renderer PLUGIN and the MathJax bundle are app-owned and live under
# the vendor dir / app bundle — they are NOT installed here.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Commit-pinned pandoc-config submodule: the source of truth for pandoc assets.
PANDOC_CONFIG="$REPO_ROOT/src-tauri/resources/vendor/pandoc-config"
if [ ! -d "$PANDOC_CONFIG/templates" ]; then
    echo "FATAL: pandoc-config submodule missing at $PANDOC_CONFIG" >&2
    echo "       run: git submodule update --init src-tauri/resources/vendor/pandoc-config" >&2
    exit 1
fi

# Symlink every file in a vendor subdir into a destination dir, preserving any
# real-file user override (a real file where a symlink would go is left intact).
# -f replaces a stale app-managed symlink atomically; -n replaces an existing
# symlink rather than dereferencing it; absolute targets resolve regardless of cwd.
link_dir() {
    local vendor_subdir="$1" dest="$2"
    if [ ! -d "$vendor_subdir" ]; then
        echo "FATAL: vendor dir missing: $vendor_subdir" >&2
        exit 1
    fi
    mkdir -p "$dest"
    local src name target
    for src in "$vendor_subdir"/*; do
        [ -e "$src" ] || continue
        name="$(basename "$src")"
        target="$dest/$name"
        if [ -e "$target" ] && [ ! -L "$target" ]; then
            echo "preserve (user override): $target"
            continue
        fi
        ln -sfn "$src" "$target"
        echo "linked: $target -> $src"
    done
}

link_dir "$PANDOC_CONFIG/filters" "$HOME/.pandoc/filters"
link_dir "$PANDOC_CONFIG/templates" "$HOME/.pandoc/templates"
# The styles directory the macros explorer pane browses (.sty macro/preamble
# files). A user override is preserved.
link_dir "$PANDOC_CONFIG/styles" "$HOME/.pandoc/styles"
# The CSL citation style the preview command resolves citations against (the
# alphabetic, hyperlinked style). A user override is preserved.
link_dir "$PANDOC_CONFIG/csl" "$HOME/.pandoc/csl"
# The bibliography citeproc resolves against. A user override (a real
# ~/.pandoc/bib/references.bib) is preserved, never clobbered.
link_dir "$PANDOC_CONFIG/bib" "$HOME/.pandoc/bib"

# The global figures directory the renderer searches via PANDOC_RESOURCE_PATH.
# The app requires it to exist (the pandoc-resource-path doctor check fails the
# startup gate otherwise); create it if absent. Figure CONTENT is user-owned and
# never vendored, so this only ensures the directory is present, never clobbering
# anything inside it.
mkdir -p "$HOME/.pandoc/figures"
