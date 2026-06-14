#!/usr/bin/env bash
# E2E vite bring-up for the proof harness, factored into a sourceable unit so the
# port-ownership guard is testable in isolation (see
# .agents/check-proof-vite-port-guard.sh).
#
# start_e2e_vite launches the VITE_PPE_E2E dev server the proof webview connects
# to and returns its process-group id on stdout. It must guarantee the server
# answering DEV_URL is the one WE started — a stale non-e2e dev server squatting
# the port would answer the readiness probe just the same, but never expose the
# window.__PPE_E2E__ harness, so every preview spec would fail on harness attach
# with the real cause (wrong server) obscured.
#
# Inputs (environment): DEV_URL, VITE_LOG (path for the dev-server log).
# Output: the started process-group id on stdout.
# Failure: prints a FATAL line to stderr and returns nonzero.

start_e2e_vite() {
    setsid env VITE_PPE_E2E=1 bun run dev > "$VITE_LOG" 2>&1 &
    local pgid=$!

    local i
    for i in $(seq 1 60); do
        curl -sf "$DEV_URL" > /dev/null 2>&1 && break
        sleep 0.5
    done
    if ! curl -sf "$DEV_URL" > /dev/null 2>&1; then
        echo "FATAL: vite never became ready at $DEV_URL" >&2
        cat "$VITE_LOG" >&2
        return 1
    fi

    echo "$pgid"
}
