# Feature Catalogue and Implementation Status

**When this applies:** scoping milestones, picking the next feature, judging completion claims, or answering "what is left."
This is the living checklist over the full feature contract; detail lives in the linked memories, status lives here.

**Checkbox rules (hard):** a box is checked only when the feature is implemented AND proven — its proof obligations green ([Proof Obligations (P1–P15)](proof-obligations)) plus a human-runnable check, with user ratification for anything user-facing.
Agent self-report is not proof.
Check items via `iwe update` with the full body (keep this H1). A checked box on a broken feature is the [Threat Model: Polished Fallback Machine](threat-model-polished-fallback-machine) failure — when in doubt, leave unchecked.
New features get a line in the right tier; involved features get their own detail memory, linked from the line.

**Status snapshot (2026-06-13):** greenfield2 has scaffolding (config.rs, doctor.rs, render.rs, fsops.rs, EditorPane, toasts) but nothing user-ratified; render.rs currently violates BOTH the [Renderer Plugin Architecture](renderer-plugin-architecture) (renderer knowledge lives in the app core, not a plugin) and the [Pandoc Command Model and Raw String Contract](pandoc-command-model-and-raw-string-contract) (structured fields), so the core loop must be rebuilt on the ratified renderer-plugin + raw-string contract before any box here can be checked.

**Ordering:** tiers by user-declared importance.
Sequencing rule still binds: every Tier-0 item is provable and human-verified before work starts on any later tier ([Product Destination: What Done Looks Like](product-destination-what-done-looks-like)).
Focus is on a usable shipped product for real writing ASAP; convenience features come only after the core is battle-tested in real workflows, since real feedback may reprioritize.

