# amar-jay/pandoc-editor — Parity Research

## What it is

A cross-platform Electron + React/TypeScript markdown editor ("built in 2 days with Claude Sonnet 4.0 + GitHub Copilot"; ~9 stars), pitched at "academic and professional writing." Source read directly from `github.com/amar-jay/pandoc-editor` (default branch `main`): main process in `src/main/` (`pandoc.ts`, `install-pandoc.ts`, `filesystem.ts`), renderer in `src/renderer/src/`. The critical architectural fact for our lens: **its live preview is NOT pandoc** — `preview-pane.tsx` renders with `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` + `rehype-highlight` and a `MermaidRenderer`. Pandoc is invoked ONLY on export (`src/main/pandoc.ts`, `buildPandocCommand`). So for a math-research user, the on-screen preview is a CommonMark/KaTeX approximation that does not reflect the real pandoc output (no amsthm/theorem environments, no filters, no `~/.pandoc` template). That is exactly the failure mode our product exists to avoid: our P1/P4 obligations demand the preview be the user's REAL raw pandoc command. This editor is a useful inventory of "ordinary editor affordances" but an anti-example on the core loop.

## Feature inventory

- Live preview via react-markdown + rehype-katex + mermaid (NOT pandoc) `[relevance: High]` — relevant as an ANTI-pattern; our loop must preview real pandoc
- Three view modes: edit-only / preview-only / split (`viewMode` state in `toolbar.tsx`) `[relevance: Med]`
- Real pandoc on export only; `buildPandocCommand` assembles a string from structured `PandocOptions` `[relevance: High]`
- Export formats: PDF, HTML, LaTeX, DOCX, EPUB, Plain Text (`export-dialog.tsx` grid) `[relevance: Med]`
- PDF engine selectable (`--pdf-engine=`, default `pdflatex`) `[relevance: Med]`
- Bibliography + CSL support on export (`--bibliography=`, `--csl=` flags built in `pandoc.ts`); "citation-ready" but NO in-editor citation picker `[relevance: High]`
- Pandoc options surfaced: `--template`, `--css`, `--toc`/`--toc-depth`, `--number-sections`, `--standalone`, `--self-contained`, font variables (mainfont/sansfont/monofont/mathfont), metadata (title/author/date), arbitrary `customArgs`/`variables` `[relevance: Med]`
- `PandocUtils` helpers: `batchConvert` (multi-format at once), `createAcademicPDF` (toc+numbered+geometry 1in+12pt+double-space), `createPresentation` (reveal-ish HTML vars) `[relevance: Med]`
- Bundled Pandoc auto-download/install per-OS at version 3.7.0.2 (`install-pandoc.ts`) `[relevance: Low]` — banned non-goal territory (cross-platform), but the "ship/provision pandoc" idea maps to our doctor/first-run
- Formatting toolbar: bold/italic/strikethrough/code/H1/H2/H3/lists/quote via `insertMarkdown('**','**')` etc. `[relevance: Low]` — exactly the generic formatting toolbar our P55 REMOVES in favor of an insertion bar
- YAML frontmatter editor / preview (`frontmatter-preview.tsx`, `use-frontmatter.ts`) `[relevance: Med]`
- File tree with selection + collapsible folders (`file-tree.tsx`); README claims "file tree with search" `[relevance: High]`
- Recent files tracking (settings + `local-storage.ts`) `[relevance: Med]`
- Auto-save (`use-content-management.ts`, settings toggle) `[relevance: High]`
- Vim mode (`use-vim.ts`, settings toggle, cursor style options block/underline/thin/fat/blink) `[relevance: Med]`
- Keyboard shortcuts (`use-keyboard-shortcuts.ts`): Ctrl+S/Shift+S save-as, Ctrl+O, Ctrl+N, Ctrl+F find, Ctrl+/ , Ctrl+ +/-/= zoom, Ctrl+Z/Shift+Z undo/redo, Ctrl+B/I, F11 fullscreen `[relevance: Med]`
- Find/search within document (Ctrl+F, `SearchHandlers`) `[relevance: Med]`
- Settings dialog (tabs: Appearance / Editor / Advanced): theme light/dark/auto, font size slider, font family, line height, line numbers, word wrap, spell check toggle `[relevance: Med]`
- Zoom 50%–200%, distraction-free fullscreen, resizable split (`resizable-split-window.tsx`) `[relevance: Low]`
- Word count + reading time (README "Extras") `[relevance: Low]`
- Cursor-position + scroll hooks (`use-cursor-position.ts`, `use-editor-scroll.ts`) `[relevance: Med]`
- Syntax highlighting in editor + `rehype-highlight` in preview (github / github-dark CSS) `[relevance: Med]`
- Mermaid diagram rendering in preview (`mermaid.tsx`) `[relevance: Low]` — not our diagram model (we own tikz/tikzcd via filters, not mermaid-in-browser)

## Parity matrix

