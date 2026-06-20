# Pandoc Preview

A desktop markdown editor for mathematical writing: edit on the left, see a live preview on the right, and export to HTML, PDF, or an arXiv-ready bundle. It is like Overleaf, but you write markdown and pandoc does the rendering, so the preview matches what pandoc produces. For Linux.

## Requirements

The editor runs real command-line tools for rendering, export, linting, and search, and checks for them at startup, naming any that are missing. The shipped setup uses all of them:

- `pandoc` — preview and export
- `lualatex` and `latexmk` — PDF export
- `pdf2svg` — TikZ figures in the preview
- `chktex` and `lacheck` — the markdown/math linter
- `ripgrep` — workspace search
- `latexpand` and `arxiv_latex_cleaner` — the arXiv export bundle
- `gum` — first-run setup
- `bun`, `cargo`, `just`, and `webkit2gtk-4.1` — to build and run

## Install and run

```sh
just deps     # fetch dependencies
just setup    # interactive first-run setup; writes your config
just dev      # launch the editor
```

The editor needs a config before it will start; `just setup` walks you through writing one (re-run `scripts/first-run.sh --force` to redo it). When the window opens, point it at a folder and click a `.md` file — the rendered preview appears on the right and updates as you type. Settings you change in-app (Tools → Settings) are written back to the same config.

Run `just --list` for the other commands (release builds, etc.).

## What it does

- **Editing** — completions that expand in math mode, snippets, Emmet abbreviations, spellcheck with a custom math dictionary, and writing-focus modes (typewriter, distraction-free, readability).
- **Math and figures** — MathJax everywhere, working offline. TikZ and `tikzcd` diagrams render inline; you can jump between a figure and its source, edit it, and keep figures in a shared folder.
- **Citations** — one bibliography drives both the editor and the preview. Type `@` to complete a citation with a preview of the entry, override the bibliography per file, and get a references list of only the keys you cited.
- **Inserting structure** — a bar for amsthm environments, matrices, tables, code blocks, footnotes, and pasted images, in place of a formatting toolbar.
- **Export** — self-contained HTML, PDF (single-pass or multi-pass with bibliography resolution), and an arXiv-ready `.tar.gz`. One action exports to every configured target at once.
- **Working in a project** — a file tree, full-text search across the folder, a command palette (Ctrl+Shift+P), and quick-open (Ctrl+P).
- **Not losing work** — unsaved edits are recovered after a crash, the last session is restored on launch, a save won't silently overwrite a file that changed underneath you, and closing with unsaved changes is guarded.

## Configuration

The config lives at `${XDG_CONFIG_HOME:-~/.config}/pandoc-preview/config.toml`. It has no built-in defaults — the editor refuses to start until it is complete, which is what `just setup` produces. The renderer, export targets, linter, and search are plugins listed in that file; add or change them there.

## Pandoc assets

The templates, filters, CSL, and bibliography come from [`pandoc-config`](https://github.com/dzackgarza/pandoc-config), pinned to a specific commit as a git submodule. `just deps` fetches it, and the install step symlinks the assets into `~/.pandoc`, preserving any file you have overridden there.
