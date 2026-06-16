#!/usr/bin/env python3
"""Convert a vim quicktex dict (.vim) into the snippet-map JSON this feature
consumes: a flat object mapping trigger -> CM6 snippet body, with `$0` marking
the final tabstop. Faithful migration of the user's real prose+math snippets."""

import json
import re
import sys

src = open(sys.argv[1]).read()

# Each entry line looks like:  \'trigger' : 'body',   or   \'trigger' : "body",
# Triggers and bodies may be single- or double-quoted. Section dividers map a
# label to 'COMMENT' and are skipped. The leading commented-out line (starts
# with ") is skipped.
entry_re = re.compile(
    r"""^\s*\\?\s*               # optional line-continuation backslash
        (['"])(?P<trig>.*?)\1    # quoted trigger
        \s*:\s*
        (['"])(?P<body>.*?)\3    # quoted body
        \s*,?\s*$""",
    re.VERBOSE,
)

out = {}
for line in src.splitlines():
    if line.lstrip().startswith('"'):  # vim comment line
        continue
    m = entry_re.match(line)
    if not m:
        continue
    trig = m.group("trig")
    body = m.group("body")
    if body == "COMMENT":
        continue
    # Drop pure vim-keystroke macros (navigation/search commands), not text.
    if "\\<ESC>" in body or ":call" in body:
        continue
    # vim string escapes that appear in bodies: \<CR> is a newline, \\ is a
    # literal backslash, \" / \' are the quote chars.
    body = body.replace("\\<CR>", "\n")
    body = body.replace('\\"', '"').replace("\\'", "'")
    # quicktex jump markers -> CM6 tabstops. <+++> is the primary landing
    # (final tabstop $0); <++> are secondary placeholders, dropped (CM6 single
    # final-tabstop bodies). Trailing whitespace after a dropped <++> is kept as
    # authored.
    body = body.replace("<+++>", "$0")
    body = body.replace("<++>", "")
    if trig.strip() == "":
        continue
    out[trig] = body

json.dump(out, sys.stdout, indent=2, ensure_ascii=False)
sys.stdout.write("\n")
sys.stderr.write(f"converted {len(out)} entries\n")
