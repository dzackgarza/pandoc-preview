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
    /// The shared figure palette (Phase D / D-2 / P91): the ONE `.tikzstyles`
    /// style file and ONE `.tikzdefs` preamble every compiled figure `\input`s.
    /// Required — both are explicit config-declared, load-validated `ExistingFile`
    /// paths; a missing shared style/defs file is a hard load error, never a
    /// default. The renderer forwards them as render context (`{tikzstyles}` /
    /// `{tikzdefs}`) the figure compile `\input`s.
    pub figures: Figures,
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

/// The `[figures]` table (Phase D / D-2 / P91): the shared figure palette every
/// compiled figure `\input`s. Both paths are required, load-validated
/// `ExistingFile`s — a config pointing at a missing shared `.tikzstyles` or
/// `.tikzdefs` is a hard load error, never a default. Distinct from
/// `[directories].figures` (the figures DIR the explorer browses): these are the
/// two specific palette FILES the figure compile consumes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Figures {
    /// The shared TikZ style palette in TikZiT's native `\tikzstyle{NAME}=[...]`
    /// format. Every figure compile `\input`s it, so a style declared here is
    /// available to every tikzpicture/tikzcd block by name. The renderer forwards
    /// this path as the `{tikzstyles}` render-context placeholder.
    pub tikzstyles: ExistingFile,
    /// The shared TikZ preamble/definitions (`.tikzdefs`): arbitrary preamble
    /// LaTeX (`\pgfdeclarelayer`, `\def`, `\usetikzlibrary`) shared by every
    /// figure, `\input` before `\begin{document}`. The renderer forwards this path
    /// as the `{tikzdefs}` render-context placeholder.
    pub tikzdefs: ExistingFile,
    /// The per-figure PREAMBLE TEMPLATE (Phase D / D-3 / P92): the standalone
    /// LaTeX document the figure compile wraps each tikz figure body in, with the
    /// QTikz `.pgs` `<>` `TemplateReplaceText` marker where the figure source is
    /// substituted. Config-declared and load-validated as an `ExistingFile` — a
    /// missing template is a hard load error, never a baked-in default. Swapping
    /// this path (or its content) swaps the preamble every figure compiles under,
    /// so a `\usetikzlibrary`/macro present only here governs whether a figure
    /// requiring it compiles. The renderer forwards this path as the
    /// `{figure_template}` render-context placeholder.
    pub template: ExistingFile,
}

/// A filesystem path that is required to exist and be a directory. The invariant
/// is enforced at deserialize time, so any `ExistingDir` value names a real
/// directory: a config pointing at a missing or non-directory path is a hard
/// load error, never an empty-string check or a silently-accepted dangling path.
/// Serializes transparently as its path string.
#[derive(Debug, Clone, Serialize)]
pub struct ExistingDir(PathBuf);

impl ExistingDir {
    /// The validated directory path. The `ExistingDir` invariant (checked at
    /// deserialize time) guarantees this names a real directory.
    pub fn path(&self) -> &std::path::Path {
        &self.0
    }
}

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

/// A filesystem path that is required to exist and be a regular file. Like
/// `ExistingDir`, the invariant is enforced at deserialize time: a config
/// pointing `editor.snippet_dictionary` at a missing or non-file path is a hard
/// load error, never a silently-accepted dangling path or a runtime default.
/// Serializes transparently as its path string.
#[derive(Debug, Clone, Serialize)]
pub struct ExistingFile(PathBuf);

impl<'de> Deserialize<'de> for ExistingFile {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        let path = PathBuf::from(&raw);
        if !path.is_file() {
            return Err(serde::de::Error::custom(format!(
                "path is not an existing file: {raw}"
            )));
        }
        Ok(ExistingFile(path))
    }
}

