# Test Philosophy from the Seed Contract

**When this applies:** designing, writing, or reviewing any test or proof in this project.
Source: user-authored PROOF_OBLIGATIONS.md (seed contract).
"Correct tests matter before passing tests... A passing test that does not prove the contract is harmful."

**Three proof boundaries, strictly tiered:**

1. **Tauri mode** (real webview on a real display via the playwright plugin socket) — the only boundary that discharges feature obligations.
2. **Rust/unit** — valid for backend-local logic (parsers, config validation, git helpers); never proves UI workflow.
3. **Browser-smoke** — proves only that the harness can load UI; discharges nothing.
   (The first iteration made browser mode structurally impossible — no Chromium installed — which is the stronger posture.)

**Dense workflow tests over shallow probes:** few tests, each exercising several coupled obligations in one real app instance (e.g. no-file launch → temp file on disk → in recovery repo → edit → autosave commit observed via real git → Save As → bytes verified → indicator updates → save commits).
Assertions must discriminate: any assertion that would pass on a broken app is invalid — no visibility-only, existence-only, type-only, screenshot, or disjunctive assertions.

**Anti-gaming obligations:** file-creation tests assert content on disk via independent process; git tests inspect real history; plugin tests observe real outputs or real structured errors; renderer-failure tests observe a real nonzero exit; dependency checks fail BEFORE feature testing, never skip.
The shared witness-fixture technique in [Proof Obligations (P1–P11)](proof-obligations) (unicode discriminators, exact-text assertions, real decoded pixels) is the current realization.

**Banned outright:** mocks, fakes, stubs, skips, xfails, IPC mocks, `page.route()` in proofs, callback-form `evaluate`, `frameLocator`, coordinate/bounding-box selectors, exact error-string assertions (assert structured kind instead), helper-branch tests that bypass the public command, source-policing tests (asserting code text contains/lacks a string — enforcement belongs in slop gates, not tests), screenshots as assertions, meta-code documenting banned patterns as a substitute for proof shape.

**Two seed rules that survive every redesign:**

- "Do not delete slop without tracing the narrative that created it.
  Deletion without diagnosis launders the original unresolved problem."
- The harness fails early and loudly on missing dependencies; it never skips or degrades.

**Hard-won caveat ([Threat Model: Polished Fallback Machine](threat-model-polished-fallback-machine)):** this philosophy proves boundary truths.
It cannot by itself prove usability — pair it with the human-runnable MVP gate, and never let harness drivability constraints leak into product design.

**Two additions from the original repo's history (transcript/doc-verified):**

- **Burden vs. pass state** (user, verbatim, codex 2026-06-02): "a test suite proves behaviour regardless of whether or not it currently passes.
  That app satisfies that proof *burden* when it passes.
  These are two entirely separate phases."
  A red proof spec is a valid, valuable artifact (cf.
  greenfield2's "P7 RED (real export hang)" commit); never delete or weaken a spec because it fails.
- **Failed-test debugging protocol** (`docs/testing-proof-obligations.md`, tauri branch): before editing anything, classify the FIRST incorrect boundary — app defect / incorrect test / harness misuse / fixture-config defect / invalid proof design — with a causal note (exact command, full stderr/console, the obligation under test, competing hypotheses and the observation that eliminated each).
  **Two-attempt limit:** after two failed fixes on the same test, stop; do not get to green by raising timeouts, adding retries, narrowing assertions, mocking, skipping, or changing expectations to match broken behavior.
