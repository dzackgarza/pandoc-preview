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

# ── 3b. Externalize every tikz diagram to a precompiled PDF figure ─────────────
# Phase G / G3 (P116). After the flattened, macro-materialized bundle root exists
# and BEFORE the latexmk .bbl bake (step 4), precompile every inline
# tikzpicture/tikzcd in the bundle root main.tex to a PDF and rewrite the .tex so
# each diagram becomes \includegraphics{figures/tikz-N.pdf} referencing that
# on-disk PDF in the bundle. The bundle then ships NO tikz source — and thus no
# tikz toolchain dependency — to arXiv, which does no tikz compilation.
#
# The PDF is produced by the EXISTING tikzcd.lua filter's pdflatex compile core
# (run_pdflatex_and_convert via standalone-tikz.tex) — the SAME per-figure compile
# the live preview drives, selecting the PDF output instead of the SVG. This plugin
# owns NO new tikz compiler: it drives `pandoc --to latex --lua-filter tikzcd.lua`
# per diagram, which compiles the diagram and emits an \includesvg whose braced
# target (minus the implicit .pdf) is the on-disk compiled figure PDF the filter
# wrote. The filter reads its compile env (template, shared palette, figures/SVG
# output dir) from the same variables the renderer's tikz-env.sh / render.sh export.
#
# The compile env is derived from PANDOC_RESOURCE_PATH (the global figures dir the
# startup doctor gate guarantees, inherited here from the app process), exactly as
# the renderer's tikz-env.sh derives it; the per-figure template + shared palette
# are the canonical install-assets paths under that pandoc config dir (the SAME
# files the config's [figures] table points at). A missing one is a loud failure.
: "${PANDOC_RESOURCE_PATH:?arxiv-export/export.sh: PANDOC_RESOURCE_PATH must be set (the global figures dir the tikz compile core reads)}"
export FIGURES_DIR="$PANDOC_RESOURCE_PATH"
export PANDOC_DIR="$(dirname "$FIGURES_DIR")"
export SVG_DIR="$FIGURES_DIR/rendered"
export TIKZSTYLES_FILE="$FIGURES_DIR/shared.tikzstyles"
export TIKZDEFS_FILE="$FIGURES_DIR/shared.tikzdefs"
export FIGURE_TEMPLATE_FILE="$PANDOC_DIR/templates/standalone-tikz.tex"
tikz_filter="$PANDOC_DIR/filters/tikzcd.lua"
for f in "$TIKZSTYLES_FILE" "$TIKZDEFS_FILE" "$FIGURE_TEMPLATE_FILE" "$tikz_filter"; do
    if [ ! -f "$f" ]; then
        echo "arxiv-export/export.sh: tikz compile asset missing: $f" >&2
        exit 9
    fi
done

# The pandoc executable the config names (first token of the tokenized command) —
# reused to drive the tikz filter compile (the plugin owns no second pandoc).
pandoc_bin="${cmd[0]}"

# Externalize: extract each tikzpicture/tikzcd env from the bundle root main.tex,
# drive the tikzcd.lua compile core (via pandoc) to a PDF, copy it into the bundle
# under figures/, and rewrite the env in main.tex to \includegraphics. A failed or
# missing precompile is a LOUD error (exit nonzero) — never a dangling
# \includegraphics whose target was never written.
mkdir -p "$bundle/figures"
python3 - "$bundle/main.tex" "$bundle" "$pandoc_bin" "$tikz_filter" "$work" <<'PY_TIKZ_EOF'
import os, re, subprocess, sys

root_tex, bundle, pandoc_bin, tikz_filter, work = sys.argv[1:6]
body = open(root_tex, encoding="utf-8").read()

# Match a whole tikzpicture/tikzcd environment (the inline diagram source pandoc
# passed through verbatim). Non-greedy body; DOTALL so the multi-line env is one
# match. The two env names are the only tikz diagram forms the filter externalizes.
ENV_RE = re.compile(
    r"\\begin\{(tikzpicture|tikzcd)\}.*?\\end\{\1\}",
    re.DOTALL,
)

