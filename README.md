# Pandoc Preview

Overleaf-style markdown editor for mathematical writing: a CodeMirror 6 editor on the left, a live pandoc-rendered HTML preview on the right, a project file tree, a tabbed preview / compile-log / problems pane, an amsthm-aware insertion bar, native menus, toasts, and a Zotero-style settings dialog backed by an XDG TOML config.

Built with Tauri 2 (Rust core) and Svelte 5 + Vite + Tailwind (frontend).

## Architecture: the plugin firewall

The Rust core owns no document-tool knowledge.
Everything that knows about pandoc, LaTeX, BibTeX, or any external binary lives in a **firewall plugin** discovered at startup and declared by category:

- **renderer** — `pandoc-renderer`: markdown → preview HTML (also drives the reveal.js slides preview).
- **export** — `pandoc-html-export` (self-contained HTML), `pandoc-pdf-export` (pandoc + lualatex), `latexmk-pdf-export` (multi-pass latexmk with auto-BibTeX, the reference-resolving PDF path), `arxiv-export` (a flattened, self-contained arXiv-ready `.tar.gz`).
- **lint** — `pandoc-md-lint`: math/delimiter balance via the real `chktex`/`lacheck` plus a markdown-native `$`-balance check.
- **search** — `workspace-search`: global full-text search via the real `ripgrep`.

The core surfaces each plugin’s real command line, stderr, and exit status in the Compile Log tab, and refuses to start when a configured plugin’s tools or assets are missing — every configured plugin contributes a startup doctor check that fails loudly rather than degrading.
Plugins are configured under `[plugins]` / `[plugin.<id>]` in the config.

## Features

**Editing.** CodeMirror 6 with composable completion: math-mode-only expansion, autotrigger space-expansion with chaining, regex/postfix triggers, mirrored tabstops and variables, a user snippet dictionary (quicktex format consumed directly), Emmet abbreviations, and visual-selection wrap/transform.
Spellcheck honors a custom math dictionary.
Structural motions move by section / environment / math-zone.
Three comfort modes — typewriter (centered caret line), distraction-free (hide the chrome), and readability (sentence coloring).

**Math & figures.** Math renders with MathJax (always — no engine option, since KaTeX cannot cover pandoc’s full math syntax) and renders offline with no network.
TikZ / `tikzcd` pictures render as inline vector figures in the live preview, driven by a shared `.tikzstyles` palette and a per-figure preamble template; source ↔ preview jump selects the matching rendered node, figures are hover-editable, and external diagram sources can be registered, edited in an external editor, externalized, and inserted into a configured global figures directory.

**Citations.** A single config-declared bibliography feeds both the editor and the preview.
`@`-trigger completion fuzzy-matches on metadata and previews the entry before insert; a per-file `bibliography:` frontmatter override is honored; the references sidebar lists only the document’s cited keys in the configured CSL style; label completion spans the whole project.

**Insertion bar.** Replaces the formatting toolbar: amsthm environments, tikz/`tikzcd` scaffolds, a matrix builder, a table builder, a snippet dropdown, a code-block-type dropdown, a footnote modal, and insert-image-from-clipboard.

**Preview & export.** Resizable split with a ratio-preserving sidebar toggle, a VSCode-style activity bar, and a three-way editor / preview / split view toggle.
A live PDF preview renders the real compiled PDF in an embedded pdf.js viewer with auto/manual and fast/full compile controls; build intermediates stay out of the source tree.
The compile log is structured — warnings surface as Problems distinct from hard errors, and entries jump to the offending source line.
One batch-export action writes a real artifact for every configured export target at once.
A reading-time metric and word count sit in the status bar.

**Project & workspace.** A file tree that mutates the real directory (create/rename/delete), global workspace search (boolean operators, per-directory restriction, relevancy heatmap, click-to-open-at-line), a command palette (Ctrl+Shift+P), and quick-open (Ctrl+P).

**Reliability.** Unsaved edits are captured durably for recovery; launch restores the last session and offers newer recovery content; the repo-state machine reflects and mutates real git state; saving is gated on durable file identity, refuses to clobber an externally modified file, and a dirty buffer is guarded on close.

## Requirements

- `pandoc` — the renderer, HTML export, and arXiv export backend.
- A pandoc **PDF engine** (`lualatex`) and `latexmk` — PDF export and the reference-resolving PDF path.
- `chktex` and `lacheck` — the markdown lint plugin.
- `ripgrep` — workspace search.
- The **TikZ toolchain** (`lualatex` + `pdf2svg`) — inline tikz figure rendering.
- `latexpand` and `arxiv_latex_cleaner` — the arXiv export bundle.
- `gum` — the first-run setup script.
- `bun`, `cargo`, `just`, and the Linux webview deps for Tauri (`webkit2gtk-4.1`).

The startup doctor verifies the tools each configured plugin needs; a missing tool fails loudly at launch rather than at use.

## Setup and run

```sh
just deps    # bun install + cargo fetch + submodule init
just setup   # gum walkthrough → writes the XDG config
just dev     # run the app
just build   # release bundles (deb, rpm, appimage)
```

The app refuses to start without a complete config at `${XDG_CONFIG_HOME:-~/.config}/pandoc-preview/config.toml`; `just setup` (`scripts/first-run.sh`) is the only thing that creates it.
Re-run with `scripts/first-run.sh --force` to overwrite.
Settings changed in-app (Tools → Settings…) are written back to the same file.

## Pandoc assets (pinned dependency)

The pandoc assets (templates, filters, CSL, bibliography) are owned by [`pandoc-config`](https://github.com/dzackgarza/pandoc-config) and consumed here at a **commit-pinned** version via the git submodule at `src-tauri/resources/vendor/pandoc-config`. `just deps` runs `git submodule update --init`; `scripts/install-assets.sh` symlinks them into `~/.pandoc` (preserving any real-file override there).
The firewall plugins (`src-tauri/resources/vendor/plugins/`) and the MathJax bundle (`src-tauri/resources/mathjax/`) are app-owned and not part of the submodule.

Bump the pin with:

```sh
git -C src-tauri/resources/vendor/pandoc-config fetch origin
git -C src-tauri/resources/vendor/pandoc-config checkout <new-commit>
git add src-tauri/resources/vendor/pandoc-config && git commit
```

## Layout

- `src/` — Svelte frontend: editor, file tree, preview tabs, insertion bar, settings, toasts, status bar, command palette / quick-open; `src/lib/editor/` holds the CodeMirror extensions (completion, snippets, spellcheck, comfort modes).
- `src-tauri/src/` — Rust core: `config.rs` (XDG TOML schema + validation), `fsops.rs` (file tree + file CRUD), `render.rs` (preview render dispatch), `plugins.rs` (the firewall — plugin discovery, the substitution engine, doctor checks), `lib.rs` (app builder + native menus).
  The core carries no pandoc/tool knowledge.
- `src-tauri/resources/vendor/plugins/` — the firewall plugins (renderer, export, lint, search), each with its `plugin.toml`, command, and startup `check-*.sh` doctor scripts.
- `scripts/first-run.sh` — gum-based initial config walkthrough.
