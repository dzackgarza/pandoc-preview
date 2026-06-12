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

# ── Build the e2e binary once, start vite once (with the harness gate) ─
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

    run_app_spec "$spec" "$spec_dir" "$abs_spec_dir"
    spec_status=$?

    if [ "$spec_status" -ne 0 ]; then
        OVERALL=failed
        echo "FAIL: $spec (status $spec_status)" >&2
    else
        echo "PASS: $spec"
    fi
done

kill_group "$VITE_PGID"
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
