#!/usr/bin/env bash
# lib-recovery.sh — shared config gate + recovery for the `just run`
# (launch.sh) and `just dev` (dev.sh) entry points. SOURCED, not executed.
#
# Single source of truth for the doctor-contract recovery (consumer 3): run the
# check battery, and on a config-class-ONLY failure route into the gum
# first-run flow so a missing/stale config never dead-ends an entry point.
#
#   resolve_app_bin
#       Echoes the prebuilt doctor/app binary path (the doctor IS the app
#       binary). FATAL if none is built.
#
#   ensure_valid_config <app_bin>
#       Runs `<app_bin> --doctor`. On success returns 0 (valid config
#       guaranteed). On a config-class-only failure routes into the gum
#       first-run flow — `--force` when an invalid config already exists (gum
#       confirm guarding the overwrite), a fresh run otherwise — then re-runs
#       doctor and returns 0. A non-config failure (pandoc / lualatex) is
#       unrecoverable: prints the report and exits nonzero. Any other
#       unexpected state exits nonzero. All diagnostics go to stderr so the
#       caller's stdout stays clean for the gum TUI / hand-off marker.
#
# The caller decides what happens AFTER a valid config: launch.sh execs the
# binary; dev.sh starts `tauri dev`.

# Repo root relative to THIS file (BASH_SOURCE[0] is lib-recovery.sh even when
# the functions run in a caller that sourced us).
_recovery_repo_root() {
    cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd
}

resolve_app_bin() {
    local repo_root candidate
    repo_root="$(_recovery_repo_root)"
    for candidate in \
        "$repo_root/src-tauri/target/debug/pandoc-preview" \
        "$repo_root/src-tauri/target/release/pandoc-preview"; do
        if [ -x "$candidate" ]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    echo "FATAL: no built pandoc-preview binary found; run 'cargo build' in src-tauri first" >&2
    exit 1
}

ensure_valid_config() {
    local app_bin="$1"
    local repo_root config_dir config_file report status line
    repo_root="$(_recovery_repo_root)"
    config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/pandoc-preview"
    config_file="$config_dir/config.toml"

    set +e
    report="$("$app_bin" --doctor)"
    status=$?
    set -e
    if [ "$status" -eq 0 ]; then
        printf '%s\n' "$report" >&2
        return 0
    fi

    # Classify the failing checks: config-class failures route into
    # reconfiguration; any other failure (pandoc-executable, pandoc-invocation,
    # pdf-engine) is not fixable by reconfiguring.
    local config_class_failed=0 other_failed=0
    while IFS= read -r line; do
        case "$line" in
        "[FAIL] config-exists:"* | "[FAIL] config-schema:"* | "[FAIL] config-values:"*)
            config_class_failed=1
            ;;
        "[FAIL] "*)
            other_failed=1
            ;;
        esac
    done <<<"$report"

    if [ "$other_failed" -eq 1 ]; then
        printf '%s\n' "$report" >&2
        echo "FATAL: doctor reported a non-config failure that reconfiguration cannot fix." >&2
        echo "Resolve the environment (pandoc / lualatex) and retry." >&2
        exit 1
    fi
    if [ "$config_class_failed" -ne 1 ]; then
        printf '%s\n' "$report" >&2
        echo "FATAL: doctor failed but reported no config-class failure to route." >&2
        exit 1
    fi

    # Config-class failure: report to stderr (diagnostics) so stdout stays clean
    # for gum's interactive first-run TUI that follows.
    printf '%s\n' "$report" >&2
    if [ -f "$config_file" ]; then
        if ! gum confirm "Reconfigure and overwrite the invalid config at $config_file?"; then
            echo "FATAL: reconfiguration declined; cannot start with an invalid config." >&2
            exit 1
        fi
        "$repo_root/scripts/first-run.sh" --force
    else
        "$repo_root/scripts/first-run.sh"
    fi

    # Reconfiguration must have produced a valid config.
    set +e
    report="$("$app_bin" --doctor)"
    status=$?
    set -e
    printf '%s\n' "$report" >&2
    if [ "$status" -ne 0 ]; then
        echo "FATAL: doctor still failing after reconfiguration." >&2
        exit 1
    fi
    return 0
}
