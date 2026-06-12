# Threat Model: Polished Fallback Machine

**When this applies:** evaluating any architecture, feature, or "quick win" in this project; reviewing agent-produced changes; deciding whether a structure is safe to hand to a coding agent.

**The threat is not "can an agent make an app run."** It is: can the codebase deny the agent enough freedom that the running app cannot quietly become a polished fallback machine — green-looking surfaces that mask a missing product.

**Negative control (the first failed app exhibited the full class):** no config prompt, unreadable CodeMirror styling, no real menus, debug/probe UI shipped, fake path-entry Open instead of native dialog, broken directory listing, no amsthm/Pandoc rendering, broken pane resizing, and movement toward later features before edit → render worked. The suite was green while the product was absent — so the architecture must make this class *structurally difficult*, not merely test-failed.

**Derived rules:**

- An inherited renderer is a slop magnet: a rich fork's old preview path gives fallback behavior a mature-looking surface, which is worse than greenfield. Hence the destructive-first-commit rule in [Architecture Path: Fork-Biased, Inkwell First](architecture-path-fork-biased-inkwell-first).
- Featureful-MVP-then-harden greenfield is the worst match: it maximizes agent design freedom exactly where agents are weakest (long-horizon architecture, resisting fallback paths and test-shaped UI). Acceptable only as a throwaway spike, never the production branch.
- Edit → render must work end-to-end before any later feature is started.
- Structural denial beats post-hoc detection: prefer deleting the wrong path, static ban gates, and save/config gates over relying on review to catch fallbacks ([Renderer Invariant and Slop Gates](renderer-invariant-and-slop-gates)).

**Verify:** for any proposed change, answer "if Pandoc/config/MathJax breaks, what does the user see?" — if the answer is a green-looking preview, the change reintroduces the threat.
