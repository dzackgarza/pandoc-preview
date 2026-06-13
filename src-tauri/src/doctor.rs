//! The doctor check battery: the single ordered, named, structured diagnostic
//! used by three consumers (the `--doctor` report, the startup gate, and the
//! `just run` launcher). Each check has a stable name (part of the contract),
//! a status, and a human-readable detail string.
//!
//! The battery is staged: a config-class failure (the file is absent, has a
//! stale key, or violates the value invariants) makes the downstream checks
//! that need a parsed config impossible to run, so they are reported SKIP
//! (not FAIL) — a skip is a consequence, never a masquerading pass or an
//! independent failure. The distinguishing failure the report attributes is
//! the first check that actually failed.
//!
//! No fallbacks, no defaults: every check either proves its obligation against
//! the real environment or reports FAIL with the concrete diagnostic.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::config::{self, Config};

/// Stable check names. These are part of the doctor contract; the report and
/// every consumer key off them.
pub const CHECK_CONFIG_EXISTS: &str = "config-exists";
pub const CHECK_CONFIG_SCHEMA: &str = "config-schema";
pub const CHECK_CONFIG_VALUES: &str = "config-values";
pub const CHECK_PANDOC_EXECUTABLE: &str = "pandoc-executable";
pub const CHECK_PANDOC_INVOCATION: &str = "pandoc-invocation";
pub const CHECK_EXPORT_PLUGINS: &str = "export-plugins";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Ok,
    Fail,
    /// A check that could not run because an upstream check failed. Reported
    /// distinctly so it is never confused with OK (a pass) or FAIL (an
    /// independent failure).
    Skip,
}

impl Status {
    fn marker(self) -> &'static str {
        match self {
            Status::Ok => "OK",
            Status::Fail => "FAIL",
            Status::Skip => "SKIP",
        }
    }
}

#[derive(Debug, Clone)]
pub struct CheckResult {
    pub name: &'static str,
    pub status: Status,
    pub detail: String,
}

#[derive(Debug)]
pub struct Report {
    pub checks: Vec<CheckResult>,
}

impl Report {
    /// True iff every check passed (none FAIL, none SKIP).
    pub fn all_ok(&self) -> bool {
        self.checks.iter().all(|c| c.status == Status::Ok)
    }

    /// Human-readable report: one line per check, name + status marker +
    /// detail, in contract order.
    pub fn render(&self) -> String {
        let mut out = String::from("pandoc-preview doctor\n");
        for c in &self.checks {
            out.push_str(&format!(
                "[{}] {}: {}\n",
                c.status.marker(),
                c.name,
                c.detail
            ));
        }
        let summary = if self.all_ok() {
            "all checks passed"
        } else {
            "one or more checks failed"
        };
        out.push_str(&format!("--\n{summary}\n"));
        out
    }
}

/// Resolve a pandoc path the same way `Command::new` will: an absolute or
/// relative path with a separator is used verbatim; a bare name is searched on
/// PATH. Returns the concrete file that would be executed, or None.
fn resolve_program(program: &str) -> Option<PathBuf> {
    let p = Path::new(program);
    if p.components().count() > 1 || p.is_absolute() {
        return if p.exists() {
            Some(p.to_path_buf())
        } else {
            None
        };
    }
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(program);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    match std::fs::metadata(path) {
        Ok(meta) => meta.is_file() && (meta.permissions().mode() & 0o111) != 0,
        Err(_) => false,
    }
}

fn check_config_exists(path: &Path) -> CheckResult {
    if path.is_file() {
        CheckResult {
            name: CHECK_CONFIG_EXISTS,
            status: Status::Ok,
            detail: format!("config present at {}", path.display()),
        }
    } else {
        CheckResult {
            name: CHECK_CONFIG_EXISTS,
            status: Status::Fail,
            detail: format!("no config file at {}", path.display()),
        }
    }
}

/// Parse the config with deny_unknown_fields (catches stale keys). Returns the
/// schema check result and, on success, the parsed config for downstream
/// checks.
fn check_config_schema(path: &Path) -> (CheckResult, Option<Config>) {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(e) => {
            return (
                CheckResult {
                    name: CHECK_CONFIG_SCHEMA,
                    status: Status::Fail,
                    detail: format!("could not read {}: {e}", path.display()),
                },
                None,
            );
        }
    };
    match toml::from_str::<Config>(&raw) {
        Ok(cfg) => (
            CheckResult {
                name: CHECK_CONFIG_SCHEMA,
                status: Status::Ok,
                detail: "config parses under the current schema".into(),
            },
            Some(cfg),
        ),
        Err(e) => (
            CheckResult {
                name: CHECK_CONFIG_SCHEMA,
                status: Status::Fail,
                detail: format!("schema rejected {}: {e}", path.display()),
            },
            None,
        ),
    }
}

