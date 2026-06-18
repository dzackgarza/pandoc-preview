# vimtex — Parity Research

**When this applies:** scoping editor-productivity features (completion, structure navigation, SyncTeX, compile-log quickfix, environment motions) against the heritage TeX IDE. Cross-links: [[../lineage-vim-live-texing-setup]] (the predecessor stack used vim-pandoc-syntax + Voom + citation pickers), [[../feature-catalogue-and-implementation-status]] (Tier-0 insertion bar, outline/TOC, autocomplete), [[../editor-experience-targets-conceals-folding-expansion]]. Source: vimtex master `doc/vimtex.txt` (read 2026-06-16 via raw.githubusercontent).

## What it is

vimtex is the dominant LaTeX plugin for vim/neovim.
It is the reference implementation of a TeX-aware editor experience: it provides multi-type completion (citations, labels, commands, environments, glossary, filenames, packages), document-structure navigation (a TOC buffer), forward/inverse SyncTeX, compile-log → quickfix translation, and a large library of motions/text-objects/surround commands scoped to LaTeX constructs (environments, math zones, delimiters).
This app is CodeMirror-6-native (vim-modal demoted to optional+very-late per [[../feature-catalogue-and-implementation-status]]); the TARGET is vimtex's CAPABILITIES, mapped to CodeMirror equivalents, NOT embedding vim.
Most capabilities are central to math research writing (faster than a compile loop, citation/label insertion, navigating large theses), so most findings score High.

## Feature inventory

- **Citation completion** (`vimtex-complete-cites`): candidates parsed from `.bib` files via pluggable backends (bibtex / vim / lua / bibparse / bibtexparser).
  Smart-matches against a formatted string `"@key [@type] @author_all (@year), \"@title\""` — i.e. you can fuzzy-match on author/year/title, not just the cite key.
  Display fully configurable (`match_str_fmt`, `menu_fmt`, `info_fmt`, `abbr_fmt` in `g:vimtex_complete_bib`). `[relevance: High]`
- **Label completion** (`vimtex-complete-labels`): completes `\ref`, `\cref`, and similar; candidate labels harvested from the multi-file project; custom command patterns via `g:vimtex_complete_ref`. `[relevance: High]`
- **Command completion** (`vimtex-complete-commands`): filtered by the packages actually detected (from `.fls` files or preamble scanning), so you only see commands the document can use.
  `[relevance: Med]`
- **Environment completion** (`vimtex-complete-environments`): completes `\begin{...}` names.
  `[relevance: Med]`
- **Filename completion** (`vimtex-complete-filenames`): for `\input`, `\include`, `\includepdf`, `\includestandalone`. `[relevance: Med]` (markdown analog: image/figure/subdocument paths)
- **Glossary completion** (`vimtex-complete-glossary`). `[relevance: Low]` (glossaries rare in pandoc-markdown math papers)
- **Package / documentclass / bibstyle completion** (`vimtex-complete-packages`, `-classes`, `-bibstyle`) from available `.sty`/`.cls`. `[relevance: Low]` (LaTeX-preamble-specific; pandoc owns the template)
- **Table of Contents buffer** (`:VimtexTocOpen`): a navigable structure buffer with section boundaries; jump to any section.
  `[relevance: High]` (= our outline/TOC sidebar)
- **Section / environment motions**: `[[` `[]` `][` `]]` jump by section; `[m` `]m` (and capitalized `[M` `]M`) jump by environment; `[n` `]n` math zones; `[r` `]r` frame environments; `[*` `]*` comments; `%` jump to matching delimiter.
  `[relevance: High]` (navigating large theses)
- **Forward SyncTeX** (editor cursor → PDF location) and **inverse SyncTeX** (PDF click → editor line).
  `[relevance: High]` (ancestor of our scroll-sync + hover-to-edit ambitions — see [[../lineage-vim-live-texing-setup]])
- **Compile-log → quickfix**: parses LaTeX compilation logs into structured quickfix entries (errors + warnings), optionally via `pplatex`, so you cycle through problems without rereading raw logs.
  `[relevance: High]` (our Tier-2 compile-log surface, P11)
- **Text objects**: `ic`/`ac` (command), `id`/`ad` (delimiter), `ie`/`ae` (environment), `i$`/`a$` (math), `iP`/`aP` (section), `im`/`am` (item).
  `[relevance: Med]` (CM6 has its own selection model; environment/math text-objects are the useful ones)
- **Surround / toggle**: `dse`/`cse`/`tse` delete/change/toggle surrounding environment; `dsc`/`csc`/`tsc` command; `ds$`/`cs$`/`ts$` math; `dsd`/`csd`/`tsd` delimiter; `tss` toggle starred; `tsf` toggle fraction (`\frac{a}{b}` ↔ `a/b`); `tsb` toggle linebreak.
  `[relevance: Med]` (`tsf` fraction-toggle and `tse` env-rename are genuinely useful for math)
- **Multi-file / project root detection**: finds the main document via buffer vars, TeX-root directives, the `subfiles` package, `.latexmain` files, `latexmkrc`, and directory scanning for `\documentclass`/`\begin{document}` — then indexes labels/citations across the whole project.
  `[relevance: High]` (= our workspace-aware `\cref` picker that "scans across subdocuments")
- **`gf`/include navigation**: enhanced `includeexpr` so `gf` opens `\input`-ed files.
  `[relevance: Med]` (= wishlist "follow wikilinks/crefs")

