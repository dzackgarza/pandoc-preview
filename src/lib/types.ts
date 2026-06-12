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
  pandoc: {
    path: string;
    from_format: string;
    extra_args: string[];
  };
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

export type RenderStatus = "idle" | "rendering" | "ok" | "error";
