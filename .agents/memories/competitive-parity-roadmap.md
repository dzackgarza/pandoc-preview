# Competitive Parity Roadmap — Follow-up Phases

**When this applies:** picking the next QOL feature once the Tier-0/1 core loop is usable;
deciding what to build to make this app a real daily driver for large mathematical writing
projects (theses, papers). This is a SECOND ordering of work, cross-cutting the tier
sequencing in [[feature-catalogue-and-implementation-status]]: the tiers order by
architectural dependency and the MVP gate; THIS doc orders the parity push by **importance to
getting research work done**, the axis the user named.

**Provenance:** synthesized from durable per-program parity studies (2026-06-16), one per
target program, under `parity-research/`:
[[parity-research/overleaf]], [[parity-research/gummi]], [[parity-research/arxiv-export]],
[[parity-research/vimtex]], [[parity-research/quicktex]],
[[parity-research/snippet-and-lint-ecosystem]], [[parity-research/qtikz]],
[[parity-research/ipe]], [[parity-research/tikzit]], [[parity-research/zettlr]],
[[parity-research/vscode]], [[parity-research/pandoc-editor]].
Each study holds the full feature inventory, parity matrix, and dispositions; this doc carries
only the prioritized actionable residue.

**How to read the status tag on each item:**
- **net-new gap** — not tracked anywhere in the catalogue; a genuine addition.
- **refines TierN / Pxx** — the feature is tracked, but a target program supplies a concrete
  MECHANISM the catalogue does not yet specify.
- **maps TierN / Pxx** — already tracked and parity-confirmed; listed only for context.

**Standing constraint:** the sequencing rule still binds — the Tier-0 core loop is provable and
human-verified before any phase here starts ([[product-destination-what-done-looks-like]]).
Nothing here re-opens a banned non-goal; the per-program Dispositions sections record every
exclusion.

---

## Phase A — Feedback faster than a compile (static lint + structured logs)

*Why first:* the user named "extremely good linting that kicks in long before compiles" and
"feedback faster than a latex compile" as core. This is the single most under-tracked High-
relevance cluster: the catalogue has matched-delimiter HIGHLIGHTING (Tier 0) and post-compile
LOG surfacing (Tier 2, P11), but NO static pre-compile diagnostic layer. CodeMirror 6's
`@codemirror/lint` is the native host, so the surface is small and the payoff is daily.
Source: [[parity-research/snippet-and-lint-ecosystem]] (ChkTeX/lacheck), [[parity-research/vimtex]].

| Item | Status | Rel |
| --- | --- | --- |
| Static delimiter-balance WARNINGS — count `{}`/`[]`/`$…$`/`\left`-`\right` across the buffer, surface imbalance in the gutter (vs. cursor-pair highlighting only) | net-new gap | High |
| Static math-mode balance check — flag an unterminated `$`/`\(`/`\[` live, before the render garbles | net-new gap | High |
| User-defined regex lint rules (ChkTeX `UserWarnRegex` analog) — config-owned `regex→message` house-style rules as diagnostics | net-new gap | High |
| Structured post-compile log → diagnostics (line, severity, message, jump-target), `pplatex`-class, distinct from raw P11 output | refines Tier 2 / P11 | High |
| Configurable typographic lint layer — dash length, `...`→`\dots`, straight/curly quotes, `x`→`\times`, `x^10`→`x^{10}`, `sin`→`\sin` | net-new gap | Med-High |
| In-document lint suppression (`% chktex N` analog) — per-line/per-file opt-out | net-new gap | Med |
| Optionally run real ChkTeX on the pandoc-emitted transient `.tex`, map diagnostics back (gated on the `sourcepos` line-mapping problem — see Tier-2 scroll-sync) | net-new gap | Med |

Prefer ChkTeX's tunable/suppressible model over lacheck (self-described "crude approximation",
no per-warning disable). Running an external linter binary is a plugin-firewall candidate.

