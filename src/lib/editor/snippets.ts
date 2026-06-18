// User-defined snippet dictionary → a composable CM6 completion source (P52),
// mode-gated by editing zone (P77).
//
// A snippet dictionary is a JSON document `{ "snippets": [ … ] }` whose entries
// are MODE-TAGGED objects: each carries a TRIGGER token, a snippet BODY, and a
// `mode` of `prose` | `math` | `both` (default `both`). The body is a CodeMirror
// snippet template whose `$0` marks the final tabstop (the cursor's landing
// position after expansion). Typing a trigger surfaces a completion labelled by
// that trigger; accepting it replaces the trigger with the expanded body and
// drops the cursor at the tabstop.
//
// The mode tag is the keystone (P77): the SAME short trigger can carry a PROSE
// body and a MATH body, and the completion source offers a math entry only when
// the cursor is in a math zone, a prose entry only in prose, a `both` entry
// always — a thing the old flat `trigger→string` shape literally could not
// express. The math/prose predicate is the vendored fork's `inMathMode`
// (OSOT: the SAME detector the LaTeX command completion gates on), not a second
// detector owned here.
//
// This is the EXACT expansion pattern the vendored LaTeX language uses for
// fenced divs (vendor/codemirror-lang-latex/src/completion.ts → snippetCompletion).
// The dictionary is config-owned (editor.snippet_dictionary), so pointing config
// at a different dict offers different snippets — no hardcoded list lives here.

import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { inMathMode } from "codemirror-lang-latex";
import { EditorView } from "@codemirror/view";
import { StateField, StateEffect, type Extension } from "@codemirror/state";
import type { ChangeDesc } from "@codemirror/state";

/** The editing zone an entry is live in. `both` is offered in every zone; the
 *  same trigger may appear once as `prose` and once as `math` to resolve to a
 *  different body per zone (P77). */
export type SnippetMode = "prose" | "math" | "both";

/** One mode-tagged snippet dictionary entry. An `auto` entry is an AUTOTRIGGER
 *  (B-DESIGN-0): it expands the instant the user types the trigger followed by
 *  its terminator (a space), in place, with no completion popup and no accept
 *  keypress (LuaSnip autosnippet / UltiSnips `A`). A non-`auto` entry expands
 *  only through the popup-accept path (P52) or the insertion bar (P59).
 *
 *  A `regex` entry is a REGEX/POSTFIX trigger (B-DESIGN-0; the LuaSnip `regTrig`
 *  / UltiSnips `r` capture-group model): its `trigger` is a JS regex pattern
 *  matched against the text before the cursor, and its body's capture references
 *  (`$1`, `$2`, …) are substituted from the match FIRST — distinct from a
 *  TextMate tabstop `${1}`. The residual body (its `${N}` tabstops intact) is
 *  then expanded through the shared `runSnippet` path. A non-`regex` entry's
 *  trigger is a literal token. */
export interface SnippetEntry {
  readonly trigger: string;
  readonly body: string;
  readonly mode: SnippetMode;
  readonly auto: boolean;
  readonly regex: boolean;
}

/** The parsed shape of a snippet dictionary: an ordered list of mode-tagged
 *  entries. (An ordered list, not a `Record<trigger, …>`, because the SAME
 *  trigger legitimately appears twice — once per mode — for P77.) */
export type SnippetMap = SnippetEntry[];

function isSnippetMode(value: unknown): value is SnippetMode {
  return value === "prose" || value === "math" || value === "both";
}

/** Parse a snippet-dictionary JSON document into a {@link SnippetMap}, failing
 *  loudly on anything that is not the mode-tagged `{ "snippets": [ … ] }` shape.
 *  The dictionary is config-owned and validated to exist by Rust; a file that
 *  parses to the wrong shape is a hard error, never a silently-empty source. The
 *  old flat `trigger→string` shape is REJECTED (breaking change, pre-launch). */
