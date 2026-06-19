import { invoke } from "@tauri-apps/api/core";
import type {
  Config,
  FileNode,
  FileRead,
  Fingerprint,
  FoldState,
  ParsedGraph,
  PluginInfo,
  PluginResult,
  RenderResult,
  RepoState,
  SearchHit,
  SearchResult,
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

// Dual-asset figure registry (P96 / D-7), persisted on the host fs under
// $XDG_STATE_HOME/pandoc-preview/figure-registry.json (the session.json pattern,
// NOT browser storage). Maps each NON-tikz figure's included RENDER path to its
// editable SOURCE path, so a restarted app resolves the SAME render to the SAME
// source. Read on register; the "edit this figure" action resolves through it.
// Returns an empty map on a clean first run; IO/parse errors fail loud.
export const readFigureRegistry = () =>
  invoke<Record<string, string>>("read_figure_registry");
export const saveFigureRegistry = (registry: Record<string, string>) =>
  invoke<void>("save_figure_registry", { registry });

// P96 / D-7: launch the diagram-tool editor on a figure's editable SOURCE through
// the plugin firewall (configure_plugin-shaped detached spawn). The app core
// holds no diagram-tool argv: the backend finds the single discovered
// `diagram-tool` category plugin and substitutes `sourcePath` into its own
// [exec] command's {file}. Fails LOUDLY on a missing source / no diagram-tool
// plugin — never a silent fall-through to the render.
export const launchDiagramTool = (sourcePath: string) =>
  invoke<void>("launch_diagram_tool", { sourcePath });

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

// P99 / D-10: register + insert an EXTERNAL-editor-produced vector asset (an
// Ipe/Inkscape SVG/PDF — NOT tikz). Reads the external asset at `sourcePath` and
// writes its REAL bytes as a file named `filename` into the CONFIGURED global
// figures directory (config.directories.figures), returning the absolute path of
// the written file — the non-tikz sibling of pasteClipboardImage. The caller
// supplies the bare filename so it can insert the markdown image reference at the
// cursor BEFORE awaiting this write, guaranteeing the reference and the on-disk
// file name the SAME path. Fails loudly (unreadable / zero-length source, no
// figures dir, non-bare filename) — never a project-local fallback.
export const registerVectorFigure = (sourcePath: string, filename: string) =>
  invoke<string>("register_vector_figure", { sourcePath, filename });

// P62 (E2E proof harness only): seed a deterministic width×height image onto the
// REAL system clipboard in one IPC, so the paste-image action can read it back.
// The write-image permission this needs is granted only in the e2e build.
export const seedClipboardImage = (width: number, height: number) =>
  invoke<void>("seed_clipboard_image", { width, height });

// D-8 (P97): the structured re-parse of tikz `source` through the app's OWN
// D-1 / P90 parser, returning { nodes: [{name,x,y,style,label}], edges:
// [{source,target,style}] } or failing loudly when `source` is not parseable
// tikz. The subgraph-copy proof feeds the clipboard text back through this to
// assert the copied text re-parses STABLY to the selected subgraph.
export const parseTikz = (source: string) =>
  invoke<ParsedGraph>("parse_tikz", { source });

// D-8 (P97): copy a SELECTED subgraph of owned tikz `source` to the REAL system
// clipboard as deterministic CANONICAL tikz (the TikzIt "copy a region of nodes"
// model). `source` is the full owned tikzpicture; `selection` is the contiguous
// span the user selected. The backend parses `source` with the D-1 parser, forms
// the induced subgraph from the selected nodes (plus the edges whose BOTH
// endpoints are selected), serializes it with the SAME canonical Graph::to_tikz()
// P90 round-trips, and writes that tikz onto the system clipboard via the
// clipboard-manager write_text path. Returns the canonical tikz it wrote. Fails
// LOUDLY on an unparseable source or a selection covering no node — never a
// raw-text copy.
export const copySubgraphTikz = (source: string, selection: string) =>
  invoke<string>("copy_subgraph_tikz", { source, selection });

export const listTree = (root: string) => invoke<FileNode[]>("list_tree", { root });

// Read a file's text together with the fingerprint of its on-disk state (P48).
// The frontend stores the fingerprint at open so a later save can detect an
// external modification.
export const readTextFile = (path: string) => invoke<FileRead>("read_text_file", { path });

// Read a file's RAW BYTES (Phase F / F1): the backend returns a tauri ipc byte
// response, which invoke surfaces as an ArrayBuffer. The embedded pdf.js viewer
// feeds these bytes to getDocument({ data }) — the asset protocol 403s a fetch
// of an asset:// URL from the dev-server origin, so the PDF bytes travel the
// host-fs IPC boundary instead.
export const readFileBytes = (path: string) =>
  invoke<ArrayBuffer>("read_file_bytes", { path });

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

// ── Firewall picker (Phase E / E3 / P104) ─────────────────────────────────────
//
// The command palette (Ctrl+Shift+P) and quick-open (Ctrl+P) both delegate the
// CHOICE to a picker-category plugin run by id through the SAME generic firewall
// (run_plugin). The app feeds the candidate list on the plugin's stdin (one
// `<token>\t<label>` line per candidate — the precedent is workspaceSearch, which
// feeds its request JSON on the same stdin) and the picker emits the CHOSEN
// candidate line on stdout. In production the picker is the interactive fzf TUI;
// the headless proof substitutes, via config, a non-interactive selection-
// returning plugin (recording-picker). The app then RUNS the returned command /
// OPENS the returned file — the app core owns no fzf argv, only the generic
// category. A picker that returns no line, or an empty/failed run, is a LOUD
// error (never a silent no-op pick).

/** One pick candidate: the `token` the app dispatches on (a command id or a file
 * path) and the human `label` shown in the picker. */
export interface PickCandidate {
  token: string;
  label: string;
}

/**
 * Run the picker-category plugin by id through the generic firewall, feeding the
 * candidates on stdin and returning the TOKEN of the chosen candidate. `root` is
 * a stable parent for the firewall's required (unused) source path, exactly as
 * workspaceSearch supplies one. Fails loud if the picker run fails or returns no
 * recognizable candidate line.
 */
export async function pickViaFirewall(
  pickerId: string,
  root: string,
  candidates: PickCandidate[],
): Promise<string> {
  if (candidates.length === 0) {
    throw new Error("pickViaFirewall: no candidates to pick from");
  }
  // The firewall delivers this on the plugin's stdin (the "buffer"); the
  // source/output paths are unused by the pick pass (it reads stdin, writes the
  // chosen line to stdout) but the firewall requires them.
  const stdin = candidates.map((c) => `${c.token}\t${c.label}`).join("\n");
  const result = await runPlugin(pickerId, `${root}/.picker`, "", stdin);
  if (!result.success) {
    throw new Error(
      `picker plugin ${pickerId} failed (exit ${result.exit_code ?? "?"}): ${result.stderr.trim()}`,
    );
  }
  const line = result.stdout.split("\n").find((l) => l.length > 0);
  if (line === undefined) {
    throw new Error(`picker plugin ${pickerId} returned no selection`);
  }
  return line.split("\t", 1)[0];
}

// ── Workspace content search (Phase E / E1 / P101+P102) ───────────────────────
//
// The app owns the boolean GRAMMAR translation and the per-file boolean
// evaluation + relevancy scoring; the REAL scanning is the workspace-search
// firewall plugin running ripgrep (rg --json). The app parses the plugin's
// ripgrep JSON event stream into structured hits and never sees a stringly blob.

/** A parsed boolean query (Zettlr grammar): space=AND, `|`=OR, `!`=NOT,
 * `"phrase"`=exact phrase. `orGroups` is an AND of OR-groups of POSITIVE terms
 * (a file must match at least one term in EVERY group); `notTerms` are terms the
 * file must NOT contain. */
export interface ParsedQuery {
  orGroups: string[][];
  notTerms: string[];
}

/** Tokenize a query string into terms, honoring `"phrases"`, the bare `|` OR
 * operator (its own token), and a leading `!` negation marker. */
function tokenizeQuery(query: string): Array<{ kind: "term" | "or"; text: string; negated: boolean }> {
  const out: Array<{ kind: "term" | "or"; text: string; negated: boolean }> = [];
  let i = 0;
  while (i < query.length) {
    const ch = query[i];
    if (ch === " " || ch === "\t" || ch === "\n") {
      i += 1;
      continue;
    }
    if (ch === "|") {
      out.push({ kind: "or", text: "|", negated: false });
      i += 1;
      continue;
    }
    let negated = false;
    if (ch === "!") {
      negated = true;
      i += 1;
    }
    if (query[i] === '"') {
      // Exact phrase: everything up to the closing quote is one term.
      i += 1;
      let phrase = "";
      while (i < query.length && query[i] !== '"') {
        phrase += query[i];
        i += 1;
      }
      i += 1; // consume the closing quote
      if (phrase.length > 0) out.push({ kind: "term", text: phrase, negated });
      continue;
    }
    // Bare term: up to the next whitespace or `|`.
    let term = "";
    while (i < query.length && query[i] !== " " && query[i] !== "\t" && query[i] !== "\n" && query[i] !== "|") {
      term += query[i];
      i += 1;
    }
    if (term.length > 0) out.push({ kind: "term", text: term, negated });
  }
  return out;
}

/** Parse the Zettlr boolean grammar into AND-of-OR-groups (positive) plus NOT
 * terms. Consecutive positive terms joined by a `|` operator form one OR group;
 * every other positive term is its own (single-element) AND group; negated
 * terms become NOT constraints. */
export function parseQuery(query: string): ParsedQuery {
  const tokens = tokenizeQuery(query);
  const orGroups: string[][] = [];
  const notTerms: string[] = [];
  let current: string[] = [];
  let pendingOr = false;
  const flush = () => {
    if (current.length > 0) {
      orGroups.push(current);
      current = [];
    }
  };
  for (const tok of tokens) {
    if (tok.kind === "or") {
      pendingOr = true;
      continue;
    }
    if (tok.negated) {
      // A negation breaks any pending OR run and is a standalone NOT constraint.
      flush();
      pendingOr = false;
      notTerms.push(tok.text);
      continue;
    }
    if (pendingOr && current.length > 0) {
      current.push(tok.text);
    } else {
      flush();
      current = [tok.text];
    }
    pendingOr = false;
  }
  flush();
  return { orGroups, notTerms };
}

/** Every distinct literal term (positive + negated) the plugin must hand to
 * ripgrep as `-e <term>` so rg returns lines matching ANY of them; the app then
 * does the boolean evaluation on the parsed per-file matches. */
function allPatterns(parsed: ParsedQuery): string[] {
  const set = new Set<string>();
  for (const group of parsed.orGroups) for (const t of group) set.add(t);
  for (const t of parsed.notTerms) set.add(t);
  return [...set];
}

/** Parse ripgrep's `--json` event stream (one JSON object per line) into
 * structured per-file hits, with the matched TERM text recorded per submatch so
 * the app can attribute each hit to a query term. `path` is normalized to a
 * project-relative path (the leading `./` ripgrep emits for a whole-project
 * search is stripped). */
function parseRgStream(stdout: string): Array<SearchHit & { terms: string[] }> {
  const hits: Array<SearchHit & { terms: string[] }> = [];
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    let evt: unknown;
    try {
      evt = JSON.parse(line);
    } catch {
      // ripgrep --json emits one well-formed JSON object per line; a line that
      // does not parse is a contract violation, surfaced loudly.
      throw new Error(`workspace-search: unparseable ripgrep JSON line: ${line}`);
    }
    const e = evt as {
      type?: string;
      data?: {
        path?: { text?: string };
        line_number?: number;
        lines?: { text?: string };
        submatches?: Array<{ match?: { text?: string }; start?: number }>;
      };
    };
    if (e.type !== "match" || !e.data) continue;
    const d = e.data;
    const rawPath = d.path?.text;
    const lineNumber = d.line_number;
    if (typeof rawPath !== "string" || typeof lineNumber !== "number") {
      throw new Error(`workspace-search: ripgrep match event missing path/line: ${line}`);
    }
    const path = rawPath.startsWith("./") ? rawPath.slice(2) : rawPath;
    const subs = d.submatches ?? [];
    const terms = subs.map((s) => s.match?.text ?? "").filter((t) => t.length > 0);
    const col = (subs[0]?.start ?? 0) + 1; // 1-based column
    hits.push({
      path,
      line: lineNumber,
      col,
      text: (d.lines?.text ?? "").replace(/\n$/, ""),
      terms,
    });
  }
  return hits;
}

