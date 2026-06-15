#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pexpect"]
# ///
"""Drive scripts/launch.sh (the doctor launcher) through a REAL PTY.

Usage: drive-launcher.py <launch_sh> <xdg_config_home> <home> <mode>

The launcher is the `just run` entry point. Per the doctor contract it runs
the doctor check battery, and for config-class failures routes into the gum
first-run flow (`--force` when an invalid config already exists, gum's confirm
guarding the overwrite), then re-runs doctor, then launches the app.

modes:
  no-config   D2: no config present. Launcher's doctor reports config-exists
              failing, routes into the gum first-run flow; we answer the
              prompts with deterministic values, then the app must boot.
  stale-key   D3: a config containing the exact observed stale key
              (`math = "mathjax"`) is present. config-schema fails; the
              launcher must route into gum reconfiguration (with --force,
              guarded by gum confirm) and replace the bad config, then boot.

This driver answers the SAME gum prompts scripts/first-run.sh defines, then
expects the launcher to hand off to the app. gum requires a TTY; pexpect
provides one. Any deviation (missing launcher, unexpected prompt, nonzero
exit, no app handoff) raises and fails the proof loudly — no fallbacks.
"""
import os
import sys

import pexpect

if len(sys.argv) != 5:
    raise SystemExit("usage: drive-launcher.py <launch_sh> <xdg_config_home> <home> <mode>")

launch_sh, xdg_config_home, home, mode = sys.argv[1:5]
if mode not in ("no-config", "stale-key"):
    raise SystemExit(f"unknown mode: {mode!r}")

if not os.path.isfile(launch_sh):
    # The launcher does not exist yet. This is the contract red for D2/D3:
    # the `just run` launcher path is unimplemented. Fail loudly and
    # unmistakably so the spec can assert the missing-launcher reason.
    raise SystemExit(f"LAUNCHER_MISSING: {launch_sh}")

env = dict(os.environ)
env["XDG_CONFIG_HOME"] = xdg_config_home
env["HOME"] = home
# The global figures resource dir, as the GUI session exports it from ~/.pathrc.
# The recovery doctor (run inside launch.sh) requires it (pandoc-resource-path check).
env["PANDOC_RESOURCE_PATH"] = home + "/.pandoc/figures"
env["TERM"] = "xterm-256color"

child = pexpect.spawn(
    "bash",
    [launch_sh],
    env=env,
    encoding="utf-8",
    timeout=30,
    dimensions=(40, 120),
)
child.logfile_read = sys.stdout

if mode == "stale-key":
    # An invalid config exists; the launcher must use the gum confirm guard
    # before overwriting it with --force. Accept the overwrite.
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

# After reconfiguration the launcher must re-run doctor and hand off to the
# app. The app boot is observed by the spec through the plugin socket; here we
# just require the launcher to reach the hand-off without erroring.
child.expect("(?i)launching|starting pandoc-preview|booting")
print("\nLAUNCHER_HANDOFF_OK")
