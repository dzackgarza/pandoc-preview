#!/usr/bin/env bash
# Proof-harness guard (red/green): start_e2e_vite must REJECT a non-proof server
# squatting the dev port, not silently accept it.
#
# Why this exists: a stale `bun run dev` (no VITE_PPE_E2E) answers the readiness
# probe exactly like our e2e server, but never exposes window.__PPE_E2E__. If the
# bring-up accepts it, scripts/proof-run.sh drives a webview with no harness and
# every preview spec fails on `waitForFunction(__PPE_E2E__)` timeout — a real
# failure whose true cause (wrong dev server) is obscured. Observed live on a
# stale dev server occupying :1420.
#
# The test stages a foreign HTTP server on the exact DEV_URL address and asserts
# the bring-up fails loudly instead of returning a pgid.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=scripts/lib/vite-bringup.sh
source "$REPO_ROOT/scripts/lib/vite-bringup.sh"

# A fixed loopback address (not "localhost") so the squatter and the readiness
# probe hit the same endpoint deterministically, independent of IPv4/IPv6
# resolution order.
export DEV_URL="http://127.0.0.1:1420"
export VITE_LOG="$(mktemp)"

squatter=""
vite_pgid=""
cleanup() {
    [ -n "$squatter" ] && kill "$squatter" 2> /dev/null
    [ -n "$vite_pgid" ] && kill -- -"$vite_pgid" 2> /dev/null
    rm -f "$VITE_LOG"
}
trap cleanup EXIT

# The endpoint must be free before the test can stage its squatter there.
if curl -sf "$DEV_URL" > /dev/null 2>&1; then
    echo "SETUP-FATAL: $DEV_URL already answered before the test staged its squatter" >&2
    exit 2
fi

# Stage a non-proof server squatting the dev endpoint.
python3 -m http.server 1420 --bind 127.0.0.1 > /dev/null 2>&1 &
squatter=$!
for _ in $(seq 1 40); do
    curl -sf "$DEV_URL" > /dev/null 2>&1 && break
    sleep 0.1
done
if ! curl -sf "$DEV_URL" > /dev/null 2>&1; then
    echo "SETUP-FATAL: the test squatter never came up on $DEV_URL" >&2
    exit 2
fi

# The bring-up must fail because the endpoint is owned by a foreign process.
vite_pgid="$(start_e2e_vite 2> "$VITE_LOG".err)"
rc=$?

if [ "$rc" -eq 0 ]; then
    echo "FAIL: start_e2e_vite accepted a non-proof server squatting $DEV_URL (returned pgid='$vite_pgid')." >&2
    echo "      proof-run.sh would drive a webview with no window.__PPE_E2E__; preview specs would" >&2
    echo "      fail on harness attach with the real cause hidden." >&2
    exit 1
fi

echo "OK: start_e2e_vite rejected the foreign server squatting $DEV_URL (rc=$rc)."