export function parseSnippetDictionary(json: string): SnippetMap {
  const parsed: unknown = JSON.parse(json);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      'snippet dictionary must be a JSON object of the form { "snippets": [ … ] }',
    );
  }
  const snippets = (parsed as Record<string, unknown>).snippets;
  if (!Array.isArray(snippets)) {
    throw new Error(
      'snippet dictionary must have a "snippets" array of mode-tagged entries',
    );
  }
  const entries: SnippetEntry[] = [];
  for (const raw of snippets) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(
        "snippet dictionary entry must be an object { trigger, body, mode? }",
      );
    }
    const entry = raw as Record<string, unknown>;
    const { trigger, body } = entry;
    if (typeof trigger !== "string" || trigger.length === 0) {
      throw new Error(
        "snippet dictionary entry must have a non-empty string trigger",
      );
    }
    if (typeof body !== "string") {
      throw new Error(
        `snippet dictionary entry ${JSON.stringify(trigger)} must have a string body`,
      );
    }
    const rawMode = entry.mode;
    if (rawMode !== undefined && !isSnippetMode(rawMode)) {
      throw new Error(
        `snippet dictionary entry ${JSON.stringify(trigger)} mode must be one of prose | math | both`,
      );
    }
    const mode: SnippetMode = rawMode ?? "both";
    const rawAuto = entry.auto;
    if (rawAuto !== undefined && typeof rawAuto !== "boolean") {
      throw new Error(
        `snippet dictionary entry ${JSON.stringify(trigger)} auto must be a boolean`,
      );
    }
    const auto: boolean = rawAuto ?? false;
    const rawRegex = entry.regex;
    if (rawRegex !== undefined && typeof rawRegex !== "boolean") {
      throw new Error(
        `snippet dictionary entry ${JSON.stringify(trigger)} regex must be a boolean`,
      );
    }
    const regex: boolean = rawRegex ?? false;
    entries.push({ trigger, body, mode, auto, regex });
  }
  return entries;
}

// ── Native quicktex source loader (B5 / P81) ─────────────────────────────────
//
// The user's REAL dictionary is a vimscript file declaring TWO global dicts:
// `g:quicktex_prose` and `g:quicktex_math`, each a `{ \'trigger' : 'body', … }`
// literal. We consume that source format DIRECTLY — no bespoke flattened
// intermediate — so the user brings his existing file with zero porting and the
// prose/math mode-split survives interop (the entry's `mode` is which map it came
// from). The quicktex jump markers translate to the SAME TextMate tabstop syntax
// the CM6 engine consumes: `<+++>` (the primary landing the cursor jumps to first)
// becomes the first ordered field `${1}`, and each subsequent `<++>` secondary
// becomes the next ordered field `${2}`, `${3}`, … — PRESERVED, not deleted (the
// `body.replace("<++>", "")` data loss of the old converter is exactly what this
// replaces). The match is fail-loud: a source declaring neither map is a hard
// error (never a silently-empty source, never a silent flatten).

/** A quicktex entry line: optional leading `\` continuation, a single- or
 *  double-quoted trigger, `:`, then a single- or double-quoted body, optional
 *  trailing comma. */
