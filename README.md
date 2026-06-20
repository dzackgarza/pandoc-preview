# Pandoc Preview

Pandoc Preview is a Pandoc-centric desktop editor for single-user mathematical
writing. It gives Markdown, LaTeX, TikZ, BibTeX, Beamer, and reveal.js-oriented
projects one local editing surface, then previews or exports through configurable
Pandoc and TeX commands.

The app is for people who already have a serious Pandoc setup: templates,
filters, macros, CSL files, a central bibliography, reusable figures, and local
commands for HTML, PDF, LaTeX, slides, or arXiv bundles. Pandoc Preview
centralizes those assets and makes them reachable from the editor without
turning them into an app-owned document format.

## Status

Pandoc Preview is experimental source-build software for a single-user Linux
workstation. It is currently developed against the author's Arch Linux setup.

No binary release is published yet.

## What It Replaces

Pandoc Preview targets the single-person writing experience covered by tools
like Overleaf, Gummi, and QTikz for LaTeX-oriented files, and by Markdown-first
editors such as Inkwell for Markdown files. The difference is that Pandoc is the
center: the same project can move between Markdown and LaTeX inputs, HTML and
PDF outputs, slide formats, templates, filters, bibliography data, and figure
pipelines.

It replaces the local glue around that setup: watcher scripts, hand-run Pandoc
commands, browser/PDF refresh loops, citation-key lookup, figure-directory
bookkeeping, and export scripts.

## Pandoc-Centric Rendering

Pandoc Preview does not expose a fixed subset of Pandoc features through a fixed
set of app controls. Renderers and exporters are configured commands. A renderer
can be Pandoc, `latexmk`, a shell script, a wrapper around a project-specific
filter stack, or another local tool that produces the output the preview pane or
export command expects.

This keeps the app hackable without requiring app changes:

- swap templates for article, preprint, thesis, slides, or handout outputs;
- add or reorder Pandoc Lua filters;
- point at a centralized bibliography and CSL file;
- use local macro/style trees;
- define new render or export plugins as scripts;
- add support for another Pandoc input or output by declaring the plugin rather
  than changing the editor.

## Inputs and Outputs

Pandoc Preview is built around a Pandoc input/output matrix, not a Markdown-only
preview.

| Source | Editing and preview role | Output paths |
| --- | --- | --- |
| Markdown | Pandoc manuscripts, notes, papers, slides | HTML, PDF, LaTeX, arXiv-oriented bundles |
| LaTeX | Full `.tex` documents | HTML or PDF through configured render/export commands |
| TikZ | Standalone figure source | SVG/HTML preview and PDF-oriented figure output |
| Beamer / reveal.js | Slide authoring through Pandoc writers | PDF slides or HTML slide decks |
| BibTeX / BibLaTeX | Citation data for completion and rendered references | Used by preview and export commands |

Any source type that can be mapped to HTML or PDF by a plugin can become part of
the editor.

## Editing Surface

The app includes the ordinary project-editor pieces expected in this workflow:

- file explorer;
- figures explorer;
- source editor plus preview pane;
- `Ctrl+P` quick-open and recent-file navigation;
- `Ctrl+Shift+P` command palette;
- live HTML and PDF preview paths;
- compile/render logs and diagnostics;
- quick CLI setup wizard.

The editing help is tuned for mathematical writing:

- UltiSnips-like snippet expansion;
- QuickTeX-style math insertion;
- amsthm environment insertion;
- matrix, table, code block, footnote, and image insertion;
- TikZ command insertion;
- source-aware completion for project commands, snippets, citations, and labels.

## Citations and References

Pandoc Preview is designed around a centralized bibliography instead of requiring
each project to own a separate citation database. The editor can use the same
BibTeX/BibLaTeX data that the Pandoc command uses for preview and export.

The intended citation workflow is local and fast: invoke Zotero / Better BibTeX
insertion, insert Pandoc citation syntax, autocomplete known keys, and render the
references in the preview through Pandoc's citation machinery. The preview can
therefore show the formatted bibliography, not only raw citation keys.

## Figures

Figures are treated as a shared library, not as throwaway per-project image
paths. The figures explorer is for browsing reusable assets, inserting a figure
into the current document, opening the source behind a rendered figure, editing
that source with the appropriate external tool, and regenerating or previewing
through the configured figure pipeline.

This is the point of the figure integration: the editor knows enough about the
relationship between source figures and rendered assets to keep writing,
previewing, and editing in one loop.

## Safety and Recovery

Pandoc Preview is opinionated about not losing research writing. It has both an
app-internal recovery path and a git-centered save workflow.

The recovery path stores unsaved buffers in an internal recovery repository and
offers restoration when that recovery state is ahead of disk. The save workflow
ties documents to git state so saves can be backed by commits instead of only by
the latest bytes written to the file.

## Install and Run from Source

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

`just deps` fetches dependencies and pinned submodules. `just setup` writes the
required config file. `just dev` launches the desktop app.

Run `just --list` for the current command surface.

## Toolchain Requirements

The source build checks required tools loudly. The full research-writing loop can
also use these command-line tools, depending on the configured workflows:

- `lualatex` and `latexmk` for PDF builds
- `pdf2svg` for figure preview paths
- `chktex` and `lacheck` for TeX diagnostics
- `ripgrep` for workspace search
- `latexpand` and `arxiv_latex_cleaner` for arXiv-oriented source bundles

Install the tool or remove the workflow that requires it.

## Configuration

The config lives at:

```text
${XDG_CONFIG_HOME:-~/.config}/pandoc-preview/config.toml
```

The app refuses to start without a complete config. Run `just setup` to create
one. Renderer, export, lint, search, bibliography, style, and figure behavior are
configured there rather than hard-coded into the editor.

## Pandoc Assets

Templates, filters, CSL files, bibliography assets, macro/style trees, and figure
libraries are normal local files. This repository pins a `pandoc-config`
submodule for the shipped setup. `just deps` fetches it, and
`just install-assets` links those assets into `~/.pandoc` while preserving real
files already present there.

## Development

This is a Tauri 2, Svelte 5, Vite, Tailwind, and CodeMirror 6 application.

Use `just --list` for build, run, proof, and typecheck commands.

## License

No top-level license file is currently present in this source tree.
