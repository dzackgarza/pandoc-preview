use std::path::PathBuf;

use serde::Serialize;

use crate::error::{Error, Result};

#[derive(Debug, Serialize)]
pub struct RenderResult {
    pub ok: bool,
    /// Standalone HTML document. Empty when ok is false.
    pub html: String,
    /// Human-readable compilation log: command line, stderr, exit status.
    pub log: String,
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
