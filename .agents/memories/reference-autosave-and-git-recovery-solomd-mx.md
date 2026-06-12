# Reference: Autosave and Git Recovery (SoloMD, mx)

# Reference: Autosave and Git Recovery (SoloMD, mx)

**When this applies:** implementing the recovery repo, autosave commits, Save=commit, file watching, or version history. Sources: audited clones of [SoloMD](https://github.com/zhitongblog/solomd) (MIT) and [mx](https://github.com/vibery-studio/mx) (**GPL-3 — clean-room patterns only, never copy code**), citations spot-verified 2026-06. Clones: `/tmp/ref-solomd`, `/tmp/ref-mx`.

**SoloMD AutoGit is the closest working model of our contract** (every save = real libgit2 commit, `app/src-tauri/src/git_history.rs`):

- `git2 = { version = "0.19", default-features = false, features = ["vendored-libgit2", "https", "vendored-openssl"] }` — statically linked, no system git needed; cfg-gated off Android.
- Commit flow: open repo → resolve repo-relative path (canonicalize parents — symlink-safe) → stage → write tree → **no-op detection: skip the commit when `parent.tree_id() == tree_oid`** (`git_history.rs:283-286`, verified) — essential at autosave cadence.
- Commit message `auto: <UTC timestamp>` from a dep-free civil-from-days formatter (no chrono) (`git_history.rs:144-154`).
- Signature: `user.name`/`user.email` from global git config with an app-identity fallback, read fresh per commit.
- History surface: per-file log via revwalk filtered by path; diff vs parent; **rollback writes the old version as a NEW commit** so history is never destroyed.

**The QC idea to integrate (SoloMD `app/src-tauri/tests/git_history_e2e_test.rs`):** Rust integration tests on real temp workspaces with real libgit2 — init → commit → no-op → history → diff → rollback → dirty-flag assertions — calling the command functions directly, **no Tauri runtime needed**. This slots beneath our tauri-mode proofs as a fast real-boundary layer (cargo test tier of the seed's three proof boundaries). SoloMD has a whole suite of such `*_e2e_test.rs` files.

**File watching, three-layer suppression (SoloMD `app/src-tauri/src/watcher.rs:9-15`, verified):** `notify-debouncer-mini` at 300 ms; self-write suppression map at 500 ms (`mark_self_write()` before app writes, so saves don't trigger reload prompts); 30 s batch-rewrite window for bulk operations. **Watch directories, not files** — atomic save (write-temp + rename) swaps the inode and deafens file-level watches (their v4.2 changelog lesson; complements Inkwell's simpler single-file watcher in [Reference: Inkwell Shell Patterns](reference-inkwell-shell-patterns)).

**mx patterns (clean-room):** autosave = 3 s debounce per keystroke, user-toggleable; separate 30 s crash-recovery snapshots to `~/.mx/recovery/<hash(path)>` with a metadata header naming the original path, restore banner on relaunch; snapshot retention capped at 50/file. Note mx splits autosave/recovery/snapshots into three non-Git mechanisms — our contract collapses all three into the recovery Git repo, which is strictly simpler; mx is a UX reference (restore banner, retention), not an architecture reference.

**Do NOT imitate:** mx swallowing autosave failures silently (console-log only — our contract: visible structured error); SoloMD's `pandoc_detect()` probing `which pandoc` + hardcoded homebrew paths (ambient discovery — our config names the command); `Result<T,String>` errors in both. SoloMD's pandoc export does get one thing right: temp input file always cleaned up, even on failure.

Related: [Contract Invariants and Ownership Boundaries](contract-invariants-and-ownership-boundaries), [First Iteration: Mechanisms Worth Porting](first-iteration-mechanisms-worth-porting).
