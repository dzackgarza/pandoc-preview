use std::collections::HashMap;
use std::path::PathBuf;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// Complete application configuration. Every field is required: the config
/// file is the single source of truth and is created by scripts/first-run.sh.
/// A missing or partial config is a hard startup error, never defaulted.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub general: General,
    pub editor: Editor,
    pub preview: Preview,
    /// Alternative-explorer roots. The macros pane browses `styles`, the figures
    /// pane browses `figures`. Required — both are explicit absolute paths (no
    /// implicit `~/.pandoc` default); first-run generates them as
    /// `~/.pandoc/styles` and `~/.pandoc/figures`.
    pub directories: Directories,
    /// Export targets are config-owned plugins: each `[export.<id>]` table is a
    /// complete compilation command. The pandoc HTML/PDF invocations are merely
    /// the shipped default plugins (scripts/first-run.sh). Required — a config
    /// without any `[export]` table is a hard startup error, never defaulted.
    /// IndexMap preserves declaration order so the Export menu lists entries in
    /// config order.
    pub export: IndexMap<String, ExportPlugin>,
    /// Plugin firewall (Milestone A). Optional capability: when the `[plugins]`
    /// table is present, `dir` is the directory the app discovers plugins from;
    /// when absent, the app has no plugins (a complete, valid state). Optional,
    /// NOT defaulted — there is no implicit plugins directory. An absent table is
    /// never re-serialized (a plugin-less config stays plugin-less on save).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugins: Option<Plugins>,
    /// Per-plugin config sections, one `[plugin.<id>]` table per plugin. Each is
    /// validated against the plugin's declared JSON Schema by the generic
    /// validator (`plugins::validate_plugin_config`), never by the core. Empty
    /// when no plugin declares config; an empty map is never re-serialized.
    #[serde(default, skip_serializing_if = "IndexMap::is_empty")]
    pub plugin: IndexMap<String, toml::Value>,
    /// Active renderer (Milestone B): selects, by plugin id, the renderer plugin
    /// that turns the editor buffer into preview HTML. The app core owns no
    /// renderer knowledge; it delegates to this plugin. Optional table, but the
    /// preview path requires it (no runtime default — absent is a loud error when
    /// a render is attempted).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub renderer: Option<Renderer>,
}

/// The `[directories]` table: roots for the alternative-explorer panes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Directories {
    /// Root directory the macros (styles) explorer pane browses.
    pub styles: ExistingDir,
    /// Root directory the figures explorer pane browses.
    pub figures: ExistingDir,
}

/// A filesystem path that is required to exist and be a directory. The invariant
/// is enforced at deserialize time, so any `ExistingDir` value names a real
/// directory: a config pointing at a missing or non-directory path is a hard
/// load error, never an empty-string check or a silently-accepted dangling path.
/// Serializes transparently as its path string.
#[derive(Debug, Clone, Serialize)]
pub struct ExistingDir(PathBuf);

impl<'de> Deserialize<'de> for ExistingDir {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        let path = PathBuf::from(&raw);
        if !path.is_dir() {
            return Err(serde::de::Error::custom(format!(
                "path is not an existing directory: {raw}"
            )));
        }
        Ok(ExistingDir(path))
    }
}

/// The `[renderer]` table: which renderer plugin is active.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Renderer {
    /// Plugin id of the active renderer (a `category = "renderer"` plugin in the
    /// configured plugins dir). Required when `[renderer]` is present.
    pub active: String,
}

/// The `[plugins]` table: where plugins are discovered. Present only when the
/// user has configured a plugins directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Plugins {
    /// Directory plugins are discovered from. Each plugin is a subdirectory with
    /// a `plugin.toml` manifest. Required when `[plugins]` is present.
    pub dir: String,
}

