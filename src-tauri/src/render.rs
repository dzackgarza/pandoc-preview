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
    renderer_id: String,
    template: String,
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

    // The app core owns NO renderer-id and NO template knowledge: the frontend
    // resolves WHICH renderer plugin and WHICH template from plugin DISCOVERY (the
    // open file's input type → a candidate render target, defaulting to the
    // configured active renderer; the user may select another target, e.g. slides)
    // and passes them here. The core forwards the render context
    // (base_dir/base_url/mathjax) and the selected template; the plugin (pandoc,
    // tikz, revealjs, …) builds and runs whatever it needs. One render path for
    // every input type and every renderer — no hardcoded plugin ids.
    let outcome = crate::plugins::render_named(
        renderer_id,
        template,
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

/// Render the editor buffer to preview HTML through a renderer plugin the frontend
/// selected from discovery. `renderer_id` is the chosen render target's plugin
/// (the open file's input type → a candidate renderer, defaulting to the configured
/// active renderer; the user may pick another, e.g. the slides renderer);
/// `template` is the user-selected template the plugin wraps the buffer in (default
/// = the renderer's shipped template). This single command replaces the former
/// per-mode render_preview/render_slides/render_tikz: the core holds no plugin ids.
#[tauri::command]
pub async fn render(
    renderer_id: String,
    template: String,
    source: String,
    base_dir: String,
    base_url: String,
    mathjax_url: String,
) -> Result<RenderResult> {
    tauri::async_runtime::spawn_blocking(move || {
        render_sync(
            renderer_id,
            template,
            source,
            base_dir,
            base_url,
            mathjax_url,
        )
    })
    .await
    .expect("render task panicked")
}
