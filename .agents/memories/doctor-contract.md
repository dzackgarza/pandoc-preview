# Doctor Contract (D1–D5)

User-mandated startup/diagnostic workflow (2026-06-12), motivated by a real regression: a stale config key (`math`, removed from the schema) produced a dead-end in-app error screen instead of routing into reconfiguration.

## Check battery (one source of truth, three consumers)

Ordered, named, structured checks in the Rust backend (`doctor` module):

- `config-exists` — config.toml present at the XDG path
- `config-schema` — parses with `deny_unknown_fields` (catches stale keys)
- `config-values` — same invariants the settings save path enforces (font_size 8–48, debounce_ms 0–10000, non-empty pandoc path/from_format); validation logic shared with `save_config`, never duplicated
- `pandoc-executable` — `pandoc.path` resolves (PATH or absolute), is executable, `pandoc --version` exits 0; version string captured
- `pandoc-invocation` — probe render with the FULL configured arg set (`--from <from_format>` + `extra_args`, stdin empty) exits 0, proving the whole invocation contract, not just the binary
- `export-plugins` — every configured `[export.<id>]` entry is well-formed ({input}/{output} placeholders present, non-empty label/extension, argv >= 1) and its argv[0] resolves to an executable. Supersedes the original `pdf-engine` check (2026-06-13): that check asserted lualatex on PATH while the export command never passed `--pdf-engine` and thus ran pandoc's implicit pdflatex default — check and command were out of sync. See [[export-plugins-contract]]. No full probe run (would compile real documents); honest limit.

**Ownership note (2026-06-13):** under the renderer-plugin model ([Renderer Plugin Architecture](renderer-plugin-architecture)), the renderer-specific checks above (`pandoc-executable`, `pandoc-invocation`, `export-plugins`, and the required-filter/template-existence checks) are **contributed by the active renderer/export plugins, not hardcoded in the app core**. The doctor is a single framework that runs the core checks (`config-exists`, `config-schema`, `config-values` for the core schema) and aggregates each enabled plugin's contributed checks — one battery, three consumers, but the renderer rows come from the plugin that owns them. The generic renderer plugin contributes no pandoc checks.

Consumers:

1.  `pandoc-preview --doctor` — full report (check name, OK/FAIL, detail), exit 0/1, never creates a window. Also carries the informational config diagnostics below.
2.  Startup gate — battery runs before the Tauri builder; any failure hard-fails with the report on stderr, nonzero exit. The in-app "Configuration required" screen is deleted (unreachable).
3.  Launcher (`just run` → launcher script) — doctor; config-class failures route into gum first-run (`--force` when an invalid config exists; gum's confirm guards the overwrite), then doctor again, then app. Non-config failures (pandoc, lualatex) hard-fail with the report, never gum.

## Config diagnostics (informational, not pass/fail — 2026-06-13)

Beyond the pass/fail battery, the doctor/CLI surfaces **how the user's config differs from the shipped defaults** — which keys are customized vs the statically shipped config — so "how does my config differ from defaults" is answerable from the CLI. A companion CLI **reset-to-defaults** copies the shipped config over the user's config (gum confirm guards the overwrite). Both read the shipped config for *diagnostics only*, never for a runtime decision — the shipped config is a diagnostic baseline, not a value source ([Shipped Config vs Runtime Defaults](shipped-config-vs-runtime-defaults)).

## Proof obligations

- **D1** — `--doctor`, valid hermetic env: every check OK, report carries the real `pandoc --version` string, exit 0, no window.
- **D2** — launcher, no config: gum flow runs in a real PTY, then the app boots to the editor UI.
- **D3** — launcher, config containing the exact observed stale key (`math = "mathjax"`): routed into gum reconfiguration, old config replaced, app boots. Regression test for the observed failure.
- **D4** — bare binary, invalid config: nonzero exit, no window, stderr report names `config-schema` as the failing check.
- **D5** — `--doctor` with `pandoc.path` → non-executable file: report shows exactly `pandoc-executable` failing, exit 1.

D3–D5 intentionally use misconfigured fixtures: broken environments are the doctor's product surface, unlike the P-series happy-path rule ([[proof-obligations]]).