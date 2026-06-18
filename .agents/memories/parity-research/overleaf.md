# Overleaf — Parity Research

**Scope note (read first):** Overleaf is a raw-.tex-source-of-truth, hosted, collaborative LaTeX editor.
This app is pandoc-markdown-first and single-user desktop.
Therefore every Overleaf feature below is mapped to the markdown → pandoc → latex/HTML pipeline, NOT copied literally.
All hosting, collaboration, and AI features are excluded or deprioritized per the banned-non-goal / gimmick rules.
See [[../feature-catalogue-and-implementation-status]] and [[../product-destination-what-done-looks-like]].

## What it is

A browser-hosted LaTeX authoring environment whose source of truth is a raw multi-file `.tex` project compiled server-side (AutoTeX/latexmk-style multi-pass over a pinned TeX Live) into a PDF rendered in an embedded PDF.js viewer, with SyncTeX click-jump between source and PDF, an inline compile-error/warning pane, citation/label autocomplete, a file tree, a per-file section outline, and a code↔visual editor toggle.
Researched at docs.overleaf.com and overleaf.com/learn (June 2026).

## Feature inventory

- **Live PDF preview in an embedded PDF.js viewer** — compiled PDF shown beside the source.
  `[relevance: High]` (this is the Tier-2 PDF-preview / Gummi-parity target)
- **Auto-compile on idle (toggleable) + manual Recompile button** — Overleaf shipped a "toggle between auto-compile and manual-compile modes" feature; the Recompile button sits top-left of the PDF viewer.
  `[relevance: High]` (our preview already auto-renders on debounce; this maps to render debounce, not a full LaTeX compile, for the HTML preview)
- **Fast vs full compile / draft mode** — Overleaf offers a faster compile that skips full reprocessing.
  `[relevance: Med]` (only relevant to the PDF-export path, not the HTML preview)
- **Inline compile-log pane: errors, warnings, compiler output** — "a pane displaying any LaTeX errors, warnings, and other compiler output to help you debug."
  Error icon next to Recompile.
  `[relevance: High]`
- **SyncTeX bidirectional click-jump (source↔PDF)** — arrows on the editor/PDF divider; click PDF to jump to source line and vice versa.
  `[relevance: High]`
- **File tree / project structure sidebar** — organize and manage project files/directories.
  `[relevance: Med]`
- **Per-file section outline** — sidebar list of the open file's LaTeX sectioning commands for in-file navigation; does NOT follow `\input`/`\include`/`\import` (single-file only — a known Overleaf limitation).
  `[relevance: High]` (large theses need cross-file outline → see Gaps)
- **Citation-key autocomplete on `\cite`** — popup of bibliography keys from the project's bib.
  `[relevance: High]`
- **`\ref`/`\label` cross-reference autocomplete** — completion of label keys.
  `[relevance: High]`
- **General LaTeX command autocomplete + code check (linting)** — editor settings expose auto-complete and code-checking toggles.
  `[relevance: Med]`
- **Spell-check with selectable dictionary** — editor-settings dictionary.
  `[relevance: Med]`
- **Project search across files** — quickly locate text within project files.
  `[relevance: Med]`
- **Visual / rich-text ("Code ↔ Visual") editor toggle** — WYSIWYG-ish editing of LaTeX. `[relevance: Low]` (DEPRIORITIZED per task instruction; markdown source is already low-friction)
- **Templates gallery** — starter documents.
  `[relevance: Low]`
- **Bibliography handling (.bib, .bst styles, Zotero/Mendeley sync)** — `[relevance: High]` for the citation/bib path; the hosted Zotero sync is a connector, our path is Zotero CAYW + bib file
- **AI Error Assistant** — `[relevance: gimmick]`
- **Real-time collaboration / track changes / comments / chat / history sharing** — `[relevance: banned non-goal]`

## Parity matrix

