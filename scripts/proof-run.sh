#!/usr/bin/env bash
# The proof entry point (`just proof`). Provisions an isolated environment,
# launches the REAL app on the REAL display, drives it through the plugin
# socket, tears the process group down, aggregates a machine-readable
# artifact into proof-artifacts/.
#
# Usage: proof-run.sh [spec-file ...]   (default: every tests/proof/*.spec.ts)
#
# Hard dependencies (fail loudly if absent): pandoc, lualatex, gum, a real
# display, plus jq/curl/bun/cargo/pgrep/flock.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SOCKET=/tmp/pandoc-preview-playwright.sock
LOCK=/tmp/pandoc-preview-proof.lock
PIDFILE=/tmp/pandoc-preview-proof.pgids
APP_BIN="$REPO_ROOT/src-tauri/target/debug/pandoc-preview"
# The doctor (D-series) obligations assert on the PLAIN user binary as a
# process: stdout/stderr report, exit code, no lingering window. The
# e2e-testing feature is irrelevant to them, so they use a separately-built
# plain binary at a dedicated path that the e2e build never overwrites.
DOCTOR_BIN="$REPO_ROOT/src-tauri/target/debug/doctor/pandoc-preview"
DEV_URL=http://localhost:1420

# ── Singleton: exactly one proof run at a time ─────────────────────
exec 9>"$LOCK"
if ! flock -n 9; then
    echo "FATAL: another proof run holds $LOCK" >&2
    exit 1
fi

# ── Reap process groups left by a crashed previous run ─────────────
if [ -f "$PIDFILE" ]; then
    while read -r stale_pgid; do
        if pgrep -g "$stale_pgid" > /dev/null 2>&1; then
            echo "reaping stale process group $stale_pgid from previous run"
            kill -KILL -- "-$stale_pgid" 2> /dev/null || true
        fi
    done < "$PIDFILE"
    rm -f "$PIDFILE"
fi

# ── Preconditions: real display, real tools ────────────────────────
if [ -z "${WAYLAND_DISPLAY:-}" ] && [ -z "${DISPLAY:-}" ]; then
    echo "FATAL: no WAYLAND_DISPLAY/DISPLAY — proofs run on the real GUI session only" >&2
    exit 1
fi
for tool in jq curl bun cargo pgrep pandoc lualatex gum; do
    if ! command -v "$tool" > /dev/null 2>&1; then
        echo "FATAL: required tool missing: $tool" >&2
        exit 1
    fi
done

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RUNS_ROOT="${TMPDIR:-/tmp}/pandoc-preview-proof-runs/$RUN_ID"
mkdir -p "$RUNS_ROOT" "$REPO_ROOT/proof-artifacts"

# ── Specs ──────────────────────────────────────────────────────────
if [ "$#" -gt 0 ]; then
    SPECS=("$@")
else
    SPECS=()
    while IFS= read -r spec_path; do
        SPECS+=("$(basename "$spec_path")")
    done < <(find tests/proof -maxdepth 1 -name '*.spec.ts' | sort)
fi
if [ "${#SPECS[@]}" -eq 0 ]; then
    echo "FATAL: no proof specs found" >&2
    exit 1
fi

# ── Teardown: group-kill everything we started ─────────────────────
TRACKED_PGIDS=()
kill_group() {
    local pgid="$1"
    kill -TERM -- "-$pgid" 2> /dev/null || true
    for _ in $(seq 1 10); do
        pgrep -g "$pgid" > /dev/null 2>&1 || return 0
        sleep 0.5
    done
    kill -KILL -- "-$pgid" 2> /dev/null || true
    sleep 0.3
    pgrep -g "$pgid" > /dev/null 2>&1 && echo "WARN: process group $pgid survived SIGKILL" >&2
    return 0
}
cleanup() {
    local pgid
    for pgid in "${TRACKED_PGIDS[@]}"; do
        kill_group "$pgid" || true
    done
    rm -f "$PIDFILE" "$SOCKET"
}
trap cleanup EXIT INT TERM

# ── Classify specs: doctor (D-series, process/launcher) vs app (P-series) ─
# D-series specs assert on the plain binary/launcher as a process; they need
# no vite server and no e2e webview bridge. P-series specs drive the real
# webview. We build only what the requested specs require.
HAVE_DOCTOR=0
HAVE_APP=0
for spec in "${SPECS[@]}"; do
    case "$spec" in
    d0[1-5]-*.spec.ts) HAVE_DOCTOR=1 ;;
    *) HAVE_APP=1 ;;
    esac