impl ExistingFile {
    /// The validated file path. The `ExistingFile` invariant (checked at
    /// deserialize time) guarantees this names a real regular file.
    pub fn path(&self) -> &std::path::Path {
        &self.0
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
    /// Config-owned path to a user snippet dictionary: a JSON document of the
    /// form `{ "snippets": [ { "trigger", "body", "mode"? } ] }`, where `mode` is
    /// `prose` | `math` | `both` (default `both`) so the SAME trigger can resolve
    /// to a different body by editing zone (P77). Optional capability — when
    /// present, the path is validated to be an existing file (ExistingFile), so
    /// the editor reads a real dictionary; when absent, the editor offers no user
    /// snippets. No implicit default path. An absent value is never re-serialized.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snippet_dictionary: Option<ExistingFile>,
    /// Config-owned path to a user custom spelling dictionary: a plain wordlist,
    /// one word per line (the user's vim `.add` math wordlist shape). Optional
    /// capability — when present, the path is validated to be an existing file
    /// (ExistingFile), so the editor reads a real wordlist and adds every term to
    /// the spellchecker so those math words are not flagged; when absent, only the
    /// vendored English base dictionary is in effect. No implicit default path.
    /// An absent value is never re-serialized.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spell_dictionary: Option<ExistingFile>,
    /// Config-owned path to the vendored QTikz tikz-command DB (P94 / D-5): a JSON
    /// array of `{ name, description, insert, dx, dy, type }` command objects (the
    /// QTikz `tikzcommands.json` model) the editor surfaces on the insertion-bar
    /// tikz palette AND as a composable CM6 completion source. Optional capability —
    /// when present, the path is validated to be an existing file (ExistingFile), so
    /// the editor reads a real DB; when absent, no tikz-command palette is offered.
    /// No implicit default path. Pointing the key at a different DB surfaces that
    /// DB's commands (the data-driven property P94 pins). An absent value is never
    /// re-serialized.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tikz_commands: Option<ExistingFile>,
    /// Config-owned path to the bibliography database the preview resolves
    /// `@`-citations against (BibLaTeX/CSL-JSON/etc). The ONE source of truth for
    /// the citation bibliography: the frontend reads it (to name which file governs
    /// the app's citations) AND the renderer layers it onto the pandoc command as
    /// `--bibliography`, sourced from this same value (P84/C1). Required and
    /// load-validated (ExistingFile), so a config pointing at a missing bibliography
    /// is a hard load error, never a silent default.
    pub bibliography: ExistingFile,
    /// Config-owned path to the CSL citation style the preview formats citations
    /// with. Like `bibliography`, the renderer layers it onto the pandoc command as
    /// `--csl`, sourced from this value. Required and load-validated (ExistingFile).
    pub csl: ExistingFile,
    /// Phase H / H.2 / P121 — the three-way editor|preview view mode the layout
    /// opens in and persists. `Split` shows both panes (the default), `Editor`
    /// shows only the editor, `Preview` shows only the preview. Config-persisted UI
    /// state restored at launch; mutated by the view:editor/preview/split commands.
    /// Required: the canonical config bakes the opinionated value (`split`); a
    /// config omitting it is a hard load error and an unknown variant is a LOUD
    /// deserialize error (no runtime default, no silent coercion).
    pub view_mode: ViewMode,
    /// Phase H / H.4 / P123 — words-per-minute the status cluster's reading-time
    /// metric divides the live word count by. The metric is a DERIVED
    /// `ceil(wordCount / reading_wpm)` over the SAME word count the status bar
    /// already shows (no new buffer scan, no new state). Range-validated in
    /// `validate()` like `font_size`/`debounce_ms` and round-tripped by
    /// `save_config` (the P9 class). Required: the canonical config bakes the
    /// opinionated value; a config omitting it is a hard load error (no runtime
    /// default), and an out-of-range value fails loudly.
    pub reading_wpm: u32,
    /// Phase H / H.1 / P120 — the three EDITOR-presentation comfort modes
    /// (distraction-free chrome-hide, typewriter caret-centering, readability
    /// sentence coloring), each a config-owned boolean the app reads at launch and
    /// persists on toggle.
    ///
    /// Required opinionated sub-table: the canonical config bakes `[editor.comfort]`
    /// with every mode OFF (all-false), and every provisioning path that emits an
    /// `[editor]` table also emits `[editor.comfort]`. A config omitting the table is
    /// a hard load error (no serde default, no silent coercion) — exactly like the
    /// other required `Editor` fields. The booleans always round-trip and survive a
    /// relaunch.
    pub comfort: Comfort,
}

/// The three EDITOR-presentation comfort modes (P120), each a REQUIRED
/// config-owned boolean. `deny_unknown_fields`: an unexpected key is a LOUD
/// deserialize error. No serde default on the struct or any field: an absent
/// `[editor.comfort]` table, or an absent mode key, is a hard load error — the
/// canonical config and every provisioning path bake the opinionated all-false
/// state. Mirrors the `comfort` sub-object in src/lib/types.ts.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Comfort {
    /// Hide the chrome (sidebar / insertion bar / status bar) — an App-shell CSS
    /// state, not editor infra.
    pub distraction_free: bool,
    /// Keep the caret line vertically centered in the editor viewport (a CM6
    /// scroll-margin / scroll-into-view centering extension).
    pub typewriter: bool,
    /// Color prose sentence spans (a thin CM6 sentence-decoration layer respecting
    /// the fork's math/code exclusion predicate).
    pub readability: bool,
}

