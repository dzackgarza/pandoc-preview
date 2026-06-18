# Proof-Run Environment Setup (headless / sandboxed sessions)

**When this applies:** running `just proof` (the Playwright proof suite) from a headless or sandboxed agent session that lacks a real GUI session, or when the build fails on missing GTK pkg-config, or when webview/export specs fail for non-product reasons.

The proof harness drives the REAL Tauri webview and hard-requires a display (`scripts/proof-run.sh` exits if both `WAYLAND_DISPLAY` and `DISPLAY` are empty — "proofs run on the real GUI session only"). On this single-user box the normal path is the real GUI session.
From a headless TTY agent session, the working recipe (user-authorized headless override) is:

1. **Display:** start Xvfb once and target it.
   `Xvfb :88 -screen 0 1920x1080x24 -nolisten tcp &` then export `DISPLAY=:88` (and `unset WAYLAND_DISPLAY`). webkit2gtk-4.1 + gtk-3 are installed and render under Xvfb.
2. **System-first PATH (critical):** the conda `sage` env is active in non-login shells and shadows system tools with broken/newer ones.
   Run proofs with `PATH=/usr/bin:/bin:$HOME/.bun/bin:$HOME/.local/bin` and `unset CONDA_PREFIX`. (Include `$HOME/.local/bin` — the global QC chain `just test` invokes `uv`, which lives there; omitting it makes `just test` die with `uv: command not found` in `_rust-cargo-manifests`/`_format-structured-text`, unrelated to any code defect.)
   This makes:
   - `pandoc` → `/usr/bin/pandoc` (3.1.3), NOT conda `pandoc 3.9.0.2`. pandoc 3.9 changed `--embed-resources` `file://` resolution (resolves the mathjax bundle relative to cwd, not as the absolute file URL) and breaks `--mathjax=file://...` HTML export.
     The specs were authored against pandoc 3.x ≤3.6.
   - `pkg-config` → `/usr/bin/pkg-config`, fixing the cold Rust build (`glib-2.0`/`gobject-2.0` not found) — the conda pkg-config has an empty search path and errors `basename: missing operand`. (Alternatively force `PKG_CONFIG=/usr/bin/pkg-config`.)
   - gum, bun (~/.bun/bin), cargo, lualatex, jq, flock, pgrep, python3 all still resolve.
3. **Playwright browser:** `just deps` does NOT run `playwright install`. The webview p-specs need it (the `@srsholmes/tauri-playwright` bridge drives the webkit webview from a headless-chromium control context).
   Install once: `bunx playwright install chromium`. Without it every p-spec dies instantly with "chrome-headless-shell ... doesn't exist".

**Spec that cannot run in a restricted sandbox:** `p17-export-html-offline` calls `spawnSync('unshare', ['-rn', ...])` to prove offline self-containment in a network namespace.
`unshare -rn` is "Operation not permitted" without user-namespace privileges, so p17 exits 1 here regardless of pandoc.
It is the ONLY spec using `unshare`. The export itself is correct on pandoc 3.1.3 (verified manually: exit 0, MathJax inlined, no remote script).
Treat p17 as environment-blocked in such sandboxes, not a product defect.

**Known headless flake:** webview specs occasionally fail at `waitForHarness` with `window 'main' not found (available windows: [])` under Xvfb — the Tauri window intermittently fails to register.
Re-run the single spec; it passes.
Seen on p02. This is the instability the "real GUI session only" rule guards against.

**Latent risk to flag, not yet a product bug:** if the app is configured to use pandoc ≥3.9, `[export.html]`'s `--mathjax={mathjax}` (a `file://` URL) will likely break the same way 3.9 broke the p17 repro.
The app picks `command -v pandoc` at first-run; with system 3.1.3 it works.
Revisit if the user's pandoc is upgraded.

**Single-tenant DISPLAY :88 — never run two proof invocations concurrently.**
The harness drives one webview on the single Xvfb `DISPLAY=:88`. Two `just proof` runs at
once (e.g. a background gate re-run while a Workflow's GREEN/review phase also runs proofs)
make the webviews contend for the one display, and a genuinely-green spec **times out
(30s `wait_for_function`)** — a starvation flake, distinct from an assertion failure (which
fails fast with a value mismatch). Trust a Workflow's internally-run gate (serial, isolated)
and run a single consolidated gate only at milestone end when no workflow is in flight. If a
green spec times out, re-run it ALONE before concluding a regression.