const QUICKTEX_ENTRY = /^\s*\\?\s*(['"])(.*?)\1\s*:\s*(['"])(.*?)\3\s*,?\s*$/;

/** Translate a quicktex body to a CM6 snippet body: resolve vim string escapes,
 *  then map the jump markers to ordered TextMate tabstops. `<+++>` (the primary
 *  landing) becomes `${1}` (the first field CM6 visits); each `<++>` secondary
 *  becomes the next ordered field (`${2}`, `${3}`, …), preserved as a real slot. */
function quicktexBodyToSnippet(body: string): string {
  // vim string escapes that appear in bodies: `\<CR>` is a newline; `\\` is a
  // literal backslash; `\"` / `\'` are the quote chars.
  let out = body
    .replace(/\\<CR>/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");
  // `<+++>` is the primary landing (visited first). Subsequent `<++>` secondaries
  // become the next ordered fields. Number them in source order starting at 1 so
  // the cursor lands at the primary slot first, then tabs through the secondaries.
  let next = 1;
  out = out.replace(/<\+\+\+>/g, () => `\${${next++}}`);
  out = out.replace(/<\+\+>/g, () => `\${${next++}}`);
  return out;
}

/** Parse one `g:quicktex_<mode> = { … }` dict body (the text BETWEEN the braces)
 *  into mode-tagged entries. Section dividers (`… : 'COMMENT'`) and pure
 *  vim-keystroke macros (bodies that are `\<ESC>`/`:call` navigation commands,
 *  not insertable text) are skipped — they carry no expandable body. */
function parseQuicktexMap(block: string, mode: SnippetMode): SnippetEntry[] {
  const entries: SnippetEntry[] = [];
  for (const line of block.split("\n")) {
    if (line.trim().length === 0) continue;
    if (line.trimStart().startsWith('"')) continue; // vim comment line
    const match = QUICKTEX_ENTRY.exec(line);
    if (!match) continue;
    const trigger = match[2];
    const rawBody = match[4];
    if (trigger.trim().length === 0) continue; // the space-key jump entry
    if (rawBody === "COMMENT") continue; // a section divider
    if (rawBody.includes("\\<ESC>") || rawBody.includes(":call")) continue; // keystroke macro
    entries.push({
      trigger,
      body: quicktexBodyToSnippet(rawBody),
      mode,
      auto: false,
      regex: false,
    });
  }
  return entries;
}

/** Extract the dict-literal body (the entry lines between the opening `{` and the
 *  closing `}`) that follows `let g:<name> = ` in a quicktex source, or null if
 *  that map is absent. The dict literal closes with a vim line-continuation
 *  `\}` on its own line (`    \}`); the many `}` characters INSIDE quoted bodies
 *  (e.g. `\frac{<+++>}{<++>}`) are NOT the dict close, so we match the
 *  continuation-`\}` line rather than the first raw `}`. */
function extractQuicktexMap(source: string, name: string): string | null {
  const marker = new RegExp(`g:${name}\\s*=\\s*\\{`);
  const open = marker.exec(source);
  if (!open) return null;
  const start = open.index + open[0].length;
  const close = /^\s*\\?\}\s*$/m;
  close.lastIndex = start;
  const rest = source.slice(start);
  const closeMatch = close.exec(rest);
  if (!closeMatch) {
    throw new Error(
      `quicktex source declares g:${name} but its dict literal is never closed with "}"`,
    );
  }
  return rest.slice(0, closeMatch.index);
}

/** Parse a native quicktex source file (the user's real two-map vimscript dict)
 *  into a {@link SnippetMap} consumed DIRECTLY — no flattened intermediate. The
 *  `g:quicktex_prose` map yields `prose`-mode entries and `g:quicktex_math`
 *  yields `math`-mode entries, so the SAME short trigger resolves to its prose
 *  body in prose and its math body in math (the mode-split the old one-way
 *  flattening destroyed). Fails loud on a source declaring neither map — never a
 *  silent flatten, never a silently-empty source. */
export function parseQuicktexSource(source: string): SnippetMap {
  const prose = extractQuicktexMap(source, "quicktex_prose");
  const math = extractQuicktexMap(source, "quicktex_math");
  if (prose === null && math === null) {
    throw new Error(
      "quicktex source declares neither g:quicktex_prose nor g:quicktex_math",
    );
  }
  const entries: SnippetEntry[] = [];
  if (prose !== null) entries.push(...parseQuicktexMap(prose, "prose"));
  if (math !== null) entries.push(...parseQuicktexMap(math, "math"));
  return entries;
}

// CodeMirror's snippet-template parser only recognises a tabstop written with
// braces (`${0}`, `${1}`, …); a bare `$0` is treated as literal text. Snippet
// dictionaries author the final tabstop as the bare `$0` convention, so we
// normalise bare `$N` tabstops to the brace form the parser understands. A `$`
// that is already followed by `{` is left untouched.
function normalizeTabstops(body: string): string {
  return body.replace(/\$(\d+)/g, "${$1}");
}

/** Build a {@link Completion} for one dictionary entry: its label is the trigger
 *  and its `apply` resolves the body's snippet VARIABLES (`$CLIPBOARD`,
 *  `$CURRENT_DATE`, `$CURRENT_YEAR`) — through the SAME {@link resolveSnippetVariables}
 *  the insertion-bar `runSnippet` path uses — and then expands the resolved body
 *  via the same `snippetCompletion` machinery the LaTeX fenced-div completions
 *  use, so accepting the popup completion (P52/P77) lands the resolved values and
 *  the cursor at the declared tabstop. Variable resolution reads the system
 *  clipboard asynchronously, so the apply resolves first and dispatches the
 *  expansion after — replacing the trigger span `[from, to)` the popup matched.
 *  Standard transform mirrors (`${N/regex/replace/flags}`, B7 / P83a) are armed
 *  after expansion so the dependent slot tracks its source field live on the
 *  popup-accept path too. */
function snippetOption(
  entry: SnippetEntry,
  clipboard: ClipboardTextReader,
): Completion {
  return {
    label: entry.trigger,
    type: "snippet",
    detail: "snippet",
    apply: (view, _completionArg, from, to) => {
      void expandSnippetBody(view, entry.body, from, to, clipboard);
    },
  };
}

/** Whether an entry is live at the cursor's editing zone. A `both` entry is
 *  always live; a `math` entry only inside a math zone; a `prose` entry only
 *  outside one. The zone is classified by the vendored fork's `inMathMode`
 *  (OSOT). */
function entryLiveAt(entry: SnippetEntry, context: CompletionContext): boolean {
  if (entry.mode === "both") return true;
  const math = inMathMode(context.state, context.pos);
  return entry.mode === "math" ? math : !math;
}

/** A completion source over a snippet map: when the token immediately before the
 *  cursor matches a dictionary trigger live at the cursor's zone, it offers that
 *  trigger as a completion whose acceptance expands the body. `from` is the
 *  trigger start so accepting REPLACES the typed trigger with the expansion (the
 *  trigger does not survive in the buffer). The zone gate (P77) is the SAME
 *  `inMathMode` predicate the LaTeX completion uses. Composes with the other
 *  editor sources — it returns null when no live trigger matches, leaving the
 *  LaTeX completions to answer. */
export function snippetCompletionSource(
  map: SnippetMap,
  clipboard: ClipboardTextReader,
): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const token = context.matchBefore(/\S+/);
    if (!token || token.from === token.to) return null;
    // Offer every entry whose trigger the typed token is a prefix of AND which
    // is live at this zone; CM6 then filters labels against the typed text and
    // highlights the best match.
    const options = map
      .filter(
        (entry) =>
          entry.trigger.startsWith(token.text) && entryLiveAt(entry, context),
      )
      .map((entry) => snippetOption(entry, clipboard));
    if (options.length === 0) return null;
    return { from: token.from, options };
  };
}

