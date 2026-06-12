#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pexpect"]
# ///
"""Drive scripts/first-run.sh through a REAL PTY, answering the gum prompts.

Usage: drive-first-run.py <first_run_sh> <xdg_config_home> <home>

Selects deterministic values the P10 spec asserts against:
  theme=light, font_size=20, line_wrapping=yes, line_numbers=yes,
  debounce_ms=350, math=mathjax, pandoc=<detected>, from=markdown, no extra args.

gum requires a TTY; pexpect.spawn provides one. Any deviation (missing gum,
unexpected prompt, nonzero exit) raises and fails the proof loudly.
"""
import os
import sys

import pexpect

if len(sys.argv) != 4:
    raise SystemExit("usage: drive-first-run.py <first_run_sh> <xdg_config_home> <home>")

first_run, xdg_config_home, home = sys.argv[1], sys.argv[2], sys.argv[3]

env = dict(os.environ)
env["XDG_CONFIG_HOME"] = xdg_config_home
env["HOME"] = home
# gum renders fancier with a known TERM; keep it simple and deterministic.
env["TERM"] = "xterm-256color"

child = pexpect.spawn(
    "bash",
    [first_run, "--force"],
    env=env,
    encoding="utf-8",
    timeout=30,
    dimensions=(40, 120),
)
child.logfile_read = sys.stdout

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

# gum choose: math engine -> move down once (katex -> mathjax), Enter.
child.expect("Math rendering")
child.send("\x1b[B")
child.send("\r")

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
print("\nFIRST_RUN_OK")