/**
 * Run a global full-text workspace content search (Phase E / E1 / P101+P102).
 * The app parses `query` with the Zettlr boolean grammar (space=AND, `|`=OR,
 * `!`=NOT, `"phrase"`=exact), runs the workspace-search firewall plugin (real
 * `rg --json`) over `root` (restricted to `scope`, a project-relative subdir, or
 * the whole project when empty), parses ripgrep's JSON event stream into hits,
 * then evaluates the boolean expression per file and ranks each result by match
 * count (the relevancy heatmap). A plugin failure is surfaced loudly (never a
 * silent empty result).
 */
export async function workspaceSearch(
  root: string,
  query: string,
  scope: string,
): Promise<SearchResult[]> {
  const parsed = parseQuery(query);
  const patterns = allPatterns(parsed);
  if (patterns.length === 0) return [];

  const request = JSON.stringify({ root, scope, patterns });
  // The firewall delivers `request` on the plugin's stdin (the "buffer"). The
  // source/output paths are unused by the search pass (it reads stdin, writes
  // stdout) but the firewall requires them; the root is a stable parent.
  const result = await runPlugin("workspace-search", `${root}/.workspace-search`, "", request);
  if (!result.success) {
    throw new Error(
      `workspace-search plugin failed (exit ${result.exit_code ?? "?"}): ${result.stderr.trim()}`,
    );
  }

  const rawHits = parseRgStream(result.stdout);

  const positiveTerms = new Set<string>();
  for (const group of parsed.orGroups) for (const t of group) positiveTerms.add(t);

  // Group hits by file, retaining the matched terms per hit so the boolean
  // evaluation and the relevancy score read off the same per-file data.
  const byFile = new Map<string, { hits: Array<SearchHit & { terms: string[] }>; terms: Set<string> }>();
  for (const h of rawHits) {
    let entry = byFile.get(h.path);
    if (!entry) {
      entry = { hits: [], terms: new Set() };
      byFile.set(h.path, entry);
    }
    entry.hits.push(h);
    for (const t of h.terms) entry.terms.add(t);
  }

  // A file is a result iff it satisfies EVERY positive OR-group (at least one of
  // the group's terms present) AND contains NONE of the NOT terms. The relevancy
  // weight (heatRank) is the count of matched lines carrying a POSITIVE query
  // term (so a three-match file outranks a one-match file → a higher heat class).
  const results: SearchResult[] = [];
  for (const [path, entry] of byFile) {
    const satisfiesAnd = parsed.orGroups.every((group) => group.some((t) => entry.terms.has(t)));
    const violatesNot = parsed.notTerms.some((t) => entry.terms.has(t));
    if (!satisfiesAnd || violatesNot) continue;

    const positiveHits = entry.hits
      .filter((h) => h.terms.some((t) => positiveTerms.has(t)))
      .sort((a, b) => a.line - b.line)
      .map((h) => ({ path: h.path, line: h.line, col: h.col, text: h.text }));
    const first = positiveHits[0];
    results.push({
      path,
      line: first.line,
      col: first.col,
      hits: positiveHits,
      heatRank: positiveHits.length,
    });
  }

  // Rank by heat (most matches first); stable secondary sort by path.
  results.sort((a, b) => b.heatRank - a.heatRank || a.path.localeCompare(b.path));
  return results;
}
