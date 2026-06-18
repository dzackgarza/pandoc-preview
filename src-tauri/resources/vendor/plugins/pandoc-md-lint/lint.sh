#!/usr/bin/env bash
# pandoc-md-lint tool: the markdown buffer on stdin -> structured diagnostics JSON
# on stdout. The reusable seed of a standalone "pandoc-md-lint" tool.
#
# OUTPUT CONTRACT: a JSON array of {line,col,severity,message,ruleId}, where
# line/col are 1-based coordinates into the MARKDOWN buffer (NOT the transient
# .tex). severity is one of "error"|"warning"|"info"|"hint". The CM6
# @codemirror/lint host (src/lib/editor/lint.ts) resolves (line,col) against the
# live document to a character range and renders the diagnostic.
#
# TWO classes of check, merged into one stream:
#  (a) markdown-native checks this tool OWNS:
#       - MATH-MODE $/$$ BALANCE: an unterminated inline `$` or display `$$` in
#         the MARKDOWN. Pandoc's md->latex writer ESCAPES a lone markdown `$` to
#         a literal `\$`, so the emitted .tex carries no open math zone and
#         chktex's warning 16 ("Mathmode still on") NEVER fires for it. This is a
#         genuinely pandoc-markdown-specific imbalance chktex-on-.tex cannot see;
#         the tool detects it directly on the markdown.
#       - \left/\right DELIMITER BALANCE over the markdown math content: a surplus
#         \left (no matching \right). Counted GLOBALLY across the buffer's math so
#         a closer appended anywhere balances it.
#  (b) interop: pandoc md->tex, then the REAL chktex and lacheck on the emitted
#       .tex for the LaTeX-native warnings (delimiter-count / environment
#       matching), each anchored back to a markdown line and merged.
#
# A missing/failed chktex/lacheck or pandoc is a LOUD failure (nonzero exit +
# stderr), never an empty diagnostic set. The pandoc binary AND --from reader are
# lifted from this plugin's canonical command (PPE_PLUGIN_CONFIG {"command":...})
# so the lint pass reads markdown exactly as the preview does; only the writer is
# swapped to latex (this is a LINT pass, not a render).
set -euo pipefail

cfg="${PPE_PLUGIN_CONFIG:-}"
[ -n "$cfg" ] || cfg='{}'
command_str="$(printf '%s' "$cfg" | jq -r '.command')"

# The typographic ChkTeX warning classes this plugin gates from its config
# section (validated REQUIRED by schema.json, delivered whole on PPE_PLUGIN_CONFIG
# by the generic firewall): operator-as-variable is ChkTeX warning 35
# (`sin`->`\sin`), sub/superscript grouping is ChkTeX warning 25 (`x^10`->`x^{10}`).
# A `false` toggle suppresses its warning number via chktex's `-n <num>` (disable);
# a `true` toggle leaves chktex's default (the class on). A missing/non-boolean
# value is a LOUD config error (jq -e), never a silent default — bad lint config
# fails loud.
operator_as_variable="$(printf '%s' "$cfg" | jq -e -r '.operator_as_variable | if type == "boolean" then tostring else error("operator_as_variable must be a boolean") end')"
script_grouping="$(printf '%s' "$cfg" | jq -e -r '.script_grouping | if type == "boolean" then tostring else error("script_grouping must be a boolean") end')"

