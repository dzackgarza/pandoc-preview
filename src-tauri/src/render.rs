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

/// The renderer plugin id for the Phase F / F6 / P113 slides fast-feedback
/// preview: the `revealjs-renderer` plugin (`pandoc --to revealjs`, the sibling
/// of the active html5 renderer). The app core names WHICH renderer plugin
/// produces slides; the plugin carries the writer command. Editing re-renders the
/// reveal.js DECK through this plugin into the SAME preview iframe on idle (the
/// fast HTML path), distinct from a beamer->PDF compile.
const SLIDES_RENDERER_ID: &str = "revealjs-renderer";

fn render_slides_sync(
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

    // The slides deck is produced by the revealjs-renderer plugin (pandoc's own
    // revealjs writer) — the renderer-plugin sibling of the active html5 renderer.
    // The core owns NO slide-renderer knowledge: it names the plugin and forwards
    // the SAME render context the HTML preview uses.
    let outcome = crate::plugins::render_named(
        SLIDES_RENDERER_ID.to_string(),
        source,
        base_dir,
        base_url,
        mathjax_url,
    )?;
    Ok(RenderResult {
        ok: outcome.ok,
        html: outcome.html,
        log: outcome.log,
    })
}

/// Render the editor buffer to a reveal.js slide DECK through the slides renderer
/// plugin (Phase F / F6 / P113). The sibling of `render_preview`: same render
/// context, same plugin firewall, but the `revealjs-renderer` plugin (pandoc
/// `--to revealjs`) instead of the active html5 renderer. The deck HTML paints
/// into the SAME preview iframe; editing re-renders it on idle (the fast path).
#[tauri::command]
pub async fn render_slides(
    source: String,
    base_dir: String,
    base_url: String,
    mathjax_url: String,
) -> Result<RenderResult> {
    tauri::async_runtime::spawn_blocking(move || {
        render_slides_sync(source, base_dir, base_url, mathjax_url)
    })
    .await
    .expect("slides render task panicked")
}
