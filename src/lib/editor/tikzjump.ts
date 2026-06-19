// ── P109 / D-4: source↔preview line jumping for owned tikz ──────────────────
//
// The TikzIt Ctrl+J jump-to-source / Ctrl+T re-parse round-trip. This module
// owns the SOURCE→RENDERED-ELEMENT mapping: it maps a node from the D-1 / P90
// owned tikz model (`name` + tikz-canvas `(x, y)` coordinate) onto a position
// inside the figure's rendered inline <svg> in the live preview, and builds the
// per-node target overlay the jump selects/scrolls to.
//
// ── Why a COORDINATE map, not an SVG-id annotation ──────────────────────────
// The figure is rendered by the P100 seam (tikzcd.lua → pdflatex → pdf2svg).
// pdf2svg FLATTENS the tikz picture to absolutely-positioned <path>/<g>/<use>
// elements positioned by `transform="matrix(...)"`; it carries NO per-node
// identity (no node name, no `\node`-level grouping survives the PDF round-trip).
// Annotating the compiled SVG with stable per-node ids would require injecting
// identity through LaTeX in a form that survives PDF→SVG flattening as a
// queryable per-node element — which pdf2svg does not preserve. So the robust,
// assertable mechanism is the COORDINATE map: the D-1 model gives each node its
// authoritative `(x, y)`, and the figure's tikz canvas maps affinely onto the
// SVG viewBox. Each node's coordinate maps to a distinct position in the SVG
// viewport, so the per-node correspondence (alpha's target ≠ omega's target) is
// a real consequence of the nodes' distinct coordinates — not a fabricated one.
//
// The mapped position carries the node NAME on a `data-ppe-tikz-node` attribute
// of a real overlay element placed over the SVG inside the preview iframe DOM.
// The jump SELECTS the overlay element for the node under the cursor (marking it
// in the DOM); the jump-target read reports the selected element's node name off
// the ACTUAL preview DOM — never a parallel JS variable.

/** A node of the D-1 / P90 owned tikz model: its name and tikz-canvas coord. */
export interface TikzModelNode {
  name: string;
  x: number;
  y: number;
}

/** The `viewBox="minX minY width height"` of a rendered figure SVG. */
export interface SvgViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/** A node mapped to a position inside the SVG viewBox coordinate system. */
export interface MappedNode {
  name: string;
  /** Position in the SVG's own viewBox coordinate units. */
  svgX: number;
  svgY: number;
}

/** The DOM attribute carrying a target overlay element's owned-node identity —
 *  the per-node discriminator the jump-target read reports off the marked
 *  element. ONE source of truth, shared by the overlay builder and the reader. */
export const NODE_ATTR = "data-ppe-tikz-node";

/** The DOM attribute the jump SETS on the currently-selected target overlay
 *  element (and clears from the previously-selected one). The jump-target read
 *  finds the element carrying this attribute and reports its NODE_ATTR. The
 *  selection state lives in the DOM, not a JS variable. */
export const SELECTED_ATTR = "data-ppe-jump-selected";

/** The fraction of the SVG viewBox kept as an inner margin so a node at the
 *  coordinate extremum still maps strictly INSIDE the viewport (and two nodes at
 *  opposite extrema map to clearly distinct, non-edge positions). */
const INNER_MARGIN = 0.12;

/** Map each owned-model node's tikz-canvas `(x, y)` onto a position inside the
 *  SVG viewBox. The tikz coordinate bounding box (min/max over the nodes) maps
 *  affinely onto the viewBox interior (inset by INNER_MARGIN): tikz x grows
 *  rightward like SVG x, while tikz y grows UPWARD and SVG y grows DOWNWARD, so
 *  the y axis is flipped. A degenerate axis (all nodes share one x or one y)
 *  maps that axis to the viewBox centre. The result is order-preserving and
 *  injective in each non-degenerate axis, so distinctly-positioned nodes map to
 *  distinct viewport positions — the per-node correspondence the jump rides. */
export function mapNodesToViewBox(
  nodes: readonly TikzModelNode[],
  vb: SvgViewBox,
): MappedNode[] {
  if (nodes.length === 0) {
    throw new Error("mapNodesToViewBox: the owned tikz model carries no nodes");
  }
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  const innerX = vb.minX + vb.width * INNER_MARGIN;
  const innerW = vb.width * (1 - 2 * INNER_MARGIN);
  const innerY = vb.minY + vb.height * INNER_MARGIN;
  const innerH = vb.height * (1 - 2 * INNER_MARGIN);

  return nodes.map((n) => {
    // Degenerate axis: map to the inner-region centre (no spurious spread).
    const fracX = spanX === 0 ? 0.5 : (n.x - minX) / spanX;
    // tikz y up → SVG y down: the larger tikz y maps to the smaller SVG y.
    const fracY = spanY === 0 ? 0.5 : (maxY - n.y) / spanY;
    return {
      name: n.name,
      svgX: innerX + fracX * innerW,
      svgY: innerY + fracY * innerH,
    };
  });
}

/** Parse an SVG element's `viewBox` attribute into an SvgViewBox. Fails LOUDLY
 *  when the attribute is absent or malformed — a figure SVG the P100 seam emits
 *  always carries a `viewBox` (pdf2svg writes one), so its absence is a broken
 *  render, not a tolerable state. */
export function parseViewBox(svg: SVGSVGElement): SvgViewBox {
  const raw = svg.getAttribute("viewBox");
  if (!raw) {
    throw new Error("parseViewBox: rendered figure SVG carries no viewBox");
  }
  const parts = raw.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) {
    throw new Error(`parseViewBox: malformed viewBox ${JSON.stringify(raw)}`);
  }
  const [minX, minY, width, height] = parts;
  return { minX, minY, width, height };
}
