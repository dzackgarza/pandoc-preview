import { invoke } from "@tauri-apps/api/core";
import type { Config, ExportResult, FileNode, RenderResult } from "./types";

export const getConfig = () => invoke<Config>("get_config");
export const saveConfig = (config: Config) => invoke<void>("save_config", { config });
export const getConfigPath = () => invoke<string>("get_config_path");

export const listTree = (root: string) => invoke<FileNode[]>("list_tree", { root });
export const readTextFile = (path: string) => invoke<string>("read_text_file", { path });
export const writeTextFile = (path: string, content: string) =>
  invoke<void>("write_text_file", { path, content });
export const createFile = (path: string) => invoke<void>("create_file", { path });
export const createDir = (path: string) => invoke<void>("create_dir", { path });
export const renamePath = (from: string, to: string) =>
  invoke<void>("rename_path", { from, to });
export const deletePath = (path: string) => invoke<void>("delete_path", { path });

export const renderPreview = (source: string, baseDir: string, baseUrl: string) =>
  invoke<RenderResult>("render_preview", { source, baseDir, baseUrl });
export const exportDocument = (
  sourcePath: string,
  outputPath: string,
  format: "html" | "pdf",
) => invoke<ExportResult>("export_document", { sourcePath, outputPath, format });
