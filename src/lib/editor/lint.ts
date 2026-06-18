// Static-lint adapter (Phase A / P70): the CM6 `@codemirror/lint` SOURCE that
// surfaces the pandoc-md-lint firewall plugin's diagnostics in the editor gutter.
// The app core owns ZERO lint logic: this module is the thin BRIDGE — it ships
// the live buffer to the pandoc-md-lint plugin through the GENERIC plugin firewall
// (`run_plugin`, the same path the renderer/export plugins use), parses the
// structured diagnostics JSON the plugin emits on stdout, and maps each
// {line,col,len,severity,message,ruleId} to a CM6 `Diagnostic`. It does NOT know
// chktex/lacheck or pandoc; all that knowledge lives inside the plugin's lint.sh.
// It COMPOSES with the fork's `latexLinter` (two `linter()` extensions; CM6 merges
// their diagnostics — the P51 lesson).

import type { EditorState } from "@codemirror/state";
import type { Diagnostic } from "@codemirror/lint";
import { runPlugin } from "../api";

/** The id of the shipped lint plugin run through the generic firewall. */
const LINT_PLUGIN_ID = "pandoc-md-lint";

/** One diagnostic record the pandoc-md-lint plugin emits on stdout: 1-based
 *  line/col into the MARKDOWN buffer, the flagged span length in chars, a CM6
 *  severity string, the message, and the producing rule id (the markdown-native
 *  rule id, or `chktex:<n>` / `lacheck` for the interop warnings). */
interface PluginDiagnostic {
  line: number;
  col: number;
  len: number;
  severity: string;
  message: string;
  ruleId: string;
}

// The plugin severity strings are exactly CM6's `Severity` union; an unexpected
// value is a hard error (the plugin contract is fixed), never a silently-defaulted
// severity.
function toSeverity(s: string): Diagnostic["severity"] {
  if (s === "error" || s === "warning" || s === "info" || s === "hint") {
    return s;
  }
  throw new Error(`lint plugin returned unknown severity: ${JSON.stringify(s)}`);
}

/** The async `@codemirror/lint` source: run the pandoc-md-lint plugin over the
 *  current buffer through the generic firewall and map its diagnostics to CM6
 *  `Diagnostic`s. `sourcePath` is the real on-disk source the firewall needs to
 *  resolve the run's working directory; a buffer with no durable identity has no
 *  lint pass (an identity-less buffer cannot be located on disk). A plugin failure
 *  (chktex/lacheck/pandoc absent or erroring) rejects loudly — CM6 surfaces
 *  nothing on a thrown source, and the failure is never masked into an empty
 *  diagnostic set. */
export async function mdLintDiagnostics(
  state: EditorState,
  sourcePath: string | null,
): Promise<Diagnostic[]> {
  if (!sourcePath) return [];
  const buffer = state.doc.toString();
  // The lint plugin reads the buffer on stdin and emits diagnostics on stdout;
  // {file}/{artifact} are unused by a lint pass, but the firewall requires a
  // source path to resolve the working directory and an output path placeholder.
  const result = await runPlugin(LINT_PLUGIN_ID, sourcePath, "", buffer);
  if (!result.success) {
    throw new Error(
      `pandoc-md-lint plugin failed (exit ${result.exit_code}): ${result.stderr.trim()}`,
    );
  }
  const records: PluginDiagnostic[] = JSON.parse(result.stdout);
  const doc = state.doc;
  return records.map((d) => {
    const lineInfo = doc.line(d.line);
    const from = Math.min(lineInfo.from + (d.col - 1), doc.length);
    const to = Math.min(from + Math.max(d.len, 1), doc.length);
    return {
      from,
      to,
      severity: toSeverity(d.severity),
      message: d.message,
      source: d.ruleId,
    };
  });
}
