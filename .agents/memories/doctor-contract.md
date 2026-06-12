# Doctor Contract (D1–D5)

User-mandated startup/diagnostic workflow (2026-06-12), motivated by a real regression: a stale config key (`math`, removed from the schema) produced a dead-end in-app error screen instead of routing into reconfiguration.

## Check battery (one source of truth, three consumers)

Ordered, named, structured checks in the Rust backend (`doctor` module):

- `config-exists` — config.toml present at the XDG path
- `config-schema` — parses with `deny_unknown_fields` (catches stale keys)
- `config-values` — same invariants the settings save path enforces (font_size 8–48, debounce_ms 0–10000, non-empty pandoc path/from_format); validation logic shared with `save_config`, never duplicated
- `pandoc-executable` — `pandoc.path` resolves (PATH or absolute), is executable, `pandoc --version` exits 0; version string captured
- `pandoc-invocation` — probe render with the FULL configured arg set (`--from <from_format>` + `extra_args`, stdin empty) exits 0, proving the whole invocation contract, not just the binary
- `pdf-engine` — lualatex present (PDF export is owned surface)

Consumers:

1.  `pandoc-preview --doctor` — full report (check name, OK/FAIL, detail), exit 0/1, never creates a window.
2.  Startup gate — battery runs before the Tauri builder; any failure hard-fails with the report on stderr, nonzero exit. The in-app "Configuration required" screen is deleted (unreachable).
3.  Launcher (`just run` → launcher script) — doctor; config-class failures route into gum first-run (`--force` when an invalid config exists; gum's confirm guards the overwrite), then doctor again, then app. Non-config failures (pandoc, lualatex) hard-fail with the report, never gum.

## Proof obligations

- **D1** — `--doctor`, valid hermetic env: every check OK, report carries the real `pandoc --version` string, exit 0, no window.
- **D2** — launcher, no config: gum flow runs in a real PTY, then the app boots to the editor UI.
- **D3** — launcher, config containing the exact observed stale key (`math = "mathjax"`): routed into gum reconfiguration, old config replaced, app boots. Regression test for the observed failure.
- **D4** — bare binary, invalid config: nonzero exit, no window, stderr report names `config-schema` as the failing check.
- **D5** — `--doctor` with `pandoc.path` → non-executable file: report shows exactly `pandoc-executable` failing, exit 1.

D3–D5 intentionally use misconfigured fixtures: broken environments are the doctor's product surface, unlike the P-series happy-path rule ([[proof-obligations]]).
