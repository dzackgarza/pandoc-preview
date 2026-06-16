import { invoke } from "@tauri-apps/api/core";
import type {
  Config,
  ExportResult,
  FileNode,
  FoldState,
  PluginResult,
  RenderResult,
} from "./types";

export const getConfig = () => invoke<Config>("get_config");
export const saveConfig = (config: Config) => invoke<void>("save_config", { config });
export const getConfigPath = () => invoke<string>("get_config_path");

// Per-file collapsed fold ranges, persisted in fold-state.json (XDG config dir).
export const readFoldState = () => invoke<FoldState>("read_fold_state");
export const saveFoldState = (state: FoldState) =>
  invoke<void>("save_fold_state", { state });

export const listTree = (root: string) => invoke<FileNode[]>("list_tree", { root });
export const readTextFile = (path: string) => invoke<string>("read_text_file", { path });
export const writeTextFile = (path: string, content: string) =>
  invoke<void>("write_text_file", { path, content });
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
export const exportDocument = (pluginId: string, sourcePath: string, outputPath: string) =>
  invoke<ExportResult>("export_document", { pluginId, sourcePath, outputPath });

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
