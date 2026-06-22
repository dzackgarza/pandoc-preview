# AGENTS.md — Pandoc Preview

Tauri 2 (Rust) + Svelte 5 + Vite + Tailwind + CodeMirror 6 desktop editor: a CodeMirror source pane on the left, a **live, real-pandoc-rendered** HTML preview on the right, built for large mathematical research writing (theses, papers).
All rendering is the user's real configured `pandoc` command; the app owns no renderer knowledge.
Single-user Linux desktop — not cross-platform, not multi-user, not hosted.
See `README.md` for build/run.

## HARD RULE #0 — Research-first, interop-first, never greenfield

**The FIRST question on ANY task — and at the start of EVERY step within a plan — before writing a single line of code, is: "How do I write as little new code as possible, define nothing new, and instead leverage an existing mature tool, an established data format, or a reference implementation?"** Reinvention is the enemy in an app like this; owned surface is debt.

Decision order, applied to every feature AND every individual work item:

1. **Leverage.** Can an existing, well-regarded tool / library / binary / format do this?
   Use it directly — run the real binary (ChkTeX, latexmk, arxiv_latex_cleaner), embed the maintained library (pdf.js, a real parser-combinator/grammar crate), invoke the real tool's own UI (Zotero CAYW, TikzIt/QTikz/Ipe).
   **Interop, not imitation.**
2. **Support the standard format.** If users already author this with an existing tool, support that tool's NATIVE files so they bring their existing work with ZERO porting — e.g. standard quicktex definition files, UltiSnips/LuaSnip/TextMate snippets, `.tikz`/`.tikzstyles`/`.tikzdefs`, `.bib`/CSL, ChkTeX config.
   The feature is "**support** a quicktex-like workflow," never "reimplement quicktex."
3. **Port.** If behaviour must genuinely be owned in-process, PORT a well-regarded reference implementation rather than designing fresh.
4. **Greenfield is never appropriate.** If you conclude something must be built from scratch, that is a signal you have not finished steps 1–3. There must ALWAYS be a reference implementation, published examples, or other repos using the same tools to anchor the design — **cite them in the plan before writing code.**

This is not advisory and not a one-time gate.
**Every plan phase and every work item must begin with the research step that answers "what already exists," and must name the tool / format / reference implementation it leverages, supports, or ports.** A work item whose first action is "write a new X" with no such research is rejected — send it back for the research step.
A "converter that flattens someone's existing file format into our bespoke shape" is a red flag: prefer consuming the source format directly.

## HARD RULE #1 — reference the existing plans before you build anything

**Before greenfielding, scaffolding, or implementing ANY queued feature, you MUST first check whether a pre-existing plan, milestone, or proof obligation already owns it — and then follow or extend that plan instead of inventing a parallel implementation.** Adding a second, unaware implementation of something already planned or built is the primary failure mode here.

Required procedure for any feature work:

1. **Find who owns the feature.** Locate it in the canonical artifacts below (search the feature catalogue and the plans).
   Every queued feature is already mapped to a tier, a milestone, or a phase plan with proposed proof obligations.
2. **Read that plan in full** before writing code.
   The plans name the exact code seams to touch, the existing utilities to REUSE, the sub-milestone order, and the proof obligations that gate each step.
   They explicitly call out what already exists so you do not rebuild it.
3. **Extend, do not duplicate.** If the plan says a capability already exists (e.g. composable completion P51, the snippet dictionary P52, the export-plugin contract, the tikz filter pipeline), attach to it.
   Do not add a competing path.
   If a plan is wrong or stale, fix the plan first and say so — do not silently fork.
4. **Honor the discipline** (every plan restates it): TDD — design → RED proof obligations (externally observable; user-ratified) → commit RED → GREEN → commit; existing obligations P1–P69 + doctor checks stay green throughout; no fallbacks / defaults / mocks / smoke tests — fail loud.
   The proposed obligations in the phase plans (P70–P124) are PROPOSALS pending user ratification; do not treat them as accepted until the user ratifies and they are written into `proof-obligations.md`.

If no plan owns the feature, that is a signal to STOP and write/extend a plan (and get it ratified), not a license to greenfield.

## Canonical planning artifacts (the single sources of truth)

| Artifact | What it owns |
| --- | --- |
| `.agents/memories/feature-catalogue-and-implementation-status.md` | The living tiered checklist (Tier 0–8) + implementation status for the WHOLE feature contract. Start here to find which tier/plan owns a feature. |
| `.agents/memories/proof-obligations.md` | The accepted external proof obligations **P1–P69** (the contract that must stay green). |
| `.agents/memories/competitive-parity-roadmap.md` | The prioritized competitive-parity follow-up **Phases A–H**, each tagged net-new-gap / refines-Tier / maps-Tier, backed by per-program studies under `.agents/memories/parity-research/`. |
| `.agents/render-rebuild-plan.md` | The render-core rebuild plan (plugin-system-first, Milestones A–G) — the renderer/plugin/vendoring foundation. |
| `.agents/plans/phase-{a..h}-*.md` | **Full implementation plans for each parity phase** (code seams, work items, proposed obligations P70–P124, verification). |

