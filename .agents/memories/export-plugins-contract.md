# Export Plugins Contract

**RATIFIED 2026-06-14 — export belongs to the pandoc plugin SUITE, not the app.** HTML
and PDF export must be owned by the same plugin suite that owns rendering ([Renderer
Plugin Architecture](renderer-plugin-architecture)), NOT by the app. The reason is
**render↔export drift**: if the app owns the export pipelines while the plugin owns the
preview render, the export flags inevitably diverge from the preview flags and require
error-prone manual syncing; the user-visible surprise to avoid is an HTML/PDF export
that looks noticeably different from what the preview rendered. (A *little* drift is
fine — e.g. filters present only to offload app-owned work.) So "Export HTML"/"Export
PDF" become sibling plugins in the vendored pandoc suite, alongside the renderer, each
auto-populating a Plugins-menu entry that simply runs the plugin's script. **The
`[export.<id>]` app-config-table model described below is the CURRENT TRANSITIONAL
implementation** (it kept exports working through Milestones A–C); migrating exports
into the pandoc suite is the dedicated milestone that retires these tables. Until then,
treat the drift risk as live and keep the shipped export commands close to the
renderer's command.

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
  renders). Verified via `unshare -rn`. RESOLVED (2026-06-13, decision A): the shipped
  `[export.html]` switches from bare `--mathjax` (CDN) to `--mathjax=<local-bundle>`
  pointing at a version-pinned MathJax shipped with the app, so `--embed-resources`
  inlines a LOCAL file and never reaches the network — the fail-open scenario no longer
  arises. `--fail-if-warnings` is NOT the fix (it would trip on benign missing-title
  warnings). See [[mathjax-offline-local-source-decision]] (P16/P17). The install-portable
  path likely arrives via a new app-substituted `{mathjax}` placeholder; if added,
  placeholder validation must accept it alongside `{input}`/`{output}`.

## Doctor impact

The `pdf-engine` check is superseded by an `export-plugins` check: for each
configured entry, validate shape (placeholders, label, extension) and that argv[0]
resolves to an executable. A full probe run is NOT performed (it would compile real
documents); this honest limit is part of the contract. See [[doctor-contract]].

Proof obligations: see [[proof-obligations]] (P7/P8 revised, P12 added; P16/P17 add the
offline/local-MathJax requirement per [[mathjax-offline-local-source-decision]]).
