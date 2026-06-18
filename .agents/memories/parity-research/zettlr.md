# Zettlr — Parity Research

## What it is

Zettlr is a mature open-source (Electron) markdown writing environment that is, structurally, a **front end for Pandoc** — its whole export pipeline delegates to the user's installed pandoc, and it writes in Pandoc-flavored Markdown (CommonMark + GFM + Pandoc extensions: footnotes, citations, LaTeX math, Mermaid).
For a math-research user it is the closest existing analogue to our product on the WRITING axes: real BibTeX/CSL citation autocomplete, a TextMate-syntax snippet system, a clickable document outline, full-text workspace search with boolean operators, and pandoc export to PDF(via LaTeX)/HTML/DOCX/reveal.js.
Researched from `docs.zettlr.com` (citations, snippets, sidebar/TOC, global search, math, settings pages).
Per the task scope, this memory EXCLUDES Zettlr's Zettelkasten-specific machinery (zettel IDs / `ZKN_ID`, internal `[[wikilink]]` graph as a knowledge base, tag-graph) and keeps only general writing-editor features.
Two divergences from our premises: Zettlr's in-editor math preview uses **KaTeX** (we are MathJax-always), and its preview is an in-editor CodeMirror render, not a live pandoc-rendered HTML preview — so it is NOT a true "exact pandoc preview" the way our P1/P4 loop demands.

## Feature inventory

- **Citation autocomplete via `@` trigger** `[relevance: High]` — typing `@` (at line start, after whitespace, or after `[`) pops a list of citekeys from the loaded library; filters by author/year as you type; tooltip shows bibliographic info to verify before Enter.
  Supports full Pandoc citation syntax: `[@Key, p. 45]`, narrative `@Key`, hybrid `@Key [p. 123]`, prefix/locator/suffix.
- **Bibliography database config** `[relevance: High]` — global library set in Preferences→Citations (CSL JSON, BibTeX, or BibLaTeX used directly; Zotero/EndNote via export); OR per-file via YAML `bibliography: ./assets/references.json`.
- **References sidebar** `[relevance: Med]` — live preview bibliography of everything cited in the current doc (Chicago internally; export uses chosen CSL).
- **Snippets (TextMate syntax)** `[relevance: High]` — `.tpl.md` files managed in the Assets Manager; inserted by typing `:` (line start / after space) → autocomplete; numbered tabstops `$1`,`$2`, `$0` final cursor, defaults `${1:default}`, duplicate tabstops select all occurrences (multi-cursor fill); 15+ variables (`CURRENT_YEAR`, `CURRENT_MONTH_NAME`, `UUID`, `CLIPBOARD`, …). Partially VS Code-compatible.
- **Tag autocomplete** via `#` `[relevance: Low]` — Zettelkasten-adjacent; only general insofar as `#` keyword completion; not a priority for us.
- **Table of Contents / outline sidebar tab** `[relevance: High]` — structured numbered list of all headings; entries are interactive — clicking jumps to the section.
  (Sidebar also has References, Related Files, Other Files tabs.)
- **Global full-text search** `[relevance: High]` — Cmd/Ctrl+Shift+F; indexes across all open workspaces.
  Boolean query syntax: space=AND, `|`=OR, `"exact phrase"`, `!term`/`!"phrase"` negation, chainable.
  Results grouped per file with line numbers + highlighted matches; filename matches first; **relevancy heatmap** (green=high, blue=relevant, gray=low; exact/case-sensitive title matches weighted higher); searches optionally restricted to a directory; click a match opens the file at that line.
- **File manager / workspaces** `[relevance: High]` — open folders as workspace roots; full file ops (open/duplicate/create/remove/drag); type-to-filter navigation (Cmd/Ctrl+Shift+T focuses file manager + enables type-to-filter); tabs for open documents (Ctrl/Alt+Tab cycle).
- **Pandoc export** `[relevance: Med]` — Cmd/Ctrl+E; formats gated on what's installed: HTML, DOCX, PDF (via LaTeX), reveal.js slides; custom templates supported.
- **reveal.js presentation export** `[relevance: Med]` — slide output through pandoc/reveal.js (maps to our Tier 2 slides editing mode).
- **Math (KaTeX) inline render** `[relevance: High]` — `$…$`/`$$…$$` rendered in-editor with KaTeX; on export PDF uses LaTeX math, HTML defaults to a math renderer.
  (Engine choice diverges from our MathJax-always.)
- **Mermaid diagrams** `[relevance: Low]` — first-class mermaid; not our diagram model.
- **Autocorrect / magic quotes / typography** `[relevance: Low]` — smart-quote substitution, autocorrect table.
- **Distraction-free mode** `[relevance: Low]` — hides sidebars/tabs/splits, grays all but current paragraph.
- **Typewriter mode** `[relevance: Low]` — centers + highlights current paragraph.
- **Readability mode** `[relevance: Low]` — selectable readability algorithm coloring sentences.
- **Spellcheck** `[relevance: Med]` — dictionary-based.
- **Syntax highlighting** for CommonMark/GFM/Pandoc extensions + code blocks `[relevance: Med]`.
- **Custom CSS / themes** `[relevance: Low]`.
- **Split editor windows / panes** `[relevance: Low]`.
- **Print/preview** Cmd/Ctrl+P `[relevance: Low]`.

## Parity matrix

