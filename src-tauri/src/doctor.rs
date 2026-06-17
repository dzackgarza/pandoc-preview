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

use std::path::Path;

use crate::config::{self, Config};

/// Stable check names. These are part of the doctor contract; the report and
/// every consumer key off them.
pub const CHECK_CONFIG_EXISTS: &str = "config-exists";
pub const CHECK_CONFIG_SCHEMA: &str = "config-schema";
pub const CHECK_CONFIG_VALUES: &str = "config-values";

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
    /// Check name. Core checks use the stable `CHECK_*` constants; plugin checks
    /// contribute dynamic names (`plugin-config:<id>` and their declared check
    /// ids), so this is an owned String.
    pub name: String,
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

fn check_config_exists(path: &Path) -> CheckResult {
    if path.is_file() {
        CheckResult {
            name: CHECK_CONFIG_EXISTS.into(),
            status: Status::Ok,
            detail: format!("config present at {}", path.display()),
        }
    } else {
        CheckResult {
            name: CHECK_CONFIG_EXISTS.into(),
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
                    name: CHECK_CONFIG_SCHEMA.into(),
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
                name: CHECK_CONFIG_SCHEMA.into(),
                status: Status::Ok,
                detail: "config parses under the current schema".into(),
            },
            Some(cfg),
        ),
        Err(e) => (
            CheckResult {
                name: CHECK_CONFIG_SCHEMA.into(),
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
            name: CHECK_CONFIG_VALUES.into(),
            status: Status::Ok,
            detail: format!(
                "font_size={}, debounce_ms={}",
                cfg.editor.font_size, cfg.preview.debounce_ms
            ),
        },
        Err(e) => CheckResult {
            name: CHECK_CONFIG_VALUES.into(),
            status: Status::Fail,
            detail: e.to_string(),
        },
    }
}


fn skip(name: &'static str, reason: &str) -> CheckResult {
    CheckResult {
        name: name.into(),
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
                name: CHECK_CONFIG_EXISTS.into(),
                status: Status::Fail,
                detail: e.to_string(),
            });
            for name in [CHECK_CONFIG_SCHEMA, CHECK_CONFIG_VALUES] {
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

    // The renderer-specific checks (pandoc-executable, pandoc-invocation) and the
    // export targets are no longer core: they are contributed by the active
    // renderer plugin and the export-category plugins respectively, aggregated
    // with every other plugin's checks below (doctor-contract.md ownership note).
    // The core battery keeps only renderer-agnostic, export-agnostic checks.

    // Plugin firewall (Milestone A): when the config is valid and declares a
    // [plugins] dir, discover plugins and aggregate each plugin's config-schema
    // check (`plugin-config:<id>`) plus its contributed doctor checks into the
    // one battery, in plugin (sorted) order. The core holds no plugin specifics —
    // every row is produced by the plugins themselves (doctor-contract.md).
    if let Some(cfg) = &cfg {
        if let Some(plugins_cfg) = &cfg.plugins {
            let config_dir = path.parent().expect("config path always has a parent");
            match crate::plugins::discover(Path::new(&plugins_cfg.dir)) {
                Ok(found) => {
                    for plugin in &found {
                        let section = cfg.plugin.get(&plugin.manifest.id);
                        for row in crate::plugins::plugin_check_rows(plugin, section, config_dir) {
                            checks.push(CheckResult {
                                name: row.name,
                                status: if row.ok { Status::Ok } else { Status::Fail },
                                detail: row.detail,
                            });
                        }
                    }
                }
                Err(e) => checks.push(CheckResult {
                    name: "plugins".into(),
                    status: Status::Fail,
                    detail: format!("plugin discovery failed: {e}"),
                }),
            }
        }
    }

    Report { checks }
}
