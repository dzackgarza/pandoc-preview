// Structured post-compile log parsing (Phase A, A.6 / proof P74).
//
// ── INTEROP-FIRST: this is a PORT of `pplatex`'s parse contract (HARD RULE #0) ──
// `pplatex` is the LaTeX-log pretty-printer vimtex routes compile logs through
// before quickfix ([[parity-research/vimtex]] §"Compile-log → quickfix" /
// §"pplatex-class log post-processing"). The PREFERRED path is running the real
// `pplatex` binary on the emitted log and parsing its already-structured output;
// on THIS host `pplatex` is MISSING (`which pplatex` → not found), so this module
// PORTS pplatex's documented parse contract rather than inventing a fresh log
// grammar. The structured-log shape `{line, severity, message}` is pplatex's, NOT
// designed here. The three recognized forms are pplatex's documented recognizers:
//
//   * `file:line: message`           → a file/line-tagged diagnostic
//   * a latex bang-error block `! …` → an error, carrying its `l.NN` line marker
//   * `… Warning: …` lines           → a warning, with the cited source line
//
// This is POST-compile log PRESENTATION over `RenderResult.log` (the P11 raw-log
// surface); it does NOT touch `render.rs`, so the P11 raw-log contract is
// unchanged. The structured entries are shown ALONGSIDE the raw log, never
// replacing it.

/** Severity classification of a parsed log entry — pplatex's three levels. */
export type LogSeverity = "error" | "warning" | "info";

/**
 * One structured compile-log entry, pplatex's shape. `line` is the 1-based
 * source line the entry jumps to; `severity` the classified level; `message` the
 * human-readable text.
 */
export interface LogEntry {
  line: number;
  severity: LogSeverity;
  message: string;
}

// `! ...` introduces a latex bang-error block; the source line is cited later in
// the block by an `l.NN` marker (pplatex's documented error-block recognition).
const BANG_ERROR = /^!\s*(.*)$/;
const L_MARKER = /^l\.(\d+)\b/;

// pandoc / latex `... Warning: ...` lines. The cited source line appears as a
// `line N` (pandoc markdown reader) or `on input line N` / `line N` (latex)
// token within the warning text — pplatex's warning recognition.
const WARNING_LINE = /\bWarning\b\s*:?\s*(.*)$/i;

// A bare `file:line: message` diagnostic — pplatex's file/line-tagged form. The
// file part is a path-like token with no embedded spaces or colons; the line is
// the cited source line. (A leading `[SEVERITY]` tag, as pandoc prepends, is
// stripped before matching so the file/line pair is recognized.)
const FILE_LINE = /^(?:\[[A-Z]+\]\s*)?([^\s:]+):(\d+):\s*(.*)$/;

// The cited source line carried inside a warning/error message body — `line N`,
// `on input line N`, or `at line N` (pandoc markdown reader and latex both cite
// the source line this way). Used to recover the jump target for a warning.
const CITED_LINE = /\b(?:on input |at )?line\s+(\d+)\b/i;

/** Classify a `... Warning: ...` / error keyword into pplatex's severity union. */
function classify(raw: string): LogSeverity {
  if (/\bWarning\b/i.test(raw)) return "warning";
  if (/\b(?:Error|Fatal|Emergency)\b/i.test(raw)) return "error";
  return "info";
}

/**
 * Parse a raw compile log into structured `{line, severity, message}` entries,
 * applying pplatex's documented parse contract (file/line-tagged diagnostics,
 * `! ...` bang-error blocks with their `l.NN` line marker, and `... Warning: ...`
 * lines with their cited source line). Pure and unit-testable.
 *
 * Only entries that recover a concrete source line are emitted — an entry whose
 * line is unknown has no jump target and is not a structured (clickable) entry.
 */
export function parseCompileLog(raw: string): LogEntry[] {
  const lines = raw.split("\n");
  const entries: LogEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];

    // (1) latex bang-error block: `! message`, with the source line cited by a
    // following `l.NN` marker. Scan forward within the block to the marker.
    const bang = text.match(BANG_ERROR);
    if (bang) {
      const message = bang[1].trim();
      for (let j = i + 1; j < lines.length; j++) {
        const marker = lines[j].match(L_MARKER);
        if (marker) {
          entries.push({
            line: Number(marker[1]),
            severity: "error",
            message,
          });
          break;
        }
      }
      continue;
    }

    // (2) `... Warning: ...` line with a cited source line — pplatex's warning
    // recognition. The cited `line N` token is the jump target.
    const warn = text.match(WARNING_LINE);
    if (warn) {
      const cited = text.match(CITED_LINE);
      if (cited) {
        entries.push({
          line: Number(cited[1]),
          severity: classify(text),
          message: text.trim(),
        });
      }
      continue;
    }

    // (3) bare `file:line: message` diagnostic — pplatex's file/line-tagged form.
    const fl = text.match(FILE_LINE);
    if (fl) {
      entries.push({
        line: Number(fl[2]),
        severity: classify(fl[3]),
        message: text.trim(),
      });
    }
  }

  return entries;
}
