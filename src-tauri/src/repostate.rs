//! Repo-state machine (P46).
//!
//! The app continuously reflects whether the open file is noRepo / untracked /
//! tracked, with one-click shortcuts OUT of each degraded state. All git facts
//! are read from the REAL repository on disk via libgit2 (git2), never a UI
//! guess: the indicator value is a pure function of the on-disk repo + index +
//! HEAD, and the init/track actions mutate that real state.
//!
//!   - `NoRepo` — the file's directory is not inside any git work tree.
//!   - `Untracked` — inside a repo, but in neither the index nor HEAD's tree.
//!   - `Tracked` — the file is in the index or in HEAD's tree.
//!
//! `init_repo` creates a real repository (`Repository::init`); `track_file`
//! stages the file into the index (add + write index — staging, not commit), so
//! an independent `git ls-files --error-unmatch` reports it tracked.

use std::path::{Path, PathBuf};

use git2::Repository;
use serde::Serialize;

use crate::error::{Error, Result};

/// The three observable repo states. Serialized to the exact lowerCamel strings
/// the frontend maps onto the `data-repo-state` attribute (`noRepo`/`untracked`/
/// `tracked`); the spec asserts those exact values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RepoState {
    NoRepo,
    Untracked,
    Tracked,
}

fn git_err(e: git2::Error) -> Error {
    Error::InvalidArgument(format!("git error: {e}"))
}

/// The repository containing `path`, or `None` if `path` is not inside any git
/// work tree. `Repository::discover` walks up from the file's directory, so a
/// repo at a parent directory means the file IS in a repo.
fn discover_repo(path: &Path) -> Result<Option<Repository>> {
    let start = path
        .parent()
        .ok_or_else(|| Error::InvalidArgument(format!("path has no parent: {}", path.display())))?;
    match Repository::discover(start) {
        Ok(repo) => Ok(Some(repo)),
        // A "not found" discovery is a clean negative (NoRepo), not a failure.
        Err(e) if e.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(e) => Err(git_err(e)),
    }
}

/// The file's path relative to the repository work-tree root, used to look it up
/// in the index and HEAD tree. Fails loudly if the file is not under the work
/// tree (a bare repo has no work tree, which this app never opens).
fn workdir_relative(repo: &Repository, path: &Path) -> Result<PathBuf> {
    let workdir = repo
        .workdir()
        .ok_or_else(|| Error::InvalidArgument("repository has no work tree (bare repo)".into()))?;
    let rel = path.strip_prefix(workdir).map_err(|_| {
        Error::InvalidArgument(format!(
            "file {} is not under the repository work tree {}",
            path.display(),
            workdir.display()
        ))
    })?;
    Ok(rel.to_path_buf())
}

/// True if `rel` is present in HEAD's tree. An unborn HEAD (fresh repo, no
/// commits) has no tree, so nothing is in HEAD — a clean `false`.
fn in_head_tree(repo: &Repository, rel: &Path) -> Result<bool> {
    let head = match repo.head() {
        Ok(head) => head,
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch => return Ok(false),
        Err(e) => return Err(git_err(e)),
    };
    let tree = head.peel_to_tree().map_err(git_err)?;
    match tree.get_path(rel) {
        Ok(_) => Ok(true),
        Err(e) if e.code() == git2::ErrorCode::NotFound => Ok(false),
        Err(e) => Err(git_err(e)),
    }
}

/// The real repo state for `path`: discovers the repo, then classifies the file
/// as tracked (in the index or HEAD tree) vs untracked.
pub fn repo_state(path: &str) -> Result<RepoState> {
    let path = Path::new(path);
    let Some(repo) = discover_repo(path)? else {
        return Ok(RepoState::NoRepo);
    };
    let rel = workdir_relative(&repo, path)?;
    let index = repo.index().map_err(git_err)?;
    let in_index = index.get_path(&rel, 0).is_some();
    if in_index || in_head_tree(&repo, &rel)? {
        Ok(RepoState::Tracked)
    } else {
        Ok(RepoState::Untracked)
    }
}

/// Initialize a real git repository at `dir` (`Repository::init`). After this
/// the directory is inside a git work tree, so an independent `git rev-parse
/// --is-inside-work-tree` succeeds.
pub fn init_repo(dir: &str) -> Result<()> {
    Repository::init(Path::new(dir)).map_err(git_err)?;
    Ok(())
}

/// Stage `path` into the index of its containing repository (add path + write
/// index). This is staging, not commit, but it puts the file in the index so an
/// independent `git ls-files --error-unmatch` reports it tracked.
pub fn track_file(path: &str) -> Result<()> {
    let path = Path::new(path);
    let repo = discover_repo(path)?.ok_or_else(|| {
        Error::InvalidArgument(format!(
            "cannot track {}: it is not inside a git repository",
            path.display()
        ))
    })?;
    let rel = workdir_relative(&repo, path)?;
    let mut index = repo.index().map_err(git_err)?;
    index.add_path(&rel).map_err(git_err)?;
    index.write().map_err(git_err)?;
    Ok(())
}

/// IPC: the real repo state for the open file, mapped by the frontend onto the
/// `data-repo-state` indicator.
#[tauri::command]
pub fn repo_state_for(path: String) -> Result<RepoState> {
    repo_state(&path)
}

/// IPC: initialize a repository in `dir` (the open project directory).
#[tauri::command]
pub fn repo_init(dir: String) -> Result<()> {
    init_repo(&dir)
}

/// IPC: start tracking the open file by staging it into the index.
#[tauri::command]
pub fn repo_track(path: String) -> Result<()> {
    track_file(&path)
}