/** Resolve the AUTOTRIGGER body to expand when a space terminator has just been
 *  typed at `pos` (the offset immediately AFTER the space). Reads the word token
 *  ending right before the space and, if it exactly matches an `auto` entry live
 *  at the cursor's zone (the SAME `inMathMode` predicate the popup gates on),
 *  returns the trigger span to replace and the body to expand; otherwise null.
 *  The caller (EditorPane's input handler) replaces `[from, to)` with the body
 *  via `runSnippet`, then re-arms — so a subsequent autotrigger fires the same
 *  way. The trigger span is the bare word before the space (`to` is the space
 *  position); the space itself is consumed by the expansion (it does not survive
 *  in the buffer, so the literal `trigger ` token is gone). */
export function findAutoExpansion(
  map: SnippetMap,
  state: EditorView["state"],
  pos: number,
): { from: number; to: number; body: string } | null {
  // The character just before `pos` must be the space terminator the user typed.
  if (pos <= 0) return null;
  const before = state.doc.sliceString(pos - 1, pos);
  if (before !== " ") return null;
  // The non-space run immediately before the space. The autotrigger keys on the
  // BARE trigger token — but after a prior expansion the cursor sits inside a
  // body (e.g. `\tilde{|}`), so the typed trigger trails non-trigger text with
  // no separating space (`\tilde{hii`). Match an `auto` entry whose trigger is
  // the SUFFIX of that run (the bare word the user just typed), so the chained
  // autotrigger fires inside the prior expansion (the re-arm).
  const line = state.doc.lineAt(pos - 1);
  const runText = state.doc.sliceString(line.from, pos - 1);
  const runMatch = /(\S+)$/.exec(runText);
  if (!runMatch) return null;
  const run = runMatch[1];
  for (const entry of map) {
    if (!entry.auto) continue;
    if (!run.endsWith(entry.trigger)) continue;
    const triggerFrom = pos - 1 - entry.trigger.length;
    const math = inMathMode(state, triggerFrom);
    const live =
      entry.mode === "both"
        ? true
        : entry.mode === "math"
          ? math
          : !math;
    if (!live) continue;
    // Replace the bare trigger token AND the space terminator with the body.
    return { from: triggerFrom, to: pos, body: entry.body };
  }
  return null;
}

/** Substitute regex capture references (`$1`, `$2`, …) in a snippet body from a
 *  match's capture groups. This is the LuaSnip `regTrig` / UltiSnips `r` model:
 *  capture references resolve FIRST, from the regex match — distinct from a
 *  TextMate tabstop `${1}` (which is left untouched here for the subsequent
 *  `runSnippet` expansion). A bare `$N` whose N indexes a capture group becomes
 *  that captured text; `${N}` (braced) is never touched (it is a tabstop). */
function substituteCaptures(body: string, match: RegExpExecArray): string {
  return body.replace(/\$(\d+)/g, (_m, n: string) => {
    const captured = match[Number(n)];
    if (captured === undefined) {
      throw new Error(
        `snippet body references capture group $${n} but the regex match has no such group`,
      );
    }
    return captured;
  });
}

/** Resolve the REGEX/POSTFIX expansion to fire when a space terminator has just
 *  been typed at `pos` (the offset immediately AFTER the space). Reads the bare
 *  word token ending right before the space and, for each `regex` entry live at
 *  the cursor's zone (the SAME `inMathMode` predicate the popup gates on), tests
 *  the entry's trigger as a JS regex ANCHORED to the END of that token. On a
 *  match the entry's capture references (`$1`, …) are substituted from the match
 *  (the LuaSnip `regTrig` / UltiSnips `r` model); the residual body (its `${N}`
 *  tabstops intact) is what the caller expands via `runSnippet`. Returns the span
 *  to replace (the matched token AND the space terminator) and the
 *  capture-substituted body, or null. */
