// Readability sentence coloring as a CM6 decoration ViewPlugin (P120 / H.1).
//
// A THIN decoration layer — the exact shape of the spellcheck layer
// (spellcheck.ts): a `ViewPlugin.fromClass` that recomputes a `RangeSetBuilder`
// of `Decoration.mark`s over the editor's VISIBLE ranges on doc/viewport change.
// It is NOT a new engine: it reuses the same decoration machinery and the same
// math/code exclusion predicate the rest of the editor uses.
//
// Each prose SENTENCE span is marked with the stable contract class
// `cm-ppe-readability` (the sibling of spellcheck's `cm-spellError`) so a
// readability theme can color alternating sentences. Sentences that begin inside
// a math zone are SKIPPED — the same `inMathMode` predicate the fork exposes and
// the snippet/completion layers gate on, so `$…$` / `\(…\)` content is never
// marked as prose.

import { Decoration, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { inMathMode } from "codemirror-lang-latex";

/** The stable contract class each readability sentence-decoration mark carries —
 *  the sibling of spellcheck's `cm-spellError`. ONE source of truth for the mark
 *  contract, shared with the proof spec. */
export const READABILITY_MARK_CLASS = "cm-ppe-readability";

// A prose sentence: a run of non-terminator characters ending at sentence-final
// punctuation (`.`, `!`, `?`) or the end of the slice. The global flag walks
// every sentence in the visible slice. Leading whitespace is trimmed off the
// matched span so the mark hugs the sentence text.
const SENTENCE = /[^.!?\n]*[.!?]/g;

/** Compute the readability decorations over the editor's VISIBLE ranges only:
 *  for each sentence span whose first non-space character sits OUTSIDE a math
 *  zone (the `inMathMode` predicate), mark the trimmed sentence with
 *  {@link READABILITY_MARK_CLASS}. Decorating only visible ranges keeps the pass
 *  bounded regardless of document size (the spellcheck precedent). */
function computeDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const mark = Decoration.mark({ class: READABILITY_MARK_CLASS });
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    for (const m of text.matchAll(SENTENCE)) {
      const raw = m[0];
      // Trim leading whitespace so the mark starts at the first prose character.
      const lead = raw.length - raw.trimStart().length;
      const body = raw.slice(lead);
      if (body.trim().length === 0) continue;
      const start = from + (m.index ?? 0) + lead;
      const end = start + body.length;
      // Exclude sentences that start inside a math zone — the SAME predicate the
      // fork exposes and the snippet/completion layers gate on. `$x = 1.$` prose
      // never gets a readability mark.
      if (inMathMode(view.state, start)) continue;
      builder.add(start, end, mark);
    }
  }
  return builder.finish();
}

/** A CM6 extension marking prose sentence spans with
 *  {@link READABILITY_MARK_CLASS}. Recomputes on document change and on viewport
 *  change (scroll/resize), so freshly-typed or scrolled-in sentences are marked
 *  as soon as they render — the spellcheck ViewPlugin pattern verbatim. The
 *  empty array (the compartment's OFF value) installs no plugin, so no marks
 *  appear. */
export function readabilityExtension() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = computeDecorations(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) {
          this.decorations = computeDecorations(u.view);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}