| feature | target has it | our status | math-writing relevance | notable mechanism worth porting |
| --- | --- | --- | --- | --- |
| Live preview = real pandoc | NO (react-markdown+katex) | planned: Tier 0 (P1/P4) — our differentiator | High | none — this is the anti-pattern; do NOT port |
| Split / edit / preview view modes | yes | have-ish (50/50 panes, Tier 0) | Med | three-way mode toggle is a minor UX nicety |
| Pandoc export (PDF/HTML/LaTeX/DOCX/EPUB/txt) | yes (export only) | planned: Tier 2 export plugins (P7/P8/P12) | Med | structured→string command build; we instead keep raw string canonical |
| PDF engine selection | yes | have (config-owned; lualatex hard dep, P8) | Med | `--pdf-engine=` flag |
| Bibliography + CSL on export | yes (flags only) | planned: Tier 2 refs pipeline | High | `--bibliography`/`--csl` wiring |
| In-editor citation PICKER (@-autocomplete) | NO | planned: Tier 0 bib autocomplete + Tier 4 Zotero | High | gap — Zettlr has it, this does not |
| `--template` / `--css` / `--toc` / numbered sections | yes | planned: Tier 2 (pandoc plugin config) | Med | flag surface inventory |
| File tree + search | yes | planned: Tier 3 tree + file-explorer filtering | High | tree-with-filter pattern |
| Recent files | yes | planned: Tier 0 (ordinary affordances) | Med | local-storage backed list |
| Auto-save | yes | planned: Tier 1 recovery (P45, stronger: host-fs git) | High | ours is durably stronger (git recovery repo) |
| Vim mode | yes | planned: Tier 5 (Firenvim, optional/late) | Med | CodeMirror vim extension instead |
| Frontmatter editor | yes | gap (not tracked) | Med | dedicated YAML edit/preview surface |
| Formatting toolbar (bold/H1/…) | yes | REMOVED by design (P55 insertion bar) | Low | anti-pattern; we replace it |
| Spell check toggle | yes (toggle only) | planned: Tier 0 (P54, with custom math dict) | High | ours is stronger (math dictionary) |
| Word count / reading time | yes | planned: Tier 0 status cluster (word/line count) | Low | status-bar metric |
| Mermaid in preview | yes | gap-by-design (we own tikz via filters, mermaid not a goal) | Low | not aligned with our diagram model |
| Bundled pandoc auto-install | yes (per-OS) | partial (doctor/first-run provision, single-platform) | Low | provisioning idea, not cross-platform |

## Gaps

Features this editor has that our catalogue does NOT explicitly track as items:

- **YAML frontmatter editor / preview surface** `[relevance: Med]` — a dedicated metadata-editing affordance (title/author/date/bibliography/csl front matter). Our catalogue assumes frontmatter is hand-typed; a structured frontmatter helper (especially to declare `bibliography:` per-file, which Zettlr also does) is a net-new candidate worth recording. NOT a banned non-goal.
- **Batch / multi-format export in one action** (`PandocUtils.batchConvert`, `Promise.allSettled` over several format options) `[relevance: Low–Med]` — our export model is per-type plugins (Tier 2/4); "export to N formats at once" is not tracked. Minor, plugin-composable later.
- **"Reading time" metric** `[relevance: Low]` — trivial; our status cluster tracks word/line count but not reading time. Negligible.

Negative finding on net-new depth:

- Searched: full `main` tree of amar-jay/pandoc-editor (all `src/` files, README), grepping labels/options across export/settings/file-tree/preview/toolbar/hooks.
- Found: no outline/TOC sidebar, no snippet system, no command palette, no quick-open file switcher, no linting, no slide editing mode, no Zotero/CAYW, no clipboard-image-to-figure, no scroll-sync implementation surfaced (a `use-editor-scroll` hook exists but no preview line-mapping).
- Conclusion: I believe this editor is shallow on the math-research-specific axes (citations-in-editor, figures, tikz, navigation of large theses); its value to us is mainly the ordinary-affordance checklist and the pandoc-flag inventory, plus a clear anti-example for the preview.
- Confidence: High (read the actual source, not the landing page).
- Gaps: I did not run the app; runtime behaviors (e.g. whether "file tree search" is real or aspirational — the `MarkdownFileBrowser` import is commented out in `toolbar.tsx`) are inferred from source, not observed.

## Dispositions

- **Mermaid-in-browser preview** — gimmick/misaligned, deprioritized. Reason: our diagram model owns tikz/tikzcd through the pandoc filter layer ([[../plugins-diagrams-figures-requirements]]); in-browser mermaid is not a math-research goal and overlaps the spirit of in-browser TikZ rendering we avoid.
- **KaTeX preview engine** — excluded. Reason: violates the user-owned "MathJax always, no engine option anywhere" premise ([[../decision-provenance-user-owned-vs-framework-forced]], P4/P16). KaTeX cannot cover pandoc's full math syntax.
- **Cross-platform packaging + bundled per-OS pandoc download** — excluded — banned non-goal (cross-platform) ([[../product-destination-what-done-looks-like]]). We provision pandoc single-platform via doctor/first-run.
- **Generic formatting toolbar (bold/italic/H1/H2/H3)** — excluded by design. Reason: P55 explicitly replaces the formatting toolbar with a math-research INSERTION bar; trivial-in-markdown formatting is Low relevance by definition ([[../feature-catalogue-and-implementation-status]]).
- **react-markdown live preview** — excluded as the core-loop approach. Reason: directly contradicts the "preview = real raw pandoc command" invariant (P1/P4); recorded here so synthesis never mistakes this editor's preview for parity.
