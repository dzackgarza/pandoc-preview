#!/usr/bin/env bash
# arXiv bundle export plugin executable — Phase G / G1 (P114). The generic export
# firewall (run_plugin in plugins.rs) invokes it as:
#   export.sh <file> <artifact>   with the real editor buffer on stdin, cwd = the
# source file's parent (so document-relative resources resolve natively), and this
# plugin's [plugin.arxiv-export] config section on PPE_PLUGIN_CONFIG as
# {"command": "<raw pandoc md->tex command>", "macros_dir": "<dzg macro tier dir>"}.
#
# It assembles a SELF-CONTAINED arXiv bundle and tars it to {artifact}:
#   1. pandoc <raw command> renders the real source {file} to a standalone .tex
#      (the app's owned renderer; --to latex passes raw \input/\RR through). The
#      preamble pulls in the dzg-arxiv macro package via --include-in-header.
#   2. latexpand (/usr/bin/latexpand — the canonical LaTeX flattener, leveraged
#      verbatim, NOT a greenfield flattener) FLATTENS every \input/\include of a
#      relative source into ONE root main.tex.
#   3. The dependent macro tier the preamble pulls in is MATERIALIZED by COPYING
#      the REAL macro file(s) out of <macros_dir> into the bundle (the file
#      defining the custom \RR), beside a dzg-arxiv.sty that \input's them; the
#      document's relative resources (figures) are copied alongside at their
#      document-relative paths.
#   4. tar gzips the bundle dir to {artifact}.
# The bundle then compiles to PDF with NO system style files: the macros are in
# the bundle, the section is flattened in, the figures are beside the root .tex.
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "arxiv-export/export.sh: expected <file> <artifact>, got $#" >&2
    exit 2
fi

file="$1"
artifact="$2"

if [ ! -f "$file" ]; then
    echo "arxiv-export/export.sh: source file does not exist: $file" >&2
    exit 3
fi

# The plugin's own config section (canonical): the raw pandoc md->tex command and
# the dzg macro tier source dir. The schema marks both required, so a booted
# config always carries them; a missing one is a loud jq failure below.
cfg="$PPE_PLUGIN_CONFIG"
command_str="$(printf '%s' "$cfg" | jq -er '.command')"
macros_dir="$(printf '%s' "$cfg" | jq -er '.macros_dir')"

if [ ! -d "$macros_dir" ]; then
    echo "arxiv-export/export.sh: macros source dir does not exist: $macros_dir" >&2
    exit 4
fi
# The REAL macro tier the preamble pulls in: it defines the document's custom
# macros (e.g. \RR). A missing tier is a loud failure — the bundle would not be
# self-contained.
macro_tier="$macros_dir/tier1-mathjax-simple.tex"
if [ ! -f "$macro_tier" ]; then
    echo "arxiv-export/export.sh: macro tier missing: $macro_tier" >&2
    exit 5
fi

# Tokenize the raw pandoc command with a shlex-class parser (quotes respected, NO
# shell expansion) — run it, do not interpret it. The first token is the pandoc
# executable; the command carries --from/--to latex/--standalone.
mapfile -t cmd < <(printf '%s' "$command_str" \
    | python3 -c 'import shlex,sys; [print(t) for t in shlex.split(sys.stdin.read())]')

# Stage the bundle under a private temp dir so partial state never lands beside
# the artifact. The bundle root is a single top-level folder the tar carries.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
bundle="$work/arxiv-bundle"
mkdir -p "$bundle"