matches = list(ENV_RE.finditer(body))
if not matches:
    # No inline tikz diagram in this document — nothing to externalize. That is the
    # document's real shape, not a skipped edge case.
    sys.exit(0)

# The filter's pandoc-latex output for a compiled diagram: \includesvg[...]{<base>}
# where <base> is the on-disk compiled figure path MINUS the .pdf extension (the
# filter wrote <base>.pdf). Read the braced target off that line.
INCLUDESVG_RE = re.compile(r"\\includesvg(?:\[[^\]]*\])?\{([^}]+)\}")

out_parts = []
last = 0
for idx, m in enumerate(matches):
    env_src = m.group(0)
    # Feed the diagram source to the tikzcd.lua compile core as a {=latex} raw
    # block, so pandoc passes it to the filter's RawBlock handler unchanged. The
    # filter compiles it (standalone-tikz.tex + pdflatex) and emits the
    # \includesvg{<base>} whose <base>.pdf is the on-disk compiled figure.
    md = "```{=latex}\n" + env_src + "\n```\n"
    proc = subprocess.run(
        [pandoc_bin, "--from", "markdown", "--to", "latex",
         "--lua-filter", tikz_filter],
        input=md, capture_output=True, text=True,
    )
    if proc.returncode != 0:
        sys.stderr.write(
            "arxiv-export: tikz precompile (pandoc+tikzcd.lua) failed for "
            f"{m.group(1)} #{idx}:\n{proc.stderr}\n"
        )
        sys.exit(10)
    sm = INCLUDESVG_RE.search(proc.stdout)
    if not sm:
        sys.stderr.write(
            "arxiv-export: tikz precompile produced no \\includesvg figure "
            f"reference for {m.group(1)} #{idx}; filter output:\n{proc.stdout}\n"
            f"{proc.stderr}\n"
        )
        sys.exit(11)
    pdf_src = sm.group(1) + ".pdf"
    if not os.path.isfile(pdf_src):
        # The filter reported a figure base whose .pdf is absent on disk — the
        # compile did not really produce a PDF. Loud failure, no dangling include.
        sys.stderr.write(
            f"arxiv-export: tikz precompile figure PDF missing on disk: {pdf_src}\n"
        )
        sys.exit(12)
    if os.path.getsize(pdf_src) == 0:
        sys.stderr.write(
            f"arxiv-export: tikz precompile figure PDF is zero-byte: {pdf_src}\n"
        )
        sys.exit(13)

    fig_rel = f"figures/tikz-{idx}.pdf"
    fig_dst = os.path.join(bundle, fig_rel)
    with open(pdf_src, "rb") as r, open(fig_dst, "wb") as w:
        w.write(r.read())

    # Rewrite the inline diagram env to an \includegraphics of the bundled PDF.
    out_parts.append(body[last:m.start()])
    out_parts.append("\\includegraphics{" + fig_rel + "}")
    last = m.end()

out_parts.append(body[last:])
rewritten = "".join(out_parts)

# Defensive loud check: no tikz diagram env may survive in the rewritten root.
if ENV_RE.search(rewritten):
    sys.stderr.write(
        "arxiv-export: inline tikz env still present after externalization — "
        "rewrite did not replace every diagram\n"
    )
    sys.exit(14)

with open(root_tex, "w", encoding="utf-8") as f:
    f.write(rewritten)
PY_TIKZ_EOF

