#!/usr/bin/env bash
# install-assets.sh — install the app's shipped pandoc assets into ~/.pandoc as
# SYMLINKS (Milestone D / Fork 3). The app keeps canonical copies in its vendor
# dir (src-tauri/resources/vendor) and symlinks each into ~/.pandoc so the app
# stays the single source of truth and updates are atomic. A user override — a
# REAL file where a symlink would go — is preserved, never clobbered. Fails loud
# on any real error.
#
# Installs the required HTML-preview filters and the preview template; the macro
# toolchain joins here as later milestones vendor it.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="$REPO_ROOT/src-tauri/resources/vendor"

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

link_dir "$VENDOR/filters" "$HOME/.pandoc/filters"
link_dir "$VENDOR/templates" "$HOME/.pandoc/templates"
# The CSL citation style the preview command resolves citations against (the
# shipped alphabetic, hyperlinked style). A user override is preserved.
link_dir "$VENDOR/csl" "$HOME/.pandoc/csl"
# The default preview bibliography citeproc resolves against. A user override (a
# real ~/.pandoc/bib/references.bib) is preserved, never clobbered.
link_dir "$VENDOR/bib" "$HOME/.pandoc/bib"

# The global figures directory the renderer searches via PANDOC_RESOURCE_PATH.
# The app requires it to exist (the pandoc-resource-path doctor check fails the
# startup gate otherwise); create it if absent. Figure CONTENT is user-owned and
# never vendored, so this only ensures the directory is present, never clobbering
# anything inside it.
mkdir -p "$HOME/.pandoc/figures"