/// The three-way editor|preview view mode (P121). `Split` shows both panes;
/// `Editor`/`Preview` show only that pane. Mirrors the `ViewMode` type in
/// src/lib/types.ts and the `view_mode` toggle realized by the dockview
/// SplitviewComponent's per-view visibility API.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ViewMode {
    Editor,
    Preview,
    Split,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Preview {
    /// Milliseconds of editor idle time before re-rendering the preview.
    pub debounce_ms: u32,
    /// Phase F / F4 / P110 — whether the PDF compile-on-idle scheduler fires on an
    /// edit. `Auto` recompiles after the debounce window; `Manual` suppresses idle
    /// recompiles until an explicit Recompile PDF command. Config-persisted UI
    /// state selecting a behaviour, NOT new build machinery. Required: the
    /// canonical config bakes the opinionated value (`auto`); a config that omits
    /// it fails to load (no runtime fallback — mirrors `debounce_ms`).
    pub pdf_compile_mode: PdfCompileMode,
    /// Phase F / F4 / P110 — which of the two configured PDF command ids the
    /// scheduler / the explicit Recompile runs. `Fast` selects the draft
    /// single-pass command (`pdf_fast_command`); `Full` selects the latexmk
    /// multi-pass driver (`pdf_full_command`). Config-persisted state selecting
    /// between CONFIGURED commands. Required: omitting it is a hard load error.
    pub pdf_compile_speed: PdfCompileSpeed,
    /// Phase F / F4 / P110 — the discovered export-plugin id the `Fast` speed runs
    /// (the draft single-pass PDF command). The app owns no command knowledge: this
    /// names a plugin discovered through the firewall and run by id, exactly as the
    /// other configured PDF commands are. Required: omitting it is a hard load
    /// error (the canonical config ships `pandoc-pdf-export`).
    pub pdf_fast_command: String,
    /// Phase F / F4 / P110 — the discovered export-plugin id the `Full` speed runs
    /// (the latexmk multi-pass driver, P109). Selecting `Full` picks this command
    /// id over `pdf_fast_command`. Required: omitting it is a hard load error
    /// (the canonical config ships `latexmk-pdf-export`).
    pub pdf_full_command: String,
}

/// PDF compile-on-idle gating (P110). `Manual` suppresses idle recompiles until an
/// explicit Recompile; `Auto` recompiles after the debounce window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PdfCompileMode {
    Auto,
    Manual,
}

/// PDF compile command selection (P110). `Fast` runs the draft single-pass command;
/// `Full` runs the latexmk multi-pass driver.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PdfCompileSpeed {
    Fast,
    Full,
}

