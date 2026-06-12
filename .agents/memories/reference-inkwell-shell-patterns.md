# Reference: Inkwell Shell Patterns

# Reference: Inkwell Shell Patterns

**When this applies:** implementing editor shell subsystems — dialogs, file watching, recent files, split pane, theme, dirty lifecycle. Source: audited clone of [Inkwell](https://github.com/Amoner/inkwell) (MIT, Tauri 2 + CM6 + vanilla JS), citations spot-verified 2026-06. Clone for reading: `git clone --depth 1 https://github.com/Amoner/inkwell /tmp/ref-inkwell`.

**Plugin stack (the native-integration baseline):** `tauri-plugin-dialog`, `-fs`, `-store`, `-window-state` (window geometry persistence for free), `notify` v7 for file watching. Dialogs: `pick_open_file`/`pick_save_file` Rust commands wrapping the dialog plugin with extension filters and `untitled.md` default (`src-tauri/src/commands/dialog.rs`); a `confirm_discard` message dialog guards New/Open/Close when dirty.

**File watching (the pattern to copy, `src-tauri/src/platform/desktop.rs:27-81`):** one `RecommendedWatcher` with 2s poll interval, filtered to `Modify|Create`, events sent over mpsc to a spawned thread that sleeps 500 ms, drains the queue, then emits a single `file-changed-externally`. Frontend reload sets an `isExternalChange` flag so the document reset doesn't flip the dirty bit, and cancels in-flight inline edits.

**CodeMirror 6 readable-editor recipe (`src/editor/editor.js`, `theme.js`):** theme via `EditorView.theme({...}, {dark:false})` built on CSS variables, dark mode = `@codemirror/theme-one-dark`, live switching through a `Compartment`; `matchMedia("(prefers-color-scheme: dark)")` for system preference. Extensions worth the same set: lineNumbers, highlightActiveLine(+gutter), drawSelection, bracketMatching, indentOnInput, highlightSelectionMatches, history, `markdown({base: markdownLanguage, codeLanguages: languages})`, `syntaxHighlighting(defaultHighlightStyle, {fallback:true})`, lineWrapping. `Mod-b/i/k` selection-wrap keymaps in `editor/keymaps.js`.

**Update lifecycle numbers:** editor change → 150 ms debounce → render preview (`src/main.js:25`). Cursor-line changes tracked separately from content changes (fires only on line change) and drive preview scroll-snap. Scroll-sync: bidirectional proportional ratio with a `syncSource` guard against feedback loops + block-level `data-source-line` tagging for cursor snap-to-block — the source-line-tagging idea transfers to pandoc via a Lua filter stamping source positions.

**Split pane (`src/ui/divider.js`):** 5px divider, mousedown/touch drag, ratio clamped 0.2–0.8, widths set as percentages, RAF-throttled; reset-to-50/50 = clear inline widths and let `flex:1` rule. Auto-collapse split→editor under 640px width.

**Recent files (`src-tauri/src/commands/recent.rs`):** plugin-store `settings.json`, key `recent_files`, `Vec<{path,name}>`, dedup-then-unshift, `MAX_RECENT=20`, `store.save()` on every mutation.

**Platform gotchas:** macOS `RunEvent::Opened` fires before the webview exists — buffer paths in managed state and let the frontend poll on init; Linux file-association opens arrive as argv[1] (check exists && not a `-` flag). CSP allows `'unsafe-inline'` styles + `asset:` images.

**Do NOT imitate:** `Result<T, String>` IPC errors (verified at `commands/file_ops.rs:6-16` — our contract requires structured kinds); `let _ =` on send/emit (our slop gates ban it); markdown-it/DOMPurify preview path. **QC reality check:** Inkwell has zero tests and no lint config — its CI is cross-platform tauri-action builds + release signing only. It is a shape reference, not a QC reference.

Related: [Reference Repo Map: Subsystem Sources](reference-repo-map-subsystem-sources), [Contract Invariants and Ownership Boundaries](contract-invariants-and-ownership-boundaries).