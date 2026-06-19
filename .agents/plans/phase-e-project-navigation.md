# Phase E — Large-Project Navigation (implementation plan)

Durable, resumable implementation plan for **Phase E — Large-project navigation (theses)** of the Competitive Parity Roadmap.
This is a **repo artifact** (future-work + current-state), NOT a memory: the durable *decisions* and parity provenance live in memory ([[competitive-parity-roadmap]] "## Phase E", [[parity-research/zettlr]], [[parity-research/vscode]], [[parity-research/vimtex]], [[parity-research/pandoc-editor]], [[feature-catalogue-and-implementation-status]], [[proof-obligations]], [[renderer-plugin-architecture]], [[plugins-diagrams-figures-requirements]], [[reference-tree-tabs-file-ops-glyph-marka-md]]); this file carries the actionable plan and resume state.
Match the style of [[render-rebuild-plan]]. If interrupted, resume from the **Status / resume here** section at the bottom.

**Deliverable + priority rationale.** Phase E is the *fifth* parity push — ordered by importance to getting real mathematical-writing work done.
"Navigating and organizing large projects like theses" and "easily jumping around files" are named user priorities.
The catalogue's Tier-3 tree + Ctrl+P quick-open browser + file-explorer filtering already match VSCode's REAL navigation model, and P18 already encodes the activity-bar / collapsible side-bar.
So Phase E does NOT re-plan the tree or the activity bar — it **refines/extends** them and adds the genuinely untracked surfaces: a global full-text **workspace search**, in-buffer structural **motions**, a fuzzy **command palette** (behind the plugin firewall), **environment/command surround+toggle** edits, a structured **YAML frontmatter editor**, and **Ctrl+Tab MRU cycling + quick-open prefix tokens** (deferred until editor tabs land).
Content search and structural motion are the two High-relevance items; the rest are Med / Low-Med.

**Keybinding correction (carry forward — load-bearing).** The user's phrasing "Ctrl+P for commands / Ctrl+Shift+P for recent files" **transposes VSCode's real bindings**. The REAL bindings, which this plan uses verbatim:

- **Ctrl+P = Quick Open / fuzzy file finder (+ recent files / MRU)** — the existing Tier-3 "Ctrl+P workspace file browser" already matches this REAL binding.
- **Ctrl+Shift+P = Command Palette** — the single fuzzy "run any command" surface.

**This is a current-state bug to fix as part of E3.** `src/App.svelte:1363-1370` currently binds **Ctrl+P (and Cmd+P) to an app-owned Svelte command-palette modal** (`CommandPaletteModal.svelte`). That is BOTH the wrong binding (Ctrl+P should be quick-open) AND the wrong delivery surface (the command palette should live behind the plugin firewall per the OS-integration-as-plugin doctrine, not as app-owned chrome).
Phase E rebinds Ctrl+P → quick-open (fzf/dmenu plugin), moves the command palette to Ctrl+Shift+P, and re-homes it behind the firewall.

## Source items (from the roadmap)

Copied verbatim from [[competitive-parity-roadmap]] "## Phase E", with status tags:

| Item | Status | Rel |
| --- | --- | --- |
| Global full-text WORKSPACE search with boolean operators (space=AND, `\|`=OR, `!`=NOT, `"phrase"`), per-directory restriction, relevancy heatmap, click-to-open-at-line — distinct from in-file find (Tier 0) and filename filtering (Tier 3) | net-new gap | High |
| Section/environment keyboard MOTIONS — next/prev section, next/prev environment, next/prev math zone (vimtex `[[`/`]m`/`[n`); the fast in-buffer path a sidebar jump doesn't give | net-new gap | High |
| Command palette — a single fuzzy "run any command" surface with prefix tokens (`>` commands, `@` symbol, `:` line); should live behind the plugin firewall (fzf/dmenu), per OS-integration-as-plugin doctrine | net-new gap | Med |
| Environment/command surround + toggle — `tse` rename theorem→lemma in place, `tsf` toggle `\frac{a}{b}`↔inline, `dsd` delete delimiter pair | net-new gap | Med |
| Structured YAML frontmatter editor surface (title/author/date/bibliography/csl), instead of hand-typing frontmatter | net-new gap | Med |
| Ctrl+Tab MRU editor cycling + quick-open prefix-token overloading (`@`/`:`) — relevant once Tier-3 editor tabs land | net-new gap | Low-Med |

