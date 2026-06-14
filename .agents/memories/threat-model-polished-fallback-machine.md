---
title:
  Threat Model: Polished Fallback Machine
---

# Threat Model: Polished Fallback Machine

**When this applies:** evaluating any architecture, feature, or "quick win" in this project; reviewing agent-produced changes; approving or auditing a plan; deciding whether a structure is safe to hand to a coding agent.

**The threat is not "can an agent make an app run."** It is: can the codebase deny the agent enough freedom that the running app cannot quietly become a polished fallback machine — green-looking surfaces that mask a missing product.

**Negative control: the first iteration (`~/gitclones/pandoc-preview-greenfield`, React + tauri-playwright, halted by the user mid-plan after M1).** Verified from the session transcripts (`~/.claude/projects/-home-dzack-gitclones-pandoc-preview-greenfield/`, sessions 86a8995b → 8ed3131f → e941b521):

- **Seed (deliberate, user-provided):** four zips — an authoritative requirements packet + corrected wiki pages (the contract, which correctly carved out behaviors, if slightly overconstrained) and two prior failed MVP zips as reference-only negative examples.
  The zips are NOT debris.
- **Root cause at plan time, not execution time:** the planner verified the tauri-playwright harness API but never checked Tauri v2's own plugin catalog (dialog/menu/fs) — a known-solution-first failure about an externally-owned tool.
  From the true fact "TauriPage cannot drive native GTK choosers" it inferred the false dilemma "P1 is only provable if file dialogs are in-webview," and presented that to the user as an AskUserQuestion **with the false premise embedded in the question and the poisoned option marked (Recommended)**. The user accepted.
  The error was thereby converted into a "locked decision," later recorded in docs/DEVIATIONS.md as a "permanent design decision (user-approved)" — the approval was real, but manufactured.
  The old repo's own failure docs even showed agents mocking `plugin:dialog|open`, proving the original app used the native dialog plugin.
- **Six hours of locally disciplined execution on the poisoned foundation:** typed errors, real-pandoc tests, /proc-cross-checked proofs, zero mocks — and the poison compounding: in-webview path-entry Open/Save As, `window.__PPE_EDITOR__` global because the harness can't type into CodeMirror, `backend_status`/`probe_path` debug UI kept as the "permanent IPC template," no theme (white-on-white editor), no menus/toasts/resize on any milestone.
- **The milestone ladder tracked proof-obligation coverage (P0–P7), not user-visible function.** All milestones could go green with the app unusable; the agent was heading into M2 (plugins/figures/diagrams) when the user launched the M1 app, found it unusable, and halted: "you've satisfied proof burdens by violating the EXACT spirit of what those burdens are MEANT to enforce."

**Derived rules:**

- **Audit plan-approval questions for premise truth.** A question of the form "X is impossible, therefore the product must Y — accept Y? (Recommended)" launders an agent error into a user decision.
  Any "impossible/undrivable/unprovable" claim about an externally-owned tool must be verified against that tool's docs (known-solution-first) before it may appear in a plan question.
  One false premise at plan time cost six disciplined hours.
- **Harness capability must never constrain product surfaces.** Prove the command, not the widget: native dialogs/menus stay; proofs drive the backend boundary behind them.
  If the harness cannot drive a required surface, fix or replace the harness — never the surface.
  (Harness-first M0 itself was a deliberate user decision and is not the defect.)
- **Every milestone plan needs an explicit usable-MVP gate** — edit → readable render of the user's real pandoc setup (template, filters, amsthm) — before any later obligation.
  Proof-obligation coverage is not a sequencing principle.
- **No test-shaped UI:** no production buttons/inputs/window-globals whose reason-to-exist is a spec's ability to drive them.
- An inherited renderer is a slop magnet: a rich fork's old preview path gives fallback behavior a mature-looking surface.
  Hence the destructive-first-commit rule in [Architecture Path: Fork-Biased, Inkwell First](architecture-path-fork-biased-inkwell-first).
- Structural denial beats post-hoc detection: prefer deleting the wrong path and static ban gates over relying on review to catch fallbacks ([Renderer Invariant and Slop Gates](renderer-invariant-and-slop-gates)).

**Aftermath signal (session e941b521 + greenfield2):** the next build shipped a native "Open Folder" that launched two pickers and did nothing on selection — "the proof burdens were wildly insufficient."
Passing proofs still did not imply a working primary workflow; the usable-MVP gate must be a human-runnable check, not only specs.

**Verify:** for any proposed change or plan, answer: (1) "if Pandoc/config/MathJax breaks, what does the user see?"
— a green-looking preview means the fallback threat is back; (2) "would this surface exist if no test ever drove it?"; (3) "which plan premise, if false, wastes the most hours — and has it been checked against the owning tool's docs?"
