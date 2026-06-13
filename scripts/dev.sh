#!/usr/bin/env bash
# dev.sh — the `just dev` entry point.
#
# Like launch.sh (`just run`) it sources the shared config gate
# (lib-recovery.sh): runs the doctor check battery and, on a config-class
# failure, routes into the gum first-run recovery (--force when an invalid
# config already exists, gum confirm guarding the overwrite) BEFORE starting
# the dev server. A stale config (e.g. one predating a schema change) no longer
# dead-ends the dev loop — it is reconfigured in place, then dev starts.
#
# After a valid config is guaranteed, hands off to `tauri dev` (vite + the app
# with hot-reload). The GUI boot under a valid config is what the rest of the
# proof suite exercises; this entry owns the recover-before-dev step.
#
# Fails loudly on every unexpected state (set -euo pipefail).
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib-recovery.sh"

APP_BIN="$(resolve_app_bin)"
ensure_valid_config "$APP_BIN"

echo "Starting tauri dev…"
exec bunx tauri dev
