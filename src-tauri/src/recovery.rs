//! Host-filesystem recovery store (P45).
//!
//! While the user edits, the live buffer is continuously captured to an
//! app-owned recovery store on the HOST FILESYSTEM — never browser storage —
//! so no more than a few seconds of work is ever permanently lost and an
//! independent process can recover the exact bytes (recovery-and-git-state-
//! requirements.md). The store is a local-only git repository per open document:
//! every autosave writes the buffer as a blob and commits a tree referencing it,
//! so each captured revision lives in the object database, reachable via
//! `git cat-file` even before any working-tree checkout. Recovery is independent
//! of Save — the project file on disk is never touched here.

use std::path::PathBuf;

use git2::{Repository, Signature, Tree};

use crate::error::{Error, Result};

/// Filename under which the buffer blob is recorded in each recovery commit's
/// tree. A single fixed entry: the tree id is a pure function of the buffer
/// bytes, which is what the no-op detection compares against the parent commit.
const BUFFER_ENTRY: &str = "buffer";

/// App identity used when the host has no git user configured. The recovery
/// store is local-only and never pushed, so the signature is purely for a
/// well-formed commit; it must never fail for a missing global git config.
const APP_NAME: &str = "Pandoc Preview Recovery";
const APP_EMAIL: &str = "recovery@pandoc-preview.localhost";

/// Root of the recovery store: `<data_dir>/pandoc-preview/recovery`. `data_dir`
/// honors `$XDG_DATA_HOME` on Linux, so the proof harness's hermetic
/// `XDG_DATA_HOME` is exactly where the store lands (P45 reads this tree).
fn recovery_root() -> Result<PathBuf> {
    let base = dirs::data_dir().ok_or_else(|| {
        Error::InvalidArgument("no XDG data directory could be determined".into())
    })?;
    Ok(base.join("pandoc-preview").join("recovery"))
}

/// Per-session repository directory. `session_id` is an opaque, app-chosen
/// stable id for the open document; it must be a single safe path component so
/// distinct documents get distinct repos and none can escape the store root.
fn session_repo_dir(session_id: &str) -> Result<PathBuf> {
    if session_id.is_empty()
        || session_id.contains('/')
        || session_id.contains('\\')
        || session_id.contains("..")
    {
        return Err(Error::InvalidArgument(format!(
            "recovery session id is not a single safe path component: {session_id:?}"
        )));
    }
    Ok(recovery_root()?.join(session_id))
}

/// Open the session's recovery repo, initializing it if absent. The repo is a
/// non-bare git repository whose object database the autosave commits into.
fn open_or_init(session_id: &str) -> Result<Repository> {
    let dir = session_repo_dir(session_id)?;
    std::fs::create_dir_all(&dir).map_err(|e| Error::io(&dir, e))?;
    Repository::open(&dir).or_else(|_| Repository::init(&dir).map_err(git_err))
}

fn git_err(e: git2::Error) -> Error {
    Error::InvalidArgument(format!("recovery git error: {e}"))
}

/// Signature for recovery commits: the host's configured git identity when
/// available, else the fixed app identity. Never fails on a missing git config.
fn recovery_signature(repo: &Repository) -> Result<Signature<'static>> {
    repo.signature()
        .or_else(|_| Signature::now(APP_NAME, APP_EMAIL))
        .map_err(git_err)
}

/// Build a tree holding the buffer bytes as a single blob `buffer`, returning
/// the resolved `Tree`. The blob is written straight into the object database
/// (no working-tree write, no index), so the captured bytes are recoverable
/// from the object db regardless of any checkout.
fn build_buffer_tree<'a>(repo: &'a Repository, buffer: &str) -> Result<Tree<'a>> {
    let blob_oid = repo.blob(buffer.as_bytes()).map_err(git_err)?;
    let mut builder = repo.treebuilder(None).map_err(git_err)?;
    builder
        .insert(BUFFER_ENTRY, blob_oid, git2::FileMode::Blob.into())
        .map_err(git_err)?;
    let tree_oid = builder.write().map_err(git_err)?;
    repo.find_tree(tree_oid).map_err(git_err)
}

/// Capture `buffer` into the session's recovery store. Initializes the repo on
/// first call, then commits a tree holding the buffer as a blob. No-op detection:
/// if HEAD's tree already equals the new tree (the buffer is byte-identical to
/// the last capture), no commit is made. `source_path` is recorded in the commit
/// message so the recovery store identifies which document each session captured.
/// The project file on disk is never read or written here — recovery is fully
/// independent of Save.
pub fn commit_buffer(session_id: &str, source_path: &str, buffer: &str) -> Result<()> {
    let repo = open_or_init(session_id)?;
    let tree = build_buffer_tree(&repo, buffer)?;

    // Parent commit (HEAD), if the repo already has one. A fresh repo has an
    // unborn HEAD, so the first capture has no parent.
    let parent = match repo.head() {
        Ok(head) => Some(head.peel_to_commit().map_err(git_err)?),
        Err(_) => None,
    };

    // No-op detection: skip the commit when the buffer is unchanged from the
    // last captured revision (identical tree id), so an idle editor does not
    // churn the object database with duplicate commits.
    if let Some(parent_commit) = &parent {
        if parent_commit.tree_id() == tree.id() {
            return Ok(());
        }
    }

    let sig = recovery_signature(&repo)?;
    let message = format!("autosave: {source_path}");
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
        .map_err(git_err)?;
    Ok(())
}

/// IPC command driving a single autosave capture. The frontend calls this on a
/// debounce timer independent of the preview-render debounce, so an unsaved
/// edit is captured within a few seconds with no user action.
#[tauri::command]
pub fn recovery_autosave(session_id: String, path: String, buffer: String) -> Result<()> {
    commit_buffer(&session_id, &path, &buffer)
}

/// Read the buffer bytes the session's recovery store last captured: the blob
/// under `buffer` in HEAD's tree (P49). `None` when the session has no recovery
/// repo or no commit yet. This is the inverse of `commit_buffer` — it reads the
/// object database directly (no working-tree checkout), so a recovery store an
/// independent process wrote is recovered byte-for-byte. The bytes are returned
/// as a `String`; the captured buffer is always UTF-8 (it was committed from a
/// `&str` editor buffer), so a non-UTF-8 blob is a corrupt store and fails loud.
pub fn read_head_buffer(session_id: &str) -> Result<Option<String>> {
    let dir = session_repo_dir(session_id)?;
    if !dir.is_dir() {
        return Ok(None);
    }
    let repo = Repository::open(&dir).map_err(git_err)?;
    let head = match repo.head() {
        Ok(head) => head,
        Err(_) => return Ok(None),
    };
    let tree = head.peel_to_tree().map_err(git_err)?;
    let entry = tree.get_name(BUFFER_ENTRY).ok_or_else(|| {
        Error::InvalidArgument(format!(
            "recovery HEAD tree has no {BUFFER_ENTRY:?} entry in {dir:?}"
        ))
    })?;
    let blob = repo.find_blob(entry.id()).map_err(git_err)?;
    let text = String::from_utf8(blob.content().to_vec()).map_err(|e| {
        Error::InvalidArgument(format!("recovery buffer blob is not valid UTF-8: {e}"))
    })?;
    Ok(Some(text))
}

/// IPC command exposing the session's last-captured recovery buffer to the
/// frontend (P49). On launch the app reads this for the restored session and
/// compares it against the on-disk file to decide whether to offer a restore.
#[tauri::command]
pub fn recovery_head_buffer(session_id: String) -> Result<Option<String>> {
    read_head_buffer(&session_id)
}