## Phase B — Snippet engine depth + the quicktex dictionary migration

*Why second:* snippets/autocomplete are the next daily-friction win and the heritage workflow's
core ergonomic. The catalogue's snippet model (P52 tooltip path, P59 bar-dropdown path) is a
FLAT config dict; the engine capabilities the heritage stack actually used are untracked. The
**math-mode-only context condition is the keystone** — it is what makes short single-letter math
triggers safe and what the quicktex prose/math split requires.
Source: [[parity-research/snippet-and-lint-ecosystem]] (LuaSnip/UltiSnips), [[parity-research/quicktex]], [[parity-research/zettlr]].

| Item | Status | Rel |
| --- | --- | --- |
| Math-mode-only expansion (a math-zone predicate gating which snippets/dict entries are live) — the keystone capability | net-new gap | High |
| Autotrigger / space-trigger auto-expansion (expand on next space, no accept keypress, re-arms for chained expansion) — quicktex's defining "as fast as the blackboard" ergonomic | net-new gap | High |
| Regex / postfix triggers with capture groups (`phat`→`\hat{p}`, `([a-z])bar`→`\bar{$1}`) | net-new gap | High |
| Mirrored tabstops (type env name once → mirrored into the closing fence/`\end`) | refines P52 (single tabstop only) | High |
| Canonical 281-entry quicktex dict as a versioned data asset + a vim-dict→config converter; pin provenance (OSOT) — the catalogue says "migrated" but never pins WHERE or "verbatim" | net-new gap | High |
| Snippet variables (`$CLIPBOARD`, `$CURRENT_DATE`, TextMate dynamic vars) | refines P52/P59 | Med |
| Transform/function nodes (derive a label from a title; case transforms) | net-new gap | Med |
| Visual-selection wrap (`${VISUAL}`: select → wrap in `\emph{}`/environment) | net-new gap | Med |

Exclude UltiSnips shell/Python interpolation (security/portability surface, gimmick) and
LuaSnip dynamic/restore nodes (heavy, Low). Map quicktex's vim-keystroke bodies to CM6
`${1}`/`${2}` template syntax — do NOT reimplement a keystroke interpreter.

## Phase C — Citations done right

*Why third:* "quickly finding and inserting citations" is a top-3 user priority. The catalogue
already plans bib-citation autocomplete + a workspace-aware `\cref` picker + Tier-4 Zotero CAYW;
the parity work supplies the MECHANISMS that make them usable, plus two small net-new surfaces.
Source: [[parity-research/vimtex]], [[parity-research/zettlr]], [[parity-research/overleaf]], [[parity-research/pandoc-editor]].

| Item | Status | Rel |
| --- | --- | --- |
| Citation fuzzy-match on a `key + author + year + title` formatted string, not just the cite key; tooltip preview of the bib entry before insert | refines Tier 0 (bib autocomplete) | High |
| `@`-trigger as the in-editor citation entry point (line-start / after-space / after `[`), full pandoc citation syntax (`[@Key, p. 45]`, narrative, locator) | refines Tier 0 | High |
| Label/`\cref` completion harvested from ALL project files via main-document root detection (the index that powers cross-file completion) | refines Tier 0 (`\cref` picker "scans subdocuments") | High |
| Per-file `bibliography:` YAML frontmatter override (papers that ship their own `.bib`), in addition to the config-declared global bib | net-new gap | Med |
| References/bibliography preview sidebar — live "what this doc cites so far" panel in a CSL style; a sibling sidebar tab to the planned figures tab | net-new gap | Med |
| Command/backslash completion scoped to AVAILABLE macros (the injected MathJax macro tiers), so users only see macros that will render | refines Tier 0 (P51) | Med |

## Phase D — Figure & TikZ management and live editing