# ── 3c. Figure-format compliance gate ──────────────────────────────────────────
# Phase G / G4 (P117). arXiv does NO on-the-fly conversion and the pdfLaTeX target
# accepts ONLY PDF/PNG/JPG, while this pipeline is SVG-centric. After the bundle
# root main.tex is flattened, materialized and tikz-externalized (steps 2/3/3b) and
# BEFORE the latexmk .bbl bake (step 4), enumerate EVERY figure the root .tex still
# references — both \includegraphics{...} (raster figures step 3 copied) AND
# \includesvg{...} (the SVG inclusions pandoc emits for a `.svg` extension, which
# step 3 did NOT copy). For each, detect the REAL on-disk format by magic bytes
# (NOT the filename extension):
#   • already PDF/PNG/JPG → pass through untouched.
#   • SVG → convert to PDF with cairosvg run through the approved `uvx` runner
#     (`inkscape`/`rsvg-convert` are not installed and cairosvg is not owned), copy
#     the PDF into the bundle, and REWRITE the reference to \includegraphics of it.
#   • anything else (a non-convertible figure: cairosvg cannot parse it / no PDF) →
#     FAIL LOUDLY: exit NON-ZERO, NAME the offending figure on stderr, and (because
#     set -e aborts before the tar step) produce NO tarball. NEVER ship an arXiv-
#     rejectable figure.
# The SVG source for an \includesvg{...} reference is read from the source dir
# ($PWD, the cwd the core set to the file's parent) — the same place step 3 reads
# document-relative resources. The converter binary is the `uvx` runner the
# pandoc-config cleaner already uses (uvx --from cairosvg cairosvg <in> -o <out>).
uvx_bin="$(command -v uvx)" || {
    echo "arxiv-export/export.sh: uvx not found on PATH — the figure-format gate needs cairosvg via the uvx runner to convert SVG figures" >&2
    exit 15
}
python3 - "$bundle/main.tex" "$bundle" "$PWD" "$uvx_bin" <<'PY_FIGGATE_EOF'
import os, re, subprocess, sys

root_tex, bundle, src_dir, uvx_bin = sys.argv[1:5]
body = open(root_tex, encoding="utf-8").read()

# Both figure-inclusion commands the bundle root may carry: \includegraphics for
# raster figures (step 3 already copied them into the bundle at their document-
# relative path) and \includesvg for the `.svg` extension (NOT yet in the bundle;
# its source lives under src_dir). Capture the command, the optional [opts], and
# the braced target so each can be rewritten in place.
INCLUDE_RE = re.compile(
    r"\\include(graphics|svg)\s*(\[[^\]]*\])?\s*\{([^}]+)\}"
)

# arXiv-acceptable formats for the pdfLaTeX target, by MAGIC BYTES (not extension).
def magic_format(path):
    with open(path, "rb") as fh:
        head = fh.read(8)
    if head[:5] == b"%PDF-":
        return "PDF"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "PNG"
    if head[:3] == b"\xff\xd8\xff":
        return "JPEG"
    return None

def resolve_in_bundle(target):
    # An \includegraphics target step 3 copied: it sits in the bundle at its
    # document-relative path (with or without a missing extension).
    direct = os.path.join(bundle, target)
    if os.path.isfile(direct):
        return direct
    for ext in (".pdf", ".png", ".jpg", ".jpeg", ".PDF", ".PNG", ".JPG"):
        cand = os.path.join(bundle, re.sub(r"\.[^./]+$", "", target) + ext)
        if os.path.isfile(cand):
            return cand
    return None

