# Reference: Render Lifecycle (Tideflow, mdTeX)

# Reference: Render Lifecycle (Tideflow, mdTeX)

**When this applies:** implementing or reviewing the render pipeline — subprocess management, debounce/coalescing, diagnostics, preview reload. Sources: audited clones of [Tideflow](https://github.com/BDenizKoca/Tideflow-md-to-pdf) (MIT, Typst→PDF) and [mdTeX](https://github.com/slashinfty/mdTeX) (MIT, pandoc→PDF), citations spot-verified 2026-06. Clones: `/tmp/ref-tideflow`, `/tmp/ref-mdtex` (re-clone shallow if gone).

**The pattern to copy — Tideflow's latest-wins coalesced render queue (`src/api.ts:89-200`):** one queue object `{inFlight, pending, currentGeneration, subscribers}`; new requests overwrite `pending`; the processor loops while `pending` exists, so keystrokes faster than compiles collapse to the newest text; `currentGeneration++` on completion invalidates stale subscribers. Frontend debounce 400 ms (`src/constants/timing.ts:20`, user-configurable as `render_debounce_ms` in prefs — our equivalent belongs in the TOML config, no default in code). Compare Inkwell's 150 ms preview debounce in [Reference: Inkwell Shell Patterns](reference-inkwell-shell-patterns); pandoc+TeX is slower than markdown-it, so 400 ms-class debounce plus coalescing is the right shape.

**Subprocess discipline — Tideflow's Rust side (`src-tauri/src/render_pipeline.rs:379-446`):** explicit `current_dir`, piped stdout+stderr, spawn then `try_wait()` poll loop with a hard timeout (30 s) and `child.kill()` on expiry; on nonzero exit, error carries status + trimmed stdout + stderr. A global render mutex serializes compiles (`renderer.rs:24`). Our renderer already does spawn/pipe/typed-failure ([First Iteration: Mechanisms Worth Porting](first-iteration-mechanisms-worth-porting)) but lacks timeout+kill — that is the gap to close, since a hung pandoc/lualatex otherwise blocks forever (mdTeX demonstrates the failure: blocking `.execute()`, no timeout, hung pandoc hangs the UI).

**Scroll preservation across preview reloads (`src/utils/pdfRenderer.ts:16-157`):** capture scrollTop/Left before rebuilding the DOM, hide the container during re-layout (CSS class) when scrolled, restore inside `requestAnimationFrame` after layout, and set a `programmaticScroll` ref so the restore doesn't trigger scroll-sync feedback. This transfers directly to HTML preview re-injection.

**mdTeX's one useful idea:** the sibling temp-YAML pattern — user preamble injected as a `header-includes:` YAML block passed to pandoc as an extra input file (`src/index.js:238-241`) — relevant if settings ever need to inject pandoc metadata without touching the user's template.

**Do NOT imitate:**

- Tideflow's binary discovery chain (PATH probe → `which` → system dirs → bundled binary → prefs override, `utils/paths.rs:67-172`) — textbook ambient discovery; our config names the command, missing = fatal.
- Tideflow's silent version-adaptation (probing `--version`, trying 5 selector syntax variants, skipping queries silently) — fail loudly instead.
- mdTeX leaving the temp YAML behind on failed compiles, unquoted paths in command args, and stderr-nonempty treated as failure (pandoc writes warnings to stderr on SUCCESS; only nonzero exit is failure — our contract already says so).
- Both repos clear or keep the old preview without marking staleness; our contract requires the explicit stale marker.

**QC reality check:** mdTeX has zero tests/lint (release workflow only). Tideflow CI = `npm run build` (tsc) + `cargo check` + exactly one vitest unit test; its release workflow SHA256-verifies downloaded Typst binaries — checksum-pinning external tool downloads is the one QC idea worth taking.

Related: [Reference Repo Map: Subsystem Sources](reference-repo-map-subsystem-sources), [Contract Invariants and Ownership Boundaries](contract-invariants-and-ownership-boundaries).
