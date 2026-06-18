//! Static-lint bridge (Phase A / P70). The app core owns NO check logic and NO
//! pandoc command knowledge: it spawns the active renderer plugin's `lint.sh`
//! (which emits the pandoc transient `.tex` and runs the REAL ChkTeX on it),
//! then maps ChkTeX's `.tex` line/column diagnostics back to the markdown buffer
//! by SPAN-ANCHORED content re-derivation — finding the offending `.tex` line
//! verbatim in the buffer (math/delimiter content passes through pandoc
//! unchanged) and projecting the column onto it.
//!
//! This is the approximate-but-correct-for-P70 mapping the plan's Line-mapping
//! gate sanctions; PRECISE per-`.tex`-line mapping (the struck `sourcepos`
//! machinery) is HELD as A.7/P75 and deliberately NOT attempted here. A ChkTeX
//! diagnostic whose `.tex` line cannot be anchored in the buffer is dropped
//! rather than shipped on a wrong line (the gate's "no wrong-line bridge" rule),
//! not silently swallowing a backend error: a missing/failed ChkTeX or pandoc is
//! a LOUD error from the plugin, surfaced here, never an empty diagnostic set.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};

use crate::config;
use crate::error::{Error, Result};
use crate::plugins;

/// One mapped lint diagnostic for the CM6 `@codemirror/lint` field: character
/// offsets into the markdown buffer, the CM6 severity string, the message, and a
/// stable `source` (the ChkTeX warning number, so A.4/P73 suppression can name
/// it). Serialized camelCase-free — the field names already match the TS shape.
#[derive(Debug, Serialize)]
pub struct LintDiagnostic {
    pub from: usize,
    pub to: usize,
    pub severity: String,
    pub message: String,
    pub source: String,
}

/// The JSON `lint.sh` emits: the pandoc-emitted `.tex` (for span anchoring) and
/// the structured ChkTeX records.
#[derive(Debug, Deserialize)]
struct LintBackendOutput {
    tex: String,
    records: Vec<ChktexRecord>,
}

/// One raw ChkTeX record from the machine format `%l:%c:%d:%k:%n:%m`.
#[derive(Debug, Deserialize)]
struct ChktexRecord {
    /// 1-based line in the emitted `.tex`.
    line: usize,
    /// 1-based column in that `.tex` line.
    col: usize,
    /// Length of the flagged span (ChkTeX `%d`); 0 for whole-file warnings.
    len: usize,
    /// ChkTeX kind (`Warning`/`Error`/`Message`).
    kind: String,
    /// ChkTeX warning number (`%n`) — the stable rule id.
    #[serde(rename = "ruleId")]
    rule_id: u32,
    /// ChkTeX's own human-readable message (`%m`).
    message: String,
}

/// Map a ChkTeX `kind` to a CM6 severity string. ChkTeX emits `Warning`,
/// `Error`, and `Message`; an unknown kind is a loud error (the backend contract
/// is fixed), never a defaulted severity.
fn cm_severity(kind: &str) -> Result<&'static str> {
    match kind {
        "Error" => Ok("error"),
        "Warning" => Ok("warning"),
        "Message" => Ok("info"),
        other => Err(Error::InvalidArgument(format!(
            "unknown ChkTeX diagnostic kind {other:?}"
        ))),
    }
}

/// A faithful class label for a ChkTeX warning number, prepended to ChkTeX's own
/// message so the produced diagnostic NAMES the imbalance it reports. These are
/// ChkTeX's documented parenthesis/environment-matching and math-mode checks
/// (ChkTeX reference, "Parenthesis and environment matching"); the label renders
/// the warning's CLASS, it does not re-run or invent the check — ChkTeX already
/// performed the count/balance and emitted the number. A number with no class
/// label surfaces ChkTeX's message verbatim.
fn rule_class_label(rule_id: u32) -> Option<&'static str> {
    match rule_id {
        // Delimiter-count / brace-matching class: "No match found for ..." (15),
        // "Number of ... doesn't match ..." (17), nesting-mismatch (9).
        9 | 15 | 17 => Some("unmatched delimiter"),
        // Math-mode balance class: "Mathmode still on at end ..." (16).
        16 => Some("unterminated math mode"),
        _ => None,
    }
}

/// Project a ChkTeX `.tex` (line, col, len) onto a markdown character span by
/// SPAN-ANCHORED content re-derivation: find the `.tex` line's text verbatim in
/// the buffer and offset by the column. Returns `None` when the line cannot be
/// anchored (pandoc-restructured prose) — such a diagnostic is dropped rather
/// than placed on a wrong line (the Line-mapping gate). `tex_lines` is the
/// emitted `.tex` split into 1-based lines.
fn anchor_span(
    buffer: &str,
    tex_lines: &[&str],
    record: &ChktexRecord,
) -> Option<(usize, usize)> {
    let tex_line = tex_lines.get(record.line.checked_sub(1)?)?;
    let trimmed = tex_line.trim();
    if trimmed.is_empty() {
        return None;
    }
    // The line must appear verbatim in the buffer to anchor it. Math/delimiter
    // content passes through pandoc unchanged, so the offending `\left(` line is
    // found exactly; prose pandoc rewrote (\section{...}, \emph{...}) is not, and
    // is correctly dropped.
    let line_start = buffer.find(tex_line)?;
    // ChkTeX columns are 1-based byte columns into the (untrimmed) `.tex` line.
    let col0 = record.col.checked_sub(1).unwrap_or(0);
    let from = line_start + col0.min(tex_line.len());
    // A zero-length whole-line/whole-file warning (ChkTeX %d == 0) is widened to
    // one char so it has a visible, overlap-testable range in the gutter.
    let span = record.len.max(1);
    let to = (from + span).min(buffer.len());
    Some((from, to))
}

