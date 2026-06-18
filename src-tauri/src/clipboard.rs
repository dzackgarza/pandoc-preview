use std::path::PathBuf;

use png::{BitDepth, ColorType, Encoder};
use tauri::image::Image;
use tauri::{AppHandle, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::config;
use crate::error::{Error, Result};
use crate::tikz;

/// Build a deterministic `width`×`height` RGBA raster and write it onto the REAL
/// system clipboard in ONE IPC (P62). The frontend's seedClipboardImage E2E hook
/// calls this so the seed is a single fast round-trip (no separate Image.new
/// resource creation + writeImage), letting the subsequent paste read the seeded
/// image off the clipboard without a timing gap. The write-image clipboard
/// permission it needs is granted only in the e2e build (runtime-added in lib.rs
/// setup), so in a user build this command would fail loudly at the permission
/// boundary — and the seed hook itself exists only under the VITE_PPE_E2E flag.
#[tauri::command]
pub async fn seed_clipboard_image<R: Runtime>(
    app: AppHandle<R>,
    width: u32,
    height: u32,
) -> Result<()> {
    // Opaque solid fill: every pixel R=20 G=120 B=200 A=255. Real RGBA bytes, so
    // the clipboard image decodes to exactly width×height — the witness size the
    // paste action later persists and the proof decodes back.
    let mut rgba = vec![0u8; (width as usize) * (height as usize) * 4];
    for px in rgba.chunks_exact_mut(4) {
        px[0] = 20;
        px[1] = 120;
        px[2] = 200;
        px[3] = 255;
    }
    let image = Image::new_owned(rgba, width, height);
    app.clipboard()
        .write_image(&image)
        .map_err(|e| Error::InvalidArgument(format!("clipboard write_image failed: {e}")))
}

/// Copy a SELECTED subgraph of owned tikz source to the system clipboard as
/// deterministic, canonical, re-parseable tikz (D-8 / P97 — the TikzIt
/// "copy a region of nodes" model).
///
/// `source` is the full owned `\begin{tikzpicture}…\end{tikzpicture}` the editor
/// buffer carries; `selection` is the contiguous source span the user selected (a
/// PROPER SUBSET — a region of node-definition lines). This:
///
///  1. parses `source` with the D-1 / P90 parser ([`tikz::parse`]) into the
///     authoritative [`tikz::Graph`] — a `source` that is not parseable tikz is a
///     LOUD error here, never a raw-text copy;
///  2. extracts the names of the nodes the selection covers by running the SAME
///     D-1 `\node` parser over the selected fragment ([`tikz::node_names_in`]);
///  3. forms the INDUCED subgraph ([`Graph::induced_subgraph`]): the selected
///     nodes plus EXACTLY the edges whose BOTH endpoints are selected;
///  4. serializes that subgraph with the SAME canonical [`Graph::to_tikz`]
///     serializer P90 round-trips — so the clipboard text re-parses STABLY back
///     to the selected subgraph;
///  5. writes that canonical tikz onto the REAL system clipboard via the
///     clipboard-manager `write_text` path (the sibling of
///     [`seed_clipboard_image`]'s write).
///
/// A selection that covers no parseable node (the induced subgraph would be
/// empty) is a LOUD error: the clipboard is NEVER populated with a raw-text
/// guess.
#[tauri::command]
pub async fn copy_subgraph_tikz<R: Runtime>(
    app: AppHandle<R>,
    source: String,
    selection: String,
) -> Result<String> {
    let graph = tikz::parse(&source)
        .map_err(|e| Error::InvalidArgument(format!("selection is not parseable tikz: {e}")))?;

    let selected = tikz::node_names_in(&selection);
    if selected.is_empty() {
        return Err(Error::InvalidArgument(format!(
            "selection covers no tikz node, refusing to copy a raw-text guess: {selection:?}"
        )));
    }

    let canonical = graph.induced_subgraph(&selected).to_tikz();

    app.clipboard()
        .write_text(canonical.clone())
        .map_err(|e| Error::InvalidArgument(format!("clipboard write_text failed: {e}")))?;
    Ok(canonical)
}

/// Read the image currently on the system clipboard, PNG-encode it, and write it
/// as a real file named `filename` into the CONFIGURED global figures directory
/// (`config.directories.figures`), returning the absolute path of the written
/// file (P62). This is the paste-image action's backend: the insertion bar's
/// paste-image control inserts a markdown image reference at the cursor pointing
/// at the path this command returns. The caller supplies the (bare) filename so
/// it can insert the reference at the cursor BEFORE awaiting this write — the
/// reference and the on-disk file therefore name the SAME path.
///
/// Fails LOUDLY: a non-bare filename (any path separator), an empty/absent
/// clipboard image, an unreadable clipboard, or an unconfigured figures dir is a
/// hard error — never a silent no-op, never a fallback to a project-local
/// `./figures`. The image is read off the clipboard as RGBA (width × height), so
/// the persisted PNG's decoded dimensions are the clipboard image's exact
/// dimensions.
#[tauri::command]
pub async fn paste_clipboard_image<R: Runtime>(
    app: AppHandle<R>,
    filename: String,
) -> Result<String> {
    // The filename must be a bare basename: the file lands directly in the
    // configured figures dir, never one path component away from it. A separator
    // (or a `..`) would let the write escape the configured dir — reject it.
    if filename.is_empty()
        || filename.contains('/')
        || filename.contains('\\')
        || filename == "."
        || filename == ".."
    {
        return Err(Error::InvalidArgument(format!(
            "paste-image filename must be a bare basename, got {filename:?}"
        )));
    }

    // The configured global figures directory, resolved from the loaded config —
    // the SAME ExistingDir P29's figures explorer browses. No project-local
    // fallback: the file lands HERE or the command fails.
    let cfg = config::load()?;
    let figures_dir = cfg.directories.figures.path();

    // Read the clipboard image (RGBA pixels + dimensions) through the
    // clipboard-manager plugin. A clipboard with no image is a hard error.
    let image = app
        .clipboard()
        .read_image()
        .map_err(|e| Error::InvalidArgument(format!("no image on the clipboard: {e}")))?;
    let width = image.width();
    let height = image.height();
    let rgba = image.rgba();

    let expected = (width as usize) * (height as usize) * 4;
    if rgba.len() != expected {
        return Err(Error::InvalidArgument(format!(
            "clipboard image is {width}×{height} but holds {} bytes (expected {expected} RGBA bytes)",
            rgba.len()
        )));
    }

    let dest: PathBuf = figures_dir.join(&filename);

    // PNG-encode the RGBA pixels in memory. 8-bit RGBA, exactly the clipboard
    // image's dimensions, so an independent decoder reads back the seeded pixel
    // size.
    let mut bytes: Vec<u8> = Vec::new();
    {
        let mut encoder = Encoder::new(&mut bytes, width, height);
        encoder.set_color(ColorType::Rgba);
        encoder.set_depth(BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|e| Error::InvalidArgument(format!("png header write failed: {e}")))?;
        writer
            .write_image_data(rgba)
            .map_err(|e| Error::InvalidArgument(format!("png data write failed: {e}")))?;
    }

    // Write atomically: encode into a temp file in the figures dir's PARENT (same
    // filesystem, so rename(2) is atomic), then rename into the figures dir. An
    // independent reader of the figures dir (the proof's before/after listing +
    // PIL decode) never observes a half-written PNG, and never lists the staging
    // temp file itself — it sees either nothing or the one complete file. Writing
    // directly to `dest`, or staging the temp INSIDE the figures dir, would expose
    // either a header-only partial file or the staging temp to a concurrent
    // directory diff.
    let stage_dir = figures_dir.parent().ok_or_else(|| {
        Error::InvalidArgument(format!(
            "configured figures dir has no parent: {}",
            figures_dir.display()
        ))
    })?;
    let tmp: PathBuf = stage_dir.join(format!(".{filename}.partial"));
    std::fs::write(&tmp, &bytes).map_err(|e| Error::io(&tmp, e))?;
    std::fs::rename(&tmp, &dest).map_err(|e| Error::io(&dest, e))?;

    Ok(dest.display().to_string())
}
