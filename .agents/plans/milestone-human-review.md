# Milestone: ready for a human review pass

## Definition of done (the user's four conditions)

1. **Local failures are almost entirely style.** The behavioral tiers
   (`cargo test`, `bun run check`, `just proof`) pass locally; the only residual
   `just test-ci` redness is the centrally-owned semgrep *style* findings.
2. **CI GUI tests are green.** The `gui-proof` job actually executes the proof
   suite and passes.
3. **All in-flight features are tied up.** Every feature the recent work set out
   to ship either (a) is implemented, driven in the real app, and guarded by a
   proof spec, or (b) is explicitly scoped out with a clean in-app behavior — no
   half-implemented dead-ends.
4. **Docs + wiki are current.** Implementation-Status, Feature-Roadmap, README,
   and proof-obligations describe the actual shipped surface so a reviewer checks
   reality, not stale intent.

## Grounding (already established this session)

- Verified working in the real app (Xvfb): md→HTML preview + live re-render
  (p01/p02), md→HTML export (p07), md→PDF export (p08), md slides→reveal.js
  (p121, which also exercises the render-target selector), `.tikz`→SVG (p132).
- Backend builds clean; `bun run check` passes; 3 backend tests pass.
- CI is red for non-app reasons only: `gui-proof` dies at `setup-go` because the
  job sets `TMPDIR=/tmp/pandoc-preview-proof-tmp` job-wide but creates it only in
  the proof step (so `go env` aborts → the suite never runs); `standard-qc`
  aborts at semgrep (2448 style findings) before `cargo test`/clippy run.
- `just deps` does NOT install the Playwright browser (local run failed at
  `browserType.launch` until `bun x playwright install chromium` was run by hand).

## Belief gaps to close (the in-flight features)

- `.tex` → HTML preview: manifest + dispatch correct; never opened in the app.
- New PDF exports through the app menu: `beamer-pdf-export` (.md),
  `latex-pdf-export` (.tex), `tikz-pdf-export` (.tikz) — pipelines smoke-tested
  as isolated scripts only; never fired from the export menu; no proof spec.
- Multi-template selection (non-default template for one renderer): mechanism
  proven for renderer-swap (p121); template-swap unobserved; no proof spec.
- `.bib`: recognized input type with no renderer → opens to `status="error"`.

## Workstreams

### WS-A — Enumerate the real red-map (full proof suite)
Run the complete `just proof` under Xvfb. Classify every FAIL as: (i) real app
bug, (ii) stale proof-debt encoding a retired contract (the realignment changed
it), or (iii) harness/env. This list drives WS-B and WS-C. (Run in progress.)

### WS-B — Tie up in-flight features (drive them, then guard them)
For each belief-gap feature, drive it in the running app and confirm real output;
then add a proof spec so CI guards it going forward:
- Open a `.tex` file → confirm `latex-renderer` produces an HTML preview. Add a
  `.tex`-render proof spec.
- Fire each new PDF export from the app's export menu → confirm a real PDF lands.
  Add export proof specs for beamer/latex-pdf/tikz-pdf.
- Select a non-default template for a renderer → confirm the re-render uses it.
  Add a template-selection proof spec.
- Decide `.bib`: implement a clean "no preview for this source type" state
  (editor opens the file; preview pane states the type is non-rendering) instead
  of a raw error, OR scope `.bib` out of the openable set. Implement the chosen
  behavior; add a spec asserting it.
- Anything WS-A flags as a real app bug: fix here, red→green with a committed
  spec per the bug protocol.

### WS-C — Reconcile proof-debt so `just proof` is green locally
Fix every stale spec from WS-A to the realigned contracts. Known: **p66**
(export discovery is now input-type-aware — give the witness fixture
`inputs=["markdown"]` and update the assertion to the input-filtered contract).
Apply the same reconciliation to any other stale specs WS-A surfaces. Target:
`just proof` exits 0 locally.

### WS-D — Make CI GUI tests green (harness)
- Fix the `gui-proof` TMPDIR bug: set `TMPDIR` on the proof *step* (which already
  `mkdir`s it) instead of job-wide, OR create the dir as the first job step.
- Ensure the Playwright browser is installed in CI before the suite runs (add
  `bun x playwright install chromium` to `just deps` or a dedicated CI step), so
  CI does not hit the local `browserType.launch` wall.
- Push; confirm the `gui-proof` job runs the suite and goes green.

### WS-E — Drive local failures down to "almost entirely style"
- With WS-B/C green, `cargo test` and `just proof` pass locally.
- The semgrep slop tier (2448 findings) is code-style and centrally owned: follow
  the QC triage protocol — delegate to a reviewer subagent (load
  `reviewing-llm-code`) then a *separate* fixer subagent; do not self-fix. Burn
  down the substantive findings so the residual `test-ci` redness is style-class
  only, and `cargo test`/clippy (currently never reached) run and pass.

### WS-F — Docs + wiki current
- Wiki: flip the realigned render/export matrix cells from 📌 Planned to ✅ where
  WS-B confirmed (slides preview, beamer export, `.tex` preview+export, `.tikz`
  preview+export); record the `.bib` disposition; keep wishlist items (instant
  math preview, full BibTeX grammar) as 💭/📌.
- README + handoff docs: confirm they describe the discovery-driven matrix and
  the actual shipped feature set.
- `proof-obligations.md`: close out the realignment obligations, register the new
  WS-B specs, record retirements.

## Sequencing & milestone gate

A → (B, C in parallel) → D → E → F.

**Landed when:** `just proof` green locally; CI `gui-proof` green; local
`test-ci` redness is style-class only (`cargo test`/clippy green); every
in-flight feature is driven-in-app + spec-guarded or cleanly scoped out; wiki +
docs reflect the real surface.
