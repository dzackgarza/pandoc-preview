//! Generic plugin firewall (Milestone A). The app core knows plugins
//! generically and holds zero plugin specifics: it discovers plugins from a
//! configured plugins directory, validates each plugin's `[plugin.<id>]` config
//! section against the plugin's own declared JSON Schema by ONE generic code
//! path, runs a plugin by id against the real buffer (returning a structured
//! result), and contributes each plugin's declared doctor checks to the single
//! diagnostic battery.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};

use crate::config;
use crate::error::{Error, Result};

/// Placeholders substituted per-argument in a plugin's exec/doctor-check argv.
/// `{plugin_dir}`/`{config_dir}` resolve for every invocation; `{file}`/`{artifact}`
/// resolve only for a tools-plugin run; `{base_dir}`/`{base_url}`/`{mathjax}` resolve
/// only for a renderer-plugin render (the render context the core supplies).
const PH_PLUGIN_DIR: &str = "{plugin_dir}";
const PH_CONFIG_DIR: &str = "{config_dir}";
const PH_FILE: &str = "{file}";
const PH_ARTIFACT: &str = "{artifact}";
/// F2 / P108 — the app-substituted per-run build directory. Sourced from the ONE
/// canonical token in `config` (OSOT). A plugin whose driver scatters
/// intermediates references `{builddir}` and routes them there with its OWN
/// native output-directing flag; the app core supplies only the path, staying
/// build-engine-agnostic.
const PH_BUILDDIR: &str = config::PLACEHOLDER_BUILDDIR;
const PH_BASE_DIR: &str = "{base_dir}";
const PH_BASE_URL: &str = "{base_url}";
const PH_MATHJAX: &str = "{mathjax}";
const PH_BIBLIOGRAPHY: &str = "{bibliography}";
const PH_CSL: &str = "{csl}";
/// The user-SELECTED template the renderer wraps the buffer in (the open file's
/// render target template, chosen from discovery; default = the renderer's shipped
/// template). Forwarded as render context — the user's selection, NOT app-owned
/// config injected as a source of truth (unlike the removed `[figures]` palette).
const PH_TEMPLATE: &str = "{template}";

/// Environment variable carrying the active plugin's `[plugin.<id>]` config as
/// JSON, so a renderer/check script can read its own config (e.g. the pandoc
/// renderer's `from_format`). Set for renderer runs and doctor-check runs.
const ENV_PLUGIN_CONFIG: &str = "PPE_PLUGIN_CONFIG";

