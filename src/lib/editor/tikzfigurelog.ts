// Figure-compile log parsing (Phase D / D-6 / proof P95).
//
// ── INTEROP-FIRST: the parse contract is the STANDARD LaTeX bang-error format ──
// A tikz figure compile (tikzcd.lua → pdflatex -interaction=nonstopmode → pdf2svg)
// that FAILS leaves a standard LaTeX bang-error block in its `.tex` log: a `! …`
// message line and an `l.NN  <source-prefix>` marker citing the offending line.
// The filter (tikzcd.lua::emit_figure_compile_error) recovers that diagnostic,
// maps the cited `.tex` line back to the line WITHIN the figure body (subtracting
// the template preamble lines), and writes ONE machine-parseable marker line per
// error to its stderr — which the app captures as `RenderResult.log` (the
// figure-compile analog of the P11 pandoc log). The marker is:
//
//   [tikzcd-figure-error] <body-line>|<message>|<verbatim figure source line>
//
// This module recovers those markers and maps each back to the EDITOR-BUFFER
// source line by locating the verbatim source-line text in the live buffer — the
// faithful jump target, since the filter's `<body-line>` is relative to the
// figure body, not to the editor buffer. The map is the source-line text, not
// brittle offset arithmetic across the markdown→figure-body boundary.
//
// This is POST-compile log PRESENTATION over `RenderResult.log`; it does NOT touch
// `render.rs` and is DISTINCT from the P11 pandoc-render log and the P74 structured
// pandoc-markdown-reader log — it is a third surface, the FIGURE-compile log.

/**
 * One figure-compile log entry. `line` is the 1-based EDITOR-BUFFER source line
 * the entry jumps to (the tikz source line carrying the malformed construct);
 * `message` is the human-readable LaTeX error text.
 */
export interface TikzFigureLogEntry {
  line: number;
  message: string;
}

// The marker the figure-compile filter writes to stderr per error. The body line
// and message precede the verbatim source line; the source is LAST and split on
// the FIRST two pipes only, since tikz source may itself contain `|`.
const MARKER = /^\[tikzcd-figure-error\]\s*(\d+)\|([^|]*)\|(.*)$/;

/**
 * The 1-based buffer line whose text EQUALS `src`, or 0 if no line matches. The
 * filter emits the figure source line verbatim, so the offending tikz line is
 * recovered by exact whole-line match against the live buffer — the same idiom
 * the P105 spec uses to locate the offending line independently.
 */
function bufferLineOf(bufferText: string, src: string): number {
  const lines = bufferText.split("\n");
  const idx = lines.indexOf(src);
  return idx < 0 ? 0 : idx + 1;
}

/**
 * Parse the raw figure-compile log markers out of a renderer `log` and map each
 * to the editor-buffer source line by matching the verbatim source-line text in
 * `bufferText`. Pure and unit-testable.
 *
 * Only markers whose source line is actually present in the live buffer (a
 * recoverable jump target) are emitted — a marker with no usable buffer line has
 * no jump target and is not a clickable entry.
 */
export function parseTikzFigureLog(
  rawLog: string,
  bufferText: string,
): TikzFigureLogEntry[] {
  const entries: TikzFigureLogEntry[] = [];
  for (const raw of rawLog.split("\n")) {
    const m = raw.match(MARKER);
    if (!m) continue;
    const message = m[2].trim();
    const src = m[3];
    const line = bufferLineOf(bufferText, src);
    if (line > 0) {
      entries.push({ line, message });
    }
  }
  return entries;
}