*Why fourth:* "managing and editing figures/tikz/tikzcd" is a top user priority and the densest
net-new cluster. The catalogue tracks rendering (tikz→SVG), a figures dir, a figures sidebar
tab, TikZ mode, an insertion gallery, external-tool launches, and Tier-6 QTikz/Ipe/Tikzit parity
milestones — but the round-trip foundation and the shared-config model are missing. The
**tikz-subset parser is the single highest-leverage item across all parity research**: it
underpins owned-tikz edit-in-place AND any future in-app node/edge editor.
Source: [[parity-research/tikzit]], [[parity-research/qtikz]], [[parity-research/ipe]].

| Item | Status | Rel |
| --- | --- | --- |
| A real tikz-SUBSET PARSER (round-trip parse↔serialize, not just render) — TikzIt's Flex/Bison + `Graph::tikz()` model; the foundation for "hand-edit the `.tikz`, re-sync" and for Tier-6 node/edge editing | net-new gap | High |
| Shared `.tikzstyles` + `.tikzdefs` palette for the global figures dir (one style file + one preamble file shared by every figure and `\input` by the paper) — a blessed shared-config pattern the figures-dir doctrine lacks; cf. Ipe's `update-master` preamble extraction | net-new gap | High |
| Source↔preview line jumping for owned tikz (TikzIt Ctrl+J jump-to-source-line / Ctrl+T re-parse) — the exact round-trip UX the Tier-3 "right-click to edit owned tikz" needs but never specified | refines Tier 3 | High |
| Swappable per-figure preamble template with a single `<>` insertion placeholder (QTikz `.pgs`) — lets a figure declare its OWN libraries/macros independent of the fixed pandoc-filter preamble | net-new gap | High |
| Declarative tikz-command snippet database (QTikz `tikzcommands.json`: `{name, description, insert, type}` with cursor offsets) — vendorable to seed the insertion bar's tikz snippets + CM completions; P56 only scaffolds bare tikz/tikzcd | net-new gap | High |
| LaTeX-error→source-line mapping + compile-log tab INSIDE TikZ mode (click error → cursor on the offending tikz line) | net-new gap | High/Med |
| Edit-in-place of NON-tikz figures (Ipe `.ipe`/PDF) via a dual-asset registry tracking the editable source alongside the included render — launch Ipe on the `.ipe`, do NOT attempt tikz extraction | net-new gap | High |
| Copy selected subgraph as tikz to clipboard (TikzIt) — deterministic subgraph→tikz at the cursor | maps Tier 3 (one-button quiver/FreeTikZ extraction) | High |
| Watch-file reload of an owned figure when an external tool rewrites it (closes the launch→edit→return loop) | net-new gap | Med |
| SVG/PDF-vector inclusion path for external-editor figures (Ipe/Inkscape emit SVG/PDF, not tikz) — a parallel "register + insert a non-tikz vector asset" path | net-new gap | Med |

Do NOT greenfield an in-app vector/node-edge canvas (Tier-6 Ipe/Tikzit parity) before the
round-trip parser and shared-style model land; external launch is the interim path. Ipe has NO
native tikz export (negative finding) — treat its output as PDF/SVG assets, not owned tikz.
quiver/FreeTikZ already cover node/edge→tikz extraction — referenced, not re-proposed.

## Phase E — Large-project navigation (theses)

*Why fifth:* "navigating and organizing large projects like theses" and "easily jumping around
files" are named priorities. The catalogue's Tier-3 tree + Ctrl+P browser + filtering already
match VSCode's REAL navigation model (and P18 already encodes the activity-bar/side-bar); the
gaps are a command surface, content search, and in-buffer structural motion.
Source: [[parity-research/zettlr]], [[parity-research/vscode]], [[parity-research/vimtex]], [[parity-research/overleaf]], [[parity-research/pandoc-editor]].