out_parts = []
last = 0
for m in INCLUDE_RE.finditer(body):
    cmd, opts, target = m.group(1), m.group(2) or "", m.group(3).strip()
    out_parts.append(body[last:m.start()])
    last = m.end()

    is_svg = target.lower().endswith(".svg") or cmd == "svg"
    if not is_svg:
        # A raster figure step 3 copied into the bundle. Verify its REAL format is
        # arXiv-acceptable by magic bytes; a non-compliant raster is a loud failure.
        on_disk = resolve_in_bundle(target)
        if on_disk is None:
            sys.stderr.write(
                f"arxiv-export: figure-format gate: referenced figure {target} "
                f"resolves to no file in the bundle\n"
            )
            sys.exit(16)
        fmt = magic_format(on_disk)
        if fmt is None:
            sys.stderr.write(
                f"arxiv-export: figure-format gate: referenced figure {target} is "
                f"NOT an arXiv-acceptable format (PDF/PNG/JPG) by magic bytes — "
                f"cannot ship it\n"
            )
            sys.exit(17)
        # Compliant raster: pass the reference through unchanged.
        out_parts.append(m.group(0))
        continue

    # An SVG figure (\includesvg{...}, or an .svg target). arXiv would reject it;
    # convert it to PDF with cairosvg via the uvx runner. The SVG source is the
    # document-relative file under src_dir (pandoc references it by that path).
    svg_src = os.path.join(src_dir, target)
    if not os.path.isfile(svg_src):
        sys.stderr.write(
            f"arxiv-export: figure-format gate: referenced SVG figure {target} "
            f"does not exist at {svg_src}\n"
        )
        sys.exit(18)

    # Place the converted PDF in the bundle beside the SVG's document-relative path
    # (same dir, .pdf extension), so the rewritten \includegraphics resolves.
    pdf_rel = re.sub(r"\.svg$", ".pdf", target, flags=re.IGNORECASE)
    if pdf_rel == target:
        pdf_rel = target + ".pdf"
    pdf_dst = os.path.join(bundle, pdf_rel)
    os.makedirs(os.path.dirname(pdf_dst) or ".", exist_ok=True)

    proc = subprocess.run(
        [uvx_bin, "--from", "cairosvg", "cairosvg", svg_src, "-o", pdf_dst],
        capture_output=True, text=True,
    )
    if proc.returncode != 0 or not os.path.isfile(pdf_dst) or os.path.getsize(pdf_dst) == 0:
        # A non-convertible figure: cairosvg could not make it arXiv-compliant
        # (e.g. a zero-byte / malformed SVG — expat "no element found"). FAIL
        # LOUDLY naming the offending figure; set -e aborts before the tar step so
        # NO tarball is produced.
        sys.stderr.write(
            f"arxiv-export: figure-format gate: could not convert SVG figure "
            f"{target} to an arXiv-acceptable PDF (cairosvg rc={proc.returncode}); "
            f"offending file: {os.path.basename(target)}\n{proc.stderr}\n"
        )
        sys.exit(19)
    # Confirm the converted figure really is a PDF by magic bytes before shipping.
    if magic_format(pdf_dst) != "PDF":
        sys.stderr.write(
            f"arxiv-export: figure-format gate: cairosvg output for {target} is not "
            f"a valid PDF by magic bytes; offending file: {os.path.basename(target)}\n"
        )
        sys.exit(20)

    # Rewrite the SVG inclusion to an \includegraphics of the converted bundle PDF,
    # preserving any [opts].
    out_parts.append(f"\\includegraphics{opts}{{{pdf_rel}}}")

out_parts.append(body[last:])
rewritten = "".join(out_parts)

# Defensive loud check: no SVG inclusion may survive in the rewritten root.
if re.search(r"\\includesvg", rewritten) or re.search(
    r"\\includegraphics(?:\[[^\]]*\])?\{[^}]*\.svg\}", rewritten, re.IGNORECASE
):
    sys.stderr.write(
        "arxiv-export: figure-format gate: an SVG inclusion survived the rewrite\n"
    )
    sys.exit(21)

with open(root_tex, "w", encoding="utf-8") as f:
    f.write(rewritten)
PY_FIGGATE_EOF

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
    #
    # SCOPE: latexmk runs on the ROOT main.tex, so ALL of its byproducts (main.pdf,
    # main.aux, main.log, …) land at the bundle ROOT. The G3-externalized diagram
    # PDFs live under figures/ (figures/tikz-N.pdf) and are arXiv submission INPUTS
    # referenced by \includegraphics — deleting them ships a dangling include. So
    # this cleanup is restricted to the bundle root (-maxdepth 1) AND figures/ is
    # explicitly excluded, so the externalized figure PDFs always survive while the
    # root main.pdf byproduct is still removed.
    find "$bundle" -maxdepth 1 -type f \
        -not -path '*/figures/*' \
        \( -name '*.aux' -o -name '*.log' -o -name '*.out' -o -name '*.fls' \
           -o -name '*.fdb_latexmk' -o -name '*.pdf' -o -name '*.blg' -o -name '*.toc' \) \
        -delete
fi

# ── 5. tar gzip the bundle to {artifact} ──────────────────────────────────────
# -C the staging dir so the archive carries the single top-level bundle folder.
tar -czf "$artifact" -C "$work" "arxiv-bundle"
