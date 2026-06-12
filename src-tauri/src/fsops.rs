use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{Error, Result};

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
            children: if is_dir { Some(build_tree(&path)?) } else { None },
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

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String> {
    let path = PathBuf::from(path);
    std::fs::read_to_string(&path).map_err(|e| Error::io(&path, e))
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<()> {
    let path = PathBuf::from(path);
    std::fs::write(&path, content).map_err(|e| Error::io(&path, e))
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
