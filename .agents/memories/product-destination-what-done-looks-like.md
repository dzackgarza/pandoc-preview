# Product Destination: What Done Looks Like

**When this applies:** scoping any milestone, judging MVP-ness, or deciding whether a feature belongs. This is the end-state guide distilled from the seed contract (`docs/vendor/` in the first iteration, user-authored, authoritative) plus the user's halt-time corrections. The current proof set is [Proof Obligations (P1–P11)](proof-obligations).

**The finished app is an ordinary-feeling Linux desktop editor** — and "ordinary" is load-bearing. The seed contract states: "the application is expected to have ordinary editor affordances such as opening, saving, keyboard shortcuts, a menu bar, recent files, and user-visible dialogs" — unspecified because assumed. The first iteration shipped none of them; their absence is what made it unusable. Concretely: native menus (Tauri Menu API), native file dialogs (Tauri dialog plugin), toasts for errors (not a status-bar error strip), a readable themed CodeMirror editor, 50/50 resizable panes, recent files, keyboard shortcuts. For power workflows the integration spirit goes further: quick-open belongs to familiar system tools (fzf/dmenu-class), per [Founding Philosophy: Exact Pandoc Preview](founding-philosophy-exact-pandoc-preview).

**Core working loop (the MVP bar, must exist before anything else):** open project/file → edit in CodeMirror (canonical text) → live preview through the user's real configured pandoc command with their real `~/.pandoc` template + filters (amsthm/theorem environments render) → MathJax typesets math → save. P1–P5 pin this loop with witness-fixture exactness.

**Full destination, beyond the loop:**

- Git-native persistence: autosave commits to an XDG recovery repo (sub-10s recoverable loss); Save = real Git commit for tracked files; prominent tracked/untracked indicator; Git local-only (no push/pull/branch UI).
- Save gate: every path-consuming action (plugin, export, diagram, figure, open/new with dirty buffer) resolves durable identity first.
- Exports as real command executions: HTML (self-contained), PDF via lualatex (hard dependency).
- Settings: structured Pandoc controls that parse/reconstruct the raw command string; a raw-command tab always authoritative; settings round-trip to XDG TOML.
- First-run: gum walkthrough writes complete config, app boots to editor ([First-Run Config Bootstrap Pattern](first-run-config-bootstrap-pattern)).
- Figure library over one configured global figures dir (never `./figures`); one-button FreeTikZ/quiver extraction → deterministic tikz-cd insertion at cursor; launch of supported diagram tools (Qtikz, Tikzit, Inkscape, xournalpp, ipe) post-save-gate; drawio/xournal/TikZjax permanently banned.
- Hover-to-edit: filter-tagged `.pandoc-preview-editable` elements postMessage source positions; app moves editor selection; app never scrapes rendered HTML for semantics.
- Compile log surface showing the real subprocess command and exit status (P11).
- Citation insertion (Zotero CAYW integration existed in the original app; "citation insertion" is in the seed contract's canonical-text enumeration) — late-stage, post-MVP.

**Explicit non-goals (never build):** cross-platform, multi-user, collaboration, hosted deployment, security hardening, XSS/sanitization/sandboxing of preview, dynamic ports, generic Git client UI, full file manager, Express preview server, in-browser TikZ.

**Sequencing rule from the failure:** the core working loop is provable and human-verifiable before any later-stage feature starts ([Threat Model: Polished Fallback Machine](threat-model-polished-fallback-machine)).