/// One export plugin: the entire compilation command for an export target.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExportPlugin {
    /// Human-readable menu label, non-empty.
    pub label: String,
    /// Output file extension (no dot), non-empty. Used for the save dialog.
    pub extension: String,
    /// The exact argv to spawn. Never a shell string. `{input}` and `{output}`
    /// placeholders are substituted per-argument (substring substitution); both
    /// must appear in at least one argument. Length >= 1.
    pub command: Vec<String>,
}

/// The two placeholders every export command must reference.
pub const PLACEHOLDER_INPUT: &str = "{input}";
pub const PLACEHOLDER_OUTPUT: &str = "{output}";
/// Optional, app-injected placeholder for the bundled MathJax bundle. The app
/// substitutes it with `file://<resource_dir>/mathjax/tex-full-svg-a11y.min.js` so the
/// shipped `[export.html]` plugin inlines a LOCAL MathJax copy under
/// `--embed-resources` instead of fetching a CDN (decision A,
/// mathjax-offline-local-source-decision.md). NOT required — a command without
/// it is valid; only `{input}`/`{output}` are mandatory.
pub const PLACEHOLDER_MATHJAX: &str = "{mathjax}";

/// Validate a single export plugin's invariants. The single source of truth for
/// the entry shape: both `validate` (config-values / save path) and the doctor's
/// `export-plugins` check call this; the rules are never duplicated.
pub fn validate_export_plugin(id: &str, plugin: &ExportPlugin) -> Result<()> {
    if plugin.label.trim().is_empty() {
        return Err(Error::InvalidArgument(format!(
            "export.{id}.label must not be empty"
        )));
    }
    if plugin.extension.trim().is_empty() {
        return Err(Error::InvalidArgument(format!(
            "export.{id}.extension must not be empty"
        )));
    }
    if plugin.command.is_empty() {
        return Err(Error::InvalidArgument(format!(
            "export.{id}.command must have at least one argument"
        )));
    }
    if !plugin
        .command
        .iter()
        .any(|arg| arg.contains(PLACEHOLDER_INPUT))
    {
        return Err(Error::InvalidArgument(format!(
            "export.{id}.command must reference the {PLACEHOLDER_INPUT} placeholder"
        )));
    }
    if !plugin
        .command
        .iter()
        .any(|arg| arg.contains(PLACEHOLDER_OUTPUT))
    {
        return Err(Error::InvalidArgument(format!(
            "export.{id}.command must reference the {PLACEHOLDER_OUTPUT} placeholder"
        )));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct General {
    /// UI theme: "dark" or "light".
    pub theme: Theme,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Dark,
    Light,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Editor {
    /// Editor font size in px.
    pub font_size: u32,
    /// Soft-wrap long lines in the editor.
    pub line_wrapping: bool,
    /// Show line numbers in the gutter.
    pub line_numbers: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Preview {
    /// Milliseconds of editor idle time before re-rendering the preview.
    pub debounce_ms: u32,
}

/// Inclusive editor font-size range, in px.
pub const FONT_SIZE_MIN: u32 = 8;
pub const FONT_SIZE_MAX: u32 = 48;
/// Inclusive preview debounce range, in ms.
pub const DEBOUNCE_MS_MIN: u32 = 0;
pub const DEBOUNCE_MS_MAX: u32 = 10_000;

/// The single source of truth for the config-values invariants. Both the
/// settings save path (`save_config`) and the doctor's `config-values` check
/// call this; the ranges are never duplicated. Fails loudly with the exact
/// offending value, no defaulting or clamping.
pub fn validate(config: &Config) -> Result<()> {
    let fs = config.editor.font_size;
    if fs < FONT_SIZE_MIN || fs > FONT_SIZE_MAX {
        return Err(Error::InvalidArgument(format!(
            "editor.font_size must be between {FONT_SIZE_MIN} and {FONT_SIZE_MAX}, got {fs}"
        )));
    }
    let dbg = config.preview.debounce_ms;
    if dbg > DEBOUNCE_MS_MAX {
        return Err(Error::InvalidArgument(format!(
            "preview.debounce_ms must be between {DEBOUNCE_MS_MIN} and {DEBOUNCE_MS_MAX}, got {dbg}"
        )));
    }
    // directories.styles / directories.figures are ExistingDir: existence and
    // dir-ness are enforced at deserialize time (a missing path is a hard load
    // error), so there is nothing weaker to re-check here.
    if config.export.is_empty() {
        return Err(Error::InvalidArgument(
            "at least one [export.<id>] plugin must be configured".into(),
        ));
    }
    for (id, plugin) in &config.export {
        validate_export_plugin(id, plugin)?;
    }
    // When a plugins directory is configured, its path must be non-empty. The
    // per-plugin `[plugin.<id>]` schema validation lives in the generic plugin
    // validator (the doctor's plugin-config checks), not here.
    if let Some(plugins) = &config.plugins {
        if plugins.dir.trim().is_empty() {
            return Err(Error::InvalidArgument(
                "plugins.dir must not be empty".into(),
            ));
        }
    }
    if let Some(renderer) = &config.renderer {
        if renderer.active.trim().is_empty() {
            return Err(Error::InvalidArgument(
                "renderer.active must not be empty".into(),
            ));
        }
    }
    Ok(())
}

pub fn config_path() -> Result<PathBuf> {
    // dirs::config_dir honors $XDG_CONFIG_HOME on Linux.
    let base = dirs::config_dir().ok_or_else(|| {
        Error::InvalidArgument("no XDG config directory could be determined".into())
    })?;
    Ok(base.join("pandoc-preview").join("config.toml"))
}

pub fn load() -> Result<Config> {
    let path = config_path()?;
    if !path.is_file() {
        return Err(Error::ConfigMissing(path.display().to_string()));
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| Error::io(&path, e))?;
    toml::from_str(&raw).map_err(|e| Error::ConfigInvalid {
        path: path.display().to_string(),
        message: e.to_string(),
    })
}

pub fn save(config: &Config) -> Result<()> {
    let path = config_path()?;
    let parent = path.parent().expect("config path always has a parent");
    std::fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
    let raw = toml::to_string_pretty(config).map_err(|e| Error::ConfigInvalid {
        path: path.display().to_string(),
        message: e.to_string(),
    })?;
    std::fs::write(&path, raw).map_err(|e| Error::io(&path, e))
}

#[tauri::command]
pub fn get_config() -> Result<Config> {
    load()
}

#[tauri::command]
pub fn save_config(config: Config) -> Result<()> {
    validate(&config)?;
    save(&config)
}

#[tauri::command]
pub fn get_config_path() -> Result<String> {
    Ok(config_path()?.display().to_string())
}

/// A collapsed fold range (character offsets), persisted per file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fold {
    pub from: usize,
    pub to: usize,
}

fn fold_state_path() -> Result<PathBuf> {
    let base = dirs::config_dir().ok_or_else(|| {
        Error::InvalidArgument("no XDG config directory could be determined".into())
    })?;
    Ok(base.join("pandoc-preview").join("fold-state.json"))
}

/// Per-file fold state: file path -> collapsed fold ranges. A missing file is a
/// legitimate first-run state and returns an empty map; IO/parse errors fail loud.
#[tauri::command]
pub fn read_fold_state() -> Result<HashMap<String, Vec<Fold>>> {
    let path = fold_state_path()?;
    if !path.is_file() {
        return Ok(HashMap::new());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| Error::io(&path, e))?;
    serde_json::from_str(&raw).map_err(|e| Error::ConfigInvalid {
        path: path.display().to_string(),
        message: e.to_string(),
    })
}

#[tauri::command]
pub fn save_fold_state(state: HashMap<String, Vec<Fold>>) -> Result<()> {
    let path = fold_state_path()?;
    let parent = path.parent().expect("fold-state path always has a parent");
    std::fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
    let raw = serde_json::to_string_pretty(&state).map_err(|e| Error::ConfigInvalid {
        path: path.display().to_string(),
        message: e.to_string(),
    })?;
    std::fs::write(&path, raw).map_err(|e| Error::io(&path, e))
}
