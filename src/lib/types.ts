// Mirrors the Rust structs in src-tauri/src/config.rs, fsops.rs, render.rs.

export interface Config {
  general: {
    theme: "dark" | "light";
  };
  editor: {
    font_size: number;
    line_wrapping: boolean;
    line_numbers: boolean;
  };
  preview: {
    debounce_ms: number;
  };
  // Export targets are config-owned plugins: each entry is a complete
  // compilation command (export-plugins-contract.md). Keyed by plugin id;
  // insertion order (preserved from the TOML) is the menu order.
  export: Record<string, ExportPlugin>;
  // Plugin firewall + active renderer (Milestone A/B). Optional; absent when the
  // config declares no plugins/renderer. The UI does not edit these (they round-
  // trip verbatim through save), so per-plugin config is left opaque.
  plugins?: { dir: string };
  renderer?: { active: string };
  plugin?: Record<string, Record<string, unknown>>;
}

export interface ExportPlugin {
  label: string;
  extension: string;
  command: string[];
}

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileNode[] | null;
}

export interface RenderResult {
  ok: boolean;
  html: string;
  log: string;
}

export interface ExportResult {
  ok: boolean;
  log: string;
}

/** Structured result of running a generic plugin by id (Milestone A). Mirrors
 * the Rust `plugins::PluginResult`. */
export interface PluginResult {
  success: boolean;
  artifact: string | null;
  exit_code: number | null;
  stdout: string;
  stderr: string;
}

// idle:      no compilation has run yet
// stale:     the source changed; the shown preview no longer matches it and a
//            re-render is pending (debouncing) or in flight for older content
// rendering: pandoc is actively recompiling the preview right now
// ok:        the preview is up to date with the source
// error:     the last compile failed (see the log)
export type RenderStatus = "idle" | "stale" | "rendering" | "ok" | "error";

/** A collapsed fold range (character offsets). Mirrors the Rust `Fold` in
 * config.rs; persisted per file in fold-state.json. */
export interface Fold {
  from: number;
  to: number;
}

/** file path -> its collapsed fold ranges. */
export type FoldState = Record<string, Fold[]>;