**Keybinding correction (carry forward):** the user's phrasing "Ctrl+P for commands /
Ctrl+Shift+P for recent files" transposes VSCode's real bindings — **Ctrl+P = Quick Open /
fuzzy file finder (+ recent files)**, **Ctrl+Shift+P = Command Palette**. The existing Tier-3
"Ctrl+P workspace file browser" already matches VSCode's REAL Ctrl+P. Implement both surfaces;
use the real bindings.

| Item | Status | Rel |
| --- | --- | --- |
| Global full-text WORKSPACE search with boolean operators (space=AND, `\|`=OR, `!`=NOT, `"phrase"`), per-directory restriction, relevancy heatmap, click-to-open-at-line — distinct from in-file find (Tier 0) and filename filtering (Tier 3) | net-new gap | High |
| Section/environment keyboard MOTIONS — next/prev section, next/prev environment, next/prev math zone (vimtex `[[`/`]m`/`[n`); the fast in-buffer path a sidebar jump doesn't give | net-new gap | High |
| Command palette — a single fuzzy "run any command" surface with prefix tokens (`>` commands, `@` symbol, `:` line); should live behind the plugin firewall (fzf/dmenu), per OS-integration-as-plugin doctrine | net-new gap | Med |
| Environment/command surround + toggle — `tse` rename theorem→lemma in place, `tsf` toggle `\frac{a}{b}`↔inline, `dsd` delete delimiter pair | net-new gap | Med |
| Structured YAML frontmatter editor surface (title/author/date/bibliography/csl), instead of hand-typing frontmatter | net-new gap | Med |
| Ctrl+Tab MRU editor cycling + quick-open prefix-token overloading (`@`/`:`) — relevant once Tier-3 editor tabs land | net-new gap | Low-Med |

## Phase F — PDF preview, Gummi parity, faster export feedback

*Why sixth:* "modes for previewing PDFs", "partially replace Gummi", "slide modes with quick
feedback", and "feedback faster than a compile" on the export side. Much of this is already the
Tier-2 PDF-preview / "Gummi parity" milestone; the parity work adds the bidirectional jump and
build-hygiene mechanisms.
Source: [[parity-research/gummi]], [[parity-research/overleaf]], [[parity-research/vimtex]], [[parity-research/zettlr]].

