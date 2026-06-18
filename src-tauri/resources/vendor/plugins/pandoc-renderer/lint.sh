#!/usr/bin/env bash
# Static-lint backend (Phase A / P70): the markdown buffer on stdin -> the REAL
# ChkTeX (and lacheck) run on the pandoc-EMITTED transient .tex -> a JSON object
# {tex, records[]} on stdout. The checks are ChkTeX's (delimiter-count / math-mode
# balance); this script only HOSTS them. It lives in the pandoc-renderer plugin
# because that is where pandoc command knowledge lives (the app core owns none —
# the architecture gate forbids pandoc flags in src-tauri/src), so the md->tex
# writer is invoked here, never in the core lint command.
#
# The pandoc binary AND reader are taken from the SAME canonical renderer command
# on PPE_PLUGIN_CONFIG ({"command": "..."}) the HTML preview uses, so there is ONE
# pandoc contract: the binary (token 0) and its --from reader are reused, only the
# writer is swapped to latex (the preview's HTML writer is irrelevant to a lint
# pass). A missing/failed ChkTeX is a LOUD failure (nonzero exit + stderr), never
# an empty record set.
set -euo pipefail

cfg="${PPE_PLUGIN_CONFIG:-}"
[ -n "$cfg" ] || cfg='{}'
command_str="$(printf '%s' "$cfg" | jq -r '.command')"

# The pandoc binary (token 0) and the --from reader, lifted from the canonical
# renderer command so the lint pass reads markdown exactly as the preview does.
read -r pandoc_bin reader < <(printf '%s' "$command_str" | python3 -c '
import shlex, sys
toks = shlex.split(sys.stdin.read())
binary = toks[0]
reader = "markdown"
if "--from" in toks:
    reader = toks[toks.index("--from") + 1]
elif "-f" in toks:
    reader = toks[toks.index("-f") + 1]
print(binary, reader)
')

# The whole markdown buffer (stdin) -> a transient .tex. The reader is the
# preview reader; the writer is latex (this is a LINT pass, not a render).
buffer="$(cat)"
tex="$(printf '%s' "$buffer" | "$pandoc_bin" --from "$reader" --to latex)"

# Run the REAL ChkTeX on the emitted .tex with its machine-readable format
# (line:col:len:kind:number:message), one record per line. ChkTeX exits nonzero
# when it FINDS warnings (the count), which is success for us — `|| true` keeps
# only that expected nonzero from aborting `set -e`; a genuine spawn failure
# (ChkTeX absent) makes `command -v` below fail loud first.
command -v chktex > /dev/null || {
    echo "chktex not found on PATH — the static lint backend requires the real /usr/bin/chktex" >&2
    exit 3
}
# ChkTeX's -f format interprets a literal `\n` as nothing (not a record
# separator), and `$(...)` strips a real trailing newline, so neither produces a
# usable per-record delimiter on its own. Terminate each record with an explicit
# sentinel (\035, an ASCII byte that never appears in a ChkTeX message) and split
# on it below — robust regardless of `:`/quotes inside the message.
fmt='%l:%c:%d:%k:%n:%m'$'\035'
records="$(printf '%s' "$tex" | chktex -q -v0 -f "$fmt" || true)"

# Assemble the JSON the core lint command parses: the emitted tex (for the
# .tex->markdown span anchoring the core performs) and the structured ChkTeX
# records. python builds it so messages with `:` / quotes are encoded safely.
TEX="$tex" RECORDS="$records" python3 <<'PY'
import json, os, sys

tex = os.environ["TEX"]
records = []
for raw in os.environ["RECORDS"].split("\035"):
    raw = raw.strip("\n")
    if not raw.strip():
        continue
    # line:col:len:kind:number:message  — split only the first five colons so a
    # message containing ':' stays intact.
    parts = raw.split(":", 5)
    if len(parts) != 6:
        # A malformed ChkTeX record is a loud failure, never silently dropped.
        sys.stderr.write(f"unparseable chktex record: {raw!r}\n")
        sys.exit(4)
    line, col, length, kind, number, message = parts
    records.append({
        "line": int(line),
        "col": int(col),
        "len": int(length),
        "kind": kind,
        "ruleId": int(number),
        "message": message,
    })

json.dump({"tex": tex, "records": records}, sys.stdout)
PY
