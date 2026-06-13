use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde::Serialize;

use tauri::{AppHandle, Manager, Runtime};

use crate::config::{self, PLACEHOLDER_INPUT, PLACEHOLDER_MATHJAX, PLACEHOLDER_OUTPUT};
use crate::error::{Error, Result};

/// Math is always MathJax: KaTeX cannot cover the full range of math syntax
/// pandoc accepts, so there is no engine choice anywhere in the app.
///
/// MathJax always loads from the LOCALLY-BUNDLED, version-pinned copy shipped as
/// an app resource — never a CDN (decision A, mathjax-offline-local-source-decision.md).
/// The bundle is the SVG build (self-contained, no runtime font fetch). It is
/// addressed two ways because the two consumers run in different origin contexts:
///   - Preview (in-webview srcdoc): `--mathjax=<asset-protocol-url>`, resolved by
///     the frontend via `convertFileSrc` and passed in as `mathjax_url`.
///   - Export (external pandoc + `--embed-resources`): the `[export.html]` plugin
///     carries `--mathjax={mathjax}`; this module substitutes `{mathjax}` with
///     `file://<resource_dir>/mathjax/tex-full-svg-a11y.min.js`.
const MATH_FLAG_PREFIX: &str = "--mathjax=";

/// Relative path of the bundled MathJax under the app resource directory.
/// `bundle.resources` lists `resources/mathjax/tex-full-svg-a11y.min.js`; a plain relative
/// path preserves its full structure under the resource dir, so the runtime
/// relpath keeps the leading `resources/`. tauri-build copies it into the target
/// dir during `cargo build`, so this resolves in both development and the bundle.
const MATHJAX_RESOURCE_RELPATH: &str = "resources/mathjax/tex-full-svg-a11y.min.js";

/// Absolute filesystem path of the bundled MathJax bundle. Fails loudly if the
/// resource was not shipped (a broken build, never a silent fallback).
fn mathjax_resource_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| Error::InvalidArgument(format!("could not resolve resource dir: {e}")))?;
    let path = dir.join(MATHJAX_RESOURCE_RELPATH);
    if !path.is_file() {
        return Err(Error::InvalidArgument(format!(
            "bundled MathJax missing at {} (expected via bundle.resources)",
            path.display()
        )));
    }
    Ok(path)
}

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

fn render_sync(
    source: String,
    base_dir: String,
    base_url: String,
    mathjax_url: String,
) -> Result<RenderResult> {
    let cfg = config::load()?;
    let base_dir = PathBuf::from(base_dir);
    if !base_dir.is_dir() {
        return Err(Error::InvalidArgument(format!(
            "base_dir {} is not a directory",
            base_dir.display()
        )));
    }
    if mathjax_url.trim().is_empty() {
        return Err(Error::InvalidArgument(
            "mathjax_url must not be empty (the local MathJax asset URL)".into(),
        ));
    }

    let args: Vec<String> = vec![
        "--from".into(),
        cfg.pandoc.from_format.clone(),
        "--to".into(),
        "html5".into(),
        "--standalone".into(),
        // Local MathJax via the asset protocol — never a CDN (decision A). The
        // SVG bundle keeps raw `\(...\)` TeX in the output AND sets the injected
        // `<script src>` to the asset-protocol URL, so the srcdoc preview loads
        // and runs it offline.
        format!("{MATH_FLAG_PREFIX}{mathjax_url}"),
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

/// Run a configured export plugin. The export surface is plugin-shaped: the
/// ENTIRE compilation command is the `[export.<id>]` config entry. This resolves
/// the entry by id (an unknown id is a loud error), substitutes the
/// `{input}`/`{output}` placeholders per-argument, and spawns the configured
/// argv with cwd = the source file's parent directory. There are NO hard-coded
/// pandoc flags or formats here; the exit code is the contract and stderr lands
/// in the compile log.
fn export_sync(
    plugin_id: String,
    source_path: String,
    output_path: String,
    mathjax_url: String,
) -> Result<ExportResult> {
    let cfg = config::load()?;
    let plugin = cfg.export.get(&plugin_id).ok_or_else(|| {
        Error::InvalidArgument(format!("no configured export plugin with id {plugin_id:?}"))
    })?;

    let source = PathBuf::from(&source_path);
    let dir = source
        .parent()
        .ok_or_else(|| Error::InvalidArgument(format!("{source_path} has no parent directory")))?
        .to_path_buf();

    // Substring substitution per argument: {input} -> source, {output} -> target,
    // {mathjax} -> file:// URL of the bundled local MathJax (decision A). The
    // {mathjax} token is optional in a command; for a command that omits it this
    // last replace is a no-op.
    let resolved: Vec<String> = plugin
        .command
        .iter()
        .map(|arg| {
            arg.replace(PLACEHOLDER_INPUT, &source_path)
                .replace(PLACEHOLDER_OUTPUT, &output_path)
                .replace(PLACEHOLDER_MATHJAX, &mathjax_url)
        })
        .collect();

    // validate_export_plugin guarantees command.len() >= 1, so argv[0] exists.
    let (program, args) = resolved
        .split_first()
        .expect("export command is non-empty (validated)");

    let output = Command::new(program)
        .args(args)
        .current_dir(&dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| Error::PandocSpawn(program.clone(), e))?;

    Ok(ExportResult {
        ok: output.status.success(),
        log: format_log(program, args, &output),
    })
}

#[tauri::command]
pub async fn render_preview(
    source: String,
    base_dir: String,
    base_url: String,
    mathjax_url: String,
) -> Result<RenderResult> {
    tauri::async_runtime::spawn_blocking(move || {
        render_sync(source, base_dir, base_url, mathjax_url)
    })
    .await
    .expect("render task panicked")
}

#[tauri::command]
pub async fn export_document<R: Runtime>(
    app: AppHandle<R>,
    plugin_id: String,
    source_path: String,
    output_path: String,
) -> Result<ExportResult> {
    // Resolve the bundled MathJax to a `file://` URL for the {mathjax} placeholder
    // (decision A). Done on the command thread (has the AppHandle); the blocking
    // pandoc spawn does not.
    let mathjax_path = mathjax_resource_path(&app)?;
    let mathjax_url = url::Url::from_file_path(&mathjax_path)
        .map_err(|()| {
            Error::InvalidArgument(format!(
                "could not build file:// URL for {}",
                mathjax_path.display()
            ))
        })?
        .to_string();

    tauri::async_runtime::spawn_blocking(move || {
        export_sync(plugin_id, source_path, output_path, mathjax_url)
    })
    .await
    .expect("export task panicked")
}
