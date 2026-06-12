# Contract Invariants and Ownership Boundaries

# Contract Invariants and Ownership Boundaries

**When this applies:** writing or reviewing any runtime code in this project. Distilled from the user-authored seed contract (REQUIREMENTS.md, DESIGN_COMMITMENTS.md, wiki Product-Contract / Ownership-Boundaries — `docs/vendor/` in the first iteration). These are premises, not suggestions; do not relitigate.

**Document and state:**
- Editor text is the canonical document; preview, diagnostics, filesystem, Git state are derived.
- No document without identity: a no-file launch creates a real temp `.md` in the recovery store before edits can occur. The recovery file IS the unsaved-buffer model — never build a parallel in-memory one.
- Save As / New: targets may be absolute or workspace-relative; saving outside the workspace re-roots Explorer/dialog state to the new directory.

**Renderer:**
- The raw configured `render_command` string is the single source of truth. The app never adds renderer-specific config keys (a second source of truth) and never special-cases Pandoc beyond convenience controls that parse/reconstruct the raw string.
- stdin=canonical markdown, stdout=preview HTML, stderr=diagnostics, nonzero exit=failure; duration is diagnostics only, never part of the success contract.
- Render failure never fabricates preview HTML. A prior successful preview may persist only if explicitly marked stale (this stale-preview semantic is contract-sanctioned, not slop).

**Pandoc assets:** templates/filters centralized under `~/.pandoc/` (version-controlled dotfiles); app validates existence at startup; templates are data — app code never embeds template content or builds templates by string manipulation. Theorem/callout semantics, semantic HTML, and hover-edit metadata are owned by templates/filters, never reimplemented app-side.

**Errors:** structured IPC results only. `Ok` means success; `Ok({ok:false})` banned; no error→falsey conversion, no suppressed stderr, no invisible catches. Missing config/template/filter/dependency = visible fatal diagnostic.

**Trust model:** one trusted workstation. No XSS prevention, no sanitization, no preview sandboxing, no dynamic-port security. The contract's stated threat is "future development that makes the app worse while appearing productive" — fallbacks, mocks, hidden defaults, success-shaped errors, feature flags, compat shims.

**Module ownership (one owner per concern; wiring files like App/main own no semantics):** `document-session` (identity, transitions, dirty state) · `recovery-repo` (XDG Git store; never degrades to non-Git writes) · `save-gate` (durable-path precondition; never runs downstream commands or guesses filenames) · `renderer-command` · `config-validation` (no runtime defaults; example-config generation is a separate explicit command) · `pandoc-assets` · `plugin-runner` (post-save-gate only) · `figure-registry` (global dir only) · `diagram-tools` (allowlist; rejects banned tools by name) · `hover-edit-bridge`.

Related: [Product Destination: What Done Looks Like](product-destination-what-done-looks-like), [Renderer Invariant and Slop Gates](renderer-invariant-and-slop-gates), [Proof Obligations (P1–P11)](proof-obligations).