done

# ── Build the PLAIN user binary for the doctor specs (no e2e feature) ──
# Built into the standard target dir so it reuses the shared dependency
# cache, then copied aside to DOCTOR_BIN BEFORE the e2e build (below)
# overwrites target/debug/pandoc-preview with the feature-gated artifact.
if [ "$HAVE_DOCTOR" -eq 1 ]; then
    mkdir -p "$(dirname "$DOCTOR_BIN")"
    ( cd src-tauri && cargo build )
    if [ ! -x "$APP_BIN" ]; then
        echo "FATAL: plain doctor binary not built at $APP_BIN" >&2
        exit 1
    fi
    cp "$APP_BIN" "$DOCTOR_BIN"
fi

# ── Build the e2e binary + start vite only if app specs are present ────
VITE_PGID=""
if [ "$HAVE_APP" -eq 1 ]; then
    ( cd src-tauri && cargo build --features e2e-testing )
    setsid env VITE_PPE_E2E=1 bun run dev > "$RUNS_ROOT/vite.log" 2>&1 &
    VITE_PGID=$!
    TRACKED_PGIDS+=("$VITE_PGID")
    echo "$VITE_PGID" >> "$PIDFILE"
    for _ in $(seq 1 60); do
        curl -sf "$DEV_URL" > /dev/null 2>&1 && break
        sleep 0.5
    done
    if ! curl -sf "$DEV_URL" > /dev/null 2>&1; then
        echo "FATAL: vite never became ready at $DEV_URL" >&2
        cat "$RUNS_ROOT/vite.log" >&2
        exit 1
    fi
fi

# ── Doctor spec runner: no app launch, no socket. The spec spawns the
# plain binary (or the launcher PTY driver) itself; we only hand it the
# binary path and the per-spec manifest/run dir. The --doctor specs
# (D1/D4/D5) self-terminate (spawnDoctor group-kills on timeout); the
# launcher specs (D2/D3) hand off to the real GUI, reaped below. ─────────
run_doctor_spec() {
    local spec="$1" spec_dir="$2" abs_spec_dir="$3"
    set +e
    PROOF_DOCTOR_BIN="$DOCTOR_BIN" \
        PROOF_RUN_MANIFEST="$spec_dir/manifest.json" \
        PROOF_RUN_DIR="$abs_spec_dir" \
        bun x playwright test --config tests/proof/playwright.config.ts "$spec" \
        > "$spec_dir/playwright.log" 2>&1
    local spec_status=$?
    set -e
    sed -n '1,80p' "$spec_dir/playwright.log"
    # The launcher specs (D2/D3) hand off by exec-ing the real GUI, which
    # lingers as a reparented process after the PTY driver observed the
    # hand-off and exited. Reap any GUI bound to THIS spec's hermetic XDG dir
    # (matched precisely on its unique config path) so lingering hand-off GUIs
    # cannot accumulate and starve the shared display for later specs. Matched
    # by the per-spec XDG path, so it can never touch the real user session.
    reap_handoff_guis "$abs_spec_dir/xdg-config"
    return "$spec_status"
}

# Kill any pandoc-preview process whose environment binds the given hermetic
# XDG_CONFIG_HOME. Precise (per-spec path) and safe (never matches the real
# user config). Used to reap launcher hand-off GUIs after a doctor spec.
reap_handoff_guis() {
    local xdg="$1" pid env_file
    for pid in $(pgrep -f 'target/debug/.*pandoc-preview' 2>/dev/null); do
        env_file="/proc/$pid/environ"
        [ -r "$env_file" ] || continue
        if tr '\0' '\n' < "$env_file" 2>/dev/null | grep -qxF "XDG_CONFIG_HOME=$xdg"; then
            kill -KILL "$pid" 2>/dev/null || true
        fi
    done
}

