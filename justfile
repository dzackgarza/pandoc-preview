# Pandoc Preview — canonical command surface.

qc-type := "rust"

default:
    @just --list

# Interactive first-time setup: writes the XDG config via gum prompts.
setup:
    scripts/first-run.sh

# Install the app's shipped pandoc assets (filters, …) into ~/.pandoc as symlinks
# from the vendor dir. Idempotent; preserves real-file user overrides.
install-assets:
    scripts/install-assets.sh

# Install JS deps and prefetch crates; hard-fail if required tools are missing.
deps:
    #!/usr/bin/env bash
    set -euo pipefail
    missing=0
    for tool in pandoc gum bun cargo; do
        if ! command -v "$tool" >/dev/null 2>&1; then
            echo "FATAL: required tool missing: $tool" >&2
            missing=1
        fi
    done
    [ "$missing" -eq 0 ] || exit 1
    # The pandoc assets (templates/filters/csl/bib) are a commit-pinned submodule.
    git submodule update --init src-tauri/resources/vendor/pandoc-config
    bun install
    cargo fetch --manifest-path src-tauri/Cargo.toml

# Run the app in dev mode (vite + tauri). Routes config-class doctor failures
# into gum first-run recovery before starting tauri dev (scripts/dev.sh).
dev:
    scripts/dev.sh

# Launch the app through the doctor gate: runs the check battery, routes
# config-class failures into gum first-run, then execs the built binary.
run:
    scripts/launch.sh

# Run the full external proof suite (P1–P11) against the real app on the
# real display. Optionally pass one or more spec filenames.
proof *specs:
    scripts/proof-run.sh {{specs}}

# Build release bundles (deb, rpm, appimage).
build:
    bunx tauri build

typecheck:
    bun run check

# Global QC contract (owned by ~/ai-review-ci): both git hooks run `just test`;
# `test-ci` is the CI variant. Each runs the project's domain check
# (arch-no-pandoc-in-core) before delegating to the global rust QC chain.
test:
    just -f .agents/justfile arch-no-pandoc-in-core
    just -d . -f ~/ai-review-ci/justfiles/rust.just test

test-ci:
    just -f .agents/justfile arch-no-pandoc-in-core
    just -d . -f ~/ai-review-ci/justfiles/rust.just test-ci