/// A plugin manifest (`plugin.toml`). The Milestone A plugin contract. Every
/// field is required: `deny_unknown_fields` + no `#[serde(default)]` means a
/// manifest missing any of these fails to parse loudly. `name`/`description`/
/// `category` are contract fields consumed by later Milestone A work (the
/// category-driven menu); they are enforced-by-presence now and not yet read,
/// hence the targeted allow.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
#[allow(dead_code)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub kind: String,
    /// The output file extension an export-category plugin writes (e.g. "wexp").
    /// A GENERIC manifest field read by the menu/command-palette populator
    /// (export-as-plugin migration ruling 4, 2026-06-17). Present only on
    /// export-category plugins; serde maps a missing `extension` to `None`
    /// without a container default.
    pub extension: Option<String>,
    pub exec: Exec,
    /// The plugin's self-owned configuration command (`[configure]` table; user
    /// ruling 2026-06-14). Plugins own configuration entirely: the app's
    /// "Configure <name>" action merely SPAWNS this command (detached, no TTY
    /// handling) so the plugin brings its own config UI. Required — a manifest
    /// without `[configure]` fails to parse loudly at discovery, like every other
    /// required field.
    pub configure: Exec,
    /// Path (relative to the plugin dir) of the JSON Schema for this plugin's
    /// `[plugin.<id>]` config section.
    pub config_schema: String,
    /// Input file types this plugin renders, e.g. `["markdown"]`, `["tikz"]`,
    /// `["markdown", "latex"]`. The app builds the (input type → render target)
    /// matrix from discovery: a plugin is a candidate render/export target for an
    /// open file ONLY if its `inputs` contains that file's type. Empty for
    /// non-render plugins (lint, search, configure-only) — a legitimate state, not
    /// a default value.
    #[serde(default)]
    pub inputs: Vec<String>,
    /// The template BASENAME this renderer/export wraps the buffer in by default
    /// (e.g. `pandoc_preview_template.html`), resolved against the templates dir by
    /// the plugin's own command. The render-target selector lets the user pick
    /// another compatible template; this is the default forwarded as `{template}`
    /// when nothing is selected. `None` for plugins that take no template.
    #[serde(default)]
    pub default_template: Option<String>,
    /// Doctor checks this plugin contributes to the battery. May be empty.
    #[serde(default)]
    pub doctor_checks: Vec<DoctorCheck>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Exec {
    /// argv to spawn, with per-element placeholder substitution. The real buffer
    /// is delivered on stdin.
    pub command: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DoctorCheck {
    pub id: String,
    pub description: String,
    /// Command whose exit status is the check: exit 0 → OK, nonzero → FAIL.
    pub command: Vec<String>,
}

/// A discovered plugin: its manifest, its directory on disk, and its loaded
/// (parsed) config schema.
pub struct Plugin {
    pub manifest: PluginManifest,
    pub dir: PathBuf,
    pub schema: serde_json::Value,
}

/// Structured result of running a plugin. Serialized to the webview as
/// `{success, artifact, exit_code, stdout, stderr}` — no `{ok}` shorthand.
#[derive(Debug, Serialize)]
pub struct PluginResult {
    pub success: bool,
    /// The artifact path the plugin was asked to write, present on success.
    pub artifact: Option<String>,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

/// A discovered plugin's identity surfaced to the webview so a category-driven
/// menu/command-palette populator can build entries (e.g. an "Export: <name>"
/// entry carrying the plugin's declared output `extension`). Sourced ONLY from
/// the discovered manifest, never from an app-core config table.
#[derive(Debug, Serialize)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub category: String,
    pub extension: Option<String>,
    /// Input file types this plugin renders (from the manifest `inputs`). The
    /// webview builds the (open file type → candidate render targets) matrix from
    /// this across all discovered plugins.
    pub inputs: Vec<String>,
    /// The default template basename this target wraps the buffer in (manifest
    /// `default_template`); the selector forwards it as `{template}` unless the
    /// user picks another. `None` for plugins that take no template.
    pub default_template: Option<String>,
}

/// One doctor-battery row contributed by a plugin (the config-schema check or a
/// declared doctor check). The doctor maps this onto its CheckResult.
pub struct PluginCheckRow {
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

/// Discover every plugin under `plugins_dir`: each immediate subdirectory that
/// contains a `plugin.toml` is a plugin. Returns them in a stable (sorted)
/// order. A configured-but-missing plugins dir is a loud error.
pub fn discover(plugins_dir: &Path) -> Result<Vec<Plugin>> {
    if !plugins_dir.is_dir() {
        return Err(Error::InvalidArgument(format!(
            "plugins dir {} is not a directory",
            plugins_dir.display()
        )));
    }
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(plugins_dir)
        .map_err(|e| Error::io(plugins_dir, e))?
        .map(|entry| entry.map(|e| e.path()))
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| Error::io(plugins_dir, e))?;
    dirs.sort();

    let mut plugins = Vec::new();
    for dir in dirs {
        if !dir.is_dir() {
            continue;
        }
        let manifest_path = dir.join("plugin.toml");
        if !manifest_path.is_file() {
            continue;
        }
        let raw =
            std::fs::read_to_string(&manifest_path).map_err(|e| Error::io(&manifest_path, e))?;
        let manifest: PluginManifest = toml::from_str(&raw).map_err(|e| Error::ConfigInvalid {
            path: manifest_path.display().to_string(),
            message: e.to_string(),
        })?;
        // Only command-kind plugins exist today; an unknown kind is a loud error,
        // never a silently-ignored manifest.
        if manifest.kind != "command" {
            return Err(Error::ConfigInvalid {
                path: manifest_path.display().to_string(),
                message: format!(
                    "unsupported plugin kind {:?} (only \"command\" is supported)",
                    manifest.kind
                ),
            });
        }
        let schema_path = dir.join(&manifest.config_schema);
        let schema_raw =
            std::fs::read_to_string(&schema_path).map_err(|e| Error::io(&schema_path, e))?;
        let schema: serde_json::Value =
            serde_json::from_str(&schema_raw).map_err(|e| Error::ConfigInvalid {
                path: schema_path.display().to_string(),
                message: e.to_string(),
            })?;
        plugins.push(Plugin {
            manifest,
            dir,
            schema,
        });
    }
    Ok(plugins)
}

/// Validate a plugin's `[plugin.<id>]` config section against the plugin's
/// declared JSON Schema. The SAME generic validator for every plugin — no
/// plugin-specific knowledge. An absent section is validated as an empty object
/// (so a schema's `required` keys fail loudly). The error names the plugin id
/// and the offending instance location.
pub fn validate_plugin_config(plugin: &Plugin, section: Option<&toml::Value>) -> Result<()> {
    let instance: serde_json::Value = match section {
        Some(v) => serde_json::to_value(v).map_err(|e| {
            Error::InvalidArgument(format!(
                "[plugin.{}] is not representable as JSON: {e}",
                plugin.manifest.id
            ))
        })?,
        None => serde_json::Value::Object(serde_json::Map::new()),
    };
    let validator = jsonschema::validator_for(&plugin.schema).map_err(|e| {
        Error::InvalidArgument(format!(
            "plugin {} schema {} is invalid: {e}",
            plugin.manifest.id, plugin.manifest.config_schema
        ))
    })?;
    match validator.validate(&instance) {
        Ok(()) => Ok(()),
        Err(error) => Err(Error::InvalidArgument(format!(
            "[plugin.{}] rejected: {error} (at {})",
            plugin.manifest.id,
            error.instance_path()
        ))),
    }
}

/// Substitute placeholders in one argv element. `subs` is an ordered list of
/// (placeholder, value) pairs; only the placeholders relevant to the caller are
/// supplied.
fn substitute(arg: &str, subs: &[(&str, &str)]) -> String {
    let mut s = arg.to_string();
    for (ph, val) in subs {
        s = s.replace(ph, val);
    }
    s
}

/// Serialize a plugin's `[plugin.<id>]` config section to JSON for the
/// `PPE_PLUGIN_CONFIG` env var. An absent section is the empty object.
fn config_json(section: Option<&toml::Value>) -> String {
    match section {
        Some(v) => serde_json::to_value(v)
            .map(|j| j.to_string())
            .unwrap_or_else(|_| "{}".to_string()),
        None => "{}".to_string(),
    }
}

/// Run one contributed doctor check: substitute its argv and spawn it (with the
/// plugin's config on `PPE_PLUGIN_CONFIG` so check scripts can read it). exit 0 is
/// OK, anything else (including a spawn failure) is FAIL with the diagnostic. On
/// success the detail is the command's first non-empty stdout line if any (so a
/// check like `pandoc --version` surfaces the real version), else the description.
fn run_doctor_check(
    plugin: &Plugin,
    check: &DoctorCheck,
    config_dir: &Path,
    plugin_config: &str,
) -> (bool, String) {
    let subs = [
        (PH_PLUGIN_DIR, plugin.dir.display().to_string()),
        (PH_CONFIG_DIR, config_dir.display().to_string()),
    ];
    let subs: Vec<(&str, &str)> = subs.iter().map(|(p, v)| (*p, v.as_str())).collect();
    let argv: Vec<String> = check.command.iter().map(|a| substitute(a, &subs)).collect();
    let Some((program, args)) = argv.split_first() else {
        return (false, format!("{}: empty command", check.description));
    };
    match Command::new(program)
        .args(args)
        .env(ENV_PLUGIN_CONFIG, plugin_config)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let first = stdout.lines().find(|l| !l.trim().is_empty());
            (
                true,
                first
                    .map(|l| l.trim().to_string())
                    .unwrap_or_else(|| check.description.clone()),
            )
        }
        Ok(out) => {
            // Surface the check's own diagnostic (its first non-empty stderr line)
            // so the report says WHY it failed — e.g. which required filter is
            // missing — not just an opaque exit code.
            let stderr = String::from_utf8_lossy(&out.stderr);
            let diag = stderr.lines().find(|l| !l.trim().is_empty());
            (
                false,
                match diag {
                    Some(d) => format!("{}: {} (exit {})", check.description, d.trim(), out.status),
                    None => format!("{}: command exited {}", check.description, out.status),
                },
            )
        }
        Err(e) => (
            false,
            format!("{}: could not spawn {program:?}: {e}", check.description),
        ),
    }
}

