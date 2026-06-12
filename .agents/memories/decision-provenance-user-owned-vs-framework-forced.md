# Decision Provenance: User-Owned vs Framework-Forced

# Decision Provenance: User-Owned vs Framework-Forced

**When this applies:** before relitigating, "simplifying," or carrying forward any past decision — check its provenance first. A decision forced by a tool deficiency must be re-derived when the tool changes; a user-owned decision is a premise. Transcript-verified from the first iteration's sessions.

**User-owned (premises — never relitigate without explicit user direction):**

- Everything in the seed contract: canonical editor text, raw render command, recovery-repo model, save gate, central `~/.pandoc` assets, global figures dir, diagram-tool allowlist, hover-edit via filter metadata, fail-loud config, structured errors, trust model ([Contract Invariants and Ownership Boundaries](contract-invariants-and-ownership-boundaries)).
- MathJax always, no engine option anywhere — KaTeX cannot cover pandoc's full math syntax (P4 of [Proof Obligations (P1–P11)](proof-obligations)).
- Harness-first M0 and real-display tauri-mode-only feature proof.
- gum first-run walkthrough, launcher-owned, runtime stays strict (ratified at halt-time).
- Heavy QC at push, instant checks at commit; pushes only on explicit authorization ([Workflow Lessons: Hooks, Pushes, CI](workflow-lessons-hooks-pushes-ci)).

**Framework-deficiency-forced (NOT product decisions; re-derive whenever the harness/stack changes):**

- ~~In-webview path-entry file dialogs~~ — forced by "tauri-playwright can't drive GTK choosers," laundered into a 'permanent design decision' via a false-premise plan question, REJECTED by the user. Correct resolution: native dialogs; prove the backend command, not the widget.
- ~~`window.__PPE_EDITOR__` editor global~~ — forced by the plugin's `fill()`/`type()` hard-coding the HTMLInputElement setter (throws on contenteditable/CodeMirror). REJECTED as a product surface. If an app-owned programmatic editor API exists it must be justified by real product callers, not specs.
- Same-document preview injection (no iframe) — forced by TauriPage having no `frameLocator`. Note the current P1 obligation says "preview iframe document": the constraint did not survive into the new obligations, so the injection strategy is open for re-derivation under the current harness.
- pnpm — chosen only to byte-match the tauri-playwright reference repo. Superseded: this project uses bun per global conventions.
- React 18 — agent-recommended as "most in-distribution," user-locked for that iteration only. Superseded: greenfield2 is Svelte 5. Stack choice is not contract.
- tauri-plugin-playwright always-on in the production binary ("proven binary is the daily binary") — decided inside the tainted harness-first frame; defensible but standing-for-re-decision, not canon.

**The audit rule this table exists to enforce:** when a recorded decision's justification names a tool limitation ("X cannot drive/express/reach Y"), verify the limitation against the tool's current docs before honoring the decision — and never let such a decision reshape a user-facing surface ([Threat Model: Polished Fallback Machine](threat-model-polished-fallback-machine)).