Background mechanisms the parity studies supply (do not re-derive): Zettlr's boolean grammar + relevancy heatmap + per-directory restriction + filename-matches-first ordering ([[parity-research/zettlr]] "Global full-text search"); VSCode's two-key model + prefix tokens + MRU cycling ([[parity-research/vscode]]); vimtex's section/environment/math-zone motions as CAPABILITIES to port as CM6 commands, NOT vim keystrokes, and `tse`/`tsf`/`dsd` surround-toggle ([[parity-research/vimtex]] "Section/environment motions", "Surround / toggle"); the structured YAML frontmatter surface ([[parity-research/pandoc-editor]] "YAML frontmatter editor / preview").

## Discipline

Inherited from [[render-rebuild-plan]] "## Discipline", unchanged:

- **Interop-first / research-first governs EVERY work item ([[AGENTS]] HARD RULE #0).** Each sub-milestone below BEGINS with the research step answering "what existing tool / library / binary / format / reference implementation already does this," and NAMES the concrete thing it leverages, supports, or ports — before any build step.
  Greenfield is rejected: a work item whose first action is "write a new X" with no such research is sent back for the research step.
  The leveraged dependencies for this phase are named up front — **ripgrep** (`rg --json`) for content search, **fzf/dmenu** behind the plugin firewall for the pickers, existing **CodeMirror 6** navigation/motion/command-palette extensions for the in-buffer surfaces — and each item below states which it uses.
- TDD: design → RED proof obligations (user-ratified) → commit RED → GREEN → commit.
  Each sub-milestone gates on its proofs green before the next starts.
  Separate RED and GREEN commits for audit (the bug-handling and TDD rules in CLAUDE.md).
- **P1–P69 and D1–D16 stay green throughout.** A sub-milestone that would break one must be re-scoped.
  Phase E is almost entirely additive (a new sidebar view, new CM6 commands, a new firewall plugin, a new modal) — the one current-state behavioral change is the Ctrl+P rebinding, which touches no existing P-spec (no P-spec asserts Ctrl+P opens the app-owned palette).
- No fallbacks / soft defaults / mocks; fail loud.
  Single-user Linux desktop; no cross-platform, no multi-user.
  Command-palette + quick-open are OS-integration surfaces and live BEHIND the plugin firewall (fzf/dmenu) per [[plugins-diagrams-figures-requirements]] and [[renderer-plugin-architecture]] "total externality" — the app contributes the *doc/workspace context* and *command catalog*, the plugin owns the picker UI.
- Proof obligations are EXACT externally-observable happy-path states, admissible only if they would FAIL on a plausibly broken app (unwired search, frozen motion, UI-only fake heatmap, a palette that runs nothing).
  No internal-behaviour assertions, no source-content meta-assertions, no forced error modes.
  Verification vehicle is the real app on a real display via `tauri-plugin-playwright` with hermetic per-run temp project + `XDG_CONFIG_HOME`, disk assertions via independent processes ([[proof-obligations]] "## Verification vehicle").
- **PROPOSALS only — do NOT edit [[proof-obligations]].** P100–P106 below are a reserved proposal block to ratify before any RED is written.

## Current code seams (what gets touched/extended)

Verified by reading the real files (2026-06-16):

- **`src/lib/components/CommandPaletteModal.svelte`** (82 L) — the existing app-owned fuzzy modal: `{commands, onClose}` props, `commands.filter(label.includes(query))`, arrow/enter keying, `data-testid="command-palette"`. It is plain substring filtering (not real fuzzy), command-only (no prefix tokens), and app-chrome (violates the firewall doctrine).
  E3 RE-HOMES the command catalog behind a firewall plugin; this Svelte modal is DELETED (per CLAUDE.md: the new thing replaces the old entirely — no deprecation, no fallback).
- **`src/App.svelte`** (1590 L):
  - `1363-1370` — the `<svelte:window onkeydown>` that binds Ctrl+P/Cmd+P → `commandPaletteOpen = true`. **The mis-binding.** E3 rebinds: Ctrl+P → quick-open (file finder), Ctrl+Shift+P → command palette; both invoke firewall plugins via `run_plugin`.
  - `603-630` `paletteCommands()` — the command catalog (`fold_all`, `save`, `find`, `new_file`, `open_folder`, view toggles, `export:<id>` from config).
    E3 reuses THIS catalog as the source the command-palette plugin is fed (the app owns the catalog; the plugin owns the picker).
  - `1428-1432` — `<OutlinePanel … onSelect={(line) => editor.goToLine(line)}>`: the existing sidebar-jump path.
    E1's workspace-search results reuse `goToLine` for in-file click-to-open; E2's motions are the in-buffer fast path the sidebar jump does not give.
  - `SIDEBAR_VIEWS` / `ActivityBar` / `activeView` (`1387`) — the P18 activity-bar model.
    E1 adds a **second view** (`search`) to `SIDEBAR_VIEWS`, exactly as a sibling to `explorer` (the activity-bar was "built to hold more views later" — P18). E5's frontmatter editor is a modal, not a view.
- **`src/lib/components/EditorPane.svelte`** (632 L):
  - `163-171` + `208-217` — the two `keymap.of([...])` blocks (CM6 defaults + the app's `Mod-b`/`Mod-i`/`Mod-k`/`Ctrl-e`). E2 adds a new app keymap block of motion + surround commands; E2 commands are real CM6 `Command`s (`(view) => boolean`) so they compose, never replace.
  - `30-31` `markdownOutline` / `OutlineItem {kind, level, depth, label, line}` from the vendored `codemirror-lang-latex` fork — the section/div structure E2's section-motions reuse (next/prev *section* = next/prev outline `kind:'heading'` line above/below the cursor; next/prev *div environment* = next/prev `kind:'div'`).
  - `latexLanguage` syntax tree (`197-207`) — math-zone nodes (the `$`/`$$`/`\(`/`\[` regions the grammar already highlights) are the structure E2's math-zone motions and E4's `dsd`/`tsf` delimiter/fraction edits walk.
    `ensureSyntaxTree` is already imported.
  - `468-475` `goToLine(line)` — the cursor-move + `scrollIntoView` primitive E1 reuses.
  - `499-510` `wrapSelection` / `prefixLines`, `393-416` `insertSnippet`/`insertSnippetByTrigger`, `590-629` `command(id)` dispatcher — the edit primitives E4's surround-toggle commands extend (E4 adds a `command()` arm or exported functions: rename-env, toggle-fraction, delete-delimiter).
- **`src-tauri/src/fsops.rs`** (205 L) — `list_tree`/`read_text_file`/`write_text_file*`/create/ rename/delete.
  **No content-search backend exists** (verified: no `search`/`grep`/`ripgrep` in fsops.rs or lib.rs).
  E1 needs a workspace content-search backend.
  Per the firewall doctrine, prefer a **`workspace-search` plugin** (ripgrep/`rg --json` behind the firewall) over an app-core Rust grep — the app contributes the root + query, the plugin emits structured hits.
  If a core Rust command is chosen instead (no extra binary dep), it is a new `fsops::search_workspace(root, query) -> Vec<SearchHit{path, line, col, text, score}>` parsing the boolean grammar in Rust; decide at E1 design (firewall plugin is the doctrine-preferred path).
- **`src-tauri/src/plugins.rs`** — `run_plugin(id, context) -> PluginResult`, `configure_plugin`, `discover`, `render_active`. The firewall the command-palette / quick-open / workspace-search plugins ride on (E1/E3). The picker plugins are `category` ≠ renderer; they return a `PluginResult` whose stdout the app consumes (selected file / command id / search hits).
- **`src-tauri/src/config.rs`** — `Config{general, editor, preview, directories, export, plugins, renderer}`. E1 may add a `[search]` section (default per-dir scope, max results) and E5 reads no new config (frontmatter is in-document).
  Any new config section is fail-loud validated and ships in the static defaults config ([[shipped-config-vs-runtime-defaults]]).
- **Spec families:** webview p-specs run to `p62`, doctor d-specs run to `d16` (verified in `tests/proof/`). Phase E's webview specs continue the p-series (`p63+`), firewall/backend specs the d-series (`d17+`); the spec design itself belongs to the test author, per [[proof-obligations]] closing note.

## Work items (ordered sub-milestones)

Ordered by relevance and dependency.
Each is its own RED→GREEN with a separate commit pair.

### E1 — Global full-text workspace search  [HIGH — do first]

**Research-first:** do NOT build a search engine.
**LEVERAGE ripgrep** — run the real `rg` binary, the canonical fast-content-search tool — and map its matches to results.
Research its **`rg --json`** output mode (the documented stream of `match`/`begin`/`end` event objects carrying path, line number, byte offsets, and submatch spans) as the integration surface: the app contributes the root + query, ripgrep does the scanning, the app parses the JSON stream into structured hits.
No owned grep/indexer.
Ripgrep handles boolean-ish patterns, case weighting, and per-directory scoping natively; the app only translates Zettlr's query grammar into `rg` invocations and ranks the returned hits.

The headline Phase-E feature.
A new **`search` sidebar view** (sibling to `explorer` in `SIDEBAR_VIEWS`, activity-bar control per P18) with a query box and a results tree.

- **Boolean grammar** (port Zettlr's, [[parity-research/zettlr]]): space = AND, `|` = OR, `!term` / `!"phrase"` = NOT, `"exact phrase"` = phrase.
  Parse once; this is the query contract.
- **Per-directory restriction**: a scope control restricts the search root to a chosen subtree of the workspace (the thesis-chapter use case).
- **Relevancy heatmap**: each result file carries a relevance weight surfaced as a heat color (Zettlr's green=high / blue=relevant / gray=low); filename matches ranked first, exact/case matches weighted higher.
- **Click-to-open-at-line**: clicking a hit opens that file in the editor and lands the cursor on the hit line — reuse `editor.goToLine(line)` (`EditorPane.svelte:468`) and the existing `openFile` path.
- **Backend**: a `workspace-search` firewall plugin **running the real ripgrep binary** (`rg --json`) — leverage ripgrep, do not reimplement scanning.
  The plugin emits ripgrep's JSON event stream; the app parses it into structured hits (`{path, line, col, text, score}`), never a stringly blob.
  Distinct from in-file find (Tier-0 `openSearchPanel`, `EditorPane.command("find")`) and filename filtering (Tier-3 tree filter) — this searches CONTENT across ALL workspace files.

### E2 — Section / environment / math-zone keyboard motions  [HIGH]

**Research-first:** before any owned motion code, research **existing CodeMirror 6 navigation/motion extensions** (`@codemirror/commands` cursor-by-syntax-node motions, `@replit/codemirror-vim` motions, published outline/heading-navigation extensions) and the CM6 `syntaxTree`/`foldable` cursor-walk primitives — reuse the maintained traversal helpers rather than hand-rolling node walking.
The motions PORT vimtex's structural CAPABILITIES (not vim keystrokes — the disposition in [[parity-research/vimtex]] "Dispositions") onto these CM6 primitives.
New app keymap block in `EditorPane.svelte` composed alongside the existing bindings (`163-171`/`208-217`), never replacing them.

- **next/prev section** — jump the cursor to the next/prev `markdownOutline` `kind:'heading'` line relative to the cursor (vimtex `[[`/`]]`). Reuses the outline already computed for the sidebar.
- **next/prev environment** — jump to the next/prev fenced-div (`kind:'div'`) — the amsthm theorem/lemma/remark blocks (vimtex `[m`/`]m`).
- **next/prev math zone** — jump to the next/prev `$`/`$$`/`\(`/`\[` math region via the `latexLanguage` syntax tree (vimtex `[n`/`]n`); `ensureSyntaxTree` already imported.
- Bindings are app-owned CM6 `Command`s returning `boolean`; expose each as a named editor command so the command palette (E3) can also invoke them.
  Pick non-conflicting Linux bindings (the `Ctrl-e` Emmet note at `212-216` shows the conflict-avoidance discipline).

### E3 — Command palette (Ctrl+Shift+P) + Ctrl+P rebinding  [MED — fixes a current-state bug]

**Research-first:** do NOT build app-owned palette chrome.
Per the project's OS-integration-as-plugin / plugin-firewall doctrine ([[plugins-diagrams-figures-requirements]], [[renderer-plugin-architecture]] "total externality"), **LEVERAGE fzf/dmenu** — the canonical fuzzy pickers — behind the firewall for both the command palette and quick-open/recent-files: the app contributes the command catalog / file list, the picker owns the UI. Before any owned in-editor picker, also research **existing CodeMirror 6 command-palette extensions** (e.g. published `@codemirror`-ecosystem palette/command-prompt extensions) so an in-buffer fallback reuses a maintained extension rather than bespoke code.
Then re-home the command surface behind the plugin firewall and FIX the binding transposition.

- **Rebind** `App.svelte:1363-1370`: **Ctrl+P → quick-open** (the existing Tier-3 fzf/dmenu workspace file browser — VSCode's REAL Ctrl+P); **Ctrl+Shift+P → command palette**.
- **Delete** `CommandPaletteModal.svelte` (app chrome) — replace entirely, no fallback.
- **Command palette = a firewall plugin** (fzf/dmenu) fed the `paletteCommands()` catalog (`App.svelte:603-630`) as `id\tlabel` lines on stdin; the plugin returns the chosen command id on stdout; the app runs that command's `run()`. Prefix tokens overload the one input: `>` commands (default), `@` symbol/outline jump (feeds the `markdownOutline` items), `:` line (feeds `goToLine`).
- **Quick-open** is the existing Tier-3 Ctrl+P file browser (fzf/dmenu over `list_tree`); E3 wires the corrected binding to it.
  If Tier-3 quick-open is not yet built, E3 builds the minimal file-finder plugin (list workspace files → pick → `openFile`).

### E4 — Environment / command surround + toggle  [MED]

**Research-first:** PORT vimtex's surround/toggle CAPABILITIES (`tse`/`tsf`/`dsd`) onto existing CM6 machinery — reuse the same maintained CM6 `syntaxTree` cursor-walk / node-range primitives researched for E2 (and any published CM6 surround/wrap extension) to locate the enclosing env / fraction / delimiter pair, plus the existing `EditorPane` edit primitives.
Do not hand-roll a new parser.
New named editor commands extending the `EditorPane` edit primitives (`wrapSelection`/`command()` family):

- **rename surrounding environment** (`tse`) — rename the enclosing fenced div in place (`:::{.theorem}` ↔ `:::{.lemma}`): rewrite both the class token and (if amsthm pairs require it) any matching marker, leaving body intact.
- **toggle fraction** (`tsf`) — `\frac{a}{b}` ↔ `a/b` at the cursor's math node (walk the `latexLanguage` tree to find the `\frac` and its two groups).
- **delete delimiter pair** (`dsd`) — remove the matched `(`…`)` / `\left`…`\right` / `$`…`$` enclosing the cursor, keeping the contents.

These reuse E2's structure-walking (outline + syntax tree).
Med relevance; gate after E1/E2.

### E5 — Structured YAML frontmatter editor  [MED]

**Research-first:** do NOT write a YAML parser/serializer.
**LEVERAGE the maintained `yaml` library** (the standard `yaml` npm package, already the canonical JS YAML round-tripper) to parse and re-emit the `---` block; the modal only maps known fields to form inputs.
Support the document's NATIVE Pandoc YAML frontmatter format directly ([[parity-research/pandoc-editor]] "YAML frontmatter editor / preview") — no bespoke shape, no flattening converter.

A modal surface (sibling shape to `PromptModal`/`SettingsModal`) for the document's YAML frontmatter (`---` … `---` block at buffer head): fields title / author / date / bibliography / csl.
Parse the existing frontmatter into the form on open; on confirm, rewrite ONLY the frontmatter block (insert one if absent), leaving the body byte-unchanged.
Distinct from hand-typing frontmatter ([[parity-research/pandoc-editor]] "YAML frontmatter editor / preview"). The `bibliography:` field intersects Phase-C's per-file bib override — keep the field but do not implement Phase-C wiring here.

### E6 — Ctrl+Tab MRU cycling + quick-open prefix tokens  [LOW-MED — deferred until editor tabs land]

**Research-first:** the prefix-token overloading reuses the E3 **fzf/dmenu** quick-open plugin (the picker already owns the fuzzy UI; E6 only feeds it `@`/`:` token streams) — no new picker.
For MRU cycling, research the canonical editor MRU model ([[parity-research/vscode]] "Ctrl+Tab recent-file cycling") and reuse the Tier-3 tab/editor state rather than a parallel list.
No greenfield surface here.

Relevant only once Tier-3 editor tabs exist (the catalogue gates this: "relevant once editor tabs land"). Maintain an MRU list of open editors; **Ctrl+Tab** cycles MRU order ([[parity-research/vscode]] "Ctrl+Tab recent-file cycling"). Fold `@` (symbol) / `:` (line) prefix tokens into the Ctrl+P quick-open input (overload the one surface).
**Do not start E6 before editor tabs (Tier 3) exist** — record as blocked-on-tabs; the proof obligation (P106) is held until then.

## Proposed proof obligations (P100–P106)

**PROPOSALS only — reserved block P100–P106. Do NOT write these into [[proof-obligations]] until user-ratified.** Each is EXACT, externally observable, and fails on a plausibly broken app.
Spec class (webview `p63+` / firewall-backed `d17+`) is the test author's call.
Witness uses the shared fixture ([[proof-obligations]] "## Shared witness fixture") extended to a multi-file project.

- **P100 (E1) — Workspace content search finds across files, with boolean operators and click-to-open-at-line.** In a multi-file project where `chapter1.md` contains `Minkowski bound` and `chapter2.md` contains `Minkowski lattice` and `Café`, open the Search view, query `Minkowski !lattice`: the results list `chapter1.md` (AND `Minkowski`, NOT `lattice`) and NOT `chapter2.md`; clicking the `chapter1.md` hit opens that file with the cursor on the matched line (independent read of the editor cursor line = the line containing `Minkowski bound`). *Admissible because it fails on: a filename-only filter (content not searched), a search ignoring `!`-negation (`chapter2.md` wrongly listed), and a result click that opens the file but not at the hit line.*

- **P101 (E1) — Per-directory restriction and relevancy heatmap.** Query `Café` restricted to a chosen subdirectory: only hits under that subtree appear (a matching file outside it is absent); each result file carries a relevance weight rendered as a discriminable heat class (a file with more / exact matches ranks above and shows a higher-heat class than a single-match file).
  *Admissible because it fails on: a restriction that searches the whole workspace anyway (the out-of-subtree file appears), and a flat result list with no per-file relevance distinction (every hit shares one heat class regardless of match count).*

- **P102 (E2) — Section / environment / math-zone motions move the cursor structurally.** In a buffer with two headings, a `:::{.theorem}` fenced div, and two `$…$` math spans, with the cursor at the top: invoke next-section → cursor on the second heading line; invoke next-environment → cursor on the fenced-div line; invoke next-math-zone → cursor inside the first math span; prev-* reverses each.
  *Admissible because it fails on: a no-op motion (cursor unmoved), a motion that lands on the wrong structure kind (next-environment landing on a heading), and motions that ignore cursor position (always jumping to the first/last regardless of where the cursor is).*

- **P103 (E3) — Ctrl+Shift+P runs a command via the firewall; Ctrl+P opens quick-open.** Ctrl+Shift+P opens the command palette (firewall plugin); selecting the "Fold All" command actually folds the buffer (independent observation of folded ranges), proving the palette RUNS the command, not just lists it.
  Ctrl+P opens the quick-open file finder (NOT the command palette); selecting a workspace file opens it in the editor.
  *Admissible because it fails on: Ctrl+P opening the command palette (the un-fixed transposition), a palette that lists commands but running the selection is a no-op (nothing folds), and a quick-open that lists files but the selection does not open the file.*

- **P104 (E4) — Surround/toggle edits transform the existing structure in place.** With the cursor in a `:::{.theorem}` div, invoke rename-environment to `lemma`: the div class becomes `lemma`, the body is byte-unchanged.
  With the cursor on `\frac{a}{b}`, invoke toggle-fraction: the buffer holds `a/b` at that position; invoking again restores `\frac{a}{b}`. With the cursor inside a `(x+y)` delimiter pair, invoke delete-delimiter-pair: the parentheses are gone and `x+y` remains.
  *Admissible because it fails on: a rename that inserts a new env instead of editing the existing one (two envs appear), a fraction toggle that is one-way or no-op, and a delimiter delete that removes the contents too.*

- **P105 (E5) — Frontmatter editor round-trips only the frontmatter block.** Open a document with a `---` frontmatter block (title/author) and a body; open the frontmatter editor, change the title and add a `bibliography:` value, confirm: the on-disk/buffer frontmatter block reflects exactly the new fields, the document BODY is byte-for-byte unchanged, and a document with NO frontmatter gains a well-formed block on confirm.
  *Admissible because it fails on: an editor that rewrites the whole document (body bytes change), a field edit that is dropped (the new title/bibliography absent), and a missing-frontmatter case that fails to insert a block.*

- **P106 (E6 — HELD until editor tabs land) — Ctrl+Tab cycles editors in MRU order.** With three editors opened in a known order, Ctrl+Tab moves to the most-recently-used prior editor; repeated Ctrl+Tab walks MRU order, not tab order.
  *HELD: proposed but not ratified for RED until Tier-3 editor tabs exist; E6 is blocked-on-tabs.* *Admissible (when unheld) because it fails on: tab-order cycling (not MRU), and a no-op (the active editor never changes).*

## Verification

- Per-sub-milestone gate: the sub-milestone's proposed obligation(s) green, plus a human-runnable check, plus user ratification for the user-facing surface (the workspace-search view, the rebound keys, the frontmatter modal).
- Full-suite regression gate every sub-milestone: **P1–P69 + D1–D16 stay green**. E3's Ctrl+P rebinding is the only current-state behavioral change; confirm no existing p-spec asserts the old Ctrl+P→app-palette behaviour (it does not — `CommandPaletteModal` has no proof obligation).
- Vehicle: real app on a real display via `tauri-plugin-playwright`, hermetic temp project + `XDG_CONFIG_HOME`, disk/cursor assertions via independent processes, real ripgrep/fzf/dmenu as hard dependencies of the firewall plugins (fail loud, never skip) — same contract as [[proof-obligations]] "## Verification vehicle".
- Firewall plugins (workspace-search, command-palette, quick-open) get doctor checks that their backing binary (`rg`/`fzf`/`dmenu`) is present, contributed via the plugin manifest's `[[doctor_checks]]` (the A3/`d09` mechanism), so a missing picker binary fails loud at doctor time.

## Sequencing & dependencies

- **E1 (workspace search) and E2 (motions) are the High-relevance pair — do them first, in that order** (E1 is the headline thesis-navigation feature; E2 is independent and can interleave).
- **E3 (command palette + Ctrl+P fix) depends on the plugin firewall** (already built: `plugins.rs` `run_plugin`) and reuses `paletteCommands()` + E2's named commands (so E2's motions are palette-invokable).
  Do E3 after E2 so the palette can list the motions.
- **E4 (surround/toggle) depends on E2's structure-walking** (outline + syntax tree) — gate after E2.
- **E5 (frontmatter editor) is independent** — can land any time after E1; no dependency on the others.
- **E6 (MRU + prefix tokens) is BLOCKED on Tier-3 editor tabs** — do not start until tabs exist; P106 is HELD.
- Cross-phase: E5's `bibliography:` field touches Phase-C (per-file bib override) — keep the field, defer the wiring to Phase C. E1's content-search index overlaps the workspace-wide `\cref`/citation index Phase C needs ([[parity-research/vimtex]] "Multi-file project root + cross-file index"); if E1 builds a workspace file index, expose it for Phase C to reuse (OSOT — one index).

## Status / resume here

- **2026-06-16:** Plan authored from [[competitive-parity-roadmap]] "## Phase E" + the four per-program studies + the live code seams (CommandPaletteModal, App.svelte command/keybinding wiring, EditorPane keymap + outline + goToLine + edit primitives, dockview, fsops, plugins, config).
  Six sub-milestones E1–E6 defined; proposed obligations P100–P106 drafted (P106 HELD). **Nothing implemented yet.** Prerequisite green baseline: P1–P69, D1–D16 (verified spec families in `tests/proof/`).

- **Key current-state finding to act on in E3:** `App.svelte:1363-1370` binds Ctrl+P to the app-owned `CommandPaletteModal` — wrong binding AND wrong (non-firewall) surface.
  E3 fixes both.

- **NEXT:** ratify proposed obligations **P100–P106** with the user, then start **E1** (workspace search) RED. Decide at E1 design: `workspace-search` firewall plugin (`rg --json`, doctrine- preferred) vs. core `fsops::search_workspace`.

- **2026-06-19: decisions RATIFIED (controller, "execute all phases, no stops"); Phases A–D shipped to main.** Executing on branch `phase-e-project-navigation`.
  - **Obligation renumber: P101–P107** (the plan's drafted P100–P106 COLLIDES — P100 is already taken by Phase D / D-0). Map: E1→P101 (search) + P102 (per-dir/heatmap), E2→P103 (motions), E3→P104, E4→P105, E5→P106, E6→P107 (HELD). Specs continue **p110+** (Phase D used p100–p109).
  - **E1 backend = `workspace-search` firewall plugin running real `rg --json`** (doctrine-preferred; `rg` confirmed at /usr/bin/rg).
    Not a core Rust grep.
  - **E3 pickers = `fzf`** (confirmed at /usr/bin/fzf; `dmenu` is absent but unneeded).
    Ctrl+P→quick-open, Ctrl+Shift+P→command-palette (firewall), delete `CommandPaletteModal.svelte`.
  - **E3 CORRECTION (plan was wrong):** `tests/proof/p40-command-palette.spec.ts` EXISTS and currently passes (asserts the old Ctrl+P→app-palette).
    E3 MUST migrate p40 to the new behavior (Ctrl+Shift+P→firewall palette runs a command; Ctrl+P→quick-open), not silently break it — the new P104 spec drives the new behavior; p40 is updated/subsumed (replace with an aligned correction, never a hollow deletion).
  - **E6 DEFERRED (blocked on editor tabs, like C6):** P107 HELD; tracked.
    E1–E5 executable now.
  - Each sub-milestone: blind-TDD via Workflow (obligation→RED→GREEN→adversarial review), full-suite gate before the Phase E merge (the d14/Phase-D lesson).
