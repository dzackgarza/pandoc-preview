# Product Destination: What Done Looks Like

**When this applies:** scoping any milestone, judging MVP-ness, or deciding whether a feature belongs.
This is the end-state guide distilled from the seed contract (`docs/vendor/` in the first iteration, user-authored, authoritative) plus the user's halt-time corrections.
The current proof set is [Proof Obligations (P1–P11)](proof-obligations).

**The finished app is an ordinary-feeling Linux desktop editor** — and "ordinary" is load-bearing.
The seed contract states: "the application is expected to have ordinary editor affordances such as opening, saving, keyboard shortcuts, a menu bar, recent files, and user-visible dialogs" — unspecified because assumed.
The first iteration shipped none of them; their absence is what made it unusable.
Concretely: native menus (Tauri Menu API), native file dialogs (Tauri dialog plugin), toasts for errors (not a status-bar error strip), a readable themed CodeMirror editor, 50/50 resizable panes, recent files, keyboard shortcuts.
For power workflows the integration spirit goes further: quick-open and similar OS integrations belong behind the plugin firewall as drop-in scripts using familiar system tools (fzf/dmenu/kitty popups/AGS/gum) rather than app-owned features — see the firewall doctrine in [Plugins, Diagrams, Figures Requirements](plugins-diagrams-figures-requirements).

**Core working loop (the MVP bar, must exist before anything else):** open project/file → edit in CodeMirror (canonical text) → live preview through the user's real configured pandoc command with their real `~/.pandoc` template + filters (amsthm/theorem environments render) → MathJax typesets math → save.
P1–P5 pin this loop with witness-fixture exactness.

**Full destination, beyond the loop:**

- Project/file tree: **collapsible**, **respects .gitignore**, with its own simple config block (filter lists, show-hidden-files/folders toggles, etc.) — behavior is config-driven, not hardcoded taste (user, 2026-06-13).
- Git-native persistence: autosave commits to an XDG recovery repo (sub-10s recoverable loss); Save = real Git commit for tracked files; prominent tracked/untracked indicator; Git local-only (no push/pull/branch UI).
- Save gate: every path-consuming action (plugin, export, diagram, figure, open/new with dirty buffer) resolves durable identity first.
- Exports as real command executions: HTML (self-contained), PDF via lualatex (hard dependency).
- Settings: structured Pandoc controls that parse/reconstruct the raw command string; a raw-command tab always authoritative; settings round-trip to XDG TOML.
- First-run: gum walkthrough writes complete config, app boots to editor ([First-Run Config Bootstrap Pattern](first-run-config-bootstrap-pattern)).
- Figure library over one configured global figures dir (never `./figures`); one-button FreeTikZ/quiver extraction → deterministic tikz-cd insertion at cursor; launch of supported diagram tools (Qtikz, Tikzit, Inkscape, ipe) post-save-gate; drawio/TikZjax permanently banned; xournalpp dropped. Second sidebar tab for figures (tikz). TikZ mode for editing `.tex` files in the figures directory (compile → SVG preview). Visual figure insertion gallery with rendering upkeep (cache + systemd recompilation of stale figures).
- Primitive scroll sync between editor and preview (ultimately required; "primitive" is the bar — proportional + source-line snap class, not perfection).
- A debugging pane: render-pipeline failures dump logs/stdout/stderr there; the pandoc-command module doubles as a playground for testing flags/filters/templates ([Rendering Pipeline Requirements: Filters, MathJax, References](rendering-pipeline-requirements-filters-mathjax-references)).
- Drop-in script plugin system with a dynamically populated plugin menu ([Plugins, Diagrams, Figures Requirements](plugins-diagrams-figures-requirements)).
- Zotero citation insertion owned by Zotero's CAYW popup; the app may hard-require a Better BibTeX export to function.
- Hover-to-edit: filter-tagged `.pandoc-preview-editable` elements postMessage source positions; app moves editor selection; app never scrapes rendered HTML for semantics.
- Compile log surface showing the real subprocess command and exit status (P11).

**Phase 2 (Firenvim demoted 2026-06-15):** Firenvim is demoted to very late, fully optional. CodeMirror 6 extensions natively provide folding, autocomplete/snippets, and most editor-productivity features previously gated on Firenvim. Autocomplete and snippets (quicktex-class 281-entry dict migrated as a CodeMirror completion source) are now Tier-0 concerns. Conceals are very optional since the live preview is already good. Firenvim embedding is only pursued if a vim-modal-editing experience is specifically desired; it no longer gates any other feature ([Lineage: Vim Live-TeXing Setup](lineage-vim-live-texing-setup), [Editor Experience Targets: Conceals, Folding, Expansion](editor-experience-targets-conceals-folding-expansion)).

**Feature wishlist (post-MVP, user 2026-06-13 — source reference implementations from Obsidian plugins where they exist, per [Reference Repo Map: Subsystem Sources](reference-repo-map-subsystem-sources)):**

- Follow wikilinks when reasonably resolvable; follow crefs to their definitions; follow Zotero refs externally — open the Zotero item or even the attached PDF.
- CriticMarkup rendering with basic accept/reject controls (an entire open-source Obsidian plugin exists; the old repo's TODO had deprioritized "CriticMarkup GUI" — it is wishlist, not dead).
- Image lightboxes; hover-preview of image links (both have existing Obsidian plugin implementations).

**Explicit non-goals (never build):** cross-platform, multi-user, collaboration, hosted deployment, security hardening, XSS/sanitization/sandboxing of preview, dynamic ports, generic Git client UI, full file manager, Express preview server, in-browser TikZ.

**Sequencing rule from the failure:** the core working loop is provable and human-verifiable before any later-stage feature starts ([Threat Model: Polished Fallback Machine](threat-model-polished-fallback-machine)).
