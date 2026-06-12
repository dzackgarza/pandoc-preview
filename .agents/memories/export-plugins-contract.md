# Export Plugins Contract

User-mandated design (2026-06-13, correcting an earlier too-narrow proposal): the
ENTIRE export compilation command is user configuration. Export targets are plugins;
the pandoc HTML/PDF invocations are merely the default plugins shipped with the app.
Users may need custom filters, templates, flags, metadata, or an entirely different
pipeline (latexmk, their own build script). Forcing an opinionated fixed command with
a few knobs (e.g. only `pdf_engine`) is explicitly rejected.

## Config shape

```toml
[export.pdf]
label = "PDF"
extension = "pdf"
command = [
  "pandoc", "--from", "markdown", "--standalone",
  "--pdf-engine=lualatex",
  "{input}", "--output", "{output}",
]

[export.html]
label = "HTML (self-contained)"
extension = "html"
command = [
  "pandoc", "--from", "markdown", "--standalone",
  "--embed-resources", "--mathjax",
  "{input}", "--output", "{output}",
]
```

- `[export.<id>]` table; each entry is a plugin. Arbitrary user-defined entries are
  first-class (e.g. a latexmk pipeline or a shell script).
- `command` is an argv array (never a shell string). `{input}` and `{output}`
  placeholders are substituted per-argument (substring substitution); validation
  requires both placeholders to appear somewhere in the argv, non-empty label,
  non-empty extension, argv length >= 1. Fail loudly otherwise.
- Process runs with cwd = the source file's parent directory. Exit code is the
  contract: nonzero = export failure, stderr captured into the compile log.
- `export_sync` contains NO hard-coded pandoc flags or formats; it only resolves
  placeholders and spawns the configured argv.
- The Export menu is populated from the config entries. (Native muda menus are not
  reachable from the webview DOM, so menu population itself is proof debt; the
  E2E hook drives exports by plugin id through the same command path.)
- first-run.sh writes the two shipped default plugins shown above.

## Motivating defects (observed 2026-06-13)

- `render.rs export_sync` passed NO `--pdf-engine`: actual exports ran pandoc's
  implicit default (pdflatex) while `doctor.rs check_pdf_engine` asserted lualatex —
  a binary the command never invoked. Check and command were out of sync; P8 never
  discriminated the engine (passed only because pdflatex was installed).
- Shipped HTML default plugin fail-open: with `--embed-resources --mathjax` and an
  unreachable CDN, pandoc warns and exits 0 producing a broken artifact (math never
  renders). Verified via `unshare -rn`. OPEN DECISION: whether the shipped default
  adds `--fail-if-warnings` (would also trip on e.g. missing-title warnings) or
  accepts the fail-open as pandoc-owned behavior. Not resolved by the user yet.

## Doctor impact

The `pdf-engine` check is superseded by an `export-plugins` check: for each
configured entry, validate shape (placeholders, label, extension) and that argv[0]
resolves to an executable. A full probe run is NOT performed (it would compile real
documents); this honest limit is part of the contract. See [[doctor-contract]].

Proof obligations: see [[proof-obligations]] (P7/P8 revised, P12 added).
