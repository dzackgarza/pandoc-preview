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
import type { EditorView } from "@codemirror/view";

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

// CodeMirror's snippet-template parser only recognises a tabstop written with
// braces (`${0}`, `${1}`, …); a bare `$0` is treated as literal text. Snippet
// dictionaries author the final tabstop as the bare `$0` convention, so we
// normalise bare `$N` tabstops to the brace form the parser understands. A `$`
// that is already followed by `{` is left untouched.
function normalizeTabstops(body: string): string {
  return body.replace(/\$(\d+)/g, "${$1}");
}

/** Build a {@link Completion} for one dictionary entry: its label is the trigger
 *  and its `apply` runs the snippet body via the same `snippetCompletion`
 *  machinery the LaTeX fenced-div completions use, so accepting expands the body
 *  and lands the cursor at the declared tabstop. */
function snippetOption(entry: SnippetEntry): Completion {
  return snippetCompletion(normalizeTabstops(entry.body), {
    label: entry.trigger,
    type: "snippet",
    detail: "snippet",
  });
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
export function snippetCompletionSource(map: SnippetMap): CompletionSource {
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
      .map(snippetOption);
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

/** Run a snippet body at the current cursor, expanding it through the SAME
 *  `snippetCompletion` apply path acceptance uses. Milestone G's insertion bar
 *  reuses this to insert a chosen snippet directly (no completion popup). The
 *  body's `$0` tabstop is honoured exactly as on accept. */
export function runSnippet(view: EditorView, body: string): void {
  const completion = snippetCompletion(normalizeTabstops(body), { label: "" });
  const apply = completion.apply;
  if (typeof apply !== "function") {
    throw new Error("snippetCompletion did not yield an apply function");
  }
  const pos = view.state.selection.main.head;
  apply(view, completion, pos, pos);
}
