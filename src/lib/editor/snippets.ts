// User-defined snippet dictionary → a composable CM6 completion source (P52).
//
// A snippet dictionary is a JSON object mapping a TRIGGER token to a SNIPPET
// BODY. The body is a CodeMirror snippet template whose `$0` marks the final
// tabstop (the cursor's landing position after expansion). Typing a trigger
// surfaces a completion labelled by that trigger; accepting it replaces the
// trigger with the expanded body and drops the cursor at the tabstop.
//
// This is the EXACT pattern the vendored LaTeX language uses for fenced divs
// (vendor/codemirror-lang-latex/src/completion.ts → snippetCompletion). The
// dictionary is config-owned (editor.snippet_dictionary), so pointing config at
// a different dict offers different snippets — no hardcoded list lives here.

import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

/** A trigger → snippet-body map, the parsed shape of a snippet dictionary. */
export type SnippetMap = Record<string, string>;

/** Parse a snippet-dictionary JSON document into a {@link SnippetMap}, failing
 *  loudly on anything that is not a flat object of string→string entries. The
 *  dictionary is config-owned and validated to exist by Rust; a file that parses
 *  to the wrong shape is a hard error, never a silently-empty source. */
export function parseSnippetDictionary(json: string): SnippetMap {
  const parsed: unknown = JSON.parse(json);
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      "snippet dictionary must be a JSON object mapping trigger → body",
    );
  }
  const map: SnippetMap = {};
  for (const [trigger, body] of Object.entries(parsed)) {
    if (typeof body !== "string") {
      throw new Error(
        `snippet dictionary entry ${JSON.stringify(trigger)} must map to a string body`,
      );
    }
    if (trigger.length === 0) {
      throw new Error("snippet dictionary trigger must be non-empty");
    }
    map[trigger] = body;
  }
  return map;
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
function snippetOption(trigger: string, body: string): Completion {
  return snippetCompletion(normalizeTabstops(body), {
    label: trigger,
    type: "snippet",
    detail: "snippet",
  });
}

/** A completion source over a snippet map: when the token immediately before the
 *  cursor matches a dictionary trigger, it offers that trigger as a completion
 *  whose acceptance expands the body. `from` is the trigger start so accepting
 *  REPLACES the typed trigger with the expansion (the trigger does not survive in
 *  the buffer). Composes with the other editor sources — it returns null when no
 *  trigger token is present, leaving the LaTeX completions to answer. */
export function snippetCompletionSource(map: SnippetMap): CompletionSource {
  const triggers = Object.keys(map);
  return (context: CompletionContext): CompletionResult | null => {
    const token = context.matchBefore(/\S+/);
    if (!token || token.from === token.to) return null;
    // Offer every trigger the typed token is a prefix of; CM6 then filters the
    // labels against the typed text and highlights the best match.
    const options = triggers
      .filter((trigger) => trigger.startsWith(token.text))
      .map((trigger) => snippetOption(trigger, map[trigger]));
    if (options.length === 0) return null;
    return { from: token.from, options };
  };
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