# The config-owned house-style user-regex rules (schema REQUIRED `lint_rules`, an
# array of {pattern, message, severity?}). Each rule is rendered into ONE ChkTeX
# `UserWarnRegex` entry (warning 44) in a generated chktexrc — the regex engine is
# ChkTeX's PCRE, NOT a re-authored matcher. A non-array `lint_rules`, or a rule
# missing a string `pattern`/`message`, is a LOUD config error (jq -e), never a
# silent default. The rules are surfaced as a compact JSON array for the renderer.
lint_rules_json="$(printf '%s' "$cfg" | jq -e -c '
  .lint_rules
  | if type != "array" then error("lint_rules must be an array") else . end
  | map(
      if (.pattern | type) != "string" or (.pattern | length) == 0 then error("each lint rule needs a non-empty string pattern")
      elif (.message | type) != "string" or (.message | length) == 0 then error("each lint rule needs a non-empty string message")
      else {pattern: .pattern, message: .message, severity: (.severity // "warning")}
      end
    )')"

# Render the user-regex rules into a chktexrc UserWarnRegex block. ChkTeX's custom
# message is embedded in the pattern as `(?!#<message>)` with the characters
# `"#!=`, spaces, and `{}[]` (when space-adjacent) escaped by `!` per chktexrc(5);
# the PCRE flavor is selected with a `PCRE:` prefix. ChkTeX echoes the message
# verbatim between a fixed `User Regex: ` prefix and a `.` suffix in `%m` (warning
# 44), which the anchoring step below strips back to the declared message. A rule
# whose pattern ChkTeX cannot compile makes chktex print a regex-compilation
# WARNING to stderr; that stderr is inspected after the run and is a LOUD failure.
chktexrc="$(mktemp --suffix=.chktexrc)"
trap 'rm -f "$chktexrc"' EXIT
LINT_RULES_JSON="$lint_rules_json" python3 > "$chktexrc" <<'PY'
import json, os

rules = json.loads(os.environ["LINT_RULES_JSON"])

def escape_message(msg):
    # chktexrc requires `"#!=`, spaces, and `{}[]` to be escaped by a leading `!`.
    out = []
    for ch in msg:
        if ch in '"#!= {}[]':
            out.append("!")
        out.append(ch)
    return "".join(out)

print("UserWarnRegex")
print("{")
for r in rules:
    print(f"    (?!#{escape_message(r['message'])})PCRE:{r['pattern']}")
print("}")
PY

# Build the chktex disable flags for the gated typographic classes. ChkTeX has both
# warnings on by default, so only a `false` toggle contributes a `-n` flag.
chktex_class_flags=()
[ "$operator_as_variable" = "false" ] && chktex_class_flags+=(-n 35)
[ "$script_grouping" = "false" ] && chktex_class_flags+=(-n 25)

# The pandoc binary (token 0) and the --from reader, lifted from the canonical
# command so the md->tex interop reads markdown exactly as the preview does.
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

# The whole markdown buffer on stdin.
buffer="$(cat)"

# The interop half: emit the transient .tex (reader = the preview reader; writer =
# latex), then run the REAL chktex and lacheck on it.
tex="$(printf '%s' "$buffer" | "$pandoc_bin" --from "$reader" --to latex)"

command -v chktex > /dev/null || {
    echo "chktex not found on PATH — the pandoc-md-lint tool wraps the real /usr/bin/chktex" >&2
    exit 3
}
command -v lacheck > /dev/null || {
    echo "lacheck not found on PATH — the pandoc-md-lint tool wraps the real /usr/bin/lacheck" >&2
    exit 4
}

# ChkTeX machine format line:col:len:kind:number:message, one record terminated by
# an \035 sentinel (a byte that never appears in a message) so a `:`/quote inside
# the message cannot break the split. ChkTeX exits nonzero when it FINDS warnings
# (the count) — that is success for us; `|| true` keeps only that expected nonzero
# from aborting set -e (a genuine spawn failure was already caught by command -v).
# `-l "$chktexrc"` LOADS the generated rc carrying the user-regex UserWarnRegex
# block (warning 44). ChkTeX's stderr is captured separately: a user pattern it
# cannot compile is reported there (and chktex still exits 0), so a non-empty
# regex-compilation line in stderr is a LOUD plugin failure — never a silent drop.
chktex_fmt='%l:%c:%d:%k:%n:%m'$'\035'
chktex_stderr="$(mktemp)"
trap 'rm -f "$chktexrc" "$chktex_stderr"' EXIT
chktex_records="$(printf '%s' "$tex" | chktex -q -v0 -l "$chktexrc" "${chktex_class_flags[@]}" -f "$chktex_fmt" 2> "$chktex_stderr" || true)"
if grep -qi 'Compilation of regular expression' "$chktex_stderr"; then
    echo "pandoc-md-lint: a lint_rules pattern failed to compile in the real chktex:" >&2
    cat "$chktex_stderr" >&2
    exit 7
fi
# lacheck reads a FILE, not stdin: write the .tex to a temp file and lint it.
lacheck_tex="$(mktemp --suffix=.tex)"
trap 'rm -f "$chktexrc" "$chktex_stderr" "$lacheck_tex"' EXIT
printf '%s' "$tex" > "$lacheck_tex"
lacheck_records="$(lacheck "$lacheck_tex" || true)"

# Build the merged diagnostics array. The markdown-native checks (math-mode
# balance + \left/\right balance) are computed here on the BUFFER (markdown
# coordinates directly); the chktex/lacheck records are anchored from their .tex
# line back to the markdown line by verbatim content re-derivation (math/delimiter
# content passes through pandoc unchanged) and merged.
BUFFER="$buffer" TEX="$tex" CHKTEX="$chktex_records" \
LACHECK="$lacheck_records" LACHECK_TEX="$lacheck_tex" LINT_RULES_JSON="$lint_rules_json" python3 <<'PY'
import json, os, re, sys

buffer = os.environ["BUFFER"]
tex = os.environ["TEX"]

# 1-based line starts (character offset of each line's first char) so a markdown
# character offset maps to (line, col).
line_starts = [0]
for i, ch in enumerate(buffer):
    if ch == "\n":
        line_starts.append(i + 1)

def offset_to_linecol(off):
    # Binary-search the line whose start is the greatest <= off.
    lo, hi = 0, len(line_starts) - 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if line_starts[mid] <= off:
            lo = mid
        else:
            hi = mid - 1
    return lo + 1, off - line_starts[lo] + 1  # 1-based line, 1-based col

diagnostics = []

# ── (a) markdown-native checks ──────────────────────────────────────────────
# Scan the buffer tracking math-mode state: `$$` toggles a display zone, `$`
# toggles an inline zone (only when not already in a display zone). A `\$` is a
# literal dollar (escaped), not a delimiter. Within ANY open math zone, \left and
# \right are pushed/popped on a single GLOBAL stack so a closer appended anywhere
# balances a surplus opener. At EOF an open zone is an unterminated-math
# diagnostic at its opening `$`/`$$`; a non-empty \left stack is a surplus-\left
# diagnostic at the last unmatched \left.
i = 0
n = len(buffer)
in_display = False          # inside a $$ ... $$ zone
in_inline = False           # inside a $ ... $ zone
zone_open_off = None        # offset of the delimiter that opened the current zone
left_stack = []             # offsets of unmatched \left within math
while i < n:
    ch = buffer[i]
    if ch == "\\":
        # An escaped delimiter or a control sequence. Detect \left / \right when
        # inside math; skip the escaped char so `\$` is never a math toggle.
        if buffer.startswith("\\left", i) and (in_display or in_inline):
            left_stack.append(i)
            i += len("\\left")
            continue
        if buffer.startswith("\\right", i) and (in_display or in_inline):
            if left_stack:
                left_stack.pop()
            i += len("\\right")
            continue
        # Any other backslash escape: skip the backslash and the next char.
        i += 2
        continue
    if ch == "$":
        if buffer.startswith("$$", i):
            if in_inline:
                # A `$$` while an inline zone is open closes it as two `$`: the
                # first closes inline, the second opens a new inline zone. Treat
                # conservatively as toggling inline twice (close then open).
                in_inline = False
                in_inline = True
                zone_open_off = i + 1
                i += 2
                continue
            in_display = not in_display
            if in_display:
                zone_open_off = i
            i += 2
            continue
        # Single `$`.
        if in_display:
            # A lone `$` inside display math is content; ignore.
            i += 1
            continue
        in_inline = not in_inline
        if in_inline:
            zone_open_off = i
        i += 1
        continue
    i += 1

# Unterminated math zone at EOF.
if in_display or in_inline:
    line, col = offset_to_linecol(zone_open_off)
    kind = "display ($$)" if in_display else "inline ($)"
    delim_len = 2 if in_display else 1
    diagnostics.append({
        "line": line,
        "col": col,
        "len": delim_len,
        "severity": "error",
        "message": f"unterminated math mode: {kind} opened here is never closed (dollar delimiter)",
        "ruleId": "md-math-unterminated",
    })

# Surplus \left (no matching \right) anywhere in the buffer's math.
if left_stack:
    off = left_stack[-1]
    line, col = offset_to_linecol(off)
    diagnostics.append({
        "line": line,
        "col": col,
        "len": len("\\left"),
        "severity": "error",
        "message": r"unmatched \left: this \left has no matching \right (unbalanced delimiter)",
        "ruleId": "md-delim-unmatched",
    })

# ── (b) interop: anchor chktex/lacheck .tex diagnostics back to markdown ──────
tex_lines = tex.split("\n")

# Pandoc's md->latex writer rewrites the math-zone delimiters and ONLY them: an
# inline `$...$` becomes `\(...\)` and a display `$$...$$` becomes `\[...\]`, while
# the math CONTENT passes through verbatim. To anchor a .tex line back to the
# markdown buffer we therefore reverse exactly those delimiter rewrites,
# reconstructing the markdown form of the line AND a per-character map from .tex
# column to markdown column (each 2-char `\(`/`\)`/`\[`/`\]` collapses to the
# 1-char `$`/`$$` it came from). chktex reports columns in the .tex; remapping
# through this collapse lands the diagnostic on the SAME token in the markdown
# buffer (e.g. the `sin`/`x^10` inside `$...$`). A line whose reconstructed
# markdown form is not present verbatim in the buffer (pandoc-restructured prose)
# is dropped (returns None) rather than placed on a wrong line.
DELIM_REWRITES = [("\\(", "$"), ("\\)", "$"), ("\\[", "$$"), ("\\]", "$$")]

def reconstruct_markdown_line(text):
    # Walk the .tex line, collapsing each math-delimiter rewrite back to its
    # markdown form. Returns (md_text, texcol_to_mdoffset): the reconstructed
    # markdown line and a list mapping each 1-based .tex column to the 0-based
    # offset into md_text where that .tex character begins.
    md_chars = []
    texcol_to_mdoffset = []  # index by (tex char index); value = md offset
    i = 0
    n = len(text)
    while i < n:
        matched = None
        for tex_delim, md_delim in DELIM_REWRITES:
            if text.startswith(tex_delim, i):
                matched = (tex_delim, md_delim)
                break
        if matched is not None:
            tex_delim, md_delim = matched
            md_start = len(md_chars)
            md_chars.extend(md_delim)
            # Both .tex delimiter chars map to the start of the md delimiter.
            for _ in range(len(tex_delim)):
                texcol_to_mdoffset.append(md_start)
            i += len(tex_delim)
            continue
        texcol_to_mdoffset.append(len(md_chars))
        md_chars.append(text[i])
        i += 1
    return "".join(md_chars), texcol_to_mdoffset

def anchor_tex_line(tex_lineno):
    # Reconstruct the .tex line's markdown form, find it verbatim in the buffer,
    # and return (md_line, buffer_offset_of_line, texcol_to_mdoffset). None when
    # the line is blank or its reconstructed form is not present in the buffer.
    if tex_lineno < 1 or tex_lineno > len(tex_lines):
        return None
    text = tex_lines[tex_lineno - 1]
    if not text.strip():
        return None
    md_text, texcol_to_mdoffset = reconstruct_markdown_line(text)
    off = buffer.find(md_text)
    if off < 0:
        return None
    line, _col = offset_to_linecol(off)
    return line, off, texcol_to_mdoffset

def tex_col_to_md_col(anchored, tex_col):
    # Map a 1-based .tex column to a 1-based markdown column on the anchored line,
    # via the delimiter-collapse offset map. A column past the mapped range (chktex
    # can point one past the last char) clamps to the line end.
    _line, _off, texcol_to_mdoffset = anchored
    idx = tex_col - 1
    if idx < 0:
        idx = 0
    if idx >= len(texcol_to_mdoffset):
        # One-past-the-end: point at the char after the last mapped md offset.
        md_offset = (texcol_to_mdoffset[-1] + 1) if texcol_to_mdoffset else 0
    else:
        md_offset = texcol_to_mdoffset[idx]
    return md_offset + 1

CHKTEX_KIND_SEVERITY = {"Error": "error", "Warning": "warning", "Message": "info"}

# The config-owned user-regex rules, keyed by declared message. ChkTeX warning 44
# (UserWarnRegex) echoes the embedded message between a fixed `User Regex: ` prefix
# and a `.` suffix in `%m`; stripping that wrapper recovers the DECLARED message
# verbatim, which carries the rule's chosen severity. A warning-44 record whose
# recovered message matches no declared rule means our rc-wrapping assumption broke
# — a LOUD failure, never a guessed message.
USER_RULES_BY_MESSAGE = {r["message"]: r for r in json.loads(os.environ["LINT_RULES_JSON"])}
USER_REGEX_PREFIX = "User Regex: "

for raw in os.environ["CHKTEX"].split("\035"):
    raw = raw.strip("\n")
    if not raw.strip():
        continue
    parts = raw.split(":", 5)
    if len(parts) != 6:
        sys.stderr.write(f"unparseable chktex record: {raw!r}\n")
        sys.exit(5)
    tl, tc, length, kind, number, message = parts
    anchored = anchor_tex_line(int(tl))
    if anchored is None:
        continue
    line, _off, _map = anchored
    severity = CHKTEX_KIND_SEVERITY.get(kind)
    if severity is None:
        sys.stderr.write(f"unknown chktex kind: {kind!r}\n")
        sys.exit(6)
    # Warning 44 is a UserWarnRegex hit: recover the DECLARED message (strip the
    # fixed `User Regex: ` prefix and the single `.` chktex appends) and surface it
    # verbatim with the rule's declared severity, not chktex's boilerplate.
    if number == "44":
        if not (message.startswith(USER_REGEX_PREFIX) and message.endswith(".")):
            sys.stderr.write(f"unexpected UserWarnRegex message shape: {message!r}\n")
            sys.exit(8)
        declared = message[len(USER_REGEX_PREFIX):-1]
        rule = USER_RULES_BY_MESSAGE.get(declared)
        if rule is None:
            sys.stderr.write(f"UserWarnRegex hit matched no declared lint rule: {declared!r}\n")
            sys.exit(9)
        message = declared
        severity = rule["severity"]
    diagnostics.append({
        "line": line,
        "col": tex_col_to_md_col(anchored, int(tc)),
        "len": max(int(length), 1),
        "severity": severity,
        "message": message,
        "ruleId": f"chktex:{number}",
    })

# lacheck emits: "filename", line N: message  — one per line. Anchor by line N.
lacheck_re = re.compile(r'^"[^"]*",\s*line\s+(\d+):\s*(.*)$')
for raw in os.environ["LACHECK"].splitlines():
    m = lacheck_re.match(raw.strip())
    if not m:
        continue
    tex_lineno = int(m.group(1))
    message = m.group(2).strip()
    anchored = anchor_tex_line(tex_lineno)
    if anchored is None:
        continue
    line, _off, _map = anchored
    diagnostics.append({
        "line": line,
        "col": 1,
        "len": 1,
        "severity": "warning",
        "message": message,
        "ruleId": "lacheck",
    })

# ── (c) in-document line-scoped suppression (A.4) ────────────────────────────
# An author silences a single intentional lint hit IN THE DOCUMENT with a
# line-scoped directive that names the rule:
#   <!-- ppe-lint-disable-line <ruleId> -->
# placed ON the line it scopes. <ruleId> is the bare ChkTeX warning NUMBER (the
# numeric tail of the diagnostic's `chktex:<number>` ruleId — e.g. `25` for the
# sub/superscript-grouping class surfaced as `chktex:25`). A directive on
# markdown line L removes ONLY diagnostics whose markdown line == L AND whose
# ruleId == `chktex:<that number>`. The same construct on a DIFFERENT line, with
# no directive, is untouched (line-scoped). Removing the directive from the
# buffer (a fresh lint pass with no directive present) restores the diagnostic
# (the suppression is recomputed from the live buffer every pass, never latched).
# This is a thin port of ChkTeX's `% chktex N` suppression to the markdown
# surface — filtering by (line, ruleId), no new suppression engine. The directive
# is an HTML comment, inert to the rendered preview.
DIRECTIVE_RE = re.compile(r"<!--\s*ppe-lint-disable-line\s+(\d+)\s*-->")
suppressions = set()  # (1-based markdown line, ChkTeX warning number string)
for lineno0, line_text in enumerate(buffer.split("\n")):
    for m in DIRECTIVE_RE.finditer(line_text):
        suppressions.add((lineno0 + 1, m.group(1)))

if suppressions:
    def is_suppressed(d):
        rule = d["ruleId"]
        if not rule.startswith("chktex:"):
            return False
        return (d["line"], rule[len("chktex:"):]) in suppressions
    diagnostics = [d for d in diagnostics if not is_suppressed(d)]

json.dump(diagnostics, sys.stdout)
PY
