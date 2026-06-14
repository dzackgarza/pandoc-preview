# Lineage: Vim Live-TeXing Setup

**When this applies:** understanding what workflow the app reproduces, or designing any feature with a "what did this look like before" question. The app is the successor to a highly efficient vim-based live-TeXing environment; its vestiges are primary sources: [dotfiles init.vim](https://github.com/dzackgarza/dotfiles/blob/master/.config-sync/nvim/init.vim) and [quicktex fork](https://github.com/dzackgarza/quicktex) (clones: `/tmp/claude-1000/init.vim`, `/tmp/ref-quicktex`).

**The intellectual origin — Gilles Castel's lecture-notes posts** ([part 1: LaTeX+Vim](https://castel.dev/post/lecture-notes-1/), [part 2: Inkscape figures](https://castel.dev/post/lecture-notes-2/)) — "many ideals/goals for this setup are expressed originally" there (user, 2026-06-13). The governing ideal: **"Writing text and mathematical formulas in LaTeX should be as fast as the lecturer writing on a blackboard: no delay is acceptable."** The mechanisms map one-to-one onto this setup and the app's targets:

- UltiSnips auto-triggered, math-mode-aware snippets ("type in the same order the lecturer writes"; `mk`→inline math, auto-subscripts, postfix `phat`→`\hat{p}`) → quicktex dictionaries → the app's phase-2 expansion target.
- Concealment (`conceallevel`, delimiters invisible, `\bigcap`→∩) + on-the-fly `Ctrl+L` spell-fix → the conceal layer in [Editor Experience Targets: Conceals, Folding, Expansion](editor-experience-targets-conceals-folding-expansion).
- Live compile + side-by-side Zathura with SyncTeX → the preview loop the app replaces (and SyncTeX is the ancestor of the scroll-sync + hover-to-edit ambitions).
- The inkscape-figures manager — hotkey creates a figure from a template and opens Inkscape; a rofi selector reopens existing figures; a file watcher auto-exports **pdf+LaTeX on every save** so figure text is typeset by LaTeX ("when you later decide to change the font, it gets updated accordingly") — is the direct ancestor of `inkscape-figures.sh`, the figure library, the rofi/fzf plugin-firewall philosophy, AND why `tikzcd.lua` supports `\input{*.pdf_tex}` overlays.
- The custom Inkscape shortcut manager (key chords for styles, `t` opens a vim window for LaTeX text) is the spirit behind "deep integration with the user's actual drawing tools," not generic launching. Castel's closing ideal is the app's UX bar: writing LaTeX "no longer an annoyance, but rather a pleasure."

**The predecessor stack (verified in init.vim):**

- `vimpreview.sh` / `pdfpreview.sh` spawned in vim terminals (`<leader>lp/lpp/lo`, init.vim:199-300) — file-watch + pandoc compile + browser/PDF view. THIS is the "manual loop" the app replaces ([Founding Philosophy: Exact Pandoc Preview](founding-philosophy-exact-pandoc-preview)).
- **quicktex fork**: mode-aware text expansion with two dictionaries — `g:quicktex_prose` and `g:quicktex_math` — e.g. `thm` → `:::{.theorem title="?"}` fenced div, `frac` → `\frac{<+++>}{<++>}` with jump-points. Daily-use proof that theorem environments are authored as pandoc fenced divs.
- `PasteImage()` (init.vim:356-363): clipboard PNG via `xclip` → `figures/` dir → inserts `![](figures/<name>.png)` at cursor. (Project-local then; the app's contract moved this to the centralized global figures dir — symlink into projects when needed.)
- `CreateInkscape()` (init.vim:561-572): shells to `inkscape-figures.sh -d <figures dir>`, which creates/opens a figure and returns the markdown snippet to insert — the create-AND-reopen flow the figure library generalizes.
- vim-pandoc-syntax with custom conceals, Voom outline, citation pickers (`citep`/pandoc format switching, init.vim:378).

**What this lineage pins down:** the app is not inventing a workflow — every feature has a working predecessor whose ergonomics set the bar. Phase-2 features (text expansion, autocomplete, concealing) are deferred to a Firenvim-based phase precisely because the vim ecosystem already owns them ([Product Destination: What Done Looks Like](product-destination-what-done-looks-like)); the app must not reimplement quicktex-class functionality natively.
