# Gummi — Parity Research

**Scope note (read first):** Gummi is a single-user GTK desktop LaTeX editor — the closest
analogue to this app's deployment shape, and the user explicitly wants to "partially replace
Gummi." Gummi's source of truth is raw `.tex`; this app is pandoc-markdown-first, so Gummi's
compile/preview machinery maps to the markdown → pandoc → latex export-and-PDF-preview path, not
to a raw-tex editor. See [[../feature-catalogue-and-implementation-status]],
[[../product-destination-what-done-looks-like]], [[../rendering-pipeline-requirements-filters-mathjax-references]].

## What it is

A lightweight GTK+ Linux LaTeX editor "designed with simplicity in mind." It compiles the open
`.tex` automatically on idle via **latexmk** (with **rubber** as an alternative build system),
writes build artifacts to a **temp directory** (jobname routed to `C_TMPDIR`, keeping the source
tree clean), enables **SyncTeX** (`-synctex=1`), and shows the resulting PDF in a **continuous
live preview pane** that updates without manual compilation. Verified against the Gummi source
(`src/compile/latexmk.c`), Wikipedia, and the project wiki (June 2026).

## Feature inventory

- **Continuous live PDF preview** — "The pdf is shown without the need to compile it manually";
  preview pane updates as you edit. `[relevance: High]` (the Tier-2 "PDF preview Gummi parity"
  milestone is named directly after this)
- **Compile-on-idle (automatic compilation)** — latexmk-driven compile triggered while editing.
  `[relevance: High]`
- **latexmk + rubber build systems** — rubber "runs just as many compilations as necessary" and
  runs BibTeX/Makeindex when needed; latexmk is the default driver. `[relevance: High]` (matches
  our latexmk-class export-pipeline requirement exactly)
- **Temp-directory builds** — output `-jobname` routed to a temp dir so artifacts don't pollute
  the source directory. `[relevance: Med]` (clean mechanism worth porting to the export path)
- **SyncTeX integration** — `-synctex=1` injected; jump between source and PDF. `[relevance: High]`
- **BibTeX / bibliography support** — bibliography handling + BibTeX processing via the build
  system. `[relevance: High]`
- **Snippets (configurable LaTeX snippets)** — user-configurable snippet expansion. `[relevance: High]`
- **Templates and wizards for new documents** — starter docs + a new-document wizard. `[relevance: Low]`
- **Graphical insertion of tables and images** — GUI table/image inserters. `[relevance: Med]`
  (directly parallels our insertion-bar table builder P58 and clipboard-image P62)
- **Project management** — basic multi-file project handling. `[relevance: Med]`
- **Syntax highlighting** — LaTeX source highlighting. `[relevance: Med]`
- **LaTeX error checking** — surfaces compile errors. `[relevance: High]`
- **Spell check (enchant-based)** — `[relevance: Med]`
- **Export to PDF** — `[relevance: High]`
- **Autosave** — periodic save of the working file. `[relevance: High]` (we go further: host-FS
  recovery store, P45)
- **Document structure / outline summary** — **Gummi explicitly LACKS this** (Wikipedia notes
  Gummi has no document-structure summary, unlike Kile/GNOME LaTeX). `[relevance: High]` (an area
  where our Tier-0 outline already EXCEEDS the replace-target)
- **Graphical math-symbol insertion** — Gummi explicitly LACKS this too. `[relevance: Med]` (our
  insertion bar is math-research-first, so this is covered by design)

## Parity matrix