### Phase plan → feature area map

| Plan | Owns | Proposed obligations |
| --- | --- | --- |
| `.agents/plans/phase-a-lint-fast-feedback.md` | Static lint (delimiter/math-mode balance, regex rules, typographic), structured compile-log diagnostics — feedback faster than a compile | P70–P76 |
| `.agents/plans/phase-b-snippet-engine.md` | Snippet ENGINE depth (math-mode-only expansion, autotrigger, regex/mirror tabstops) + the quicktex dictionary migration | P77–P83 |
| `.agents/plans/phase-c-citations.md` | Citation + label/`\cref` completion (metadata fuzzy-match, tooltip, per-file bib override, references sidebar) | P84–P89 |
| `.agents/plans/phase-d-figures-tikz.md` | Figure & TikZ management: the tikz-subset parser (foundation), shared `.tikzstyles`/`.tikzdefs`, owned-tikz round-trip, Ipe dual-asset registry | P90–P99 |
| `.agents/plans/phase-e-project-navigation.md` | Large-project navigation: workspace full-text search, section/env motions, command palette, frontmatter editor | P100–P106 |
| `.agents/plans/phase-f-pdf-preview-gummi.md` | PDF preview + Gummi parity + faster export feedback (SyncTeX jump, temp-dir builds, multi-pass orchestration) | P107–P113 |
| `.agents/plans/phase-g-arxiv-export.md` | Arxiv-ready export pipeline (arxiv_latex_cleaner plugin, `.bbl` baking, source flattening, tikz externalization) | P114–P119 |
| `.agents/plans/phase-h-qol.md` | Low-priority QOL (distraction-free/typewriter modes, view toggle, batch export; autocorrect deprioritized with a correctness caution) | P120–P124 |

## Durable decisions & memory

Durable decisions, contracts, and architecture live as **iwe-indexed memories** in `.agents/memories/` (managed with `iwe`; see the global memory guidance).
Read the relevant memory before changing a subsystem — keystones include `renderer-plugin-architecture`, `pandoc-command-model-and-raw-string-contract`, `plugins-diagrams-figures-requirements`, `shipped-config-vs-runtime-defaults`, `decision-provenance-user-owned-vs-framework-forced`, and `product-destination-what-done-looks-like` (the non-goals list).
Plans reference these by `[[slug]]`. Agent-facing artifacts (this file, plans, QC scripts, the agent justfile) live under `.agents/`; never expose them in the user-facing `justfile`.

## Build / test surface

All workflows route through `just` (see `README.md` and `.agents/justfile`): `just deps`, `just setup` (gum first-run → writes the XDG config; the app refuses to start without a complete `config.toml`), `just dev`, `just build`. Proofs run the real app on a real display via the `tauri-plugin-playwright` harness — real pandoc, real filesystem, hermetic `XDG_CONFIG_HOME`, independent-process disk assertions, no mocks or skips.

# Review Guidelines

These are additional requirements for reviewing agent work.
They do not replace the reviewer’s normal role, repo-specific standards, or technical
judgment. They provide the failure model that should shape the review.

The task is not merely to review a PR. The task is to decide whether a completion claim
is true under the original objective.
The standard is full, correct, provable completion against the original requirements and
repo guidelines. Anything less is incomplete work that must not be treated as a win.

## Failure Model

Agents systematically produce impressive non-completion.
Common patterns are: polished summaries that imply finished work, caveats that quietly
narrow the goal, reclassification without proof, delegated discovery presented as
resolution, process language that substitutes for evidence, merged PRs treated as
completion, passing checks treated as semantic proof, and artifacts that look
substantial while leaving required work unowned.

Treat the agent’s summary, PR description, closing comment, issue closure, “goal
completed” statement, and self-reported validations as untrusted.
They may be diagnostic pointers, but they are not evidence that the work is complete.
The evidence is the original issue or task, the code diff, tests, source/runtime facts,
review comments, and produced artifacts.

## Decisive Invariants

Preserve the original success condition.
Read the original issue or task before accepting any restatement of it.
Keep its quantifiers intact: “all,” “complete,” "full subset," “zero remaining,” and
similar terms cannot be quietly narrowed to examples, partial coverage, known blockers,
or whatever the PR happened to touch.

Nothing required may disappear silently.
A required work family must be implemented, explicitly falsified, or validly
reclassified with evidence that satisfies the issue’s own standard.
Partial implementation is not completion.
Future work is not completion.
Count reduction is not completion.
Resolved review threads are not completion.
Passing checks are not completion.
Substantial-looking work is not completion.
“Better than before” is not completion.