/// Build the battery rows one plugin contributes, in report order: its
/// `plugin-config:<id>` schema check first, then each declared doctor check.
pub fn plugin_check_rows(
    plugin: &Plugin,
    section: Option<&toml::Value>,
    config_dir: &Path,
) -> Vec<PluginCheckRow> {
    let mut rows = Vec::new();
    match validate_plugin_config(plugin, section) {
        Ok(()) => rows.push(PluginCheckRow {
            name: format!("plugin-config:{}", plugin.manifest.id),
            ok: true,
            detail: format!(
                "[plugin.{}] section conforms to {}",
                plugin.manifest.id, plugin.manifest.config_schema
            ),
        }),
        Err(e) => rows.push(PluginCheckRow {
            name: format!("plugin-config:{}", plugin.manifest.id),
            ok: false,
            detail: e.to_string(),
        }),
    }
    let plugin_config = config_json(section);
    for check in &plugin.manifest.doctor_checks {
        let (ok, detail) = run_doctor_check(plugin, check, config_dir, &plugin_config);
        rows.push(PluginCheckRow {
            name: check.id.clone(),
            ok,
            detail,
        });
    }
    rows
}

fn run_plugin_sync(
    plugin_id: String,
    source_path: String,
    output_path: String,
    buffer: String,
) -> Result<PluginResult> {
    let cfg = config::load()?;
    let plugins_cfg = cfg
        .plugins
        .as_ref()
        .ok_or_else(|| Error::InvalidArgument("no [plugins] directory is configured".into()))?;
    let config_path = config::config_path()?;
    let config_dir = config_path
        .parent()
        .expect("config path always has a parent")
        .to_path_buf();

    let plugins = discover(Path::new(&plugins_cfg.dir))?;
    let plugin = plugins
        .iter()
        .find(|p| p.manifest.id == plugin_id)
        .ok_or_else(|| {
            Error::InvalidArgument(format!(
                "no plugin with id {plugin_id:?} in the plugins dir"
            ))
        })?;

    let source = PathBuf::from(&source_path);
    let dir = source
        .parent()
        .ok_or_else(|| Error::InvalidArgument(format!("{source_path} has no parent directory")))?
        .to_path_buf();

    // F2 (P108) — BUILD ISOLATION via an APP-SUPPLIED build directory. A build
    // driver may scatter its intermediates unless told otherwise. The app core
    // stays build-engine-agnostic: it SUPPLIES a per-run isolated build directory
    // through the `{builddir}` placeholder (config::resolve_build_dir, a LOUD error
    // if it cannot be created — no fallback to the source tree) and substitutes it
    // into the plugin argv. The PLUGIN's own driver flag does the isolation with
    // that path; the core does NOT cwd into it and exports NO engine env var. The
    // spawn cwd stays the SOURCE file's parent (below), so the document's relative
    // resources resolve natively — only the build's intermediates are routed into
    // {builddir}.
    let build_dir = config::resolve_build_dir()?;

    let subs = [
        (PH_PLUGIN_DIR, plugin.dir.display().to_string()),
        (PH_CONFIG_DIR, config_dir.display().to_string()),
        (PH_FILE, source_path.clone()),
        (PH_ARTIFACT, output_path.clone()),
        (PH_BUILDDIR, build_dir.display().to_string()),
    ];
    let subs: Vec<(&str, &str)> = subs.iter().map(|(p, v)| (*p, v.as_str())).collect();
    let argv: Vec<String> = plugin
        .manifest
        .exec
        .command
        .iter()
        .map(|a| substitute(a, &subs))
        .collect();
    let (program, args) = argv.split_first().ok_or_else(|| {
        Error::InvalidArgument(format!("plugin {plugin_id} has an empty command"))
    })?;

    // Deliver the plugin's own `[plugin.<id>]` config section on
    // PPE_PLUGIN_CONFIG, exactly as render_active does for the renderer. An export
    // plugin reads its individually-managed raw command from here (the app core
    // owns no pandoc/export command knowledge); plugins that derive everything from
    // {file} simply ignore the env var.
    let plugin_config = config_json(cfg.plugin.get(&plugin_id));

    // Spawn with cwd = the SOURCE file's parent directory, so a build driver
    // resolves the document's relative resources natively — exactly as it would if
    // the user ran it by hand beside the source. Build isolation is the plugin's
    // concern via the substituted {builddir} (its driver routes its intermediates
    // there); the core injects NO build-engine env var.
    let mut child = Command::new(program)
        .args(args)
        .current_dir(&dir)
        .env(ENV_PLUGIN_CONFIG, plugin_config)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| Error::ProcessSpawn(program.clone(), e))?;

    // Feed the real buffer on stdin from a separate thread so a large buffer
    // cannot deadlock against the plugin filling its stdout pipe.
    let mut stdin = child.stdin.take().expect("stdin was piped");
    let writer = std::thread::spawn(move || stdin.write_all(buffer.as_bytes()));
    let output = child
        .wait_with_output()
        .map_err(|e| Error::ProcessSpawn(program.clone(), e))?;
    writer
        .join()
        .expect("stdin writer thread panicked")
        .map_err(|e| Error::ProcessSpawn(program.clone(), e))?;

    let success = output.status.success();
    Ok(PluginResult {
        success,
        artifact: if success { Some(output_path) } else { None },
        exit_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

/// Run a discovered plugin by id against the real open buffer, returning a
/// structured result. `source_path` is the real on-disk source, `buffer` the
/// current editor contents (delivered on the plugin's stdin), `output_path` the
/// artifact the plugin is asked to write.
#[tauri::command]
pub async fn run_plugin(
    plugin_id: String,
    source_path: String,
    output_path: String,
    buffer: String,
) -> Result<PluginResult> {
    tauri::async_runtime::spawn_blocking(move || {
        run_plugin_sync(plugin_id, source_path, output_path, buffer)
    })
    .await
    .expect("run_plugin task panicked")
}

/// Spawn a plugin's self-owned `[configure]` command (C1; user ruling
/// 2026-06-14). Plugins own configuration entirely: the app resolves the plugin
/// by id, substitutes `{plugin_dir}`/`{config_dir}`, delivers the plugin's own
/// `[plugin.<id>]` section on `PPE_PLUGIN_CONFIG` (so the configure UI can read
/// the current config), and SPAWNS the command DETACHED — it does not wait. The
/// command brings its own UI (the pandoc renderer opens a kitty popup running
/// gum). Fails loud only if the plugin is unknown or the command cannot spawn.
fn configure_plugin_sync(plugin_id: String) -> Result<()> {
    let cfg = config::load()?;
    let plugins_cfg = cfg
        .plugins
        .as_ref()
        .ok_or_else(|| Error::InvalidArgument("no [plugins] directory is configured".into()))?;
    let config_path = config::config_path()?;
    let config_dir = config_path
        .parent()
        .expect("config path always has a parent")
        .to_path_buf();

    let plugins = discover(Path::new(&plugins_cfg.dir))?;
    let plugin = plugins
        .iter()
        .find(|p| p.manifest.id == plugin_id)
        .ok_or_else(|| {
            Error::InvalidArgument(format!(
                "no plugin with id {plugin_id:?} in the plugins dir"
            ))
        })?;

    let plugin_dir = plugin.dir.display().to_string();
    let config_dir_s = config_dir.display().to_string();
    let subs = [
        (PH_PLUGIN_DIR, plugin_dir.as_str()),
        (PH_CONFIG_DIR, config_dir_s.as_str()),
    ];
    let argv: Vec<String> = plugin
        .manifest
        .configure
        .command
        .iter()
        .map(|a| substitute(a, &subs))
        .collect();
    let (program, args) = argv.split_first().ok_or_else(|| {
        Error::InvalidArgument(format!("plugin {plugin_id} has an empty configure command"))
    })?;

    // The plugin's own [plugin.<id>] section, so its configure UI can read the
    // current configuration (e.g. the pandoc command it is about to edit).
    let section_json = config_json(cfg.plugin.get(&plugin_id));

    // Spawn detached: the command owns its UI and the app never blocks on it.
    Command::new(program)
        .args(args)
        .current_dir(&config_dir)
        .env(ENV_PLUGIN_CONFIG, section_json)
        .spawn()
        .map_err(|e| Error::ProcessSpawn(program.clone(), e))?;
    Ok(())
}

/// Spawn the configure command of the plugin with the given id (C1). Returns once
/// the command has been spawned; it runs independently (the app does not wait).
#[tauri::command]
pub async fn configure_plugin(plugin_id: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || configure_plugin_sync(plugin_id))
        .await
        .expect("configure_plugin task panicked")
}

/// The plugin category whose member launches an external diagram editor (Ipe /
/// Inkscape) on a figure's editable source (P96 / D-7). The app core holds NO
/// diagram-tool argv: it only knows the GENERIC category name and routes the
/// figure's source into the discovered plugin's own `[exec]` command. A real
/// diagram tool's launch argv lives entirely in its plugin.toml.
const CATEGORY_DIAGRAM_TOOL: &str = "diagram-tool";

/// Launch the diagram-tool editor on a figure's editable SOURCE (P96 / D-7). The
/// "edit this figure" action resolves a render to its tracked source via the
/// dual-asset registry, then calls this with that SOURCE path. The launch is
/// configure_plugin-shaped: the app finds the single discovered `diagram-tool`
/// category plugin, substitutes the SOURCE into its `[exec]` command's `{file}`
/// (plus `{plugin_dir}`/`{config_dir}`), and SPAWNS it DETACHED — the editor owns
/// its own GUI and the app never blocks on it. The app core holds no diagram-tool
/// argv (only the generic category). A missing/empty source path, a
/// configured-but-missing plugins dir, or no discovered diagram-tool plugin is a
/// LOUD error — never a silent fall-through to launching on the render.
fn launch_diagram_tool_sync(source_path: String) -> Result<()> {
    if source_path.is_empty() {
        return Err(Error::InvalidArgument(
            "cannot launch the diagram-tool editor: the figure resolved to an empty source path"
                .into(),
        ));
    }
    let cfg = config::load()?;
    let plugins_cfg = cfg
        .plugins
        .as_ref()
        .ok_or_else(|| Error::InvalidArgument("no [plugins] directory is configured".into()))?;
    let config_path = config::config_path()?;
    let config_dir = config_path
        .parent()
        .expect("config path always has a parent")
        .to_path_buf();

    let plugins = discover(Path::new(&plugins_cfg.dir))?;
    let plugin = plugins
        .iter()
        .find(|p| p.manifest.category == CATEGORY_DIAGRAM_TOOL)
        .ok_or_else(|| {
            Error::InvalidArgument(format!(
                "no plugin in the {CATEGORY_DIAGRAM_TOOL:?} category is discoverable in the plugins dir"
            ))
        })?;

    let plugin_dir = plugin.dir.display().to_string();
    let config_dir_s = config_dir.display().to_string();
    let subs = [
        (PH_PLUGIN_DIR, plugin_dir.as_str()),
        (PH_CONFIG_DIR, config_dir_s.as_str()),
        (PH_FILE, source_path.as_str()),
    ];
    let argv: Vec<String> = plugin
        .manifest
        .exec
        .command
        .iter()
        .map(|a| substitute(a, &subs))
        .collect();
    let (program, args) = argv.split_first().ok_or_else(|| {
        Error::InvalidArgument(format!(
            "diagram-tool plugin {} has an empty command",
            plugin.manifest.id
        ))
    })?;

    let plugin_config = config_json(cfg.plugin.get(&plugin.manifest.id));
    // Spawn detached: the editor owns its UI and the app never blocks on it.
    Command::new(program)
        .args(args)
        .current_dir(&config_dir)
        .env(ENV_PLUGIN_CONFIG, plugin_config)
        .spawn()
        .map_err(|e| Error::ProcessSpawn(program.clone(), e))?;
    Ok(())
}

/// Launch the diagram-tool editor on a figure's editable source (P96 / D-7). See
/// `launch_diagram_tool_sync`. Returns once the editor has been spawned; it runs
/// independently (the app does not wait).
#[tauri::command]
pub async fn launch_diagram_tool(source_path: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || launch_diagram_tool_sync(source_path))
        .await
        .expect("launch_diagram_tool task panicked")
}