/// Inclusive editor font-size range, in px.
pub const FONT_SIZE_MIN: u32 = 8;
pub const FONT_SIZE_MAX: u32 = 48;
/// Inclusive preview debounce range, in ms.
pub const DEBOUNCE_MS_MIN: u32 = 0;
pub const DEBOUNCE_MS_MAX: u32 = 10_000;
/// Inclusive reading-speed range, in words per minute (P123). A 0 wpm would make
/// the derived `ceil(words / wpm)` reading-time metric divide by zero; the upper
/// bound keeps the configured speed in a sane human range.
pub const READING_WPM_MIN: u32 = 1;
pub const READING_WPM_MAX: u32 = 2_000;

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
    let wpm = config.editor.reading_wpm;
    if wpm < READING_WPM_MIN || wpm > READING_WPM_MAX {
        return Err(Error::InvalidArgument(format!(
            "editor.reading_wpm must be between {READING_WPM_MIN} and {READING_WPM_MAX}, got {wpm}"
        )));
    }
    // P110: the FAST/FULL selectors name discovered PDF-command plugin ids; an empty
    // id resolves no command, so reject it loudly (no silent no-op compile).
    if config.preview.pdf_fast_command.trim().is_empty() {
        return Err(Error::InvalidArgument(
            "preview.pdf_fast_command must not be empty".into(),
        ));
    }
    if config.preview.pdf_full_command.trim().is_empty() {
        return Err(Error::InvalidArgument(
            "preview.pdf_full_command must not be empty".into(),
        ));
    }
    // directories.styles / directories.figures are ExistingDir: existence and
    // dir-ness are enforced at deserialize time (a missing path is a hard load
    // error), so there is nothing weaker to re-check here.
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

/// The canonical app-substituted build-directory placeholder (F2 / P108). A
/// plugin whose driver scatters intermediates references `{builddir}` in its
/// argv; the app substitutes a per-run isolated build directory it supplies, and
/// the DRIVER's own native output-directing flag routes its intermediates there
/// instead of beside the source. The app neither knows nor names what those
/// intermediates are.
///
/// This is the OSOT for the token: the plugin firewall substitutes it exactly as
/// it substitutes `{file}`/`{artifact}`, and the resolver below supplies the
/// value. The app core stays build-engine-agnostic — it names no engine concept
/// and exports no engine env var; it only owns "a per-run build directory exists,
/// here is its path." How a driver uses that path is entirely the plugin's.
pub const PLACEHOLDER_BUILDDIR: &str = "{builddir}";

/// Monotonic counter making each supplied build directory unique within a
/// process, so concurrent or repeated runs never collide in the OS temp root.
static BUILD_DIR_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Resolve a per-run isolated build directory the app SUPPLIES to a plugin via
/// the `{builddir}` placeholder. Created eagerly so substitution can never hand
/// a plugin a path that does not exist; a directory that cannot be created is a
/// LOUD error (no fallback to the source tree, no silent skip). The app neither
/// `cwd`s into this directory nor exports any engine-specific env var — the
/// plugin's own driver flag does the isolation with this path.
pub fn resolve_build_dir() -> Result<PathBuf> {
    let dir = std::env::temp_dir().join(format!(
        "pandoc-preview-build-{}-{}",
        std::process::id(),
        BUILD_DIR_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).map_err(|e| Error::io(&dir, e))?;
    Ok(dir)
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

/// The last active session a prior run persisted (P49): the last open project +
/// file + the recovery-store session id for that file. Lives on the HOST
/// FILESYSTEM under `$XDG_STATE_HOME/pandoc-preview/session.json`, never browser
/// storage, so on launch the app reopens the last file and can locate that
/// session's recovery store to offer newer unsaved content.
///
/// The on-disk JSON is `{project, file, sessionId}` (camelCase): one source of
/// truth for the file shape, shared with the frontend `SessionState` and the
/// proof harness's provisioned session.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SessionState {
    /// Absolute path of the last open project root.
    pub project: String,
    /// Absolute path of the last open file.
    pub file: String,
    /// Recovery-store session id for `file` (the per-document repo directory
    /// name under the recovery root). Lets launch read that session's HEAD
    /// buffer blob to compare against the on-disk file.
    pub session_id: String,
}

fn session_state_path() -> Result<PathBuf> {
    // dirs::state_dir honors $XDG_STATE_HOME on Linux, matching the hermetic
    // XDG_STATE_HOME the proof harness launches the app with.
    let base = dirs::state_dir().ok_or_else(|| {
        Error::InvalidArgument("no XDG state directory could be determined".into())
    })?;
    Ok(base.join("pandoc-preview").join("session.json"))
}

/// Read the last persisted session, or `None` on a clean first run (no file).
/// IO/parse errors fail loud.
#[tauri::command]
pub fn read_session_state() -> Result<Option<SessionState>> {
    let path = session_state_path()?;
    if !path.is_file() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| Error::io(&path, e))?;
    let state = serde_json::from_str(&raw).map_err(|e| Error::ConfigInvalid {
        path: path.display().to_string(),
        message: e.to_string(),
    })?;
    Ok(Some(state))
}

