# Editor Experience Targets: Conceals, Folding, Expansion

# Editor Experience Targets: Conceals, Folding, Expansion

**When this applies:** scoping editor-pane features beyond plain text editing, or evaluating CodeMirror capabilities. Source: the dotfiles nvim config (`/tmp/ref-dotfiles/.config-sync/nvim/`, init.vim + `after/ftplugin/pandoc/quicktex_dict.vim`) — the working editor experience the app ultimately wants to reproduce or mimic.

**What the vim setup provides today (init.vim:327-353, 404, 426):**

- **Conceals** (`conceallevel=1`, `<Leader>c` toggles 0↔2): `:::` fenced-div fences concealed as `―`, `\hfill` as `―`, `title=` inside env attributes hidden — the theorem markup visually recedes while editable.
- **Semantic highlighting of theorem environments:** a syntax region over `{.…}` attribute blocks with keyword classes — `theorem|definition|proof` highlighted as Special, `proposition|corollary|example|problem|solution|question|remark|warnings|exercise|slogan` as Statement. The fenced-div vocabulary is enumerated right there.
- **Folding:** `g:markdown_folding=1` + `foldcolumn=3` (an `after/ftplugin/pandoc/folding.vim` exists as a dangling symlink — its target never made it into the repo; the intent is section folding).
- **Outline pane:** Voom (pandoc mode) auto-opened beside NERDTree on markdown open (init.vim:255-270) — tree + outline + editor (+ preview) is the working IDE layout. The outline itself carries conceal task markers: `$\work$` → 🚩, `$\done$` → ✨ — outline-visible TODO states inside the manuscript.
- **Text expansion:** quicktex with 281 entries across `g:quicktex_prose` and `g:quicktex_math` (`m` → `\( <+++> \)`, `M` → display math block, `thm` → theorem fenced div, domain vocabulary like `st` → "such that"). The dictionary file is the de facto personal authoring vocabulary spec.

**Open feasibility questions (user-flagged, unresolved — do not assume either way):** folding/syntax in CodeMirror 6 → custom Lezer grammar (CM6 has folding + syntax infrastructure but uses Lezer, not treesitter; a pandoc-markdown grammar with fenced-div env awareness is nontrivial); conceals → CM6 replace-decorations can hide/substitute ranges, but whether the full conceal UX (cursor-line reveal, toggle levels) is achievable "is unclear in this framework."

**The strategic out:** the Firenvim embedding phase obviates much of this — expansion/conceal/folding stay nvim-owned and "refocuses development on getting the nvim side right in isolation" ([Product Destination: What Done Looks Like](product-destination-what-done-looks-like) phase 2, [Lineage: Vim Live-TeXing Setup](lineage-vim-live-texing-setup)). Before building any of these natively in CM6, check whether the Firenvim path makes it unnecessary.
