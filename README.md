# Pandoc Preview

Pandoc Preview is a local, source-first editor for mathematical research manuscripts.
It gives a project-editor surface - file tree, source editor, search, quick open, command palette, and live HTML or PDF preview - while rendering through the user's real Pandoc and TeX workflow.

The source text stays canonical.
Templates, filters, macros, bibliographies, figures, and export commands stay in the existing toolchain; the app gives that toolchain one writing surface.

## Status

Pandoc Preview is experimental source-build software for a single-user Linux workstation.
It is currently developed against the author's Arch Linux setup.

No binary release is published.
Hosted collaboration, account sync, multi-user projects, and cross-platform support are not current targets.

## Who it is for

Pandoc Preview is for researchers writing papers, preprints, theses, notes, or slides with Markdown, LaTeX, BibTeX, TikZ, and Pandoc.

Use it when the current workflow is an editor plus watcher scripts, Pandoc or LaTeX commands, a browser or PDF viewer, citation-key copying, figure-directory glue, and export scripts.

Do not use it as a general Markdown editor, a hosted Overleaf replacement, or a Typora-style inline WYSIWYG editor.
The separate source pane is intentional.

## How it fits

Pandoc Preview uses the familiar source-left/output-right layout, but the layout is not the product.
The important difference is that preview output comes from the configured local renderer rather than an approximate Markdown renderer owned by the editor.

It should feel like an ordinary local project editor: open folders, edit files, search, use quick-open, run commands, and keep source files on disk.
Its specialization is the mathematical research toolchain around those files.

## Core workflow

- Open a research project folder.
- Edit Markdown, LaTeX, TikZ, slide, or bibliography source.
- Catch cheap source mistakes before a full render where the editor can do so.
- Inspect HTML or PDF output produced by the configured Pandoc/TeX commands.
- Insert citations and figures without leaving the writing context.
- Export using the same templates, filters, macros, bibliography, and figure assets that made the preview work.

## What is distinctive

- **Exact preview path** - the preview is produced by the real configured renderer, not by a substitute Markdown parser.
- **Source-first editing** - source text is the durable document, even when the preview is live.
- **Mathematical feedback loop** - editor diagnostics catch cheap delimiter, math-mode, citation, and syntax mistakes before expensive renders.
- **Tool-native integration** - Pandoc, TeX, Zotero or BibTeX, TikZ, templates, filters, macros, and figure files remain owned by their existing formats and tools.
- **Publication continuity** - the same project assets support drafting, preview, PDF output, LaTeX export, arXiv-oriented bundles, and archived source handoff.
- **Visible failure** - missing configuration or renderer failure is an error, not a silent downgrade to a lower-fidelity preview.

## What it is not

- A hosted collaboration service.
- An account-backed project manager.
- A WYSIWYG editor that hides source syntax.
- A general IDE.
- An app-owned document ecosystem.
- A cross-platform product.

## Install and run from source

Install the local tools needed for the source build and first-run setup:

- `just`
- `pandoc`
- `gum`
- `bun`
- `cargo`
- WebKitGTK / Tauri desktop dependencies for your Linux distribution

Then run:

```sh
just deps
just setup
just dev
```

`just deps` fetches dependencies and pinned submodules.
`just setup` writes the required config file.
`just dev` launches the desktop app.

When the window opens, choose a project folder and open a source file.
The preview pane renders through the configured toolchain and updates as the source changes.

Run `just --list` for the current command surface.

## Toolchain requirements

The source build checks required tools loudly.
The full research-writing loop can also use these command-line tools, depending on the configured workflows:

- `lualatex` and `latexmk` for PDF builds
- `pdf2svg` for figure preview paths
- `chktex` and `lacheck` for TeX diagnostics
- `ripgrep` for workspace search
- `latexpand` and `arxiv_latex_cleaner` for arXiv-oriented source bundles

The app does not hide missing tools behind fallback behavior.
Install the tool or remove the workflow that requires it.

## Configuration

The config lives at:

```text
${XDG_CONFIG_HOME:-~/.config}/pandoc-preview/config.toml
```

The app refuses to start without a complete config.
Run `just setup` to create one.
Renderer, export, lint, and search behavior are configured there rather than hard-coded into the editor.

## Pandoc assets

Templates, filters, CSL files, and bibliography assets come from the pinned `pandoc-config` git submodule.
`just deps` fetches it, and `just install-assets` links those assets into `~/.pandoc` while preserving real files already present there.

## Development

This is a Tauri 2, Svelte 5, Vite, Tailwind, and CodeMirror 6 application.
Those implementation details matter for contributors, not for deciding whether the app fits a writing workflow.

Use `just --list` for build, run, proof, and typecheck commands.

## License

No top-level license file is currently present in this source tree.
