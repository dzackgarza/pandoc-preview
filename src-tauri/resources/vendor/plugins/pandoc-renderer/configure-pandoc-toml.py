#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["tomlkit"]
# ///
"""Read/update [plugin.pandoc-renderer].command in config.toml, preserving the
rest of the file (comments, formatting). Used by the pandoc renderer's gum
configurator — the plugin owns all pandoc-command knowledge; the app never parses
or edits the command.

Usage:
  configure-pandoc-toml.py read  <config_path>           -> prints "<exe>\t<format>"
  configure-pandoc-toml.py write <config_path> <command> -> sets the command
"""
import shlex
import sys

import tomlkit


def _command(doc):
    return doc["plugin"]["pandoc-renderer"]["command"]


def main():
    if len(sys.argv) < 3:
        raise SystemExit("usage: configure-pandoc-toml.py <read|write> <config_path> [command]")
    action, config_path = sys.argv[1], sys.argv[2]
    with open(config_path, encoding="utf-8") as fh:
        doc = tomlkit.parse(fh.read())

    if action == "read":
        toks = shlex.split(_command(doc))
        exe = toks[0] if toks else "pandoc"
        fmt = "markdown"
        for i, tok in enumerate(toks):
            if tok == "--from" and i + 1 < len(toks):
                fmt = toks[i + 1]
            elif tok.startswith("--from="):
                fmt = tok.split("=", 1)[1]
        sys.stdout.write(f"{exe}\t{fmt}\n")
    elif action == "write":
        if len(sys.argv) != 4:
            raise SystemExit("write requires <command>")
        doc["plugin"]["pandoc-renderer"]["command"] = sys.argv[3]
        with open(config_path, "w", encoding="utf-8") as fh:
            fh.write(tomlkit.dumps(doc))
    else:
        raise SystemExit(f"unknown action {action!r}")


main()