/// List every discovered plugin's identity ({id, name, category, extension}) for
/// the webview, in discover()'s stable (sorted) order. The category-aware menu/
/// command-palette populator filters these by `category` (e.g. "export") and
/// reads the plugin's declared `extension` — all sourced from the discovered
/// manifest, never from an app-core config table. A configured-but-missing
/// plugins dir is a loud error (discover() owns that). No [plugins] dir is
/// configured -> an empty list (no plugins are discoverable).
fn list_plugins_sync() -> Result<Vec<PluginInfo>> {
    let cfg = config::load()?;
    let Some(plugins_cfg) = cfg.plugins.as_ref() else {
        return Ok(Vec::new());
    };
    let plugins = discover(Path::new(&plugins_cfg.dir))?;
    Ok(plugins
        .into_iter()
        .map(|p| PluginInfo {
            id: p.manifest.id,
            name: p.manifest.name,
            category: p.manifest.category,
            extension: p.manifest.extension,
            inputs: p.manifest.inputs,
            default_template: p.manifest.default_template,
        })
        .collect())
}

/// List discovered plugins for the webview (see `list_plugins_sync`).
#[tauri::command]
pub async fn list_plugins() -> Result<Vec<PluginInfo>> {
    tauri::async_runtime::spawn_blocking(list_plugins_sync)
        .await
        .expect("list_plugins task panicked")
}