/// Build the mapped diagnostic for one ChkTeX record, or `None` when it cannot be
/// anchored to a real markdown span.
fn map_record(buffer: &str, tex_lines: &[&str], record: &ChktexRecord) -> Result<Option<LintDiagnostic>> {
    let Some((from, to)) = anchor_span(buffer, tex_lines, record) else {
        return Ok(None);
    };
    let severity = cm_severity(&record.kind)?;
    let message = match rule_class_label(record.rule_id) {
        Some(label) => format!("{label}: {}", record.message),
        None => record.message.clone(),
    };
    Ok(Some(LintDiagnostic {
        from,
        to,
        severity: severity.to_string(),
        message,
        source: format!("chktex:{}", record.rule_id),
    }))
}

fn lint_buffer_sync(buffer: String) -> Result<Vec<LintDiagnostic>> {
    let cfg = config::load()?;
    let renderer_cfg = cfg.renderer.as_ref().ok_or_else(|| {
        Error::InvalidArgument("no [renderer] is configured (no active renderer to lint with)".into())
    })?;
    let plugins_cfg = cfg.plugins.as_ref().ok_or_else(|| {
        Error::InvalidArgument(
            "a [renderer] is active but no [plugins] directory is configured".into(),
        )
    })?;

    let plugins = plugins::discover(Path::new(&plugins_cfg.dir))?;
    let plugin = plugins
        .iter()
        .find(|p| p.manifest.id == renderer_cfg.active)
        .ok_or_else(|| {
            Error::InvalidArgument(format!(
                "active renderer {:?} not found in the plugins dir",
                renderer_cfg.active
            ))
        })?;

    // The lint backend ships alongside the renderer's render.sh in the plugin
    // dir. The buffer is delivered on stdin; the plugin's own config (the
    // canonical pandoc command, for the binary + reader) is on PPE_PLUGIN_CONFIG,
    // exactly as render_active supplies it.
    let lint_script = plugin.dir.join("lint.sh");
    if !lint_script.is_file() {
        return Err(Error::InvalidArgument(format!(
            "renderer {:?} has no lint.sh at {} — the static-lint backend is missing",
            renderer_cfg.active,
            lint_script.display()
        )));
    }
    let plugin_config = cfg
        .plugin
        .get(&renderer_cfg.active)
        .map(|v| {
            serde_json::to_value(v)
                .map(|j| j.to_string())
                .unwrap_or_else(|_| "{}".to_string())
        })
        .unwrap_or_else(|| "{}".to_string());

    let program = lint_script.display().to_string();
    let mut child = Command::new(&lint_script)
        .current_dir(&plugin.dir)
        .env("PPE_PLUGIN_CONFIG", plugin_config)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| Error::ProcessSpawn(program.clone(), e))?;

    let mut stdin = child.stdin.take().expect("stdin was piped");
    // The buffer is needed AFTER the spawn for span anchoring, so the writer
    // thread owns its own copy of the bytes.
    let stdin_bytes = buffer.clone().into_bytes();
    let writer = std::thread::spawn(move || stdin.write_all(&stdin_bytes));
    let output = child
        .wait_with_output()
        .map_err(|e| Error::ProcessSpawn(program.clone(), e))?;
    writer
        .join()
        .expect("stdin writer thread panicked")
        .map_err(|e| Error::ProcessSpawn(program.clone(), e))?;

    // A nonzero lint backend exit is a LOUD failure (e.g. ChkTeX absent, pandoc
    // failed) — surfaced with the backend's stderr, never swallowed into an empty
    // diagnostic set. ChkTeX's own "warnings found" nonzero exit is absorbed
    // inside lint.sh, so a nonzero exit HERE is always a real backend failure.
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(Error::InvalidArgument(format!(
            "static lint backend {program} failed ({}): {}",
            output.status,
            stderr.trim()
        )));
    }

    let parsed: LintBackendOutput =
        serde_json::from_slice(&output.stdout).map_err(|e| Error::InvalidArgument(format!(
            "static lint backend produced unparseable output: {e}"
        )))?;

    let tex_lines: Vec<&str> = parsed.tex.split('\n').collect();
    let mut diagnostics = Vec::new();
    for record in &parsed.records {
        if let Some(d) = map_record(&buffer, &tex_lines, record)? {
            diagnostics.push(d);
        }
    }
    Ok(diagnostics)
}

/// Run the REAL ChkTeX (via the active renderer plugin's `lint.sh`) over the
/// markdown buffer's pandoc-emitted `.tex`, returning diagnostics mapped back to
/// markdown character spans. The cheap static lint pass — "feedback faster than a
/// compile" (P70) — no HTML render, no latex compile.
#[tauri::command]
pub async fn lint_buffer(buffer: String) -> Result<Vec<LintDiagnostic>> {
    tauri::async_runtime::spawn_blocking(move || lint_buffer_sync(buffer))
        .await
        .expect("lint_buffer task panicked")
}