# The macro PACKAGE the document's preamble pulls in. It REQUIRES the system
# math packages (amsmath/amssymb/amsthm — present in any TeX install, NOT personal
# styles) then \input's the REAL materialized macro tier. The root .tex
# \usepackage's it; latexpand leaves \usepackage alone, and the empty-TEXMFHOME
# compile finds dzg-arxiv.sty in the bundle (no system dzg styles needed).
#
# The materialized macro tier lives under macros/ (a subdir), NOT beside the root
# main.tex: the bundle's ROOT document must be the single shallowest .tex, so the
# copied .tex macro file sits one level deeper. dzg-arxiv.sty (a .sty, not a .tex)
# \input's it by its bundle-relative path.
mkdir -p "$bundle/macros"
cp "$macro_tier" "$bundle/macros/tier1-mathjax-simple.tex"
cat > "$bundle/dzg-arxiv.sty" <<'STY_EOF'
\NeedsTeXFormat{LaTeX2e}
\ProvidesPackage{dzg-arxiv}[2026/06/19 arXiv self-contained dzg macro package]
% System math packages (present in any TeX install, not personal styles).
\RequirePackage{amsmath}
\RequirePackage{amssymb}
\RequirePackage{amsthm}
\RequirePackage{graphicx}
% The REAL dzg macro tier, materialized under macros/ in the bundle.
\input{macros/tier1-mathjax-simple}
\endinput
STY_EOF

# Header injected into pandoc's standalone preamble: pull in the materialized
# macro package so the custom macros (e.g. \RR) resolve under the empty TEXMFHOME.
header="$work/header.tex"
printf '\\usepackage{dzg-arxiv}\n' > "$header"

# ── 1. pandoc md->tex (the app's owned renderer) ──────────────────────────────
# Render the real {file} to a standalone .tex. --to latex passes the raw \input /
# \RR through verbatim. The source dir is cwd (the core sets it), so document-
# relative resources are referenced by their relative paths in the emitted .tex.
#
# --natbib selects pandoc's BibTeX citation driver: a pandoc citation `[@key]` is
# emitted as a `\cite`/`\citep{key}` command (NOT resolved inline) and natbib is
# pulled into the preamble, so the citation is left for latexmk's BibTeX pass
# (step 4) to resolve into the baked `.bbl`. Without it, pandoc would print the
# citation as literal text and BibTeX would see no `\citation`, baking an EMPTY
# `.bbl`. The `\bibliography{...}` the document carries is the BibTeX driver
# latexmk needs; --natbib leaves it in place.
preflat="$work/pre-flat.tex"
"${cmd[@]}" --natbib "$file" --include-in-header="$header" --output "$preflat"

# ── 2. latexpand flatten into ONE root main.tex ───────────────────────────────
# latexpand resolves every relative \input/\include against cwd (the source dir)
# and inlines it; \usepackage/\RequirePackage are NOT flattened. The result is the
# self-contained bundle root.
latexpand "$preflat" > "$bundle/main.tex"

