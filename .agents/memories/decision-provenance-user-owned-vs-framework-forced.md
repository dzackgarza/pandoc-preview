# Decision Provenance: User-Owned vs Framework-Forced

**When this applies:** before relitigating, "simplifying," or carrying forward any past decision — check its provenance first.
A decision forced by a tool deficiency must be re-derived when the tool changes; a user-owned decision is a premise.
Transcript-verified from the first iteration's sessions.

**User-owned (premises — never relitigate without explicit user direction):**

- Everything in the seed contract: canonical editor text, raw render command, recovery-repo model, save gate, central `~/.pandoc` assets, global figures dir, diagram-tool allowlist, hover-edit via filter metadata, fail-loud config, structured errors, trust model ([Contract Invariants and Ownership Boundaries](contract-invariants-and-ownership-boundaries)).
- MathJax always, no engine option anywhere — KaTeX cannot cover pandoc's full math syntax (P4 of [Proof Obligations (P1–P15)](proof-obligations)).
- **Renderer is a swappable plugin; the app is renderer-agnostic (ratified 2026-06-13).** The app core owns NO renderer-specific knowledge.
  Pandoc specifics (flags, filters, templates, semantic deconstruction) live inside a pandoc renderer plugin; a generic renderer plugin (script: markdown stdin → HTML stdout, raw-string-only config) is the no-enforcement escape hatch and the proof the abstraction holds (markdown-it must work).
  Plugins may define their own config pages.
  Full contract: [Renderer Plugin Architecture](renderer-plugin-architecture).
- **Pandoc command model (ratified 2026-06-13):** within the pandoc renderer plugin, the raw command string is the canonical stored form, always extractable/input-able; the plugin derives a semantic data type from it (filters, template, enforced flags + opaque extra-args bag) via real arg-parsing libraries, never hand-rolled splitting.
  Structured config fields as stored truth are rejected.
  Full contract: [Pandoc Command Model and Raw String Contract](pandoc-command-model-and-raw-string-contract).
- Harness-first M0 and real-display tauri-mode-only feature proof.
- gum first-run walkthrough, launcher-owned, runtime stays strict (ratified at halt-time).
- Heavy QC at push, instant checks at commit; pushes only on explicit authorization ([Workflow Lessons: Hooks, Pushes, CI](workflow-lessons-hooks-pushes-ci)).

**Framework-deficiency-forced (NOT product decisions; re-derive whenever the harness/stack changes):**

- ~~In-webview path-entry file dialogs~~ — forced by "tauri-playwright can't drive GTK choosers," laundered into a 'permanent design decision' via a false-premise plan question, REJECTED by the user.
  Correct resolution: native dialogs; prove the backend command, not the widget.
- ~~`window.__PPE_EDITOR__` editor global~~ — forced by the plugin's `fill()`/`type()` hard-coding the HTMLInputElement setter (throws on contenteditable/CodeMirror).
  REJECTED as a product surface.
  If an app-owned programmatic editor API exists it must be justified by real product callers, not specs.
- Same-document preview injection (no iframe) — forced by TauriPage having no `frameLocator`. Note the current P1 obligation says "preview iframe document": the constraint did not survive into the new obligations, so the injection strategy is open for re-derivation under the current harness.
- pnpm — chosen only to byte-match the tauri-playwright reference repo.
  Superseded: this project uses bun per global conventions.
- React 18 — agent-recommended as "most in-distribution," user-locked for that iteration only.
  Superseded: greenfield2 is Svelte 5. Stack choice is not contract.
- tauri-plugin-playwright always-on in the production binary ("proven binary is the daily binary") — decided inside the tainted harness-first frame; defensible but standing-for-re-decision, not canon.

**RESOLVED 2026-06-13 — render command shell-EXECUTION semantics (was the open cross-iteration contradiction):** the original repo spawned the renderer with `shell: true` (pipes/env interpolation); the greenfield iterations `shell_words::split` and spawned directly.
This is no longer an app-level question.
Render became renderer-plugin-owned ([Renderer Plugin Architecture](renderer-plugin-architecture)): the pandoc plugin builds and spawns a pandoc argv; the generic plugin runs the user's script (which may itself be a shell pipeline) over stdin→stdout.
Complex `shell: true`-style pipelines (latexmk and friends) belong to the EXPORT path, never render.
Exec strategy is now each plugin's internal concern, so there is no global contradiction to surface — the only standing rule is that the pandoc plugin parses (never naively splits) the command for its semantic model.

**Open decision (2026-06-13) — preview reader format vs precise scroll sync.** Precise source↔preview scroll sync needs per-element source positions, which pandoc emits only for CommonMark-family readers (`+sourcepos`); the shipped `-f markdown` reader cannot, and no Lua-filter recovers them ([Reference: Source-Preview Scroll Sync](reference-source-preview-scroll-sync), verified on pandoc 3.6). Switching the *preview* reader to `commonmark_x` gains `sourcepos` but loses `+citations` and raw-LaTeX-environment parsing — conflicting with the "exact pandoc preview" invariant whenever the export command uses `-f markdown`. UNRESOLVED — the user must choose: (a) proportional-only sync to preserve exactness, or (b) a preview/export reader split to enable precise line-mapping.
Surface before the scroll-sync feature hardens.

**Seed-packet corrections (user statements postdating the packet win):**

- **xournalpp is dropped** (user, 2026-06-13) — the seed REQUIREMENTS.md still lists it in the supported diagram tools and PROOF_OBLIGATIONS.md calls it "the supported Xournal-family tool"; both are stale.
  Current focus: quiverapp, qtikz, ipe (+ FreeTikZ/Tikzit/Inkscape-class).
  drawio remains banned.
- The user characterizes the seeds as "correctly carve out many behaviours, if not slightly overconstrained" — when a seed rule produces absurd UX (cf.
  the first-run config dead-end), suspect overconstraint and ask, rather than either silently obeying or silently amending.

**The audit rule this table exists to enforce:** when a recorded decision's justification names a tool limitation ("X cannot drive/express/reach Y"), verify the limitation against the tool's current docs before honoring the decision — and never let such a decision reshape a user-facing surface ([Threat Model: Polished Fallback Machine](threat-model-polished-fallback-machine)).
