// Static-lint adapter (Phase A / P70): the CM6 `@codemirror/lint` SOURCE that
// surfaces the REAL ChkTeX's diagnostics in the editor gutter. The checks are
// ChkTeX's (delimiter-count / math-mode balance); this module is the thin BRIDGE
// — it ships the live buffer to the `lint_buffer` Tauri command (which runs the
// active renderer plugin's lint.sh: pandoc md->tex + the real /usr/bin/chktex)
// and translates the mapped backend diagnostics into CM6 `Diagnostic`s. It does
// NOT reimplement any check, and it COMPOSES with the fork's `latexLinter` (two
// `linter()` extensions; CM6 merges their diagnostics — the P51 lesson).

import type { EditorState } from "@codemirror/state";
import type { Diagnostic } from "@codemirror/lint";
import { lintBuffer, type LintBackendDiagnostic } from "../api";

// The backend severity strings are exactly CM6's `Severity` union, so the map is
// the identity over the legal values; an unexpected value is a hard error (the
// backend contract is fixed), never a silently-defaulted severity.
function toSeverity(s: string): Diagnostic["severity"] {
  if (s === "error" || s === "warning" || s === "info" || s === "hint") {
    return s;
  }
  throw new Error(`lint backend returned unknown severity: ${JSON.stringify(s)}`);
}

/** The async `@codemirror/lint` source: run the real ChkTeX over the current
 *  buffer's pandoc-emitted .tex (via the `lint_buffer` command) and return the
 *  mapped diagnostics as CM6 `Diagnostic`s. A backend failure (ChkTeX/pandoc
 *  absent or erroring) rejects loudly — CM6 surfaces nothing on a thrown source,
 *  and the failure is never masked into an empty diagnostic set. */
export async function chktexDiagnostics(state: EditorState): Promise<Diagnostic[]> {
  const buffer = state.doc.toString();
  const backend: LintBackendDiagnostic[] = await lintBuffer(buffer);
  return backend.map((d) => ({
    from: d.from,
    to: d.to,
    severity: toSeverity(d.severity),
    message: d.message,
    source: d.source,
  }));
}
