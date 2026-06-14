#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pexpect"]
# ///
"""Drive the pandoc renderer's gum configurator through a REAL PTY.

Usage: drive-configure.py <wizard_sh> <config_dir> <home>

This drives the gum wizard DIRECTLY (the kitty popup that the app's "Configure"
action launches is just a thin wrapper around this script). It accepts the
prefilled executable/format and adds no extra args, then expects the wizard's
success marker. gum requires a TTY; pexpect.spawn provides one. Any deviation
(missing wizard, unexpected prompt, nonzero exit) raises and fails loudly.
"""
import os
import sys

import pexpect

if len(sys.argv) != 4:
    raise SystemExit("usage: drive-configure.py <wizard_sh> <config_dir> <home>")

wizard, config_dir, home = sys.argv[1], sys.argv[2], sys.argv[3]

env = dict(os.environ)
env["HOME"] = home
env["TERM"] = "xterm-256color"

child = pexpect.spawn(
    "bash",
    [wizard, config_dir],
    env=env,
    encoding="utf-8",
    timeout=30,
    dimensions=(40, 400),
)
child.logfile_read = sys.stdout

# gum input: pandoc executable, prefilled with the current value -> accept.
child.expect("Pandoc executable")
child.send("\r")

# gum input: input format, prefilled -> accept.
child.expect("(?i)input format")
child.send("\r")

# gum write: extra pandoc arguments -> finish empty with Esc.
child.expect("Extra pandoc")
child.send("\x1b")

# The wizard wrote the updated command and printed its success marker.
child.expect("CONFIGURE_PANDOC_OK")
child.expect(pexpect.EOF)
child.close()
if child.exitstatus != 0:
    raise SystemExit(f"configure-wizard.sh exited {child.exitstatus}")
print("\nCONFIGURE_DRIVE_OK")
