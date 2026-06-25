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
    # Pinned submodules: pandoc assets, and the vendored CodeMirror LaTeX fork.
    git submodule update --init src-tauri/resources/vendor/pandoc-config vendor/codemirror-lang-latex
    just vendor-build
    bun install
    cargo fetch --manifest-path src-tauri/Cargo.toml

# Build the vendored CodeMirror LaTeX language fork (Lezer grammar -> dist) so
# its dist/ exists for the file: dependency. Re-run after editing the grammar.
# Clears vite's dep cache so the rebuilt dist is re-optimized (vite does not
# invalidate file: deps on its own).
vendor-build:
    cd vendor/codemirror-lang-latex && bun install && bun run build
    rm -rf node_modules/.vite

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
# The domain check is a repo-owned script (scripts/check-no-pandoc-in-core.sh)
# so it runs on a fresh checkout / in CI without the agent vault: `.agents` is a
# tracked symlink into a private vault that intentionally dangles off-machine.
#
# CI gating (#100): the SUBSTANTIVE tier (`just test` — clippy, rustfmt --check,
# cargo test, bypass scan) is the blocking gate; the STYLE/SLOP tier
# (`just test-style` — complexity, duplication, codeql, semgrep/ast-grep/
# vibecheck/ai-slop) runs advisory (continue-on-error) so style-class findings
# are surfaced without blocking a green check.
test:
    bash scripts/check-no-pandoc-in-core.sh
    just -d . -f ~/ai-review-ci/justfiles/rust.just test

test-ci:
    bash scripts/check-no-pandoc-in-core.sh
    just -d . -f ~/ai-review-ci/justfiles/rust.just test-ci

# Style/slop tier only — the recipes test-ci adds on top of `test`. Run advisory
# in CI (their findings are style-class, non-blocking per #100); run directly to
# inspect them locally.
test-style:
    just -d . -f ~/ai-review-ci/justfiles/rust.just _jscpd _lizard _codeql
    just -d . -f ~/ai-review-ci/justfiles/shared.just _global-qc

# Re-render a draft PR's claim-status block from the live state of the issues it
# claims. The PR body must carry a `<!-- claims: N N -->` marker. Boxes are derived
# from issue open/closed state, never hand-checked; run on push / from CI.
pr-sync pr:
    scripts/pr-sync.py {{pr}}