export function findRegexExpansion(
  map: SnippetMap,
  state: EditorView["state"],
  pos: number,
): { from: number; to: number; body: string } | null {
  if (pos <= 0) return null;
  const before = state.doc.sliceString(pos - 1, pos);
  if (before !== " ") return null;
  // The non-space run immediately before the space — the bare token the user
  // just typed (`pbar`), the postfix operand the regex matcher keys on.
  const line = state.doc.lineAt(pos - 1);
  const runText = state.doc.sliceString(line.from, pos - 1);
  const runMatch = /(\S+)$/.exec(runText);
  if (!runMatch) return null;
  const run = runMatch[1];
  for (const entry of map) {
    if (!entry.regex) continue;
    // Anchor the entry's pattern to the END of the typed token so it matches the
    // postfix operand right before the space, not somewhere earlier in the line.
    const pattern = new RegExp(`(?:${entry.trigger})$`);
    const match = pattern.exec(run);
    if (!match) continue;
    const triggerFrom = pos - 1 - match[0].length;
    const math = inMathMode(state, triggerFrom);
    const live =
      entry.mode === "both"
        ? true
        : entry.mode === "math"
          ? math
          : !math;
    if (!live) continue;
    // Re-run the ENTRY's own pattern (its capture groups) against the matched
    // text so `$1` references resolve to the entry's groups, not the wrapping
    // anchor group.
    const captureMatch = new RegExp(entry.trigger).exec(match[0]);
    if (!captureMatch) continue;
    const body = substituteCaptures(entry.body, captureMatch);
    // Replace the matched token AND the space terminator with the body.
    return { from: triggerFrom, to: pos, body };
  }
  return null;
}

/** The number of characters a snippet body RENDERS to once expanded — its
 *  literal text with every tabstop marker removed (a bare `${N}` contributes
 *  nothing; a `${N:placeholder}` contributes its placeholder text). An
 *  autotrigger expansion uses this to land the cursor at the END of the rendered
 *  body rather than at the `$0` tabstop, so the engine re-arms OUTSIDE the field
 *  and a chained autotrigger expands sequentially (not nested inside the prior
 *  body's tabstop). */
export function renderedSnippetLength(body: string): number {
  const normalized = normalizeTabstops(body);
  // `${N}` → "" ; `${N:placeholder}` → "placeholder".
  const rendered = normalized.replace(
    /\$\{(\d+)(?::([^}]*))?\}/g,
    (_m, _n, placeholder) => placeholder ?? "",
  );
  return rendered.length;
}

/** Reads the system clipboard's current text — the SAME backend the P62
 *  paste-image path reads through. Injected into {@link runSnippet} so the pure
 *  snippet module never imports the Tauri clipboard plugin directly; the editor
 *  wires the real `readText`. Awaited only when a body actually references
 *  `$CLIPBOARD`. */
export type ClipboardTextReader = () => Promise<string>;

/** The standard TextMate/VSCode snippet-variable NAME grammar: a leading letter
 *  or underscore, then letters/digits/underscores. This is what distinguishes a
 *  VARIABLE (`$CLIPBOARD`, `$CURRENT_DATE`) from a TABSTOP/CAPTURE (`$1`, `${2}`):
 *  a variable name is alphabetic, a tabstop/capture is purely numeric. The
 *  numeric forms are left UNTOUCHED here for the subsequent `snippetCompletion`
 *  tabstop expansion. */
const SNIPPET_VARIABLE = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;

/** Resolve the STANDARD TextMate/VSCode snippet variables in a body to their
 *  host values, AT EXPANSION TIME, BEFORE the body reaches `snippetCompletion`.
 *  Both the bare `$NAME` and braced `${NAME}` forms resolve. Adopted names (no
 *  bespoke tokens): `CLIPBOARD` → the system-clipboard text (read through the
 *  injected reader, the SAME backend P62 owns); `CURRENT_DATE` → the host day of
 *  the month; `CURRENT_YEAR` → the host 4-digit year (the established VSCode
 *  semantics). A `$NAME` whose NAME is not a recognised variable is a hard error
 *  — never a silent passthrough that would leave a literal token in the buffer.
 *  Numeric `$N` / `${N}` tabstops and captures are not matched here. */
export async function resolveSnippetVariables(
  body: string,
  clipboard: ClipboardTextReader,
  now: Date,
): Promise<string> {
  // The clipboard read is async and may be costly; perform it once, and only
  // when the body actually references $CLIPBOARD.
  const needsClipboard = /\$(?:\{CLIPBOARD\}|CLIPBOARD\b)/.test(body);
  const clipboardText = needsClipboard ? await clipboard() : "";
  const year = String(now.getFullYear());
  // The day of the month, zero-padded to two digits (VSCode CURRENT_DATE).
  const date = String(now.getDate()).padStart(2, "0");
  return body.replace(SNIPPET_VARIABLE, (_match, braced?: string, bare?: string) => {
    const name = braced ?? bare;
    switch (name) {
      case "CLIPBOARD":
        return clipboardText;
      case "CURRENT_DATE":
        return date;
      case "CURRENT_YEAR":
        return year;
      default:
        throw new Error(`unknown snippet variable: $${name}`);
    }
  });
}

