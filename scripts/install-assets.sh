#!/usr/bin/env bash
# install-assets.sh — install the app's shipped pandoc assets into ~/.pandoc as
# SYMLINKS (Milestone D / Fork 3). The app keeps canonical copies in its vendor
# dir (src-tauri/resources/vendor) and symlinks each into ~/.pandoc so the app
# stays the single source of truth and updates are atomic. A user override — a
# REAL file where a symlink would go — is preserved, never clobbered. Fails loud
# on any real error.
#
# Currently installs the required HTML-preview filters; templates/macro-toolchain
# join here as later milestones vendor them.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_FILTERS="$REPO_ROOT/src-tauri/resources/vendor/filters"
DEST_FILTERS="$HOME/.pandoc/filters"

if [ ! -d "$VENDOR_FILTERS" ]; then
    echo "FATAL: vendor filters dir missing: $VENDOR_FILTERS" >&2
    exit 1
fi

mkdir -p "$DEST_FILTERS"
for src in "$VENDOR_FILTERS"/*.lua; do
    name="$(basename "$src")"
    target="$DEST_FILTERS/$name"
    if [ -e "$target" ] && [ ! -L "$target" ]; then
        # A real file (not a symlink) is a deliberate user override — preserve it.
        echo "preserve (user override): $target"
        continue
    fi
    # -f replaces a stale app-managed symlink atomically; -n so an existing
    # symlink is replaced rather than dereferenced. Absolute target so it
    # resolves regardless of cwd.
    ln -sfn "$src" "$target"
    echo "linked: $target -> $src"
done