**Firenvim decision (2026-06-15):** Firenvim is demoted to very late, fully optional. CodeMirror 6 extensions natively provide folding, autocomplete/snippets, and most editor-productivity features previously gated on Firenvim. Conceals are demoted to very optional since the live preview is already good. Autocomplete/snippets are now Tier-0 concerns delivered through CodeMirror extensions and plugins like [emmetio/codemirror6-plugin](https://github.com/emmetio/codemirror6-plugin), not through Firenvim.

## Tier 0 — Core working loop (the product itself; the MVP gate)

- [ ] Open project/file → edit in a readable, themed CodeMirror pane (canonical text ownership)
- [ ] Live preview through the user's REAL raw pandoc command with their real `~/.pandoc` template + filters — amsthm/theorem environments render ([Pandoc Command Model and Raw String Contract](pandoc-command-model-and-raw-string-contract), [Required Filter Set](required-filter-set), [Shipped Template Requirements](shipped-template-requirements))
- [ ] MathJax always (no engine option) with macro-tier injection ([MathJax Macro System: Tiers and Injection](mathjax-macro-system-tiers-and-injection))
- [ ] Render failures NON-FATAL: Overleaf-style log surface + clean recovery on next good render ([Failure Semantics and Product State Model](failure-semantics-and-product-state-model))
- [ ] Save works (= real Git commit for tracked files)
- [ ] Ordinary editor affordances: native menus, native file dialogs (Open/Save As), error toasts, recent files, keyboard shortcuts, find, resizable 50/50 panes with reset, window-title dirty indicator, **folding** (CodeMirror extension — not Firenvim), **matched delimiter highlighting** (to help diagnose missing delimiters), **indentation guides**, **Ctrl+/ comment/uncomment line selections** ([Product Destination: What Done Looks Like](product-destination-what-done-looks-like))
- [ ] Math-research insertion bar — **NOT a standard formatting toolbar**. Making text bold or an H3 in markdown is trivial (vs LaTeX) and is not the point; the bar is geared to math writing.
  Quick-inserts: named amsthm environments (remark / lemma / theorem / proof / …), tikz and tikzcd scaffolding, launchers for the diagram plugins, insert-image-from-clipboard, `\cref` with a populated picker of available labels/references (**workspace-aware — scans across subdocuments**, not just the current file), **bib citation autocomplete** (needs a required bib file declared in config), Zotero-linked citations, a small n×m matrix builder, a table builder, a dropdown of user-defined quick-insert snippets, code-block-type dropdowns, and a **footnote key-combo that pops up a temporary modal/popup to write the entire footnote body, inserted all at once at cursor when confirmed**.
  Entries light up as their dependencies land (diagram launchers → Tier 3; clipboard image → Tier 3 figures; cref label list → workspace scanning; Zotero → Tier 4; bib autocomplete → bib file in config; snippets → autocomplete below).
- [ ] **General autocomplete and snippets** via CodeMirror 6 extensions (replaces Firenvim dependency for text expansion): extensible completion sources, integration points for plugins like [emmetio/codemirror6-plugin](https://github.com/emmetio/codemirror6-plugin), user-defined snippet dictionaries (quicktex-class 281-entry dict migrated as a completion source)
- [ ] **Spellcheck** with a custom dictionary, ideally compatible with vim dictionaries
- [ ] **Outline/TOC sidebar**: standard document outline with keyboard shortcuts to jump between markers. Includes not just headers but all fenced divs — e.g. `:::{.remark title="On ABCD"}` renders as "Remark: On ABCD" in the outline, indented under the appropriate subsection
- [ ] Extremely good **pandoc-aware syntax highlighting** in the editor — **SCOPED 2026-06-13** ([Reference: Pandoc-Aware Editor Syntax Highlighting (CodeMirror 6)](reference-pandoc-aware-editor-highlighting)): extend `@lezer/markdown` via the `MarkdownConfig` API (Zettlr's architecture — GPL, reimplement; one small parser per construct), math sub-highlighting via the stex stream trick. **Must account for fenced divs** (e.g. `:::{.remark}`). Lower priority within Tier 0 — may require defining an entire parser/grammar for this extended markdown flavor. Implementation pending
- [ ] Status cluster: cursor position, word/line count, file path, render state + duration, save state + saved-ago, backup timestamp (mined from ppe main + tauri branches)
- [ ] Editor display options in config: theme (dark/light), font size, line wrapping, line numbers — live-applied
- [ ] Fail-loud config validation + doctor ([Doctor Contract (D1–D5)](doctor-contract))
- [ ] First-run gum walkthrough, launcher-owned; runtime stays strict ([First-Run Config Bootstrap Pattern](first-run-config-bootstrap-pattern))
- [ ] No runtime defaults/fallbacks, but a statically shipped defaults config for diagnostics only: doctor/CLI reports config-vs-shipped diff; CLI reset-to-defaults (gum-confirmed overwrite) ([Shipped Config vs Runtime Defaults](shipped-config-vs-runtime-defaults))

## Tier 1 — Recovery and git state (user: "backups and restoration pathways are the highest priority")

- [ ] XDG recovery repo with autosave commits — never lose more than several seconds of work; no-op tree detection; gigabyte-scale repos acceptable ([Recovery and Git-State Requirements](recovery-and-git-state-requirements))
- [ ] tracked/untracked/noRepo state machine with prominent indicator + state shortcuts (init repo, track file, …)
- [ ] Save gate: every path-consuming action (plugin, export, diagram, figure, open/new on dirty buffer) resolves durable identity first ([Contract Invariants and Ownership Boundaries](contract-invariants-and-ownership-boundaries))
- [ ] External-modification conflict detection: file fingerprint (content hash + mtime) checked before save; saving over a file changed on disk is refused loudly, never silently clobbered (ppe tauri branch: `commands/document.rs` fingerprinting)
- [ ] Session restore: persist last file + window state to XDG_STATE_HOME; optional restore-on-launch, including auto-restore of newer recovery-backup content
- [ ] Unsaved-changes guards: dirty-buffer prompt on file switch and on app close

## Tier 2 — Render pipeline depth

- [ ] Renderer is a swappable plugin; app core is renderer-agnostic and owns no renderer knowledge ([Renderer Plugin Architecture](renderer-plugin-architecture))
- [ ] Generic renderer plugin: script accepting markdown on stdin → HTML on stdout, raw-string-only config, zero validation — acceptance test is that `markdown-it` works with no app changes ([Renderer Plugin Architecture](renderer-plugin-architecture))
- [ ] Pandoc renderer plugin: houses all pandoc knowledge; ships the filters + templates; semantic command data type — understood subset (filters, template, formats, enforced flags e.g. wikilink compat) + ordered opaque extra-args bag; round-trip property-tested ([Pandoc Command Model and Raw String Contract](pandoc-command-model-and-raw-string-contract))
- [ ] Pandoc plugin config page (may be gum-driven rather than a bespoke GUI): flag checkboxes with required flags permanently checked/uncheckable and hover text explaining why; required filters likewise; raw-command view always authoritative; XDG TOML round-trip ([Renderer Plugin Architecture](renderer-plugin-architecture), [Shipped Config vs Runtime Defaults](shipped-config-vs-runtime-defaults))
- [ ] Pandoc-plugin-managed filter install into `~/.pandoc/filters` (canonical location; missing required filter = fatal) ([Required Filter Set](required-filter-set))
- [ ] Vendored research templates installable into `~/.pandoc/templates` — `research_draft.html` (with its `templates/css/` partials) and `research_draft.tex` (real-paper amsart template; `dzg-unified` texmf dependency doctor-checked) — same install surface as filters ([Shipped Template Requirements](shipped-template-requirements))
- [ ] Preview iframe + asset resolution ([Preview Iframe and Asset Resolution](preview-iframe-and-asset-resolution))
- [ ] Hover-to-edit: `.pandoc-preview-editable` postMessage → editor selection; app never scrapes rendered HTML for semantics
- [ ] Compile log surface: real subprocess command + exit status (P11)
- [ ] Debugging pane: pipeline failures dump logs/stdout/stderr; pandoc-command module doubles as a flag/filter/template playground ([Rendering Pipeline Requirements: Filters, MathJax, References](rendering-pipeline-requirements-filters-mathjax-references))
- [ ] Render lifecycle robustness: stale-render cancellation on overlap, configurable debounce + render timeout, manual refresh-preview that bypasses debounce
- [ ] Scroll sync — **SCOPED 2026-06-13** ([Reference: Source-Preview Scroll Sync](reference-source-preview-scroll-sync)): proportional + data-line snap (Stage 0, works with `-f markdown`) is the primitive bar; precise line-mapping needs a CommonMark reader for pandoc `sourcepos` and is **GATED on the preview-reader decision** (`commonmark_x` loses citations/raw-TeX — see [Decision Provenance: User-Owned vs Framework-Forced](decision-provenance-user-owned-vs-framework-forced)). Implementation pending
- [ ] Renderer-agnostic piping: stupidly pipe the buffer — e.g. a revealjs command works with zero app changes
- [ ] Exports as real command executions: self-contained HTML; PDF compilation completely controllable by an arbitrary user script/pipeline — latexmk-class drivers, inclusion filters (`include.lua`) for multi-section papers; the app never hardcodes a compile recipe, it runs the configured one and surfaces command/output/exit status.
  Each export type ships as a standalone, individually-managed plugin (Tier 4 richness bar) ([Rendering Pipeline Requirements: Filters, MathJax, References](rendering-pipeline-requirements-filters-mathjax-references))
- [ ] References/bibliography via the intermediate md → tex → latexmk pipeline; Better BibTeX export may be hard-required ([Rendering Pipeline Requirements: Filters, MathJax, References](rendering-pipeline-requirements-filters-mathjax-references))
- [ ] **Slides editing mode**: an entirely separate renderer plugin, hot-swappable for the standard pandoc rendering plugin — ultimately just a different pandoc command with canonical output as reveal.js slides. Delivered through the plugin system (Tier 4)
- [ ] **PDF preview** with minimal app-owned code — needs research; candidate: pdf.js or similar embedded viewer. Goal: preview PDF output in-app without heavy custom rendering code
- [ ] **PDF preview Gummi parity** (late-stage milestone): PDF preview reaches feature parity with Gummi, without attempting to handle complex LaTeX build orchestration

## Tier 3 — Workspace

- [ ] Project/file tree: collapsible, respects `.gitignore`, own config block (filter lists, show-hidden toggles) — config-driven, not hardcoded taste (implementation reference: [Reference: Tree, Tabs, File Ops (Glyph, marka.md)](reference-tree-tabs-file-ops-glyph-marka-md))
- [ ] File operations from the tree: new file/folder, rename, delete-with-confirmation, collision-safe naming — all workspace-boundary-guarded Rust commands
- [ ] **File explorer filtering**: search/filter within the file tree
- [ ] **xdg-open on unknown file types**: clicking an unrecognized file type in the file explorer launches it via `xdg-open`
- [ ] **Right-click context menu** on any item in the file explorer with an xdg-open option (plus standard file operations)
- [ ] **Ctrl+P workspace file browser**: launches a dmenu/fzf-style browser listing all workspace files for quick-open
- [ ] Figure library over ONE configured global figures dir (never `./figures`); sample config ships defaulting it to `~/.pandoc/figures`; clipboard image paste (Wayland-compatible) lands there with symlinks ([Plugins, Diagrams, Figures Requirements](plugins-diagrams-figures-requirements))
- [ ] **Second sidebar tab for figures**: dedicated sidebar view for browsing and editing figures in the configured figures directory (predominantly tikz). Registry with timestamps, search/filter, cross-document usage tracking, and re-open-in-source-tool (edit-in-place) launch
- [ ] **TikZ mode**: activated when editing any `.tex` file in the configured figures directory. Replicates what the pandoc tikz filter already does — compiles the tikz source and shows the resulting SVG as the preview. Should be straightforward: the compilation machinery already exists in the filter pipeline
- [ ] **Figure insertion gallery**: when editing markdown, insert a known tikz image from the figures directory via a **visual gallery** — swipeable/browsable, showing rendered SVGs. Prerequisite: `~/.pandoc`'s `render_figures` script has been run. The app owns rendering upkeep: a cache + a systemd background process that recompiles stale figures (not edited recently) so the gallery always has viewable images. Insertion includes the SVG reference
- [ ] **Right-click to edit owned tikz figures**: right-clicking on an image inclusion in the editor that is "owned" by the app as tikz → jump to editing it. Configurable: in-app tikz-mode editor, or as an interim milestone, launch into Qtikz
- [ ] Diagram tool launches post-save-gate — quiver, qtikz, ipe (+ FreeTikZ/Tikzit/Inkscape-class; xournalpp dropped, drawio banned per [Decision Provenance: User-Owned vs Framework-Forced](decision-provenance-user-owned-vs-framework-forced)); each tool integration is its own individually-managed plugin (Tier 4 richness bar)
- [ ] One-button quiver/FreeTikZ extraction → deterministic tikz-cd insertion at cursor (incl.
  quiver iframe hover-export); precedent shape: three-path diagram entry (desktop tool / proxied web tool with export overlay / clipboard image), per-tool starter templates, startup availability probing (ppe tauri branch)
- [ ] **Editor tabs** (late-stage): editors are tabs; multiple files open simultaneously

## Tier 4 — Plugin system (the firewall)

**Architecture soundness is an early gate (2026-06-15):** the plugin API and the modular architecture it requires must be solid enough that all later features (exports, diagram tools, renderers, OS integrations) can be cleanly built as isolated plugins with almost-sure guarantees of not introducing regressions. This is a prerequisite that unblocks work across Tiers 2–3, not a late deliverable.

- [ ] Plugin API: drop-in scripts with pre-populated variables, QC'd in isolation, dynamically populated category-grouped plugin menu, plugin failure = toast (never crash), optional declared output artifact opened on success (xdg-open), and plugins may define their own configuration pages (the capability the renderer plugins depend on) ([Plugins, Diagrams, Figures Requirements](plugins-diagrams-figures-requirements), [Renderer Plugin Architecture](renderer-plugin-architecture))
- [ ] Renderers delivered through the plugin system: both the pandoc renderer and the generic script renderer are plugins, individually managed like every other ([Renderer Plugin Architecture](renderer-plugin-architecture))
- [ ] Richness bar: the API is rich enough that ALL export types and ALL diagram-tool integrations are standalone plugins, each individually managed (install/enable/disable/update/QC per plugin, no monolithic bundle) — the Tier-2 export items and Tier-3 diagram items are DELIVERED through this ([Plugins, Diagrams, Figures Requirements](plugins-diagrams-figures-requirements))
- [ ] OS integrations live BEHIND the firewall as plugins, never app features: quick-open via fzf/dmenu, kitty popup terminals, AGS GUIs, gum wizards
- [ ] Zotero citation insertion (**very important**): invoke Zotero's own CAYW popup from the editor and insert the returned citation at cursor (plugin-side; the app may hard-require a Better BibTeX export to function — missing/misconfigured export is a fatal setup failure, not degraded mode)

## Tier 5 — Editor experience phase 2 (Firenvim demoted; CodeMirror-native first)

**Firenvim decision (2026-06-15):** Firenvim is demoted to very late, fully optional. CodeMirror 6 natively provides folding (moved to Tier 0), snippets (absorbed into Tier 0 autocomplete), and most editor-productivity features previously gated on Firenvim. Conceals are low-value given the live preview.

- [ ] Conceals (very optional — live preview makes them low-value; defer indefinitely or until a lightweight CodeMirror decoration approach is validated) ([Editor Experience Targets: Conceals, Folding, Expansion](editor-experience-targets-conceals-folding-expansion))
- [ ] Firenvim embedding (optional, very late — only if a vim-modal-editing experience is desired in the CodeMirror pane; no longer a gate for any other feature) ([Lineage: Vim Live-TeXing Setup](lineage-vim-live-texing-setup))
- [ ] Theorem-keyword syntax decorations (may be subsumed by the pandoc-aware syntax highlighting work in Tier 0)

## Tier 6 — TikZ and diagram parity milestones

- [ ] **TikZ preview QTikz parity**: in-app tikz editing reaches feature parity with QTikz
- [ ] **TikZ parity with Ipe and Tikzit**: full external-tool-class tikz editing while still allowing external integrations via plugins

## Tier 7 — Late-stage structural changes

- [ ] **Preferences externalized**: "Preferences" moves out of the app GUI entirely, managed by a gum+kitty combo launched from the app as a totally separate popup. App stops managing configs internally after that

## Tier 8 — Wishlist (post-MVP; mine Obsidian plugins for reference implementations first)

- [ ] Follow wikilinks when reasonably resolvable
- [ ] Follow crefs to their definitions
- [ ] Follow Zotero refs externally — open the Zotero item or attached PDF
- [ ] CriticMarkup rendering + accept/reject controls (existing Obsidian plugin)
- [ ] Image lightboxes (existing Obsidian plugin)
- [ ] Hover-preview of image links (existing Obsidian plugin)

**Mining note (2026-06-13):** cross-checked against pandoc-preview-editor `main` (incl.
its `Feature-Disposition-Matrix.md`) and `feature/tauri-first-architecture` (full clone `/tmp/ppe-full`; re-clone from github.com/dzackgarza/pandoc-preview-editor).
Found there but deliberately NOT imported: TikZJax in-browser rendering (banned non-goal), the math-engine selector offering KaTeX/WebTeX/None (violates MathJax-always), xournalpp starter template (tool dropped).
The matrix also scopes Firenvim as "optional, limited to textarea editing" — consistent with its demotion here.

**Non-goals (never build, never re-add as features):** cross-platform, multi-user/collaboration, hosted deployment, security hardening/sanitization of preview, dynamic ports, generic Git client UI, full file manager, in-browser TikZ — full list in [Product Destination: What Done Looks Like](product-destination-what-done-looks-like).