// ── Transform mirrors (B7 / P83a) ────────────────────────────────────────────
//
// The STANDARD TextMate/VSCode/UltiSnips mirror-transform `${N/regex/replace/flags}`
// derives a dependent slot from a source tabstop by running a regex substitution
// over the source field's current text (e.g. `${1/(.*)/\U$1/}` upper-cases the
// `${1}` field into the dependent position). CM6's vendored snippet parser
// covers tabstops, placeholders, and mirrors NATIVELY (P80) but NOT this
// transform: its field regex would mis-read `${1/(.*)/\U$1/}` as a NAMED field,
// never applying the substitution. The jonschlinkert/tabstops library is the
// named PORT candidate for this grammar, but its sole published release
// (0.1.2, a WIP) fails to load (`Cannot find module './location'`), so the
// standard transform RULE is ported here — the established TextMate semantics,
// no bespoke token.
//
// We LEVERAGE CM6's native mirror for the live wiring: a transform target is
// emitted into the CM6 template as a PLAIN mirror `${N}` of its source, so CM6
// keeps it textually identical to the source field as the user types. A small
// CM6 extension ({@link transformMirrorExtension}) then rewrites only that
// target range with the TRANSFORMED text, so the dependent slot shows the
// transform live (no second keystroke), exactly as the standard editors do.

/** A `${N/regex/replace/flags}` transform extracted from a snippet body: the
 *  source tabstop number it mirrors, the compiled matcher, the replacement
 *  format string (with capture refs `$1`/`${1}` and the `\U`/`\L`/`\E` case
 *  modifiers the standard transform supports), and `markerIndex` — the character
 *  offset, within the STRIPPED template, of the plain `${N}` mirror this
 *  transform was rewritten to. {@link armTransforms} renders the stripped
 *  template prefix up to that marker to derive the dependent slot's absolute
 *  document offset. */
interface SnippetTransform {
  readonly field: number;
  readonly regex: RegExp;
  readonly replacement: string;
  readonly markerIndex: number;
}

/** Match one standard transform mirror `${N/regex/replace/flags}` in a body. The
 *  regex and replacement are delimited by `/`; a `\/` inside either is a literal
 *  slash, not a delimiter. Flags are the trailing regex flags (`g`, `i`, `m`, …). */
const TRANSFORM_TOKEN =
  /\$\{(\d+)\/((?:\\.|[^/\\])*)\/((?:\\.|[^/\\])*)\/([a-z]*)\}/;

/** Apply a parsed transform to a source field's text, producing the dependent
 *  slot's text. Implements the STANDARD TextMate format-string semantics: each
 *  match is replaced by the replacement, in which `$n`/`${n}` are the match's
 *  capture groups and `\U`/`\L` switch subsequent output to upper/lower case
 *  until `\E` (or the end of the replacement). */
function applyTransform(text: string, t: SnippetTransform): string {
  return text.replace(t.regex, (...args: unknown[]) => {
    // String.replace passes (match, p1, p2, …, offset, string[, groups]); the
    // captures are the args between the match and the trailing offset/string.
    const groups = args.slice(0, -2) as string[];
    return expandReplacement(t.replacement, groups);
  });
}

/** Expand a transform replacement format string against the match's capture
 *  groups: substitute `$n`/`${n}`, and honour the `\U`/`\L`/`\E` case modifiers
 *  (the standard TextMate format-string case folding). */
function expandReplacement(replacement: string, groups: string[]): string {
  let out = "";
  let caseMode: "upper" | "lower" | null = null;
  const emit = (s: string): void => {
    out += caseMode === "upper" ? s.toUpperCase() : caseMode === "lower" ? s.toLowerCase() : s;
  };
  for (let i = 0; i < replacement.length; i++) {
    const ch = replacement[i];
    if (ch === "\\") {
      const next = replacement[i + 1];
      if (next === "U") { caseMode = "upper"; i++; continue; }
      if (next === "L") { caseMode = "lower"; i++; continue; }
      if (next === "E") { caseMode = null; i++; continue; }
      if (next !== undefined) { emit(next); i++; continue; }
      emit("\\");
      continue;
    }
    if (ch === "$") {
      const braced = /^\$\{(\d+)\}/.exec(replacement.slice(i));
      const bare = /^\$(\d+)/.exec(replacement.slice(i));
      const m = braced ?? bare;
      if (m) {
        emit(groups[Number(m[1])] ?? "");
        i += m[0].length - 1;
        continue;
      }
    }
    emit(ch);
  }
  return out;
}