Goal substitution is the main thing to detect.
Ask whether the submitted work solves the original problem or merely produces a narrower
artifact: cleaner metadata, a partial subset, a better explanation, a new issue, a
renamed scope, a local workaround, or proof that someone should investigate later.

Technically correct administrative artifacts can be goal substitution.
A well-written issue, comment, audit note, scope statement, or enumeration of remaining
work may be required, but it does not complete implementation, testing, proof, or
downstream cleanup. If the original task requires execution, the artifact is only useful
insofar as it drives that execution; it must not become the stopping point.

Treat self-scoped remaining-work lists as a severe completion-laundering pattern.
When an agent is asked to enumerate remaining work, the domain is the original full
completion requirement, not the agent’s intended subset, the PR’s current shape, a
closeability criterion, or the work left after deferral and reclassification.
A valid enumeration subtracts only artifact-proven completed work from the original
contract. Deferrals, routed follow-ups, owner changes, and truthful incompletion notes
remain unresolved work unless the original task explicitly made that administrative
routing the whole deliverable.

If an agent repeats a narrowed enumeration after being corrected, treat that as a hard
misalignment signal, not as an innocent wording issue.
The reviewer should identify the original full requirement, the scope the agent
substituted, and the required work hidden by that substitution.

Silent reclassification is not resolution.
If the PR says remaining work is out-of-scope, research-owned, stub-owned, plugin-owned,
downstream-owned, or future-owned, require evidence from the relevant source/runtime
behavior, repo boundary, or original acceptance criteria.
A sentence in the PR description is not enough.

Ownership boundaries matter.
The submitting repo must prove its own claimed behavior and do the blocker forensics
required by its own issue.
Do not require a receiving or downstream repo to classify another project’s internal
uncertainty unless the original issue explicitly made that part of acceptance.
When an external issue is created, it should be written for that receiving repo, not for
a reader who already knows the submitting repo’s context.

## Evidence Expectations

Review tests as evidence, not as decoration.
Valid tests exercise the real production path or semantic requirement.
Be skeptical of helper-only tests, tautologies, assertions of the implementation’s own
output, bypasses around the runtime/plugin/stub path, example-only coverage where the
issue required full coverage, weakened assertions, and missing invalid-nearby cases
where the fix could overgeneralize.

For plugin work, the evidence should usually distinguish valid generic behavior from
invalid nearby ordinary Python and should not hard-code a downstream consumer.
For stubs work, the evidence should be source-backed: the upstream surface exists, the
stub matches public behavior, no fake API is added, no Any/object opacity escape is
introduced, and inherited-method inflation is not used unless source exposes that
surface.

Watch for code-level laundering: hard-coded consumer names, support for local research
abstractions as if they were external API, fake stubs, broad Any/object escapes, line
suppressions, diagnostic filtering, deletion of required data, broad type widening, and
any move that makes checks pass by weakening the problem instead of solving it.

## When Acting on Review Feedback

A positive disposition requires a commit.

Do not resolve an accepted review comment until the code/proof remediation is committed and the reply cites the commit.

Never reply “accepted,” “aligned,” “fixed,” “addressed,” or “will address” to a review thread unless the remediation is already committed. A thread cannot be resolved on intent or future work.

Rejected and modified feedback must be collected in a top-level PR comment titled `Review feedback disposition ledger` so resolved threads do not hide the audit trail.

Review comments are not implementation specs. The worker must translate accepted feedback into first-principles remediation requirements before assigning implementation.

For each comment:
- Identify the concern.
- Identify the proposed fix.
- Decide whether the concern is true under global + repo policy.
- Decide whether the proposed fix preserves those policies.
- If the concern is true but the fix is wrong, apply a policy-compatible remediation.

## Writing the Review

Write nuanced feedback for an intelligent reader.
Do not force a machine-readable template, a mandatory table, or a simplistic pass/fail
label when prose communicates the situation better.
Do make the completion judgment clear: whether the original task can be considered
complete, what evidence supports that judgment, and which unresolved requirements block
completion if any remain.

Do not foreground effort, progress, good intentions, volume of work, or “substantial”
partial implementation when required work remains.
Mention completed pieces only when they are necessary to identify the exact remaining
blockers or to prevent redoing already-correct work.
Do not compare incomplete work to “no work done” or “completely fake work”; compare it
to the expected standard: the task done correctly, completely, and provably.

When required work remains, lead with the incompleteness and the concrete blockers.
Do not make the reader excavate the missing work from beneath praise, context-setting,
or a narrative of what did get done.

Nuance belongs in the evidence and blocker analysis, not in softening the completion
standard. The review should make it easy to finish the work, not easy to feel satisfied
with less than the original contract required.