/// List the template BASENAMES available in the user's templates dir (the sibling
/// of the config-declared styles dir, e.g. `~/.pandoc/templates`). The render-target
/// selector filters these by output format (`.html` for html renderers, `.tex`/
/// `.latex` for pdf export) and forwards the chosen basename as `{template}`; the
/// plugin resolves it against the templates dir. Sorted; a missing templates dir is
/// an empty list (no templates discoverable).
fn list_templates_sync() -> Result<Vec<String>> {
    let cfg = config::load()?;
    // The templates dir is the sibling of the validated styles dir (both under the
    // pandoc config dir, e.g. ~/.pandoc/{styles,templates}).
    let styles = cfg.directories.styles.path();
    let Some(pandoc_dir) = styles.parent() else {
        return Ok(Vec::new());
    };
    let templates_dir = pandoc_dir.join("templates");
    if !templates_dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut names: Vec<String> = std::fs::read_dir(&templates_dir)
        .map_err(|e| Error::io(&templates_dir, e))?
        .filter_map(|entry| entry.ok())
        .filter(|e| e.path().is_file())
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    names.sort();
    Ok(names)
}

/// List available template basenames for the webview (see `list_templates_sync`).
#[tauri::command]
pub async fn list_templates() -> Result<Vec<String>> {
    tauri::async_runtime::spawn_blocking(list_templates_sync)
        .await
        .expect("list_templates task panicked")
}