fn check_config_values(cfg: &Config) -> CheckResult {
    match config::validate(cfg) {
        Ok(()) => CheckResult {
            name: CHECK_CONFIG_VALUES,
            status: Status::Ok,
            detail: format!(
                "font_size={}, debounce_ms={}, pandoc/from_format non-empty",
                cfg.editor.font_size, cfg.preview.debounce_ms
            ),
        },
        Err(e) => CheckResult {
            name: CHECK_CONFIG_VALUES,
            status: Status::Fail,
            detail: e.to_string(),
        },
    }
}

/// Resolve pandoc, confirm it is an executable file, and run `pandoc --version`
/// (must exit 0). Captures the real version banner on success. Returns the
/// check and whether the binary is usable for the downstream invocation probe.
fn check_pandoc_executable(cfg: &Config) -> (CheckResult, bool) {
    let resolved = match resolve_program(&cfg.pandoc.path) {
        Some(p) => p,
        None => {
            return (
                CheckResult {
                    name: CHECK_PANDOC_EXECUTABLE,
                    status: Status::Fail,
                    detail: format!(
                        "pandoc path {:?} does not resolve to a file",
                        cfg.pandoc.path
                    ),
                },
                false,
            );
        }
    };
    if !is_executable(&resolved) {
        return (
            CheckResult {
                name: CHECK_PANDOC_EXECUTABLE,
                status: Status::Fail,
                detail: format!("{} is not executable", resolved.display()),
            },
            false,
        );
    }
    match Command::new(&cfg.pandoc.path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(out) if out.status.success() => {
            let banner = String::from_utf8_lossy(&out.stdout);
            let version_line = banner.lines().next().unwrap_or("").trim().to_string();
            (
                CheckResult {
                    name: CHECK_PANDOC_EXECUTABLE,
                    status: Status::Ok,
                    detail: version_line,
                },
                true,
            )
        }
        Ok(out) => (
            CheckResult {
                name: CHECK_PANDOC_EXECUTABLE,
                status: Status::Fail,
                detail: format!("`pandoc --version` exited {}", out.status),
            },
            false,
        ),
        Err(e) => (
            CheckResult {
                name: CHECK_PANDOC_EXECUTABLE,
                status: Status::Fail,
                detail: format!("could not spawn {:?}: {e}", cfg.pandoc.path),
            },
            false,
        ),
    }
}

/// Probe render with the FULL configured arg set (`--from <from_format>` +
/// extra_args, empty stdin) to prove the whole invocation contract, not just
/// that the binary exists.
fn check_pandoc_invocation(cfg: &Config) -> CheckResult {
    let mut args: Vec<String> = vec![
        "--from".into(),
        cfg.pandoc.from_format.clone(),
        "--to".into(),
        "html5".into(),
    ];
    args.extend(cfg.pandoc.extra_args.iter().cloned());

    match Command::new(&cfg.pandoc.path)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(out) if out.status.success() => CheckResult {
            name: CHECK_PANDOC_INVOCATION,
            status: Status::Ok,
            detail: format!(
                "pandoc --from {} (+{} extra args) exited 0",
                cfg.pandoc.from_format,
                cfg.pandoc.extra_args.len()
            ),
        },
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            CheckResult {
                name: CHECK_PANDOC_INVOCATION,
                status: Status::Fail,
                detail: format!("invocation exited {}: {}", out.status, stderr.trim()),
            }
        }
        Err(e) => CheckResult {
            name: CHECK_PANDOC_INVOCATION,
            status: Status::Fail,
            detail: format!("could not spawn {:?}: {e}", cfg.pandoc.path),
        },
    }
}

