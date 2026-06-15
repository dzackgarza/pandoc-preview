# Pandoc Preview

Overleaf-style markdown editor: CodeMirror 6 editor on the left, live pandoc-rendered HTML preview on the right, with a project file tree, a tabbed preview/compile-log pane, native menus, toasts, and a Zotero-style settings dialog backed by an XDG TOML config.

Built with Tauri 2 (Rust backend) and Svelte 5 + Vite + Tailwind (frontend).
All rendering is real pandoc: the backend spawns the configured `pandoc` binary and surfaces its full command line, stderr, and exit status in the Compile Log tab.

## Requirements

- `pandoc` (preview/export backend; PDF export additionally needs a pandoc PDF engine such as lualatex)
- `gum` (first-run setup script)
- `bun`, `cargo`, `just`
- Linux webview deps for Tauri (webkit2gtk-4.1)

## Setup and run

```sh
just deps    # bun install + cargo fetch
just setup   # gum walkthrough → writes the XDG config
just dev     # run the app
just build   # release bundles (deb, rpm, appimage)
```

The app refuses to start without a complete config at `${XDG_CONFIG_HOME:-~/.config}/pandoc-preview/config.toml`; `just setup` (`scripts/first-run.sh`) is the only thing that creates it.
Re-run with `scripts/first-run.sh --force` to overwrite.
Settings changed in-app (Tools → Settings…) are written back to the same file.

## Pandoc assets (pinned dependency)

The pandoc assets (templates, filters, CSL, bibliography) are owned by
[`pandoc-config`](https://github.com/dzackgarza/pandoc-config) and consumed here at
a **commit-pinned** version via the git submodule at
`src-tauri/resources/vendor/pandoc-config`. `just deps` runs
`git submodule update --init`; `scripts/install-assets.sh` symlinks them into
`~/.pandoc` (preserving any real-file override there). The pandoc-renderer plugin
(`src-tauri/resources/vendor/plugins/`) and the MathJax bundle
(`src-tauri/resources/mathjax/`) are app-owned and not part of the submodule.

Bump the pin with:

```sh
git -C src-tauri/resources/vendor/pandoc-config fetch origin
git -C src-tauri/resources/vendor/pandoc-config checkout <new-commit>
git add src-tauri/resources/vendor/pandoc-config && git commit
```

## Layout

- `src/` — Svelte frontend (editor, file tree, preview tabs, settings, toasts, status bar)
- `src-tauri/src/` — Rust backend: `config.rs` (XDG TOML), `fsops.rs` (file tree + file CRUD), `render.rs` (pandoc preview/export), `lib.rs` (app builder + native menus)
- `scripts/first-run.sh` — gum-based initial config walkthrough
