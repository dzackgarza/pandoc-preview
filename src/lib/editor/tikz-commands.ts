// Config-owned vendored TikZ command DB (P94 / D-5) → an insertion-bar palette
// AND a composable CM6 completion source.
//
// The DB is the QTikz `tikzcommands.json` model: a JSON array of cursor-aware
// command objects, each
//   { name, description, insert, dx, dy, type }
// where `insert` is the multi-character text inserted when the command is chosen
// and `dx`/`dy` is the cursor offset AFTER insertion, relative to the start of the
// inserted body (the QTikz cursor-placement convention; for a single-line insert,
// dy=0 and dx is the character/column offset within the body). The corpus is
// vendored from QTikz (src-tauri/resources/tikz-commands/, with PROVENANCE); this
// module only READS that native data file — no command list is authored here.
//
// Both surfaces are built from the SAME parsed list: the bar palette surfaces the
// command names, and the completion source offers a command when the token before
// the cursor is a prefix of its name. Choosing a command (bar or popup) inserts
// its `insert` body with the cursor placed at the declared `dx`/`dy` offset,
// reusing the shared snippet `$0`-tabstop mechanism (snippets.ts), so the cursor
// lands strictly inside the inserted body — not a dumb paste at the body end.
//
// The DB is config-owned (editor.tikz_commands), so pointing config at a different
// DB surfaces different commands — no hardcoded list lives here. A malformed/
// unreadable DB is a hard error (the caller surfaces a visible toast), never a
// silently-empty palette.

import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";

/** One QTikz tikz-command DB entry. `dx`/`dy` is the cursor offset after the
 *  `insert` body is placed (relative to the body start); `type` is the upstream
 *  QTikz highlighting class (0 plain, 1 command, 2 draw-to, 3 option). */
export interface TikzCommand {
  readonly name: string;
  readonly description: string;
  readonly insert: string;
  readonly dx: number;
  readonly dy: number;
  readonly type: number;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`tikz-command DB entry ${field} must be a string`);
  }
  return value;
}

function requireInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`tikz-command DB entry ${field} must be an integer`);
  }
  return value;
}

/** Parse a tikz-command DB JSON document into a {@link TikzCommand}[] , failing
 *  loudly on anything that is not the QTikz `{name, description, insert, dx, dy,
 *  type}` array shape. The DB is config-owned and validated to exist by Rust; a
 *  file that parses to the wrong shape is a hard error, never a silently-empty
 *  source. */
export function parseTikzCommandDb(json: string): TikzCommand[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error("tikz-command DB must be a JSON array of command objects");
  }
  return parsed.map((raw): TikzCommand => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(
        "tikz-command DB entry must be an object { name, description, insert, dx, dy, type }",
      );
    }
    const entry = raw as Record<string, unknown>;
    return {
      name: requireString(entry.name, "name"),
      description: requireString(entry.description, "description"),
      insert: requireString(entry.insert, "insert"),
      dx: requireInt(entry.dx, "dx"),
      dy: requireInt(entry.dy, "dy"),
      type: requireInt(entry.type, "type"),
    };
  });
}

/** The character offset, within the multi-line `insert` body, at which the QTikz
 *  `dx`/`dy` cursor lands: skip `dy` whole lines from the start of the body, then
 *  `dx` characters into that line. For a single-line body (dy=0) this is just
 *  `dx`. The result indexes into the literal `insert` string. */
function tikzCursorIndex(cmd: TikzCommand): number {
  if (cmd.dy === 0) return cmd.dx;
  let index = 0;
  let line = 0;
  while (line < cmd.dy) {
    const nl = cmd.insert.indexOf("\n", index);
    if (nl < 0) {
      throw new Error(
        `tikz command ${JSON.stringify(cmd.name)} dy=${cmd.dy} exceeds its insert body line count`,
      );
    }
    index = nl + 1;
    line += 1;
  }
  return index + cmd.dx;
}

/** Build the snippet template for a command: its literal `insert` body with the
 *  CM6 final tabstop `${0}` placed at the declared `dx`/`dy` cursor index, so
 *  expanding it through the shared `runSnippet` path lands the cursor strictly
 *  inside the inserted body at the QTikz-declared offset. The body's `$` and `\`
 *  characters are tikz/LaTeX literals (no `$N` tabstops, no `$NAME` variables),
 *  so injecting the single `${0}` is the only tabstop the template carries. */
export function tikzCommandSnippetBody(cmd: TikzCommand): string {
  const idx = tikzCursorIndex(cmd);
  return cmd.insert.slice(0, idx) + "${0}" + cmd.insert.slice(idx);
}

/** A composable CM6 completion source over a tikz-command list: when the token
 *  immediately before the cursor is a prefix of a command's `name`, offer that
 *  command. Accepting it expands its `insert` body — with the cursor landing at
 *  the declared `dx`/`dy` offset (the `${0}` tabstop injected by
 *  {@link tikzCommandSnippetBody}) — through the SAME `snippetCompletion` apply
 *  the LaTeX/snippet completions use, replacing the typed name span `[from, to)`.
 *  Returns null when no command matches, leaving the other editor sources to
 *  answer (P51 compose-don't-override). */
export function tikzCommandCompletionSource(
  commands: readonly TikzCommand[],
): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const token = context.matchBefore(/\S+/);
    if (!token || token.from === token.to) return null;
    const options: Completion[] = commands
      .filter((cmd) => cmd.name.startsWith(token.text))
      .map((cmd) =>
        snippetCompletion(tikzCommandSnippetBody(cmd), {
          label: cmd.name,
          type: "function",
          detail: cmd.description,
        }),
      );
    if (options.length === 0) return null;
    return { from: token.from, options };
  };
}
