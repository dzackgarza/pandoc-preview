use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde::Serialize;

use tauri::{AppHandle, Manager, Runtime};

use crate::config::{self, PLACEHOLDER_INPUT, PLACEHOLDER_MATHJAX, PLACEHOLDER_OUTPUT};
use crate::error::{Error, Result};

/// MathJax always loads from the LOCALLY-BUNDLED, version-pinned copy shipped as
/// an app resource — never a CDN (decision A, mathjax-offline-local-source-decision.md).
/// The bundle is the SVG build (self-contained, no runtime font fetch). The
/// EXPORT path consumes it here: the `[export.html]` plugin command carries the
/// generic `{mathjax}` placeholder, which `export_sync` substitutes with
/// `file://<resource_dir>/mathjax/tex-full-svg-a11y.min.js`. (The PREVIEW path's
/// MathJax URL is resolved by the frontend via `convertFileSrc` and handed to the
/// active renderer plugin as the `{mathjax}` render-context value — no renderer
/// knowledge lives in the app core.)
///
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
    if !PathBuf::from(&base_dir).is_dir() {
        return Err(Error::InvalidArgument(format!(
            "base_dir {base_dir} is not a directory"
        )));
    }
    if mathjax_url.trim().is_empty() {
        return Err(Error::InvalidArgument(
            "mathjax_url must not be empty (the local MathJax asset URL)".into(),
        ));
    }

    // The app core owns NO renderer knowledge: delegate buffer->HTML to the
    // active renderer plugin (renderer-plugin-architecture.md). The render context
    // (base_dir/base_url/mathjax) is supplied to the plugin; the plugin (pandoc,
    // generic, …) builds and runs whatever it needs.
    let outcome = crate::plugins::render_active(source, base_dir, base_url, mathjax_url)?;
    Ok(RenderResult {
        ok: outcome.ok,
        html: outcome.html,
        log: outcome.log,
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
        .map_err(|e| Error::ProcessSpawn(program.clone(), e))?;

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