# ── 3. Materialize the document's relative figure + bibliography resources ────
# Copy every relative \includegraphics target AND every \bibliography{...} target
# referenced by the flattened root into the bundle at its document-relative path,
# so the no-system-styles compile finds the figures beside the root .tex and
# latexmk's BibTeX pass (step 4) resolves \bibliography{references} against the
# bundle-root references.bib. Paths are read off the REAL root .tex.
# The sentinel records whether the flattened root carries a \bibliography{...}
# BibTeX driver — the document's REAL shape, read off the root .tex. It exists iff
# the document has a bibliography, which gates the .bbl bake (step 4) below.
bibflag="$work/has-bibliography"
python3 - "$bundle/main.tex" "$PWD" "$bundle" "$bibflag" <<'PY_EOF'
import os, re, shutil, sys
root_tex, src_dir, bundle, bibflag = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
body = open(root_tex, encoding="utf-8").read()
# \includegraphics[...]{path} — capture the path argument.
for m in re.finditer(r"\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}", body):
    rel = m.group(1)
    if os.path.isabs(rel):
        continue
    src = os.path.join(src_dir, rel)
    if not os.path.isfile(src):
        # A figure the document references but that is absent on disk is a loud
        # failure: the bundle would not compile.
        sys.stderr.write(f"arxiv-export: referenced figure missing: {src}\n")
        sys.exit(6)
    dst = os.path.join(bundle, rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(src, dst)
# \bibliography{names} — comma-separated bib basenames (the BibTeX driver). Copy
# each named <name>.bib from the source dir into the bundle so latexmk's BibTeX
# pass resolves it from the bundle root; a NAMED-but-absent .bib is a loud failure
# (no .bbl could be baked). Record the sentinel iff a driver is present.
has_bib = False
for m in re.finditer(r"\\bibliography\{([^}]+)\}", body):
    for name in m.group(1).split(","):
        name = name.strip()
        if not name:
            continue
        rel = name if name.endswith(".bib") else name + ".bib"
        if os.path.isabs(rel):
            continue
        src = os.path.join(src_dir, rel)
        if not os.path.isfile(src):
            sys.stderr.write(f"arxiv-export: referenced bibliography missing: {src}\n")
            sys.exit(7)
        dst = os.path.join(bundle, rel)
        os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
        shutil.copyfile(src, dst)
        has_bib = True
if has_bib:
    open(bibflag, "w").close()
PY_EOF

# ── 4. Bake the .bbl via the REAL latexmk multi-pass BibTeX build ──────────────
# Only when the document carries a \bibliography{...} BibTeX driver (the sentinel
# from step 3). A document WITHOUT a bibliography has no .bbl to bake and no .bib
# to delete — that is the document's real shape, not a skipped edge case.
#
# Run /usr/bin/latexmk -pdf on the bundle root main.tex (cwd = the bundle), so
# latexmk drives the LaTeX + BibTeX passes itself and writes its OWN intermediate
# main.bbl into the bundle. The plugin owns NO bibliography processing — it
# leverages latexmk's own .bbl. The jobname is the root .tex basename (main), so
# latexmk's .bbl is already main.bbl (the name arXiv reads). max_print_line wide
# so engine log lines are not wrapped (mirrors the F3 latexmk driver).
mainstem="$(basename "$bundle/main.tex" .tex)"
if [ -f "$bibflag" ]; then
    export max_print_line=10000
    # Run latexmk in the bundle; surface its engine log on stderr (the app's
    # compile-log surface) so a failed bake carries the REAL engine diagnostics. A
    # nonzero latexmk exit is tolerated ONLY long enough to reach the explicit .bbl
    # assertion below — which fails loud if the BibTeX pass produced no .bbl.
    latexmk_rc=0
    ( cd "$bundle" && latexmk -pdf -interaction=nonstopmode "$mainstem.tex" ) >&2 || latexmk_rc=$?

    # latexmk's own intermediate .bbl must exist — the citation resolved into it. A
    # missing .bbl is a loud failure: the BibTeX pass never produced the resolved
    # bibliography, so the bundle would carry an unresolved citation.
    if [ ! -f "$bundle/$mainstem.bbl" ]; then
        echo "arxiv-export/export.sh: latexmk (rc=$latexmk_rc) produced no $mainstem.bbl in the bundle" >&2
        exit 8
    fi

    # arXiv compiles from the .bbl directly and a leftover required .bib BLOCKS
    # submission — delete every .bib from the bundle now that the .bbl is baked.
    find "$bundle" -name '*.bib' -delete

    # Strip latexmk's other build intermediates so the bundle carries only sources
    # + the baked .bbl (the .pdf/.aux/.log/.fls/.fdb_latexmk are build byproducts,
    # not arXiv submission inputs). The baked .bbl is KEPT.
    find "$bundle" -type f \
        \( -name '*.aux' -o -name '*.log' -o -name '*.out' -o -name '*.fls' \
           -o -name '*.fdb_latexmk' -o -name '*.pdf' -o -name '*.blg' -o -name '*.toc' \) \
        -delete
fi

# ── 5. tar gzip the bundle to {artifact} ──────────────────────────────────────
# -C the staging dir so the archive carries the single top-level bundle folder.
tar -czf "$artifact" -C "$work" "arxiv-bundle"
