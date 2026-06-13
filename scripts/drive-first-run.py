#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pexpect"]
# ///
"""Drive scripts/first-run.sh through a REAL PTY, answering the gum prompts.

Usage: drive-first-run.py <first_run_sh> <xdg_config_home> <home> [mode]

modes:
  fresh          (default) P10: no config present. Runs first-run.sh --force
                 and answers the gum prompts; final marker FIRST_RUN_OK.
  over-existing  D6: a config already exists at the hermetic XDG path. Runs
                 first-run.sh as `just setup` does — WITHOUT --force — which
                 must show a gum confirm to OVERWRITE the existing config
                 (instead of the old hard-fail). We accept the overwrite, then
                 answer the same prompts; final marker SETUP_RECONFIGURE_OK.

Selects deterministic values the specs assert against:
  theme=light, font_size=20, line_wrapping=yes, line_numbers=yes,
  debounce_ms=350, pandoc=<detected>, from=markdown, no extra args.

gum requires a TTY; pexpect.spawn provides one. Any deviation (missing gum,
unexpected prompt, nonzero exit) raises and fails the proof loudly.
"""
import os
import sys

import pexpect

if len(sys.argv) not in (4, 5):
    raise SystemExit("usage: drive-first-run.py <first_run_sh> <xdg_config_home> <home> [mode]")

first_run, xdg_config_home, home = sys.argv[1], sys.argv[2], sys.argv[3]
mode = sys.argv[4] if len(sys.argv) == 5 else "fresh"
if mode not in ("fresh", "over-existing"):
    raise SystemExit(f"unknown mode: {mode!r}")

env = dict(os.environ)
env["XDG_CONFIG_HOME"] = xdg_config_home
env["HOME"] = home
# gum renders fancier with a known TERM; keep it simple and deterministic.
env["TERM"] = "xterm-256color"

# `just setup` runs first-run.sh with NO --force; P10's fresh path uses --force
# because no config exists to guard. The over-existing path deliberately omits
# --force to exercise the in-script overwrite confirm.
first_run_args = [first_run] if mode == "over-existing" else [first_run, "--force"]

child = pexpect.spawn(
    "bash",
    first_run_args,
    env=env,
    encoding="utf-8",
    timeout=30,
    dimensions=(40, 120),
)
child.logfile_read = sys.stdout

if mode == "over-existing":
    # A config already exists; `just setup` (no --force) must offer a gum
    # confirm to overwrite it rather than hard-failing. Accept the overwrite.
    child.expect("(?i)overwrite|reconfigure|replace")
    child.send("\r")

# gum choose: UI theme -> move down once (dark -> light), Enter.
child.expect("UI theme")
child.send("\x1b[B")  # down arrow
child.send("\r")

# gum input: font size, default 14 -> clear and type 20.
child.expect("font size")
child.send("\x15")  # Ctrl-U clear line
child.send("20\r")

# gum confirm: soft-wrap (default yes) -> Enter accepts default.
child.expect("Soft-wrap")
child.send("\r")

# gum confirm: line numbers (default yes) -> Enter.
child.expect("line numbers")
child.send("\r")

# gum input: debounce, default 400 -> clear and type 350.
child.expect("debounce")
child.send("\x15")
child.send("350\r")

# gum input: pandoc path, prefilled with detected -> accept.
child.expect("Pandoc executable")
child.send("\r")

# gum input: from format, default markdown -> accept.
child.expect("input format")
child.send("\r")

# gum write: extra args -> finish empty with Esc.
child.expect("Extra pandoc")
child.send("\x1b")

# gum confirm: write config -> Enter (default yes).
child.expect("Write this config")
child.send("\r")

child.expect("Config written to")
child.expect(pexpect.EOF)
child.close()
if child.exitstatus != 0:
    raise SystemExit(f"first-run.sh exited {child.exitstatus}")
print("\nSETUP_RECONFIGURE_OK" if mode == "over-existing" else "\nFIRST_RUN_OK")
