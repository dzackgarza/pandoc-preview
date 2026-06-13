#!/usr/bin/env bash
# launch.sh — the `just run` entry point (doctor contract consumer 3).
#
# Sources the shared config gate (lib-recovery.sh): runs the doctor check
# battery and, on a config-class-only failure, routes into the gum first-run
# flow (--force when an invalid config already exists, gum confirm guarding the
# overwrite), then re-runs doctor. Non-config failures (pandoc, lualatex) are
# unrecoverable — ensure_valid_config prints the report and hard-fails. After a
# valid config is guaranteed, execs the app.
#
# Fails loudly on every unexpected state (set -euo pipefail).
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib-recovery.sh"

APP_BIN="$(resolve_app_bin)"
ensure_valid_config "$APP_BIN"

echo "Launching pandoc-preview…"
exec "$APP_BIN"
