#!/usr/bin/env bash
# launch.sh — the `just run` entry point (doctor contract consumer 3).
#
# Runs the doctor check battery. If and only if a config-class check
# (config-exists / config-schema / config-values) fails, routes into the gum
# first-run flow (scripts/first-run.sh), passing --force exactly when a config
# file already exists (an invalid one to be replaced); the gum confirm guards
# that overwrite. Then re-runs doctor and execs the app.
#
# Non-config failures (pandoc, lualatex) are NOT recoverable by reconfiguring:
# the report is printed and the launcher hard-fails. No gum, no fallbacks.
#
# Fails loudly on every unexpected state (set -euo pipefail).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/pandoc-preview"
CONFIG_FILE="$CONFIG_DIR/config.toml"

# Resolve the built app/doctor binary. The doctor report, startup gate, and
# `--doctor` are all the same binary; we use the debug build by preference,
# then release. Building is the caller's job (`just deps` / cargo build).
APP_BIN=""
for candidate in \
    "$REPO_ROOT/src-tauri/target/debug/pandoc-preview" \
    "$REPO_ROOT/src-tauri/target/release/pandoc-preview"; do
    if [ -x "$candidate" ]; then
        APP_BIN="$candidate"
        break
    fi
done
if [ -z "$APP_BIN" ]; then
    echo "FATAL: no built pandoc-preview binary found; run 'cargo build' in src-tauri first" >&2
    exit 1
fi

# Run the doctor battery and capture its report. The binary exits 0 when every
# check passes, 1 otherwise; we keep the report regardless to classify the
# failing checks.
set +e
DOCTOR_REPORT="$("$APP_BIN" --doctor)"
DOCTOR_STATUS=$?
set -e

if [ "$DOCTOR_STATUS" -eq 0 ]; then
    # Every check passed: hand off to the app directly.
    printf '%s\n' "$DOCTOR_REPORT"
    echo "Launching pandoc-preview…"
    exec "$APP_BIN"
fi

# A check failed. Determine whether the failures are exclusively config-class.
# A config-class failure routes into reconfiguration; any other failure
# (pandoc-executable, pandoc-invocation, pdf-engine) is unrecoverable here.
config_class_failed=0
other_failed=0
while IFS= read -r line; do
    case "$line" in
    "[FAIL] config-exists:"* | "[FAIL] config-schema:"* | "[FAIL] config-values:"*)
        config_class_failed=1
        ;;
    "[FAIL] "*)
        other_failed=1
        ;;
    esac
done <<<"$DOCTOR_REPORT"

if [ "$other_failed" -eq 1 ]; then
    # Unrecoverable: print the full report so the user sees exactly what failed,
    # then hard-fail. No gum, no reconfiguration.
    printf '%s\n' "$DOCTOR_REPORT" >&2
    echo "FATAL: doctor reported a non-config failure that reconfiguration cannot fix." >&2
    echo "Resolve the environment (pandoc / lualatex) and retry." >&2
    exit 1
fi

if [ "$config_class_failed" -ne 1 ]; then
    printf '%s\n' "$DOCTOR_REPORT" >&2
    echo "FATAL: doctor failed but reported no config-class failure to route." >&2
    exit 1
fi

# Config-class failure: the report goes to stderr (diagnostics) so the PTY
# stdout stays clean for gum's interactive first-run TUI that follows.
printf '%s\n' "$DOCTOR_REPORT" >&2

# Config-class failure: route into the gum first-run flow. If a config file
# already exists (an invalid one), confirm the overwrite, then run first-run
# with --force. Otherwise run a fresh first-run (no --force).
if [ -f "$CONFIG_FILE" ]; then
    if ! gum confirm "Reconfigure and overwrite the invalid config at $CONFIG_FILE?"; then
        echo "FATAL: reconfiguration declined; cannot start with an invalid config." >&2
        exit 1
    fi
    "$REPO_ROOT/scripts/first-run.sh" --force
else
    "$REPO_ROOT/scripts/first-run.sh"
fi

# Re-run doctor: the reconfiguration must have produced a valid config. Its
# report goes to stderr so stdout carries only the hand-off line.
set +e
RECHECK_REPORT="$("$APP_BIN" --doctor)"
DOCTOR_STATUS=$?
set -e
printf '%s\n' "$RECHECK_REPORT" >&2
if [ "$DOCTOR_STATUS" -ne 0 ]; then
    echo "FATAL: doctor still failing after reconfiguration." >&2
    exit 1
fi

echo "Launching pandoc-preview…"
exec "$APP_BIN"
