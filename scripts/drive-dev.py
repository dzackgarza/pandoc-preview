#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pexpect"]
# ///
"""Drive scripts/dev.sh (the `just dev` entry) through a REAL PTY.

Usage: drive-dev.py <dev_sh> <xdg_config_home> <home>

`just dev` must route config-class doctor failures into the same gum recovery
that `just run` uses (gum confirm -> first-run --force) BEFORE starting
`tauri dev`. This driver provisions a config-class-INVALID config (the caller
sets one up), runs dev.sh in a PTY, accepts the overwrite confirm, answers the
gum prompts with deterministic values, and requires dev.sh to reach the
hand-off-to-`tauri dev` marker. At that point the config on disk must be the
reconfigured (valid) one; the spec reads it back with an independent process.

`tauri dev` (vite + cargo build, a long-running GUI) is the heavy tail. We do
NOT let it run: the moment dev.sh prints its hand-off marker we SIGKILL the
whole PTY session (pexpect.spawn puts the child in its own session via setsid,
so killing the session-leader pgid reaps dev.sh AND every descendant it had
started). The boot of the GUI under a VALID config is already proved by the
P-series; D7 owns only the recovery-before-dev guarantee.

scripts/dev.sh does not exist yet: this driver prints DEV_MISSING and exits
nonzero — the contract red for D7. Any deviation (unexpected prompt, nonzero
exit, no hand-off) raises and fails the proof loudly. No fallbacks.
"""
import os
import signal
import sys

import pexpect

if len(sys.argv) != 4:
    raise SystemExit("usage: drive-dev.py <dev_sh> <xdg_config_home> <home>")

dev_sh, xdg_config_home, home = sys.argv[1], sys.argv[2], sys.argv[3]

if not os.path.isfile(dev_sh):
    # `just dev` has no recovery entry yet. Contract red for D7: fail loudly
    # and unmistakably so the spec can assert the missing-entry reason.
    raise SystemExit(f"DEV_MISSING: {dev_sh}")

env = dict(os.environ)
env["XDG_CONFIG_HOME"] = xdg_config_home
env["HOME"] = home
# The global figures resource dir, as the GUI session exports it from ~/.pathrc.
# The recovery doctor (run inside dev.sh) requires it (pandoc-resource-path check).
env["PANDOC_RESOURCE_PATH"] = home + "/.pandoc/figures"
env["TERM"] = "xterm-256color"

child = pexpect.spawn(
    "bash",
    [dev_sh],
    env=env,
    encoding="utf-8",
    timeout=30,
    dimensions=(40, 120),
)
child.logfile_read = sys.stdout

# An invalid config exists; dev.sh must use the gum confirm guard before
# reconfiguring it with --force. Accept the overwrite.
child.expect("(?i)overwrite|reconfigure|replace")
child.send("\r")

# gum choose: UI theme -> down once (dark -> light), Enter.
child.expect("UI theme")
child.send("\x1b[B")
child.send("\r")

# gum input: font size -> clear, type 20.
child.expect("font size")
child.send("\x15")
child.send("20\r")

# gum confirm: soft-wrap (default yes).
child.expect("Soft-wrap")
child.send("\r")

# gum confirm: line numbers (default yes).
child.expect("line numbers")
child.send("\r")

# gum input: debounce -> clear, type 350.
child.expect("debounce")
child.send("\x15")
child.send("350\r")

# gum input: pandoc path (prefilled) -> accept.
child.expect("Pandoc executable")
child.send("\r")

# gum input: from format (default markdown) -> accept.
child.expect("input format")
child.send("\r")

# gum write: extra args -> finish empty.
child.expect("Extra pandoc")
child.send("\x1b")

# gum confirm: write config -> Enter (default yes).
child.expect("Write this config")
child.send("\r")

child.expect("Config written to")

# Reconfiguration done; dev.sh must announce the hand-off to `tauri dev`
# instead of dead-ending. Match the dev hand-off marker (distinct from the
# launcher's app hand-off).
child.expect("(?i)starting tauri dev|handing off to tauri dev|dev server")

# Reap the whole session BEFORE `tauri dev` does any real work (vite bind,
# cargo build). pexpect.spawn already called setsid in the child, so the
# child pid is the session/group leader; kill the negative pgid.
os.killpg(os.getpgid(child.pid), signal.SIGKILL)
child.close(force=True)
print("\nDEV_HANDOFF_OK")