/// Every configured `[export.<id>]` plugin must be well-formed (the same
/// invariants the save path enforces, via `config::validate_export_plugin`) and
/// its argv[0] must resolve to an executable file. No full probe run is
/// performed — that would compile real documents; this honest limit is part of
/// the contract (doctor-contract.md, export-plugins-contract.md). Supersedes the
/// old `pdf-engine` check, which asserted lualatex on PATH while the export
/// command never passed `--pdf-engine` and ran pandoc's implicit pdflatex.
fn check_export_plugins(cfg: &Config) -> CheckResult {
    if cfg.export.is_empty() {
        return CheckResult {
            name: CHECK_EXPORT_PLUGINS,
            status: Status::Fail,
            detail: "no [export.<id>] plugins configured".into(),
        };
    }
    for (id, plugin) in &cfg.export {
        if let Err(e) = config::validate_export_plugin(id, plugin) {
            return CheckResult {
                name: CHECK_EXPORT_PLUGINS,
                status: Status::Fail,
                detail: e.to_string(),
            };
        }
        // argv[0] is the program; validate_export_plugin guarantees it exists.
        let program = &plugin.command[0];
        match resolve_program(program) {
            Some(p) if is_executable(&p) => {}
            Some(p) => {
                return CheckResult {
                    name: CHECK_EXPORT_PLUGINS,
                    status: Status::Fail,
                    detail: format!("export.{id}: {} is not executable", p.display()),
                };
            }
            None => {
                return CheckResult {
                    name: CHECK_EXPORT_PLUGINS,
                    status: Status::Fail,
                    detail: format!("export.{id}: program {program:?} does not resolve to a file"),
                };
            }
        }
    }
    CheckResult {
        name: CHECK_EXPORT_PLUGINS,
        status: Status::Ok,
        detail: format!("{} export plugin(s) well-formed", cfg.export.len()),
    }
}

fn skip(name: &'static str, reason: &str) -> CheckResult {
    CheckResult {
        name,
        status: Status::Skip,
        detail: reason.into(),
    }
}

/// Run the full ordered check battery against the current environment.
pub fn run() -> Report {
    let mut checks: Vec<CheckResult> = Vec::with_capacity(6);

    let path = match config::config_path() {
        Ok(p) => p,
        Err(e) => {
            // No XDG config dir at all: every check is undeterminable. Fail the
            // config-exists check loudly and skip the rest.
            checks.push(CheckResult {
                name: CHECK_CONFIG_EXISTS,
                status: Status::Fail,
                detail: e.to_string(),
            });
            for name in [
                CHECK_CONFIG_SCHEMA,
                CHECK_CONFIG_VALUES,
                CHECK_PANDOC_EXECUTABLE,
                CHECK_PANDOC_INVOCATION,
                CHECK_EXPORT_PLUGINS,
            ] {
                checks.push(skip(name, "config path could not be determined"));
            }
            return Report { checks };
        }
    };

    let exists = check_config_exists(&path);
    let exists_ok = exists.status == Status::Ok;
    checks.push(exists);

    let cfg = if exists_ok {
        let (schema, parsed) = check_config_schema(&path);
        checks.push(schema);
        parsed
    } else {
        checks.push(skip(CHECK_CONFIG_SCHEMA, "config file does not exist"));
        None
    };

    let cfg = match cfg {
        Some(cfg) => {
            checks.push(check_config_values(&cfg));
            if config::validate(&cfg).is_ok() {
                Some(cfg)
            } else {
                None
            }
        }
        None => {
            checks.push(skip(CHECK_CONFIG_VALUES, "config did not parse"));
            None
        }
    };

    match &cfg {
        Some(cfg) => {
            let (exe, usable) = check_pandoc_executable(cfg);
            checks.push(exe);
            if usable {
                checks.push(check_pandoc_invocation(cfg));
            } else {
                checks.push(skip(CHECK_PANDOC_INVOCATION, "pandoc binary is not usable"));
            }
        }
        None => {
            checks.push(skip(
                CHECK_PANDOC_EXECUTABLE,
                "config is invalid; cannot resolve pandoc",
            ));
            checks.push(skip(
                CHECK_PANDOC_INVOCATION,
                "config is invalid; cannot probe invocation",
            ));
        }
    }

    // export-plugins needs the parsed, valid config to enumerate the entries.
    match &cfg {
        Some(cfg) => checks.push(check_export_plugins(cfg)),
        None => checks.push(skip(
            CHECK_EXPORT_PLUGINS,
            "config is invalid; cannot enumerate export plugins",
        )),
    }

    Report { checks }
}