| feature | target has it | our status | math-writing relevance | notable mechanism worth porting |
| --- | --- | --- | --- | --- |
| Citation autocomplete (`@` → citekeys) | yes | planned: Tier 0 bib autocomplete (catalogue line) | High | `@`-trigger reading a config-declared BibTeX/CSL; tooltip preview before insert |
| Bibliography config (global + per-file YAML) | yes | partial (Tier 0 requires bib file in config) | High | per-file `bibliography:` frontmatter key as an override |
| References/bibliography preview sidebar | yes | gap (not tracked) | Med | live "what you've cited so far" panel |
| Snippets (TextMate, tabstops, variables) | yes | planned: Tier 0 P52/P59 (config snippet dict, tabstops) | High | TextMate `$1`/`${1:default}`/`$0`, duplicate-tabstop multi-fill, `CLIPBOARD`/date vars |
| `:`-trigger snippet autocomplete | yes | planned: Tier 0 P52 (autocomplete) + P59 (bar dropdown) | High | colon trigger as the snippet entry point |
| Outline / TOC sidebar (clickable, jumps) | yes | planned: Tier 0 outline/TOC (also indexes fenced divs) | High | clickable headings → jump; ours ALSO lists `:::{.remark title=…}` divs |
| Global full-text workspace search | yes | gap (not tracked) | High | boolean syntax + relevancy heatmap + per-dir restriction |
| File manager / workspaces / file ops | yes | planned: Tier 3 tree + file ops (P6) | High | open-folder-as-workspace; type-to-filter |
| Type-to-filter in file list | yes | planned: Tier 3 file-explorer filtering | High | filter-as-you-type within the tree |
| Quick file switcher (fuzzy quick-open) | partial (type-to-filter, no fuzzy palette) | planned: Tier 3 Ctrl+P workspace browser | High | ours (fzf/dmenu) is stronger than Zettlr here |
| Pandoc export (HTML/DOCX/PDF/reveal) | yes | planned: Tier 2 export plugins | Med | export gated on installed tools |
| reveal.js slides export | yes | planned: Tier 2 slides mode (separate renderer plugin) | Med | pandoc→reveal.js command |
| In-editor math render | yes (KaTeX) | have-by-design (MathJax always) | High | mechanism diverges; we use MathJax |
| Live pandoc HTML preview | NO (in-editor CodeMirror render) | planned: Tier 0 (our differentiator, P1/P4) | High | none — ours is the stronger model |
| Spellcheck | yes | planned: Tier 0 P54 (with custom math dict) | High | ours stronger (math dictionary) |
| Distraction-free / typewriter / readability | yes | gap (not tracked) | Low | writing-comfort modes |
| Autocorrect / magic quotes | yes | gap (not tracked) | Low | typography substitution table |
| Mermaid diagrams | yes | gap-by-design (we own tikz via filters) | Low | not aligned |

## Gaps

Features Zettlr has that our catalogue does NOT track — net-new candidates (Zettelkasten features deliberately excluded):

- **Global full-text workspace search with boolean operators + relevancy heatmap** `[relevance: High]` — our catalogue tracks file-tree FILTERING (Tier 3) and the Ctrl+P quick-open browser, but NOT a content search across all workspace files.
  For navigating a large multi-chapter thesis, "find every file mentioning `Minkowski bound`" with AND/OR/NOT and a relevance heatmap is a strong net-new candidate.
  Maps onto the "workspace-aware, scans across subdocuments" spirit our `\cref` picker already needs.
- **References/bibliography preview sidebar** `[relevance: Med]` — a live panel of what the current document cites (rendered in a CSL style).
  Distinct from the citation autocomplete we already plan; a "second sidebar tab" sibling to our planned figures tab.
  Net-new candidate.
- **Per-file `bibliography:` YAML override** `[relevance: Med]` — our Tier 0 assumes a single required bib file declared in config; Zettlr also honors a per-file frontmatter `bibliography:` key.
  Useful for papers that ship their own `.bib`. Small net-new refinement.
- **Snippet variables (`CLIPBOARD`, date variables)** `[relevance: Med]` — our P52/P59 snippet model proves tabstop expansion but does not yet specify dynamic variables.
  TextMate-style `$CLIPBOARD`/`$CURRENT_DATE` substitution is a concrete enrichment of our snippet source.
  Net-new refinement.
- **Writing-comfort modes: distraction-free / typewriter / readability** `[relevance: Low]` — not tracked; low priority for math research but cheap.
  Record, do not prioritize.
- **Autocorrect / magic quotes / typography table** `[relevance: Low]` — not tracked; low relevance (and risky around math/LaTeX where smart quotes corrupt source).
  Record with caution.

## Dispositions

- **Zettelkasten features** (zettel IDs, `[[wikilink]]` knowledge graph, tag graph, `ZKN_ID`) — out of scope per task instructions; not a banned non-goal but explicitly excluded as a knowledge-base concern, NOT a general writing feature.
  (Our Tier 8 wishlist DOES track "follow wikilinks when resolvable" — but as link-following, not graph-building.)
- **KaTeX math engine** — excluded.
  Reason: violates MathJax-always premise ([[../decision-provenance-user-owned-vs-framework-forced]], P4/P16).
- **Mermaid diagrams** — deprioritized/misaligned.
  Reason: our diagram model is tikz/tikzcd via the pandoc filter layer ([[../plugins-diagrams-figures-requirements]]); mermaid is not a math-research target.
- **Autocorrect / magic quotes** — recorded but deprioritized.
  Reason: smart-quote/autocorrect substitution is hazardous in LaTeX-bearing math source (can rewrite `"` inside `\text{}` or break `$…$`); Low relevance and a correctness risk, so not a near-term goal.
- **In-editor (non-pandoc) preview** — excluded as the core-loop approach.
  Reason: Zettlr renders markdown in-editor, not through pandoc; our P1/P4 invariant requires the preview to be the user's REAL pandoc output.
  Zettlr's preview is therefore NOT parity for our core loop.
- **Cross-platform Electron packaging** — excluded — banned non-goal (cross-platform) ([[../product-destination-what-done-looks-like]]).
