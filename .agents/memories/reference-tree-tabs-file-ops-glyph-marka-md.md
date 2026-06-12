# Reference: Tree, Tabs, File Ops (Glyph, marka.md)

# Reference: Tree, Tabs, File Ops (Glyph, marka.md)

**When this applies:** implementing the project sidebar, file tabs, file operations, or session restore. Sources: audited clones of [Glyph](https://github.com/hamidfzm/glyph) (MIT) and [marka.md](https://github.com/mattenarle10/markamd) (MIT), citations spot-verified 2026-06. Clones: `/tmp/ref-glyph`, `/tmp/ref-markamd`.

**Tree architecture (Glyph is the model — matches our contract's Rust-side ownership):** Rust `read_directory` command returns `Vec<DirEntry{name,path,isDirectory,modified}>` sorted dirs-first; frontend caches as `Map<dir, DirEntry[]>` with an `expanded: Set<string>`, loading children on demand; `notify` v8 watcher emits `directory-changed`, frontend refreshes debounced 300 ms. marka.md does pure frontend recursion over plugin-fs `readDir` plus 2 s mtime polling (their stated tradeoff: "md files are cheap, no new rust deps") — acceptable fallback, not the default.

**File operations (Glyph `src-tauri/src/commands/create.rs`, verified):** all ops are Rust commands — create note/folder (collision-safe "Untitled 2.md" auto-increment), rename (preserves extension if omitted), duplicate ("copy" suffix), delete, move. Two safety patterns to copy: `ensure_within_root(target_parent, root)` on every mutating op (workspace-escape guard), and `sanitize_name()` stripping `/\:*?"<>|`. Create-flow UX: command returns the collision-safe path → inline-rename mode in the tree → open on commit.

**Undo for file operations (marka.md `src/hooks/use-file-ops.ts:138-181`):** bounded stack (20 ops) of `{kind: move|rename|create-file|create-folder, from, to}`; rename/move reverse exactly; creates are undoable **only while pristine** (file empty / folder empty — verified before remove, else blocked with a toast). Bound to a command-palette entry + `Mod+Alt+Z`. This is the cheapest honest undo: no trash, no content restore, refuses rather than guesses.

**Native dialog call shapes (marka.md `src/lib/files.ts:11-39`):** `open({directory:true, multiple:false, title})` for folders; `open({filters:[{name, extensions:["md","markdown","mdx"]}]})` for files; `save({title, defaultPath, filters})` for Save As. marka.md's explicit titles/filters/defaultPath beat Glyph's bare calls.

**Workspace resolution (Glyph `src-tauri/src/workspace/resolve.rs`, verified):** on folder open, `git2::Repository::discover()` finds the repo top-level; refuses folders nested under a parent repo or under another workspace's state dir; plain non-git folders valid. Unit-tested with tempfile fixtures including the bare-repo edge.

**Tabs/session:** Glyph persists `PersistedTab[]{kind, path, filePath?, expanded?}` + active path to its settings store on every change, restoring folder-tab expansion and active file. Dirty dot from state; middle-click closes. marka.md: dirty = `source !== savedContent`; active tab `scrollIntoView` on switch; binary-file guard before opening (magic bytes + 5 MB cap); recursive-walk skip-list (node_modules, .git, dist, target...) and 5000-entry walk cap — loud bounds, log when hit.

**The QC standout — Glyph has the best pipeline of all seven audited repos (`.github/workflows/ci.yml`, verified):** Biome lint + format with `--error-on-warnings`; `tsc` typecheck; vitest with coverage; **`cargo llvm-cov nextest` for Rust coverage with junit output**; `cargo clippy -D warnings`; multi-platform build gated on all checks; pre-commit via lint-staged = `biome check --write` + `cargo fmt --check`. Biome config: 2-space, lineWidth 100, double quotes, bans `../../` imports in favor of `@/` alias. Direct integration candidates for our `just` QC chain: `cargo llvm-cov nextest` and Biome-with-error-on-warnings.

**Do NOT imitate:** `Result<T,String>` errors (both); marka.md's `FS_CONFLICT` stringly error constant (use a structured kind); marka.md's dotfile allowlist UX is product taste — ours is a user decision, not a default to inherit.

Related: [Reference Repo Map: Subsystem Sources](reference-repo-map-subsystem-sources), [Product Destination: What Done Looks Like](product-destination-what-done-looks-like).
