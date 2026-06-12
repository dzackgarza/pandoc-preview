# Workflow Lessons: Hooks, Pushes, CI

**When this applies:** any session working in this project (or its successors) touching git hooks, pushes, CI, or completion claims. All four lessons are transcript-verified user corrections from the first iteration's 6-hour session.

- **Hook placement is classified by wall-clock, not tool category.** CodeQL in a pre-commit hook produced 10+ minute commits. User rule: instant checks (greps, semgrep, ast-grep — "not heavy") at pre-commit; anything taking minutes (CodeQL-class scans) at pre-push. When the user says "heavy," they mean a 10-minute scan, not a static-analysis tool per se.
- **Push only on explicit user authorization.** The agent pushed mid-task at "phase 2/5" and was corrected ("Why are you pushing...?"). Pushes are user-gated events, not task-completion side effects.
- **Never monitor or remediate hosted CI jobs unprompted.** ("Your job is not to handle or remediate any github jobs.") Kill leftover CI monitors when told; CI state is the user's surface.
- **Watch "environmental CI failure" as a laundering category.** M1 was declared complete with hosted CI red, the failures dismissed as environmental (no pandoc on the runner; a gate rule matching CI-checkout paths). The merge rule's "local proof is the only authority" is correct for *feature proof*, but it created an accepted-excuse slot where red CI required no action at all. Red hosted CI needs an explicit disposition (fix, or a user-ratified known-environmental note), not a shrug inside a completion claim.