# ── Per-spec: provision → launch app → drive → assert teardown ─────
OVERALL=passed
run_app_spec() {
    local spec="$1" spec_dir="$2" abs_spec_dir="$3"
    rm -f "$SOCKET"
    setsid env \
        HOME="$abs_spec_dir/home" \
        XDG_STATE_HOME="$abs_spec_dir/xdg-state" \
        XDG_CONFIG_HOME="$abs_spec_dir/xdg-config" \
        XDG_CACHE_HOME="$abs_spec_dir/xdg-cache" \
        "$APP_BIN" > "$spec_dir/app.log" 2>&1 &
    local app_pgid=$!
    TRACKED_PGIDS+=("$app_pgid")
    echo "$app_pgid" >> "$PIDFILE"

    local socket_up=false
    for _ in $(seq 1 60); do
        if [ -S "$SOCKET" ]; then socket_up=true; break; fi
        kill -0 "$app_pgid" 2> /dev/null || break
        sleep 0.5
    done
    if [ "$socket_up" != true ]; then
        echo "FATAL: app socket never appeared for $spec" >&2
        cat "$spec_dir/app.log" >&2
        kill_group "$app_pgid"
        return 2
    fi

    set +e
    PROOF_RUN_MANIFEST="$spec_dir/manifest.json" \
        PROOF_RUN_DIR="$abs_spec_dir" \
        bun x playwright test --config tests/proof/playwright.config.ts "$spec" \
        > "$spec_dir/playwright.log" 2>&1
    local spec_status=$?
    set -e
    sed -n '1,60p' "$spec_dir/playwright.log"
    kill_group "$app_pgid"
    rm -f "$SOCKET"
    return "$spec_status"
}

for spec in "${SPECS[@]}"; do
    spec_name="${spec%.spec.ts}"
    spec_dir="$RUNS_ROOT/$spec_name"
    # P10's config is produced by the real first-run.sh via PTY inside
    # provisioning (before the app launches), so it uses the standard
    # app-launch + socket path like every other spec.
    scripts/provision-proof.sh "$spec_dir" "$spec" "$RUN_ID"
    abs_spec_dir="$(realpath "$spec_dir")"

    # `set -e`-safe status capture: a failing spec must not abort the loop;
    # the per-spec status is recorded and aggregated into the artifact.
    spec_status=0
    case "$spec" in
    d0[1-5]-*.spec.ts)
        run_doctor_spec "$spec" "$spec_dir" "$abs_spec_dir" || spec_status=$?
        ;;
    *)
        run_app_spec "$spec" "$spec_dir" "$abs_spec_dir" || spec_status=$?
        ;;
    esac

    if [ "$spec_status" -ne 0 ]; then
        OVERALL=failed
        echo "FAIL: $spec (status $spec_status)" >&2
    else
        echo "PASS: $spec"
    fi
done

if [ -n "$VITE_PGID" ]; then
    kill_group "$VITE_PGID"
fi
rm -f "$PIDFILE"

# ── Aggregate the artifact ─────────────────────────────────────────
SPEC_ENTRIES="$(
    for spec in "${SPECS[@]}"; do
        spec_dir="$RUNS_ROOT/${spec%.spec.ts}"
        results="/dev/null"; [ -f "$spec_dir/results.json" ] && results="$spec_dir/results.json"
        obs="/dev/null"; [ -f "$spec_dir/observations.json" ] && obs="$spec_dir/observations.json"
        jq -n --arg spec "$spec" \
            --slurpfile results "$results" \
            --slurpfile observations "$obs" \
            '{spec: $spec,
              results: (if ($results|length)>0 then $results[0] else null end),
              observations: (if ($observations|length)>0 then $observations[0] else [] end)}'
    done | jq -s '.'
)"

ARTIFACT="$REPO_ROOT/proof-artifacts/run-$RUN_ID.json"
jq -n \
    --arg runId "$RUN_ID" \
    --arg overall "$OVERALL" \
    --arg waylandDisplay "${WAYLAND_DISPLAY:-}" \
    --arg x11Display "${DISPLAY:-}" \
    --arg pandoc "$(pandoc --version | head -1)" \
    --arg lualatex "$(lualatex --version | head -1)" \
    --arg gum "$(gum --version)" \
    --argjson specs "$SPEC_ENTRIES" \
    '{run_id: $runId, status: $overall,
      display: {wayland: $waylandDisplay, x11: $x11Display},
      versions: {pandoc: $pandoc, lualatex: $lualatex, gum: $gum},
      specs: $specs}' \
    > "$ARTIFACT"

echo "proof artifact: $ARTIFACT"
if [ "$OVERALL" != passed ]; then
    echo "PROOF RUN FAILED" >&2
    exit 1
fi
echo "PROOF RUN PASSED"