/** Replace each standard transform mirror `${N/regex/replace/flags}` in a body
 *  with a PLAIN mirror `${N}` (so CM6 instantiates and live-mirrors it from
 *  source field N), and return the rewritten body together with the parsed
 *  transforms. The bodies CM6 then expands carry only the tabstop/mirror syntax
 *  its parser covers; the transform substitution is applied live by
 *  {@link transformMirrorExtension}. */
export function extractTransforms(body: string): {
  body: string;
  transforms: SnippetTransform[];
} {
  const transforms: SnippetTransform[] = [];
  let out = body;
  let match: RegExpExecArray | null;
  while ((match = TRANSFORM_TOKEN.exec(out)) !== null) {
    const field = Number(match[1]);
    const regex = new RegExp(unescapeSlash(match[2]), match[4]);
    const replacement = unescapeSlash(match[3]);
    const mirror = `\${${field}}`;
    transforms.push({ field, regex, replacement, markerIndex: match.index });
    out = out.slice(0, match.index) + mirror + out.slice(match.index + match[0].length);
  }
  return { body: out, transforms };
}

/** Resolve `\/` (an escaped delimiter slash) to a literal `/` inside a transform
 *  regex or replacement segment; other escapes are left for the regex engine /
 *  the replacement expander. */
function unescapeSlash(segment: string): string {
  return segment.replace(/\\\//g, "/");
}

/** One armed transform tracker: the live document range holding the dependent
 *  (mirror) occurrence of field N, and the transform to apply to the source
 *  field's text. The range is the CM6-mirrored occurrence we OVERWRITE with the
 *  transformed text; the source field's current text is read from that SAME
 *  range (it is a mirror, so CM6 keeps it equal to the source field). */
interface TransformTracker {
  from: number;
  to: number;
  readonly transform: SnippetTransform;
}

/** Effect that arms a set of transform trackers for a just-expanded snippet
 *  body (the dependent mirror ranges + their transforms), or clears them. */
const setTransformTrackers = StateEffect.define<TransformTracker[]>();

/** Map a tracker's range forward through a document change. The dependent
 *  occurrence may be entirely rewritten (delete + insert) by this very field's
 *  own transform pass, so map `from` back and `to` forward to keep the range
 *  spanning the dependent slot. */
function mapTracker(tracker: TransformTracker, changes: ChangeDesc): TransformTracker {
  return {
    from: changes.mapPos(tracker.from, -1),
    to: changes.mapPos(tracker.to, 1),
    transform: tracker.transform,
  };
}

/** The armed transform trackers for the active snippet, mapped through every
 *  document change so each dependent range keeps spanning its mirror occurrence. */
const transformTrackerField = StateField.define<TransformTracker[]>({
  create() {
    return [];
  },
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(setTransformTrackers)) next = effect.value;
    }
    if (next.length && tr.docChanged) {
      next = next.map((t) => mapTracker(t, tr.changes));
    }
    return next;
  },
});

/** A user-event annotation marking the transform field's OWN rewrite dispatch,
 *  so the updateListener does not treat its own write as a source-field edit and
 *  loop. */
const TRANSFORM_REWRITE_EVENT = "snippet.transform";

/** The CM6 extension that realises transform mirrors live (B7 / P83a): it tracks
 *  each dependent mirror range and, whenever the source field changes (CM6 has
 *  mirrored the raw source text into the dependent range), overwrites that range
 *  with the TRANSFORMED text. Reads the source field's text from the dependent
 *  range itself — it is a CM6 mirror, so CM6 keeps it equal to the source field —
 *  so no access to CM6's private snippet field state is needed. */
export const transformMirrorExtension: Extension = [
  transformTrackerField,
  EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    const trackers = update.state.field(transformTrackerField);
    if (trackers.length === 0) return;
    // Do not react to our own rewrite (avoid a feedback loop).
    if (update.transactions.some((t) => t.isUserEvent(TRANSFORM_REWRITE_EVENT))) {
      return;
    }
    const doc = update.state.doc;
    const changes: { from: number; to: number; insert: string }[] = [];
    for (const { from, to, transform } of trackers) {
      // The dependent range currently holds the raw source-field text (CM6
      // mirrored it). Transform that text and overwrite the range when it differs.
      const sourceText = doc.sliceString(from, to);
      const transformed = applyTransform(sourceText, transform);
      if (transformed !== sourceText) {
        changes.push({ from, to, insert: transformed });
      }
    }
    if (changes.length === 0) return;
    queueMicrotask(() => {
      update.view.dispatch({
        changes,
        userEvent: TRANSFORM_REWRITE_EVENT,
      });
    });
  }),
];

