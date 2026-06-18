---
name: per-milestone-gate-must-run-full-suite
description: Per-milestone proof gates must run the FULL d-suite + p-suite, not just targeted specs
metadata:
  type: feedback
---

Running only a milestone's own new specs + a few hand-picked regressions at each merge gate lets a spec OUTSIDE that picked set break silently and stay red across later milestones.
Observed: `d14-first-run-doctor-clean` went red at Phase A (P72 added a required `lint_rules` key to the pandoc-md-lint schema without updating `first-run.sh`), and stayed red through Phases B, C, and into D — uncaught because the per-phase gates were targeted (the chosen p-specs + a few regressions), and the d-series (doctor) specs were never in those gates.

**Why:** a fresh install generating a schema-invalid plugin config is a real user-facing defect (the first-run doctor-clean guarantee).
It was invisible because nothing in the per-phase gate exercised it.

**How to apply:** before merging ANY milestone to main, run the FULL proof suite — every `d*.spec.ts` AND every `p*.spec.ts` — serially (single-tenant `:88`, see [[proof-display-88-single-tenant]]), not just the milestone's own specs.
A green milestone gate that skips the d-suite is not a real baseline.
If a pre-existing red surfaces, triage it (history: `git log -S <key>` to confirm pre-existing vs. introduced) before attributing it to the current work — adversarial reviewers will misattribute a pre-existing red to the diff in front of them.
See [[proof-run-environment-setup]].
