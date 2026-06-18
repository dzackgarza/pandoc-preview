import { invoke } from "@tauri-apps/api/core";
import type {
  Config,
  FileNode,
  FileRead,
  Fingerprint,
  FoldState,
  PluginInfo,
  PluginResult,
  RenderResult,
  RepoState,
  SessionState,
} from "./types";

export const getConfig = () => invoke<Config>("get_config");
export const saveConfig = (config: Config) => invoke<void>("save_config", { config });
export const getConfigPath = () => invoke<string>("get_config_path");

// Per-file collapsed fold ranges, persisted in fold-state.json (XDG config dir).
export const readFoldState = () => invoke<FoldState>("read_fold_state");
export const saveFoldState = (state: FoldState) =>
  invoke<void>("save_fold_state", { state });

// Capture the live (possibly unsaved) buffer into the host-filesystem recovery
// store (P45). The backend commits the buffer as a blob into a per-session git
// repo under the XDG data dir; recovery is independent of Save, and the buffer
// is NEVER written to browser storage. `sessionId` is a stable id for the open
// document; `path` is recorded so the store identifies what each session held.
export const recoveryAutosave = (sessionId: string, path: string, buffer: string) =>
  invoke<void>("recovery_autosave", { sessionId, path, buffer });

// Last-session state (P49), persisted on the host fs under
// $XDG_STATE_HOME/pandoc-preview/session.json. Written on open/save so the next
// launch reopens the last file; read on launch. Returns null on a clean first
// run. The unsaved buffer itself lives in the recovery store, NOT here.
export const readSessionState = () => invoke<SessionState | null>("read_session_state");
export const saveSessionState = (state: SessionState) =>
  invoke<void>("save_session_state", { state });

// The session's last-captured recovery buffer: the bytes under the recovery
// store's HEAD `buffer` blob for `sessionId` (P49). null when that session has
// no recovery repo/commit. On launch the app compares this against the on-disk
// file to decide whether to offer a restore.
export const recoveryHeadBuffer = (sessionId: string) =>
  invoke<string | null>("recovery_head_buffer", { sessionId });

// Repo-state machine (P46). The real git state of the open file is read from
// the on-disk repository via libgit2 in the backend; `repoInit`/`repoTrack`
// mutate that real state (init a repo / stage the file), after which the
// frontend re-queries `repoStateFor` so the indicator reflects disk, never a
// UI guess.
export const repoStateFor = (path: string) =>
  invoke<RepoState>("repo_state_for", { path });
export const repoInit = (dir: string) => invoke<void>("repo_init", { dir });
export const repoTrack = (path: string) => invoke<void>("repo_track", { path });

// P62: read the system clipboard's image, PNG-encode it, and write it as a real
// file named `filename` into the CONFIGURED global figures directory
// (config.directories.figures). Returns the absolute path of the written file.
// The caller supplies the bare filename so it can insert the markdown image
// reference at the cursor BEFORE awaiting this write, guaranteeing the reference
// and the on-disk file name the SAME path. Fails loudly (no clipboard image / no
// figures dir / non-bare filename) — never a project-local fallback.
export const pasteClipboardImage = (filename: string) =>
  invoke<string>("paste_clipboard_image", { filename });

// P62 (E2E proof harness only): seed a deterministic width×height image onto the
// REAL system clipboard in one IPC, so the paste-image action can read it back.
// The write-image permission this needs is granted only in the e2e build.
export const seedClipboardImage = (width: number, height: number) =>
  invoke<void>("seed_clipboard_image", { width, height });

export const listTree = (root: string) => invoke<FileNode[]>("list_tree", { root });

// Read a file's text together with the fingerprint of its on-disk state (P48).
// The frontend stores the fingerprint at open so a later save can detect an
// external modification.
export const readTextFile = (path: string) => invoke<FileRead>("read_text_file", { path });

// Write unconditionally and return the post-write fingerprint. Used for Save As
// (new target, nothing to conflict with) and the explicit force-overwrite that
// resolves a conflict (the user chose their buffer wins).
export const writeTextFile = (path: string, content: string) =>
  invoke<Fingerprint>("write_text_file", { path, content });

// Guarded write (P48): writes ONLY IF the file still matches `expected` (the
// fingerprint captured at open / last save). If the file changed underneath,
// the backend refuses with a conflict error (CONFLICT_PREFIX) and leaves the
// external content intact. Returns the post-write fingerprint on success.
export const writeTextFileChecked = (
  path: string,
  content: string,
  expected: Fingerprint,
) => invoke<Fingerprint>("write_text_file_checked", { path, content, expected });
export const createFile = (path: string) => invoke<void>("create_file", { path });
export const createDir = (path: string) => invoke<void>("create_dir", { path });
export const renamePath = (from: string, to: string) =>
  invoke<void>("rename_path", { from, to });
export const deletePath = (path: string) => invoke<void>("delete_path", { path });

export const renderPreview = (
  source: string,
  baseDir: string,
  baseUrl: string,
  mathjaxUrl: string,
) => invoke<RenderResult>("render_preview", { source, baseDir, baseUrl, mathjaxUrl });

/** Run a discovered plugin by id against the real open buffer (Milestone A). */
export const runPlugin = (
  pluginId: string,
  sourcePath: string,
  outputPath: string,
  buffer: string,
) => invoke<PluginResult>("run_plugin", { pluginId, sourcePath, outputPath, buffer });

/**
 * Spawn a plugin's self-owned configure command (Milestone C). Plugins own their
 * configuration entirely; this merely launches the plugin's [configure] command
 * (detached — it brings its own UI, e.g. a kitty popup running gum).
 */
export const configurePlugin = (pluginId: string) =>
  invoke<void>("configure_plugin", { pluginId });

/**
 * List every discovered plugin's identity ({id, name, category, extension}) from
 * the configured plugins dir. The category-aware menu/command-palette populator
 * filters these by category (e.g. "export") and reads the declared extension —
 * sourced from the discovered manifest, never an app-core config table (P66).
 */
export const listPlugins = () => invoke<PluginInfo[]>("list_plugins");
