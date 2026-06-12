# Pandoc Preview — canonical command surface.

qc-type := "rust"

default:
    @just --list

# Interactive first-time setup: writes the XDG config via gum prompts.
setup:
    scripts/first-run.sh

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
    bun install
    cargo fetch --manifest-path src-tauri/Cargo.toml

# Run the app in dev mode (vite + tauri).
dev:
    bunx tauri dev

# Run the full external proof suite (P1–P11) against the real app on the
# real display. Optionally pass one or more spec filenames.
proof *specs:
    scripts/proof-run.sh {{specs}}

# Build release bundles (deb, rpm, appimage).
build:
    bunx tauri build

typecheck:
    bun run check

# Global QC contract: test-commit is the pre-commit hook chain (no
# CodeQL); test is the full pre-push chain.
test-commit:
    just -f ~/ai/quality-control/justfile-rust test-commit

test:
    just -f ~/ai/quality-control/justfile-rust test

test-ci:
    just -f ~/ai/quality-control/justfile-rust test-ci