/** Arm the transform trackers for a body just expanded at `from`. Each
 *  transform's dependent mirror was rewritten to a plain `${N}` at `markerIndex`
 *  in the stripped template; CM6 renders a bare `${N}` as a ZERO-WIDTH position
 *  (its rawName is empty). The dependent slot's absolute document offset is
 *  therefore `from` plus the RENDERED length of the stripped-template prefix up
 *  to that marker, so each tracker starts as the zero-width range there. CM6's
 *  field-mirror selection later fills it as the user types the source field, and
 *  {@link transformMirrorExtension} rewrites it with the transformed text. */
function armTransforms(
  view: EditorView,
  from: number,
  template: string,
  transforms: SnippetTransform[],
): void {
  if (transforms.length === 0) return;
  const trackers: TransformTracker[] = transforms.map((transform) => {
    const renderedPrefixLen = renderedSnippetLength(
      template.slice(0, transform.markerIndex),
    );
    const pos = from + renderedPrefixLen;
    return { from: pos, to: pos, transform };
  });
  view.dispatch({ effects: setTransformTrackers.of(trackers) });
}

/** Run a snippet body at the current cursor, expanding it through the SHARED
 *  {@link expandSnippetBody} path (resolve variables → expand via
 *  `snippetCompletion` → arm transforms). Milestone G's insertion bar, the
 *  autotrigger (P78), and the regex/postfix (P79) paths reuse this to insert a
 *  chosen snippet directly (no completion popup); the popup-accept path (P52/P77)
 *  reaches the SAME {@link expandSnippetBody} through {@link snippetOption}'s
 *  apply. The body's `$0` tabstop is honoured exactly as on accept. The standard
 *  UltiSnips `${VISUAL}` placeholder (B7 / P83b) wraps the CURRENT selection: it
 *  is resolved to the selected text HERE (the popup path has no selection to
 *  wrap), and the expansion REPLACES the selection (so `\emph{${VISUAL}}` over a
 *  selected `foo` yields `\emph{foo}`). */
export async function runSnippet(
  view: EditorView,
  body: string,
  clipboard: ClipboardTextReader,
): Promise<void> {
  const selection = view.state.selection.main;
  const selectedText = view.state.sliceDoc(selection.from, selection.to);
  const withVisual = resolveVisual(body, selectedText);
  // `${VISUAL}` wraps the selection: expand OVER the selection range (CM6's
  // snippet apply replaces `[from, to)`), so the selected text is consumed and
  // re-emitted inside the body. A bare cursor (empty selection) expands in place.
  await expandSnippetBody(view, withVisual, selection.from, selection.to, clipboard);
}

/** Resolve a snippet body's standard variables (`$CLIPBOARD`, `$CURRENT_DATE`,
 *  `$CURRENT_YEAR`) — the SHARED resolution every expansion path runs through —
 *  then expand the resolved body over `[from, to)` via the SAME
 *  `snippetCompletion` apply both the popup-accept (P52/P77) and the
 *  insertion-bar/autotrigger/regex (P59/P78/P79) paths use. Variable resolution
 *  reads the clipboard asynchronously, so this awaits the resolution BEFORE it
 *  dispatches the CM6 expansion (the CM6 apply itself is synchronous). Transform
 *  mirrors (B7 / P83a) are armed after expansion so the dependent slot tracks its
 *  source field live. The `$0` tabstop is honoured exactly as on a direct accept. */
async function expandSnippetBody(
  view: EditorView,
  body: string,
  from: number,
  to: number,
  clipboard: ClipboardTextReader,
): Promise<void> {
  const resolved = await resolveSnippetVariables(body, clipboard, new Date());
  const { body: template, transforms } = extractTransforms(resolved);
  const completion = snippetCompletion(normalizeTabstops(template), { label: "" });
  const apply = completion.apply;
  if (typeof apply !== "function") {
    throw new Error("snippetCompletion did not yield an apply function");
  }
  apply(view, completion, from, to);
  armTransforms(view, from, template, transforms);
}

/** The standard UltiSnips selection placeholder. */
const VISUAL_TOKEN = /\$\{VISUAL\}|\$VISUAL\b/g;

/** Resolve the standard UltiSnips `${VISUAL}` placeholder to the text that was
 *  selected when the snippet expands, so an entry like `\emph{${VISUAL}}` WRAPS
 *  the selection. A body without `${VISUAL}` is returned unchanged. */
function resolveVisual(body: string, selectedText: string): string {
  return body.replace(VISUAL_TOKEN, () => selectedText);
}