| feature | target has it | our status | math-writing relevance | notable mechanism worth porting |
| --- | --- | --- | --- | --- |
| Live document preview beside source | yes (PDF) | have (HTML preview, Tier 0); PDF preview planned: Tier 2 | High | embedded PDF.js viewer for the PDF-export path (catalogue already names pdf.js) |
| Auto-compile on idle + manual recompile | yes | have (debounce render + manual refresh-preview, Tier 2 render-lifecycle) | High | explicit auto/manual toggle as a first-class control |
| Inline error+warning log pane | yes | have (Compile Log surface P11; debugging pane Tier 2) | High | warnings surfaced inline next to the compile control, not buried |
| SyncTeX source↔PDF click-jump | yes (bidirectional) | partial — scroll sync planned Tier 2 (proportional + data-line); hover-to-edit (preview→source) Tier 2 | High | bidirectional click-jump on the divider; gated on pandoc `sourcepos` reader decision |
| File tree / project structure | yes | planned: Tier 3 (project/file tree, respects .gitignore) | Med | — |
| Per-file section outline | yes | planned: Tier 0 (Outline/TOC sidebar — already RICHER: includes fenced divs) | High | our catalogue already exceeds Overleaf (fenced-div `:::{.remark}` entries) |
| Citation-key autocomplete | yes | planned: Tier 0 insertion bar (bib citation autocomplete, needs bib file in config) + Tier 4 Zotero | High | popup sourced from the config-declared bib file |
| `\ref`/`\label` autocomplete | yes | planned: Tier 0 insertion bar (`\cref` picker, workspace-aware) | High | our `\cref` picker is workspace-aware (scans subdocuments) — exceeds Overleaf's single-file ref scope |
| General command autocomplete + lint | yes | planned: Tier 0 (CodeMirror 6 completion sources; quicktex 281-entry dict) | Med | composable completion sources (P51) |
| Spell-check w/ dictionary | yes | planned: Tier 0 (P54, custom math dictionary) | Med | our version honors a custom math dict so math terms aren't flagged |
| Project-wide search | yes | not explicitly tracked | Med | — (see Gaps: in-file search is Tier 0; project-wide is a gap) |
| Visual/rich-text editor | yes | excluded (DEPRIORITIZED) | Low | — |
| Templates gallery | yes | planned: Tier 2 (vendored research templates install) | Low | install into `~/.pandoc/templates`, not an in-app gallery |
| Bibliography (.bib/.bst, Zotero) | yes | planned: Tier 4 Zotero CAYW + Better BibTeX export | High | Zotero's own CAYW popup, not an in-app bib manager |

## Gaps

Target features our catalogue does NOT currently track (net-new candidates):

- **Bidirectional SyncTeX-style click-jump for the PDF-export preview** — the catalogue tracks scroll sync (editor↔HTML preview) and hover-to-edit (HTML→source), but NOT click-jump between the **compiled PDF** and source once PDF preview lands.
  When the PDF preview milestone (Tier 2) arrives, pandoc emits `\input{}`-flattened latex; mapping a PDF page-coordinate back to a markdown source line is unsolved and not tracked.
  `[relevance: High]`
- **Explicit fast/draft vs full compile distinction for the export/PDF path** — our render path is single-pass and fast by design, but the latexmk-class export path has no "draft mode" concept tracked; a fast preview-compile vs a final multi-pass compile could matter for large theses.
  `[relevance: Med]`
- **Project-wide text search** — Tier 0 tracks in-editor `find`; Overleaf has cross-file project search.
  For a multi-file thesis this is distinct from in-file find.
  Tier 3 tracks file-tree filtering (filename search), not content search.
  `[relevance: Med]`
- **Inline warning surfacing (not just errors) tied to source locations** — P11/Compile Log asserts command + exit status; surfacing pandoc/latex **warnings** mapped to source positions (Overleaf lists warnings in the same pane) is not explicitly an obligation.
  `[relevance: Med]`

## Dispositions

- **AI Error Assistant** — gimmick, deprioritized.
  Reason: AI feature, explicitly out of scope.
- **Real-time collaboration, track changes, comments, chat, sharing, project history sharing** — excluded, banned non-goal (multi-user / collaboration).
- **Hosted/server-side compilation** — excluded, banned non-goal (hosted deployment).
  Mapped instead to a local user-configured latexmk-class command ([[../rendering-pipeline-requirements-filters-mathjax-references]]).
- **Visual / rich-text ("Code↔Visual") editor** — DEPRIORITIZED (recorded, not dropped).
  Reason: per task instruction; markdown is already low-friction vs raw LaTeX, so a WYSIWYG layer adds little for math research writing.
- **Cloud templates gallery as an in-app browser** — mapped to vendored-template install into `~/.pandoc/templates` (Tier 2), not a hosted gallery.