/// Persist the active session so the next launch reopens it. Called on open and
/// save, mirroring fold-state persistence.
#[tauri::command]
pub fn save_session_state(state: SessionState) -> Result<()> {
    let path = session_state_path()?;
    let parent = path
        .parent()
        .expect("session-state path always has a parent");
    std::fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
    let raw = serde_json::to_string_pretty(&state).map_err(|e| Error::ConfigInvalid {
        path: path.display().to_string(),
        message: e.to_string(),
    })?;
    std::fs::write(&path, raw).map_err(|e| Error::io(&path, e))
}

/// The dual-asset figure registry (P96 / D-7): for each NON-tikz figure, the
/// included RENDER (the asset embedded in the document) paired with its editable
/// SOURCE (the .ipe/.svg an external diagram editor opens). The "edit this
/// figure" action resolves a render to its tracked source through this registry
/// and launches the diagram-tool editor on the SOURCE, never the render.
///
/// Held on the HOST FILESYSTEM under `$XDG_STATE_HOME/pandoc-preview/
/// figure-registry.json` (the session.json/fold-state.json read-/save-state
/// pattern), NOT browser storage, so the source↔render pairing survives an app
/// restart. The on-disk JSON maps each absolute render path to its absolute
/// source path. A parse error is LOUD; a missing file is a legitimate first-run
/// empty registry.
pub type FigureRegistry = HashMap<String, String>;

fn figure_registry_path() -> Result<PathBuf> {
    // dirs::state_dir honors $XDG_STATE_HOME on Linux, matching the hermetic
    // XDG_STATE_HOME the proof harness launches the app with — the same place
    // session.json lives, the place a restarted app reads.
    let base = dirs::state_dir().ok_or_else(|| {
        Error::InvalidArgument("no XDG state directory could be determined".into())
    })?;
    Ok(base.join("pandoc-preview").join("figure-registry.json"))
}

/// Read the dual-asset figure registry, or an empty map on a clean first run (no
/// file). IO/parse errors fail loud.
#[tauri::command]
pub fn read_figure_registry() -> Result<FigureRegistry> {
    let path = figure_registry_path()?;
    if !path.is_file() {
        return Ok(HashMap::new());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| Error::io(&path, e))?;
    serde_json::from_str(&raw).map_err(|e| Error::ConfigInvalid {
        path: path.display().to_string(),
        message: e.to_string(),
    })
}

/// Persist the dual-asset figure registry so a relaunched app resolves the SAME
/// render to the SAME editable source. Mirrors session-state/fold-state
/// persistence.
#[tauri::command]
pub fn save_figure_registry(registry: FigureRegistry) -> Result<()> {
    let path = figure_registry_path()?;
    let parent = path
        .parent()
        .expect("figure-registry path always has a parent");
    std::fs::create_dir_all(parent).map_err(|e| Error::io(parent, e))?;
    let raw = serde_json::to_string_pretty(&registry).map_err(|e| Error::ConfigInvalid {
        path: path.display().to_string(),
        message: e.to_string(),
    })?;
    std::fs::write(&path, raw).map_err(|e| Error::io(&path, e))
}
