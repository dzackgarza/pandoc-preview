use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};

use crate::config::{self, MathEngine};
use crate::error::{Error, Result};

#[derive(Debug, Serialize)]
pub struct RenderResult {
    pub ok: bool,
    /// Standalone HTML document. Empty when ok is false.
    pub html: String,
    /// Human-readable compilation log: command line, stderr, exit status.
    pub log: String,
}

#[derive(Debug, Serialize)]
pub struct ExportResult {
    pub ok: bool,
    pub log: String,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Html,
    Pdf,
}

fn math_flag(engine: MathEngine) -> &'static str {
    match engine {
        MathEngine::Katex => "--katex",
        MathEngine::Mathjax => "--mathjax",
    }
}

fn format_log(program: &str, args: &[String], output: &std::process::Output) -> String {
    let mut log = format!(
        "$ {} {}\n",
        program,
        args.iter()
            .map(|a| format!("{a:?}"))
            .collect::<Vec<_>>()
            .join(" ")
    );
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.trim().is_empty() {
        log.push_str(&stderr);
        if !stderr.ends_with('\n') {
            log.push('\n');
        }
    }
    log.push_str(&format!("exit status: {}\n", output.status));
    log
}

fn render_sync(source: String, base_dir: String, base_url: String) -> Result<RenderResult> {
    let cfg = config::load()?;
    let base_dir = PathBuf::from(base_dir);
    if !base_dir.is_dir() {
        return Err(Error::InvalidArgument(format!(
            "base_dir {} is not a directory",
            base_dir.display()
        )));
    }

    let args: Vec<String> = vec![
        "--from".into(),
        cfg.pandoc.from_format.clone(),
        "--to".into(),
        "html5".into(),
        "--standalone".into(),
        math_flag(cfg.preview.math).into(),
        // Resolve relative resources (images, includes) against the open file's
        // directory, both for pandoc itself and for the webview via <base>.
        "--resource-path".into(),
        base_dir.display().to_string(),
        format!("--variable=header-includes:<base href=\"{base_url}\">"),
    ]
    .into_iter()
    .chain(cfg.pandoc.extra_args.iter().cloned())
    .collect();

    let mut child = Command::new(&cfg.pandoc.path)
        .args(&args)
        .current_dir(&base_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| Error::PandocSpawn(cfg.pandoc.path.clone(), e))?;

    // Feed stdin from a separate thread so a large document cannot deadlock
    // against pandoc filling its stdout pipe.
    let mut stdin = child.stdin.take().expect("stdin was piped");
    let writer = std::thread::spawn(move || stdin.write_all(source.as_bytes()));
    let output = child
        .wait_with_output()
        .map_err(|e| Error::PandocSpawn(cfg.pandoc.path.clone(), e))?;
    writer
        .join()
        .expect("stdin writer thread panicked")
        .map_err(|e| Error::PandocSpawn(cfg.pandoc.path.clone(), e))?;

    let log = format_log(&cfg.pandoc.path, &args, &output);
    Ok(RenderResult {
        ok: output.status.success(),
        html: if output.status.success() {
            String::from_utf8_lossy(&output.stdout).into_owned()
        } else {
            String::new()
        },
        log,
    })
}

fn export_sync(
    source_path: String,
    output_path: String,
    format: ExportFormat,
) -> Result<ExportResult> {
    let cfg = config::load()?;
    let source = PathBuf::from(&source_path);
    let dir = source
        .parent()
        .ok_or_else(|| Error::InvalidArgument(format!("{source_path} has no parent directory")))?
        .to_path_buf();

    let mut args: Vec<String> = vec![
        "--from".into(),
        cfg.pandoc.from_format.clone(),
        "--standalone".into(),
    ];
    match format {
        ExportFormat::Html => {
            // Self-contained single file: inline images, CSS, and math assets.
            args.push("--embed-resources".into());
            args.push(math_flag(cfg.preview.math).into());
        }
        ExportFormat::Pdf => {
            args.push(math_flag(cfg.preview.math).into());
        }
    }
    args.extend(cfg.pandoc.extra_args.iter().cloned());
    args.push("--output".into());
    args.push(output_path);
    args.push(source_path);

    let output = Command::new(&cfg.pandoc.path)
        .args(&args)
        .current_dir(&dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| Error::PandocSpawn(cfg.pandoc.path.clone(), e))?;

    Ok(ExportResult {
        ok: output.status.success(),
        log: format_log(&cfg.pandoc.path, &args, &output),
    })
}

#[tauri::command]
pub async fn render_preview(
    source: String,
    base_dir: String,
    base_url: String,
) -> Result<RenderResult> {
    tauri::async_runtime::spawn_blocking(move || render_sync(source, base_dir, base_url))
        .await
        .expect("render task panicked")
}

#[tauri::command]
pub async fn export_document(
    source_path: String,
    output_path: String,
    format: ExportFormat,
) -> Result<ExportResult> {
    tauri::async_runtime::spawn_blocking(move || export_sync(source_path, output_path, format))
        .await
        .expect("export task panicked")
}
