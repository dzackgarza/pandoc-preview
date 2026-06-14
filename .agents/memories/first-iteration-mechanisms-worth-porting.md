# First Iteration: Mechanisms Worth Porting

**When this applies:** designing greenfield2's proof/QC layer, renderer, or recovery; deciding what to salvage from `~/gitclones/pandoc-preview-greenfield` (the halted first iteration). Its failure was plan-level ([Threat Model: Polished Fallback Machine](threat-model-polished-fallback-machine)); several mechanisms beneath it are genuinely good and field-tested.

**Bridge-burning held at the code level.** Across ~6 hours of implementation: zero mocks, zero fallback HTML, no fake preview, no suppressed stderr, structured `AppError {kind, message, detail}` with error-KIND assertions (never message-string matching). The historical failure modes the seeds documented (xvfb cloaking, browser-mode IPC mocks, fake filters, child-only kills leaving ghost windows) were structurally banned and did not recur. Blanket prohibitions worked where applied; the disaster slipped in above them.

**Mechanisms worth porting:**

- **Renderer contract** (`src-tauri/src/renderer_command.rs`): raw configured command string is the single source of truth, `shell_words` parsing, stdin=markdown / stdout=HTML / stderr=diagnostics / nonzero exit=typed failure, sha256 command fingerprint, unit tests against real pandoc including a real-failure leg. This is the reference implementation for greenfield2's render path.
- **/proc ground-truth proofs:** spec reads the displayed PID, then `/proc/<pid>/exe` and `/proc/<pid>/environ` to prove IPC reached the real, correctly-provisioned binary — unfakeable by any mocked surface.
- **Per-run isolated provisioning from real fixtures:** fresh HOME/XDG/workspace per spec, populated with committed copies of the real template/filters/figures (never synthesized), manifest cross-checked by the spec.
- **Proof artifacts with identity:** committed run JSONs recording git_head, tree_dirty, mode, tool versions, per-spec observations — completion claims become auditable ("P0–P4 discharged by clean-tree artifact run-X at HEAD Y").
- **Discrimination and teardown drills:** rename a testid → spec must fail; wrong PID → fail; injected failing spec → halt; SIGINT mid-run → no orphan processes, socket gone (process-group `setsid` + negative-PGID kill, asserted every run).
- **Gate self-test with seed violations:** the slop gate must detect every planted violation in `tests/static/seed-violations/` or fail itself; `gate.lock` sha256s all gate files, changes require a `Gate-Change:` trailer — gates cannot be weakened silently.
- **Deviation ledger discipline:** `docs/DEVIATIONS.md` records every gap between tree and contract, removable only by landing the behavior plus its proof — and in-session the agent enumerated remaining work against the full original plan without scope-narrowing.
- **Contract-change discipline:** when the user-authored contract rule ("example config generation is explicit only") collided with sane first-run UX, the agent separated the fused rules, identified it as a contract change only the user could authorize, and changed nothing until directed. (That rule itself was later superseded — the app generates no config at all; see [Shipped Config vs Runtime Defaults](shipped-config-vs-runtime-defaults). The transferable lesson is the discipline, not the rule.)

**The caveat that governs all of it:** these mechanisms prove boundary truths, not usability. Port them only alongside the human-runnable usable-MVP gate; never let their green-ness stand in for a working app.