## Parity matrix

| feature | target has it | our status | math-writing relevance | notable mechanism worth porting |
| --- | --- | --- | --- | --- |
| Citation completion from .bib | yes | planned: Tier0 (insertion bar "bib citation autocomplete", P52-adjacent) | High | match against `key+author+year+title` formatted string, not just key — fuzzy on metadata |
| Label/`\cref` completion, workspace-wide | yes | planned: Tier0 (insertion bar `\cref` picker, "workspace-aware — scans across subdocuments") | High | harvest labels from ALL project files via root detection, not current buffer only |
| Command completion filtered by active packages | yes | planned: Tier0 (composable completion P51; LaTeX backslash source exists) | Med | scope candidates to what's actually loaded (we'd scope to pandoc-available macros / injected MathJax macro tiers) |
| Environment completion | yes | planned: Tier0 (`:::` fenced-div completion already in P51) | Med | our envs are fenced divs not `\begin`; enumerate the amsthm vocabulary (see [[../editor-experience-targets-conceals-folding-expansion]]) |
| TOC / structure buffer | yes (`:VimtexTocOpen`) | planned: Tier0 (outline/TOC sidebar — includes fenced divs as outline entries) | High | section-boundary jump; our spec already extends this to `:::{.remark title=...}` entries |
| Section/environment motions | yes (`[[`,`]m`,`[n`…) | gap | High | keyboard jump between sections/theorem-envs in a long thesis — CM6 needs custom commands |
| Forward/inverse SyncTeX | yes | planned: Tier2 (scroll sync, hover-to-edit) — GATED on preview-reader decision | High | source↔output position mapping; pandoc `sourcepos` is our analog |
| Compile-log → quickfix | yes | planned: Tier2 (compile log surface P11; debugging pane) | High | structured error cycling, not raw log scroll |
| Environment surround/toggle (`tse`,`tsf`) | yes | gap | Med | rename a theorem→lemma in place; fraction toggle |
| Multi-file project root + cross-file index | yes | planned: Tier0/Tier3 (workspace-aware cref; project tree) | High | the index that powers cross-file `\cref` and citation completion |
| Filename completion for includes | yes | gap (partial: figure insertion gallery Tier3) | Med | path completion inside image/include references |

## Gaps (net-new candidates our catalogue does NOT track)

- **Section/environment keyboard MOTIONS** (`[[`/`]]` by section, `[m`/`]m` by environment, `[n`/`]n` by math zone).
  The catalogue tracks an outline SIDEBAR with jump-shortcuts, but not in-buffer next/prev-section / next/prev-environment motion commands.
  For a long thesis these are the fast path.
  `[relevance: High]`
- **Environment/command surround + toggle** (`tse` rename-environment, `tsf` fraction toggle, `cse` change-surrounding-env, `dsd` delete-delimiter-pair).
  No catalogue item covers structural edits of an existing environment/delimiter.
  `tsf` (toggle `\frac{a}{b}` ↔ inline) and `tse` (theorem→lemma) are high-value for math.
  `[relevance: Med]`
- **Citation fuzzy-match on metadata, not key**: vimtex matches the cite popup against a formatted `key + author + year + title` string.
  The catalogue's "bib citation autocomplete" doesn't specify the match surface; porting the metadata-match string is the mechanism that makes it usable.
  `[relevance: High]`
- **Command completion scoped to available macros**: vimtex only offers commands the document can actually use (detected packages).
  Our analog: scope backslash-completion to the injected MathJax macro tiers ([[../feature-catalogue-and-implementation-status]] references the macro-tier system) so users only see macros that will render.
  `[relevance: Med]`
- **Inverse search (preview→source) as a first-class action**, distinct from scroll-sync: click a rendered theorem → land on its source line.
  The catalogue has hover-to-edit via `.pandoc-preview-editable` postMessage, which is the inverse-SyncTeX analog, but only for filter-tagged elements; vimtex's is universal.
  `[relevance: High]`
- **`pplatex`-class log post-processing**: vimtex can route compile logs through a dedicated pretty-printer before quickfix.
  Our compile-log surface (P11) shows the raw subprocess output; a structured warning/error parser layer (line, severity, message, jump target) is a net-new refinement.
  `[relevance: High]`

## Dispositions

- **Glossary / package / documentclass / bibstyle completion** — *deprioritized (Low relevance)*: these are LaTeX-preamble concerns; in this app pandoc owns the template and the document class, so users do not author `\documentclass`/`\usepackage` lines.
  Glossaries are rare in math-research markdown.
  Not gimmicks, just out of the math-markdown surface.
- **Vim modal motions/text-objects as literal keybindings** — *excluded as stated, capability retained*: the app is CodeMirror-6-native and vim-modal editing is demoted to optional+very-late ([[../feature-catalogue-and-implementation-status]] Firenvim decision).
  Port the CAPABILITY (jump-by-section, select-environment) as CM6 commands/keymaps, NOT the vim keystroke grammar.
- **`tsb` toggle-linebreak, `iP`/`aP` paragraph objects** — *gimmick — deprioritized*: low marginal value over CM6 native paragraph handling and our flowmark semantic-linebreak formatting; not worth bespoke surface.
- No banned-non-goal overlap: vimtex is single-user desktop tooling; nothing here implies cross-platform/hosted/multi-user.
