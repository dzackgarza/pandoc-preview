// Spellcheck as a CM6 decoration ViewPlugin, honoring a user-owned custom math
// dictionary (P54).
//
// The engine is `nspell` — a mature, pure-JS hunspell-compatible spellchecker —
// over the `dictionary-en` hunspell English dictionary (vendored as the base
// asset, imported below as raw .aff/.dic strings so the dictionary ships in the
// bundle and runs in the WebView with no filesystem read). This is NOT the
// browser's native spellcheck: native spellcheck cannot take a custom dictionary
// and exposes no queryable DOM mark, whereas the obligation needs both a
// config-owned math dictionary AND a stable `cm-spellError` mark on screen.
//
// The custom math dictionary is CONFIG-OWNED (editor.spell_dictionary), the same
// discipline P52's snippet dictionary uses: a plain wordlist, one word per line,
// whose every entry is `.add()`-ed into the checker so those terms are accepted.
// No hardcoded word list lives here — pointing config at a different wordlist
// accepts different terms.

import { Decoration, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import nspell from "nspell";
// Vite ?raw: bundle the vendored hunspell English dictionary as strings so the
// checker is constructed entirely in the WebView. The .aff/.dic are vendored
// under dictionaries/ (provenance: the `dictionary-en` npm package, wooorm
// hunspell English; see dictionaries/PROVENANCE) and imported relatively because
// that package's `exports` map exposes no .aff/.dic subpath and its own index.js
// reads them via node:fs, which does not exist in the renderer.
import affEn from "./dictionaries/en.aff?raw";
import dicEn from "./dictionaries/en.dic?raw";

/** The stable contract class the misspelling decoration carries. A word the
 *  checker considers misspelled renders inside an element of this class; a word
 *  it considers correct never does. ONE source of truth for the mark contract,
 *  shared with the proof spec. */
export const SPELL_ERROR_CLASS = "cm-spellError";

/** A spellchecker verdict surface: `correct(word)` is true iff the word is
 *  accepted (English base dictionary OR a custom-dictionary addition). */
export interface SpellChecker {
  correct(word: string): boolean;
}

/** Parse a plain wordlist (one word per line) into its words, dropping blank
 *  lines. This is the vim `.add` wordlist shape the user's real math dictionary
 *  uses (dotfiles/dictionaries/mathdict.utf-8.add). A line is a single word; we
 *  trim surrounding whitespace and skip empties. */
export function parseWordlist(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Build the spellchecker: the vendored hunspell English base dictionary, then
 *  every word of the config-owned custom math wordlist added as an accepted
 *  term. The custom words come from the caller (read from the config-owned path);
 *  this function never hardcodes a list. */
export function buildSpellChecker(customWords: string[]): SpellChecker {
  const spell = nspell(affEn, dicEn);
  for (const word of customWords) {
    spell.add(word);
  }
  return spell;
}

// A word token: a run of letters (with an internal apostrophe permitted, e.g.
// "doesn't"). Numbers and punctuation are not words and are never marked.
const WORD = /[A-Za-z]+(?:'[A-Za-z]+)*/g;

/** Compute the misspelling decorations over the editor's visible ranges only:
 *  for each word token in view, if the checker rejects it, mark it with
 *  {@link SPELL_ERROR_CLASS}. Decorating only visible ranges keeps the pass
 *  bounded regardless of document size. */
function computeDecorations(
  view: EditorView,
  checker: SpellChecker,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const mark = Decoration.mark({ class: SPELL_ERROR_CLASS });
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    for (const m of text.matchAll(WORD)) {
      const word = m[0];
      if (checker.correct(word)) continue;
      const start = from + (m.index ?? 0);
      builder.add(start, start + word.length, mark);
    }
  }
  return builder.finish();
}

/** A CM6 extension that marks misspelled words with {@link SPELL_ERROR_CLASS}.
 *  Recomputes on document change and on viewport change (scroll/resize), so a
 *  freshly-typed word is marked as soon as it renders. The checker is built once
 *  by the caller and closed over here. */
export function spellcheckExtension(checker: SpellChecker) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = computeDecorations(view, checker);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) {
          this.decorations = computeDecorations(u.view, checker);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}
