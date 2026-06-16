import { parseMixed } from "@lezer/common";
import type { MarkdownConfig, InlineContext } from "@lezer/markdown";
import { StreamLanguage } from "@codemirror/language";
import { stexMath } from "@codemirror/legacy-modes/mode/stex";

// stex in math mode tokenizes LaTeX control sequences (\zeta, \pi), braces,
// sub/superscripts, numbers, and operators into highlight tags. We mount it
// inside $…$ regions so math is highlighted as LaTeX rather than rendered as
// undifferentiated markdown paragraph text.
const stexMathLanguage = StreamLanguage.define(stexMath);

const DOLLAR = 36; // '$'

// A single '$' both opens and closes inline math. The markdown delimiter
// resolver pairs matching delimiters and wraps the enclosed content in an
// InlineMath node, emitting each '$' as a MathMark node.
const InlineMathDelimiter = { resolve: "InlineMath", mark: "MathMark" };

// Markdown extension: recognize $…$ inline math and embed a LaTeX math parser
// in the content between the dollar marks.
export const markdownMath: MarkdownConfig = {
  defineNodes: ["InlineMath", "MathMark"],
  parseInline: [
    {
      name: "InlineMath",
      // A lone '$' delimits inline math. Adjacent dollars ('$$', and the second
      // '$' of any pair) are not inline-math delimiters, so display math and
      // escaped sequences are left for other rules rather than mis-paired here.
      parse(cx: InlineContext, next: number, pos: number): number {
        if (
          next !== DOLLAR ||
          cx.char(pos + 1) === DOLLAR ||
          cx.char(pos - 1) === DOLLAR
        ) {
          return -1;
        }
        return cx.addDelimiter(InlineMathDelimiter, pos, pos + 1, true, true);
      },
      before: "Emphasis",
    },
  ],
  // Mount the LaTeX parser over the math content only — the [from+1, to-1] range
  // excludes the surrounding '$' marks. InlineMath is only produced when both
  // delimiters paired, so the inner range always holds at least one character.
  wrap: parseMixed((node) => {
    if (node.name !== "InlineMath") return null;
    return {
      parser: stexMathLanguage.parser,
      overlay: [{ from: node.from + 1, to: node.to - 1 }],
    };
  }),
};