/// The outcome of a render through the active renderer plugin. `render.rs` maps
/// this onto its public `RenderResult`.
pub struct RenderOutcome {
    pub ok: bool,
    pub html: String,
    pub log: String,
}

fn render_log(program: &str, args: &[String], output: &std::process::Output) -> String {
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

/// Render the editor buffer to preview HTML through a SPECIFIC renderer plugin,
/// named by id, wrapping the buffer in a SELECTED template. The frontend resolves
/// both from plugin discovery (the open file's input type → a candidate render
/// target, defaulting to `[renderer].active`; the user may select another target,
/// e.g. the slides renderer) and the user's template choice (default = the
/// renderer's shipped template). The renderer plugin carries ALL writer knowledge;
/// the core only forwards the render context, the selected template, and the
/// plugin's own config. An unknown renderer id is a loud error.
pub fn render_named(
    renderer_id: String,
    template: Option<String>,
    buffer: String,
    base_dir: String,
    base_url: String,
    mathjax_url: String,
) -> Result<RenderOutcome> {
    let cfg = config::load()?;
    let plugins_cfg = cfg.plugins.as_ref().ok_or_else(|| {
        Error::InvalidArgument(
            "a [renderer] is active but no [plugins] directory is configured".into(),
        )
    })?;
    let config_path = config::config_path()?;
    let config_dir = config_path
        .parent()
        .expect("config path always has a parent")
        .to_path_buf();

    let plugins = discover(Path::new(&plugins_cfg.dir))?;
    let plugin = plugins
        .iter()
        .find(|p| p.manifest.id == renderer_id)
        .ok_or_else(|| {
            Error::InvalidArgument(format!(
                "renderer {renderer_id:?} not found in the plugins dir"
            ))
        })?;

    // P84/C1: the bibliography + CSL the preview cites against are render context
    // sourced from the ONE config-declared source (config.editor.bibliography /
    // .csl), substituted in alongside {mathjax}. The renderer plugin layers them
    // onto its pandoc command; the app core holds no citation knowledge beyond
    // forwarding these config-owned paths as context.
    let plugin_dir = plugin.dir.display().to_string();
    let config_dir_s = config_dir.display().to_string();
    let bibliography = cfg.editor.bibliography.path().display().to_string();
    let csl = cfg.editor.csl.path().display().to_string();
    let mut subs: Vec<(&str, &str)> = vec![
        (PH_PLUGIN_DIR, plugin_dir.as_str()),
        (PH_CONFIG_DIR, config_dir_s.as_str()),
        (PH_BASE_DIR, base_dir.as_str()),
        (PH_BASE_URL, base_url.as_str()),
        (PH_MATHJAX, mathjax_url.as_str()),
        (PH_BIBLIOGRAPHY, bibliography.as_str()),
        (PH_CSL, csl.as_str()),
    ];
    // The user-selected template the renderer wraps the buffer in (render context,
    // forwarded — the renderer's command takes --template={template}). `None` for a
    // renderer that takes no template: its command never references {template}, so
    // the placeholder is simply absent from the substitution set (renderer-agnostic
    // escape hatch — the app core imposes no template requirement; each plugin's own
    // template-exists doctor check enforces the templates IT requires).
    if let Some(t) = template.as_deref() {
        subs.push((PH_TEMPLATE, t));
    }
    let argv: Vec<String> = plugin
        .manifest
        .exec
        .command
        .iter()
        .map(|a| substitute(a, &subs))
        .collect();
    let (program, args) = argv.split_first().ok_or_else(|| {
        Error::InvalidArgument(format!("renderer {renderer_id} has an empty command"))
    })?;

    let plugin_config = config_json(cfg.plugin.get(&renderer_id));
    let mut child = Command::new(program)
        .args(args)
        .current_dir(&base_dir)
        .env(ENV_PLUGIN_CONFIG, plugin_config)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| Error::ProcessSpawn(program.clone(), e))?;

    let mut stdin = child.stdin.take().expect("stdin was piped");
    let writer = std::thread::spawn(move || stdin.write_all(buffer.as_bytes()));
    let output = child
        .wait_with_output()
        .map_err(|e| Error::ProcessSpawn(program.clone(), e))?;
    writer
        .join()
        .expect("stdin writer thread panicked")
        .map_err(|e| Error::ProcessSpawn(program.clone(), e))?;

    let ok = output.status.success();
    Ok(RenderOutcome {
        ok,
        html: if ok {
            String::from_utf8_lossy(&output.stdout).into_owned()
        } else {
            String::new()
        },
        log: render_log(program, args, &output),
    })
}
