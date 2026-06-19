use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// A fingerprint of a file's on-disk state, captured when the file is read and
/// after each successful write (P48). It pairs a content hash with the mtime in
/// nanoseconds since the epoch: the hash detects content changes, the mtime
/// detects a same-content rewrite. A guarded save compares the stored
/// fingerprint against the current on-disk fingerprint; any difference means the
/// file changed underneath the editor and the write is refused.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Fingerprint {
    /// FNV-1a 64-bit hash of the file's bytes, hex-encoded.
    pub hash: String,
    /// Last-modified time in nanoseconds since the Unix epoch, as a decimal
    /// STRING. A nanosecond mtime (~1.8e18) exceeds JS's safe-integer range, so
    /// it must round-trip as a string to survive the IPC boundary exactly —
    /// otherwise the frontend rounds it and a guarded save of an unmodified file
    /// would false-conflict. Compared by exact string equality.
    pub mtime_ns: String,
}

/// FNV-1a 64-bit hash of `bytes`, hex-encoded. A small, dependency-free content
/// hash: P48 needs change-detection, not cryptographic strength.
fn content_hash(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// The current on-disk fingerprint of `path` (content hash + mtime). Reads the
/// bytes and the metadata mtime; fails loudly if either read fails.
fn fingerprint_of(path: &Path) -> Result<Fingerprint> {
    let bytes = std::fs::read(path).map_err(|e| Error::io(path, e))?;
    let meta = std::fs::metadata(path).map_err(|e| Error::io(path, e))?;
    let mtime_ns = meta
        .modified()
        .map_err(|e| Error::io(path, e))?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| {
            Error::InvalidArgument(format!(
                "file {} has a pre-epoch mtime: {e}",
                path.display()
            ))
        })?
        .as_nanos();
    Ok(Fingerprint {
        hash: content_hash(&bytes),
        mtime_ns: mtime_ns.to_string(),
    })
}

/// A file's content together with the fingerprint captured at read time, so the
/// frontend can store the fingerprint and later detect external modification.
#[derive(Debug, Serialize)]
pub struct FileRead {
    pub content: String,
    pub fingerprint: Fingerprint,
}

#[derive(Debug, Serialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileNode>>,
}

fn build_tree(dir: &Path) -> Result<Vec<FileNode>> {
    let mut nodes = Vec::new();
    let entries = std::fs::read_dir(dir).map_err(|e| Error::io(dir, e))?;
    for entry in entries {
        let entry = entry.map_err(|e| Error::io(dir, e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let is_dir = path.is_dir();
        nodes.push(FileNode {
            name,
            path: path.display().to_string(),
            children: if is_dir {
                Some(build_tree(&path)?)
            } else {
                None
            },
            is_dir,
        });
    }
    // Overleaf-style ordering: directories first, then case-insensitive by name.
    nodes.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(nodes)
}

#[tauri::command]
pub fn list_tree(root: String) -> Result<Vec<FileNode>> {
    let root = PathBuf::from(root);
    if !root.is_dir() {
        return Err(Error::InvalidArgument(format!(
            "{} is not a directory",
            root.display()
        )));
    }
    build_tree(&root)
}

/// Read a file's text together with the fingerprint of its current on-disk
/// state (P48). The frontend stores the fingerprint when it opens a file so a
/// later save can detect whether the file changed underneath the editor.
#[tauri::command]
pub fn read_text_file(path: String) -> Result<FileRead> {
    let path = PathBuf::from(path);
    let content = std::fs::read_to_string(&path).map_err(|e| Error::io(&path, e))?;
    let fingerprint = fingerprint_of(&path)?;
    Ok(FileRead {
        content,
        fingerprint,
    })
}

/// Read a file's RAW BYTES, returned as an IPC byte response (the frontend
/// receives an ArrayBuffer). Used by the embedded pdf.js viewer (Phase F / F1):
/// the asset protocol returns 403 to a `fetch()` of an `asset://` URL from the
/// dev-server origin, so the compiled PDF's bytes are read through this host-fs
/// boundary and handed to pdf.js as a byte array. Generic file I/O — carries no
/// renderer/pandoc knowledge.
#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<tauri::ipc::Response> {
    let path = PathBuf::from(path);
    let bytes = std::fs::read(&path).map_err(|e| Error::io(&path, e))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Write `content` to `path` UNCONDITIONALLY and return the fingerprint of the
/// freshly written file. Used where there is nothing to conflict with: a Save
/// As to a new target, and the explicit force-overwrite resolution after a
/// conflict refusal (the user has deliberately chosen their buffer wins). The
/// returned fingerprint is captured AFTER the write so the next guarded save
/// compares against the just-written state.
#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<Fingerprint> {
    let path = PathBuf::from(path);
    std::fs::write(&path, content).map_err(|e| Error::io(&path, e))?;
    fingerprint_of(&path)
}

/// Write `content` to `path` ONLY IF the file still matches `expected` — the
/// fingerprint captured at open / last save (P48). If the on-disk fingerprint
/// differs, the file was modified externally: the write is REFUSED with
/// `Error::Conflict` and the external content is left intact. On success the
/// file is written and the post-write fingerprint is returned, so the frontend
/// refreshes its stored fingerprint and a subsequent save matches (this is why
/// p03's second save does not false-conflict).
#[tauri::command]
pub fn write_text_file_checked(
    path: String,
    content: String,
    expected: Fingerprint,
) -> Result<Fingerprint> {
    let path = PathBuf::from(path);
    let current = fingerprint_of(&path)?;
    if current != expected {
        return Err(Error::Conflict {
            path: path.display().to_string(),
        });
    }
    std::fs::write(&path, content).map_err(|e| Error::io(&path, e))?;
    fingerprint_of(&path)
}

#[tauri::command]
pub fn create_file(path: String) -> Result<()> {
    let path = PathBuf::from(path);
    if path.exists() {
        return Err(Error::AlreadyExists(path.display().to_string()));
    }
    std::fs::write(&path, "").map_err(|e| Error::io(&path, e))
}

#[tauri::command]
pub fn create_dir(path: String) -> Result<()> {
    let path = PathBuf::from(path);
    if path.exists() {
        return Err(Error::AlreadyExists(path.display().to_string()));
    }
    std::fs::create_dir(&path).map_err(|e| Error::io(&path, e))
}

#[tauri::command]
pub fn rename_path(from: String, to: String) -> Result<()> {
    let from = PathBuf::from(from);
    let to = PathBuf::from(to);
    if to.exists() {
        return Err(Error::AlreadyExists(to.display().to_string()));
    }
    std::fs::rename(&from, &to).map_err(|e| Error::io(&from, e))
}

#[tauri::command]
pub fn delete_path(path: String) -> Result<()> {
    let path = PathBuf::from(path);
    if path.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| Error::io(&path, e))
    } else {
        std::fs::remove_file(&path).map_err(|e| Error::io(&path, e))
    }
}