| feature | target has it | our status | math-writing relevance | notable mechanism worth porting |
| --- | --- | --- | --- | --- |
| Continuous live PDF preview | yes | planned: Tier 2 ("PDF preview Gummi parity"; candidate pdf.js) | High | continuous preview without manual compile — already the named milestone |
| Compile-on-idle | yes | have for HTML preview (debounce render, Tier 0); PDF compile-on-idle: Tier 2 | High | idle trigger reused for the PDF-export preview compile |
| latexmk / rubber multi-pass builds | yes | planned: Tier 2 (latexmk-class export drivers; user-configured command) | High | rubber/latexmk "as many passes as necessary" + auto BibTeX/Makeindex matches our reference-resolution requirement |
| Temp-dir builds (clean source tree) | yes | not explicitly tracked | Med | route export/compile artifacts to a temp dir (`-jobname` to tmp) — net-new |
| SyncTeX source↔PDF | yes | partial — scroll sync + hover-to-edit planned Tier 2 | High | `-synctex=1` flag injection; same gate as Overleaf's click-jump |
| BibTeX / bibliography | yes | planned: Tier 0 bib autocomplete + Tier 4 Zotero | High | build system auto-runs BibTeX between passes |
| Snippets | yes | planned: Tier 0 (P52 dictionary expand) + Tier 0 insertion-bar dropdown (P59) | High | our snippet dictionary is config-declared and composable |
| Templates / wizards | yes | planned: Tier 2 vendored templates; first-run gum walkthrough (P10) | Low | gum wizard, not an in-app GUI wizard |
| Graphical table/image insertion | yes | planned: Tier 0 insertion bar (table builder P58, clipboard image P62) | Med | dimension-chosen pandoc pipe-table; clipboard image → global figures dir |
| Project management | yes | planned: Tier 3 (project/file tree) | Med | — |
| Syntax highlighting | yes | planned: Tier 0 (pandoc-aware highlighting via @lezer/markdown) | Med | ours extends markdown grammar incl. fenced divs |
| Error checking | yes | have (Compile Log P11; debugging pane Tier 2) | High | — |
| Spell check | yes | planned: Tier 0 (P54 + custom math dictionary) | Med | ours skips math-dictionary terms |
| Export to PDF | yes | have (export plugin P8, lualatex) | High | export is a plugin ([[../export-plugins-contract]]) |
| Autosave | yes | have/planned: Tier 1 recovery (P45 host-FS recovery store) | High | ours is a host-FS git recovery repo, sub-10s loss bound — exceeds Gummi |
| Document outline/structure | **Gummi LACKS** | planned: Tier 0 (Outline incl. fenced divs) | High | we exceed the replace-target here |

## Gaps

Target features our catalogue does NOT track (net-new candidates):

- **Temp-directory build isolation for the compile/export path** — Gummi routes latexmk
  `-jobname` to a temp dir so `.aux`/`.log`/`.pdf` never litter the source tree. Our export-plugin
  contract runs with `cwd = source file's parent directory` ([[../export-plugins-contract]]), which
  WILL scatter latex aux files next to the user's thesis. A temp-build-dir convention for the
  latexmk-class export path is untracked and worth adopting. `[relevance: Med]`
- **`rubber` as an alternative build driver / auto BibTeX-Makeindex orchestration** — our pipeline
  names latexmk + include.lua but does not track rubber's "run exactly as many passes as needed,
  auto-invoke BibTeX/Makeindex" behavior as a first-class option. For reference-heavy theses this
  multi-pass auto-orchestration is the substance of "references done right." `[relevance: Med]`
  (overlaps the existing Tier-2 reference-resolution requirement but is not pinned as an obligation)
- **New-document wizard** — Gummi has GUI wizards; our equivalent is the first-run gum walkthrough
  (P10), which bootstraps config, not per-document scaffolding. A per-document "new math paper from
  template" scaffold is untracked. `[relevance: Low]`

## Dispositions

- No Gummi gimmicks (no AI/collab/telemetry) — nothing to deprioritize on that axis.
- **GTK-native / cross-toolkit packaging** — excluded, banned non-goal (cross-platform). This app
  is Tauri/Linux-single-target by design.
- **Raw-.tex source-of-truth editing** — not copied literally; this app is markdown-first and maps
  Gummi's tex-compile loop onto the markdown→pandoc→latex export/PDF-preview path.
- **In-app GTK math-symbol palette** — superseded (not a gap): the math-research insertion bar
  (Milestone G, P55–P62) is the deliberate replacement and is richer (amsthm envs, tikz/tikzcd,
  matrix builder, footnote modal) than Gummi's absent symbol palette.
