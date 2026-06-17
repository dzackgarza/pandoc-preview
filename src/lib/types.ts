// Mirrors the Rust structs in src-tauri/src/config.rs, fsops.rs, render.rs.

/** An absolute path that Rust's config loader has validated to be an existing
 *  directory (the `ExistingDir` newtype in config.rs). Over the wire it is a
 *  path string; the brand records that its existence was enforced at load. */
export type ExistingDir = string;

/** An absolute path that Rust's config loader has validated to be an existing
 *  file (the `ExistingFile` newtype in config.rs). Over the wire it is a path
 *  string; the brand records that its existence was enforced at load. */
export type ExistingFile = string;

export interface Config {
  general: {
    theme: "dark" | "light";
  };
  editor: {
    font_size: number;
    line_wrapping: boolean;
    line_numbers: boolean;
    // Config-owned path to a user snippet dictionary (a JSON object mapping a
    // trigger token to a CM6 snippet body). Optional: absent when no dictionary
    // is configured. When present, Rust's loader validates the path exists and is
    // a file (ExistingFile in config.rs), so the editor receives only a real
    // path; the editor reads and parses it into composable completion snippets.
    snippet_dictionary?: ExistingFile;
    // Config-owned path to a user custom spelling dictionary: a plain wordlist,
    // one word per line (the user's vim `.add` math wordlist shape). Optional:
    // absent when no custom dictionary is configured. When present, Rust's loader
    // validates the path exists and is a file (ExistingFile in config.rs), so the
    // editor receives only a real path; the editor reads it and adds every word
    // to the spellchecker so those math terms are not flagged. The base English
    // dictionary always ships as a vendored bundle asset.
    spell_dictionary?: ExistingFile;
  };
  preview: {
    debounce_ms: number;
  };
  // Alternative-explorer roots: the macros pane browses `styles`, the figures
  // pane browses `figures`. Each is an ExistingDir — Rust's config loader
  // validates the path exists and is a directory at load time (ExistingDir in
  // config.rs), failing loud otherwise, so the UI receives only real directories.
  directories: {
    styles: ExistingDir;
    figures: ExistingDir;
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

/** A discovered plugin's identity (Mirrors the Rust `plugins::PluginInfo`). The
 * category-aware menu/command-palette populator filters by `category` and reads
 * the declared output `extension` (P66) — sourced from the discovered manifest,
 * never an app-core config table. `extension` is present only on export-category
 * plugins. */
export interface PluginInfo {
  id: string;
  name: string;
  category: string;
  extension: string | null;
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

/** The last active session a prior run persisted (P49), mirroring the Rust
 *  `SessionState` in config.rs. Lives on the host fs under
 *  $XDG_STATE_HOME/pandoc-preview/session.json; on launch the app reopens
 *  `file` and locates `sessionId`'s recovery store to offer newer content. */
export interface SessionState {
  project: string;
  file: string;
  sessionId: string;
}

/** Real git state of the open file, mirroring the `RepoState` enum in
 *  src-tauri/src/repostate.rs. Maps 1:1 onto the `data-repo-state` indicator. */
export type RepoState = "noRepo" | "untracked" | "tracked";

/** Fingerprint of a file's on-disk state (content hash + mtime), mirroring the
 *  Rust `Fingerprint` in src-tauri/src/fsops.rs. Captured at open and after each
 *  successful write; a guarded save compares the stored fingerprint against the
 *  current on-disk one to detect external modification (P48). */
export interface Fingerprint {
  hash: string;
  // Decimal nanosecond mtime as a STRING: a ns mtime exceeds JS's safe-integer
  // range, so it must cross the IPC boundary as a string to round-trip exactly
  // (a number would round and false-conflict an unmodified file). Opaque to the
  // frontend — captured at open/save and passed back to the guarded write verbatim.
  mtime_ns: string;
}

/** A file's text plus the fingerprint captured at read time, mirroring the Rust
 *  `FileRead` in src-tauri/src/fsops.rs. */
export interface FileRead {
  content: string;
  fingerprint: Fingerprint;
}

/** Stable sentinel prefix on the serialized conflict-refusal error message
 *  (`Error::Conflict` in src-tauri/src/error.rs, `CONFLICT_PREFIX`). The save
 *  path matches this to tell a P48 conflict refusal apart from a generic IO
 *  failure. ONE source of truth shared with the backend constant. */
export const CONFLICT_PREFIX = "EXTERNAL_MODIFICATION_CONFLICT";
