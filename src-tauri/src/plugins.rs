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
const PH_BASE_DIR: &str = "{base_dir}";
const PH_BASE_URL: &str = "{base_url}";
const PH_MATHJAX: &str = "{mathjax}";

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
        let raw = std::fs::read_to_string(&manifest_path).map_err(|e| Error::io(&manifest_path, e))?;
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
                first.map(|l| l.trim().to_string()).unwrap_or_else(|| check.description.clone()),
            )
        }
        Ok(out) => (
            false,
            format!("{}: command exited {}", check.description, out.status),
        ),
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
    let plugins_cfg = cfg.plugins.as_ref().ok_or_else(|| {
        Error::InvalidArgument("no [plugins] directory is configured".into())
    })?;
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
            Error::InvalidArgument(format!("no plugin with id {plugin_id:?} in the plugins dir"))
        })?;

    let source = PathBuf::from(&source_path);
    let dir = source
        .parent()
        .ok_or_else(|| Error::InvalidArgument(format!("{source_path} has no parent directory")))?
        .to_path_buf();

    let subs = [
        (PH_PLUGIN_DIR, plugin.dir.display().to_string()),
        (PH_CONFIG_DIR, config_dir.display().to_string()),
        (PH_FILE, source_path.clone()),
        (PH_ARTIFACT, output_path.clone()),
    ];
    let subs: Vec<(&str, &str)> = subs.iter().map(|(p, v)| (*p, v.as_str())).collect();
    let argv: Vec<String> = plugin
        .manifest
        .exec
        .command
        .iter()
        .map(|a| substitute(a, &subs))
        .collect();
    let (program, args) = argv
        .split_first()
        .ok_or_else(|| Error::InvalidArgument(format!("plugin {plugin_id} has an empty command")))?;

    let mut child = Command::new(program)
        .args(args)
        .current_dir(&dir)
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
            Error::InvalidArgument(format!("no plugin with id {plugin_id:?} in the plugins dir"))
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

/// Render the editor buffer to preview HTML through the ACTIVE renderer plugin.
/// The app core owns no renderer knowledge: it loads `[renderer].active`, finds
/// that renderer plugin, supplies the render context as `{base_dir}`/`{base_url}`/
/// `{mathjax}` placeholders and the plugin's own config on `PPE_PLUGIN_CONFIG`,
/// feeds the buffer on stdin, and takes stdout as the standalone HTML. A missing
/// `[renderer]` (no active renderer) or unknown renderer id is a loud error.
pub fn render_active(
    buffer: String,
    base_dir: String,
    base_url: String,
    mathjax_url: String,
) -> Result<RenderOutcome> {
    let cfg = config::load()?;
    let renderer_cfg = cfg.renderer.as_ref().ok_or_else(|| {
        Error::InvalidArgument("no [renderer] is configured (no active renderer)".into())
    })?;
    let plugins_cfg = cfg.plugins.as_ref().ok_or_else(|| {
        Error::InvalidArgument("a [renderer] is active but no [plugins] directory is configured".into())
    })?;
    let config_path = config::config_path()?;
    let config_dir = config_path
        .parent()
        .expect("config path always has a parent")
        .to_path_buf();

    let plugins = discover(Path::new(&plugins_cfg.dir))?;
    let plugin = plugins
        .iter()
        .find(|p| p.manifest.id == renderer_cfg.active)
        .ok_or_else(|| {
            Error::InvalidArgument(format!(
                "active renderer {:?} not found in the plugins dir",
                renderer_cfg.active
            ))
        })?;

    let subs = [
        (PH_PLUGIN_DIR, plugin.dir.display().to_string()),
        (PH_CONFIG_DIR, config_dir.display().to_string()),
        (PH_BASE_DIR, base_dir.clone()),
        (PH_BASE_URL, base_url),
        (PH_MATHJAX, mathjax_url),
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
        Error::InvalidArgument(format!("renderer {} has an empty command", renderer_cfg.active))
    })?;

    let plugin_config = config_json(cfg.plugin.get(&renderer_cfg.active));
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
