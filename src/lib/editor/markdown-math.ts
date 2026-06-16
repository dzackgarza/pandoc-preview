import { parseMixed } from "@lezer/common";
import type {
  MarkdownConfig,
  InlineContext,
  BlockContext,
  Line,
} from "@lezer/markdown";
import { parser as latexParser } from "codemirror-lang-latex";

// Markdown only CARVES math regions out of the host document so their content is
// not parsed as markdown; codemirror-lang-latex's grammar owns how each math
// mode is tokenized. We mount it over the FULL delimited span (dollars
// included) so the grammar sees the delimiters and selects the mode itself —
// single $ -> InlineMath, $$ -> DisplayMath — classifying control sequences,
// sub/superscripts, numbers, and operators. Mounting over the bare inner text
// would leave the grammar in text mode, where ^ and _ are parse errors.

const DOLLAR = 36; // '$'

// Distinct delimiter types so single dollars pair only with single, and double
// only with double; both carve the same MathSpan node (the grammar, not the
// markdown layer, distinguishes inline vs display).
const SingleDollar = { resolve: "MathSpan" };
const DoubleDollar = { resolve: "MathSpan" };

function parseMathInline(cx: InlineContext, next: number, pos: number): number {
  if (next !== DOLLAR) return -1;
  if (cx.char(pos + 1) === DOLLAR) {
    return cx.addDelimiter(DoubleDollar, pos, pos + 2, true, true);
  }
  // The second '$' of a pair is consumed with the first; a lone '$' both opens
  // and closes inline math.
  if (cx.char(pos - 1) === DOLLAR) return -1;
  return cx.addDelimiter(SingleDollar, pos, pos + 1, true, true);
}

function parseMathBlock(cx: BlockContext, line: Line): boolean {
  if (line.next !== DOLLAR || line.text.charCodeAt(line.pos + 1) !== DOLLAR) {
    return false;
  }
  // A $$…$$ that also closes on this line is single-line display — leave it for
  // the inline parser. Only line-spanning blocks are carved here.
  if (line.text.indexOf("$$", line.pos + 2) >= 0) return false;
  const from = cx.lineStart + line.pos;
  while (cx.nextLine()) {
    const idx = line.text.indexOf("$$", line.pos);
    if (idx >= 0) {
      const to = cx.lineStart + idx + 2;
      cx.addElement(cx.elt("MathBlock", from, to));
      cx.nextLine();
      return true;
    }
  }
  // An unterminated block extends to the document end — matches fenced-code
  // behavior and is the correct transient state while a block is being typed.
  cx.addElement(cx.elt("MathBlock", from, cx.prevLineEnd()));
  return true;
}

// Markdown extension: carve $…$ / $$…$$ (inline and single-line display) and
// line-spanning $$…$$ blocks, then mount the LaTeX grammar over each.
export const markdownMath: MarkdownConfig = {
  defineNodes: ["MathSpan", "MathBlock"],
  parseInline: [{ name: "MathSpan", parse: parseMathInline, before: "Emphasis" }],
  parseBlock: [{ name: "MathBlock", parse: parseMathBlock, before: "FencedCode" }],
  wrap: parseMixed((node) => {
    if (node.name !== "MathSpan" && node.name !== "MathBlock") return null;
    return { parser: latexParser, overlay: [{ from: node.from, to: node.to }] };
  }),
};