| Item | Status | Rel |
| --- | --- | --- |
| Continuous live PDF preview / compile-on-idle for the PDF path (pdf.js viewer) | maps Tier 2 ("PDF preview Gummi parity") | High |
| Bidirectional SyncTeX-style click-jump source↔compiled PDF; inverse search (click rendered element → source line) as a first-class action, beyond the filter-tagged hover-to-edit | refines Tier 2 (scroll sync / hover-to-edit) — gated on `sourcepos` reader decision | High |
| Temp-directory build isolation — route latexmk `-jobname` to a temp dir so `.aux`/`.log` never litter the thesis source tree (the export-plugin contract currently runs in the source's parent dir) | net-new gap | Med |
| `rubber`/latexmk multi-pass auto-orchestration — "run exactly as many passes as needed, auto-invoke BibTeX/Makeindex" as a first-class option; the substance of "references done right" | refines Tier 2 (reference resolution) | Med |
| Explicit auto/manual compile toggle + fast/draft vs full compile distinction for the export path | refines Tier 2 (render lifecycle) | Med |
| Inline WARNING surfacing (not just errors) tied to source locations, in the same pane as the compile control | refines Tier 2 / P11 | Med |
| Slides (beamer/revealjs) fast-feedback preview — a separate renderer plugin already planned; the parity ask is QUICK feedback for the slide path | maps Tier 2 (slides mode) | Med |

## Phase G — Arxiv-ready export pipeline

*Why seventh (high value, late lifecycle):* "export to a fully arxiv-ready paper" is High-value
but happens at the END of a paper's life, so it ranks after daily-writing features. It is also
the LARGEST single gap cluster — arXiv export is essentially untracked beyond generic latexmk
plumbing. Each item fits the existing export-plugin contract ([[export-plugins-contract]]) as a
standalone plugin running on the pandoc-EMITTED `.tex` (post `md→tex`), not on the markdown.
Source: [[parity-research/arxiv-export]].

| Item | Status | Rel |
| --- | --- | --- |
| arXiv-export plugin running `arxiv_latex_cleaner` over the built project — strip comments, delete `\todo`/draft commands, prune unused `.tex`/images, resize images, emit a cleaned folder/tarball "ready to upload" | net-new gap | High |
| `.bbl`-baking + bundle step — ship the precompiled `.bbl` named to the main tex, omit `.bib` (arXiv's canonical requirement); capture latexmk's intermediate `.bbl` into the bundle | net-new gap | High |
| Source flattening into a single self-contained directory with bundled `.sty`/macros (arXiv: "we don't have your macros") — extend the already-named `include.lua` to a flatten-for-arxiv mode | refines Tier 2 (include.lua) | High |
| TikZ-externalization for the bundle — substitute precompiled PDF/EPS for `tikzpicture` source (the tikz filter already precompiles for preview; emit PDF/EPS instead) | refines Tier 3 (tikz filter) | High |
| Figure-format compliance gate — ensure exported figures are arXiv-acceptable (PDF/PNG/JPG for pdfLaTeX; EPS for DVI); arXiv does NO on-the-fly conversion and our pipeline is SVG/tikz-centric | net-new gap | Med |

## Phase H — Low-priority QOL / writing-comfort

*Why last:* recorded for completeness; cheap but low-leverage for math research, and one item is
a correctness risk.
Source: [[parity-research/zettlr]], [[parity-research/pandoc-editor]].

| Item | Status | Rel |
| --- | --- | --- |
| Distraction-free / typewriter / readability modes | net-new gap | Low |
| Three-way edit / preview / split view-mode toggle | refines Tier 0 (50/50 panes) | Low-Med |
| Batch / multi-format export in one action | net-new gap | Low-Med |
| Reading-time metric in the status cluster | refines Tier 0 (status cluster) | Low |
| Autocorrect / magic quotes — **deprioritized with caution**: smart-quote/autocorrect substitution can corrupt LaTeX-bearing math source (`"` inside `\text{}`, breaking `$…$`); a correctness risk, not just low value | net-new gap (do not prioritize) | Low |

---

## Where the catalogue already EXCEEDS the targets (not gaps — keep)

- **Outline/TOC indexes fenced divs** (`:::{.remark title="…"}` → "Remark: …"): Gummi has NO
  document outline at all; Overleaf's is single-file. ([[parity-research/gummi]], [[parity-research/overleaf]])
- **Workspace-aware `\cref` picker** scans across subdocuments: Overleaf's ref scope is
  single-file. ([[parity-research/overleaf]])
- **Recovery is a host-FS git repo with a sub-10s loss bound** (P45): stronger than the plain
  autosave of pandoc-editor and Gummi. ([[parity-research/pandoc-editor]], [[parity-research/gummi]])
- **Spellcheck honors a custom math dictionary** (P54): the targets' spellcheck flags math terms.
- **The math-research insertion bar** (P55–P62) is richer than Gummi's absent math-symbol palette
  and replaces the generic formatting toolbar the markdown editors ship.

## The cross-cutting ANTI-pattern (do not port)

Three of the markdown editors (amar-jay/pandoc-editor: react-markdown+KaTeX; Zettlr: in-editor
CodeMirror render+KaTeX; VSCode: markdown-it) preview WITHOUT pandoc — a CommonMark/KaTeX
approximation that does not reflect real pandoc output (no amsthm environments, no filters, no
`~/.pandoc` template). This is exactly the failure the P1/P4 real-pandoc loop exists to avoid;
none of the three is parity for the core loop. KaTeX previews also violate the MathJax-always
premise. Recorded so no future synthesis mistakes their preview for a target.
([[parity-research/pandoc-editor]], [[parity-research/zettlr]], [[parity-research/vscode]])
