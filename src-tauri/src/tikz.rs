//! D-1 keystone (P90): an owned, pure-Rust parser/serializer for the TikzIt
//! subset of pgf/TikZ.
//!
//! ## Survey / crate choice
//!
//! No maintained crate parses the TikzIt `.tikz` format into a structured graph:
//! `rust_tikz` is a TeX→SVG runtime, `svg-tikz` converts SVG→TikZ, and
//! `depict-tikz` is a layout/generator. All emit or render TikZ; none ingest
//! TikzIt source. The reference parser is the TikzIt bison/flex grammar
//! (`tikzparser.y` / `tikzlexer.l`) plus the `Graph::tikz()` serializer in the
//! TikzIt C++ source. That grammar is ported here.
//!
//! The port uses [`nom`], a parser-combinator crate already present in this
//! crate's lock graph (so no new build-graph node is introduced). `nom` carries
//! the byte offset of the failing input through its error type, which lets us
//! report the offending line number — P90 requires a LOUD structured error that
//! names the offending line, never a silent partial/empty graph.
//!
//! ## Grammar (TikzIt subset)
//!
//! ```text
//! tikzpicture := "\begin{tikzpicture}" body "\end{tikzpicture}"
//! body        := ( boundingbox | "\begin{pgfonlayer}{" name "}" item* "\end{pgfonlayer}" )*
//! boundingbox := "\path" props "(" num "," num ")" "rectangle" "(" num "," num ")" ";"
//! item        := node | edge
//! node        := "\node" props? "(" name ")" "at" "(" num "," num ")" "{" label "}" ";"
//! edge        := "\draw" props? "(" name ")" "to" "(" name ")" ";"
//! props       := "[" ... "]"   (raw bracket content, preserved verbatim)
//! ```
//!
//! ## Round-trip contract
//!
//! [`parse`] yields a [`Graph`]; [`Graph::to_tikz`] serializes it to canonical
//! source. The serialization is canonical and stable: re-parsing it yields a
//! structurally equal [`Graph`], and re-serializing that yields byte-identical
//! source (idempotence). Property brackets are preserved verbatim so no edge
//! option (`in=`, `out=`, `bend right`, …) is lost, even though only `style=` is
//! surfaced through [`Node::style`] / [`Edge::style`].

use std::fmt;

use serde::Serialize;

use nom::{
    bytes::complete::{tag, take_until},
    character::complete::{char, multispace0},
    combinator::{opt, recognize},
    multi::many0,
    number::complete::double,
    sequence::{delimited, preceded},
    IResult, Parser,
};

/// A bounding-box rectangle: `\path [use as bounding box] (x1,y1) rectangle (x2,y2);`.
#[derive(Debug, Clone, PartialEq)]
pub struct BoundingBox {
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
}

impl BoundingBox {
    /// The lower-left corner `(x1, y1)`.
    pub fn lower_left(&self) -> (f64, f64) {
        (self.x1, self.y1)
    }

    /// The upper-right corner `(x2, y2)`.
    pub fn upper_right(&self) -> (f64, f64) {
        (self.x2, self.y2)
    }
}

/// A TikzIt node: `\node [props] (name) at (x, y) {label};`.
#[derive(Debug, Clone, PartialEq)]
pub struct Node {
    name: String,
    x: f64,
    y: f64,
    /// Raw bracket content (everything between `[` and `]`), preserved verbatim
    /// so every option round-trips. `None` when the node has no `[...]`.
    props: Option<String>,
    label: String,
}

impl Node {
    /// The node's name (the parenthesised identifier).
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The node's `(x, y)` coordinate.
    pub fn coord(&self) -> (f64, f64) {
        (self.x, self.y)
    }

    /// The value of the `style=` key in the property bracket, if present.
    pub fn style(&self) -> Option<&str> {
        self.props.as_deref().and_then(extract_style)
    }

    /// The brace-delimited label, verbatim (may be empty).
    pub fn label(&self) -> &str {
        &self.label
    }
}

/// A TikzIt edge: `\draw [props] (source) to (target);`.
#[derive(Debug, Clone, PartialEq)]
pub struct Edge {
    source: String,
    target: String,
    /// Raw bracket content, preserved verbatim. `None` when the edge has no `[...]`.
    props: Option<String>,
}

impl Edge {
    /// The source node name.
    pub fn source(&self) -> &str {
        &self.source
    }

    /// The target node name.
    pub fn target(&self) -> &str {
        &self.target
    }

    /// The value of the `style=` key in the property bracket, if present.
    pub fn style(&self) -> Option<&str> {
        self.props.as_deref().and_then(extract_style)
    }
}

/// The parsed structured model of a `tikzpicture`.
#[derive(Debug, Clone, PartialEq)]
pub struct Graph {
    bbox: Option<BoundingBox>,
    nodes: Vec<Node>,
    edges: Vec<Edge>,
}

impl Graph {
    /// The parsed nodes, in source order.
    pub fn nodes(&self) -> &[Node] {
        &self.nodes
    }

    /// The parsed edges, in source order.
    pub fn edges(&self) -> &[Edge] {
        &self.edges
    }

    /// The bounding box, if the source declared one.
    pub fn bbox(&self) -> Option<&BoundingBox> {
        self.bbox.as_ref()
    }

    /// Form the subgraph INDUCED by a set of selected node names (D-8 / P97):
    /// the nodes whose names are in `selected` (with their coordinates, props,
    /// and labels intact, taken from this fully-parsed graph) plus EXACTLY the
    /// edges whose BOTH endpoints are selected. Every other node and every edge
    /// with an endpoint outside the selection is dropped. The bounding box is
    /// dropped: a sub-selection's box would be a fabricated extent, not an owned
    /// fact. Node/edge source order is preserved so the result serializes
    /// deterministically through [`Graph::to_tikz`].
    ///
    /// This is the TikzIt "copy a region of nodes" model: the induced subgraph is
    /// the selected vertices and the edges internal to them.
    pub fn induced_subgraph(&self, selected: &[String]) -> Graph {
        let nodes: Vec<Node> = self
            .nodes
            .iter()
            .filter(|n| selected.iter().any(|s| s == &n.name))
            .cloned()
            .collect();
        let edges: Vec<Edge> = self
            .edges
            .iter()
            .filter(|e| {
                nodes.iter().any(|n| n.name == e.source) && nodes.iter().any(|n| n.name == e.target)
            })
            .cloned()
            .collect();
        Graph {
            bbox: None,
            nodes,
            edges,
        }
    }

    /// Serialize the model back to canonical tikz source.
    ///
    /// Layout mirrors the TikzIt `Graph::tikz()` serializer: a tab-indented
    /// `tikzpicture`, an optional bounding-box `\path`, then a `nodelayer` and
    /// an `edgelayer` `pgfonlayer`. The output is canonical and stable —
    /// re-parsing then re-serializing reproduces this exact string.
    pub fn to_tikz(&self) -> String {
        let mut out = String::new();
        out.push_str("\\begin{tikzpicture}\n");

        if let Some(b) = &self.bbox {
            out.push_str(&format!(
                "\t\\path [use as bounding box] ({}, {}) rectangle ({}, {});\n",
                fmt_num(b.x1),
                fmt_num(b.y1),
                fmt_num(b.x2),
                fmt_num(b.y2),
            ));
        }

        out.push_str("\t\\begin{pgfonlayer}{nodelayer}\n");
        for n in &self.nodes {
            out.push_str("\t\t\\node ");
            if let Some(p) = &n.props {
                out.push_str(&format!("[{}] ", p));
            }
            out.push_str(&format!(
                "({}) at ({}, {}) {{{}}};\n",
                n.name,
                fmt_num(n.x),
                fmt_num(n.y),
                n.label,
            ));
        }
        out.push_str("\t\\end{pgfonlayer}\n");

        out.push_str("\t\\begin{pgfonlayer}{edgelayer}\n");
        for e in &self.edges {
            out.push_str("\t\t\\draw ");
            if let Some(p) = &e.props {
                out.push_str(&format!("[{}] ", p));
            }
            out.push_str(&format!("({}) to ({});\n", e.source, e.target));
        }
        out.push_str("\t\\end{pgfonlayer}\n");

        out.push_str("\\end{tikzpicture}\n");
        out
    }
}

/// A loud, structured parse error that names the offending line.
#[derive(Debug, Clone, PartialEq)]
pub struct TikzError {
    line: usize,
    /// A short, faithful excerpt of the offending line for diagnosis.
    excerpt: String,
    /// What the parser expected at that locus.
    reason: String,
}

impl fmt::Display for TikzError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "tikz parse error on line {}: {} (near: {:?})",
            self.line, self.reason, self.excerpt
        )
    }
}

impl std::error::Error for TikzError {}

/// Parse TikzIt-class `.tikz` source into the structured [`Graph`] model.
///
/// On malformed input this returns a [`TikzError`] naming the offending line —
/// never a silent empty or partial graph.
pub fn parse(src: &str) -> Result<Graph, TikzError> {
    match graph(src) {
        Ok((rest, g)) => {
            let rest_trimmed = rest.trim_start();
            if rest_trimmed.is_empty() {
                Ok(g)
            } else {
                Err(locate(
                    src,
                    rest,
                    "unexpected trailing input after \\end{tikzpicture}",
                ))
            }
        }
        Err(nom::Err::Error(e)) | Err(nom::Err::Failure(e)) => {
            Err(locate(src, e.input, "malformed tikz construct"))
        }
        Err(nom::Err::Incomplete(_)) => Err(TikzError {
            line: src.lines().count().max(1),
            excerpt: src.lines().last().unwrap_or("").trim().to_string(),
            reason: "unexpected end of input (unterminated construct)".to_string(),
        }),
    }
}

/// A JSON-serializable node, the shape the `parseTikz` E2E observable returns
/// (D-8 / P97): name, coordinates, the `style=` value (or null), and the label.
#[derive(Debug, Serialize)]
pub struct ParsedNode {
    name: String,
    x: f64,
    y: f64,
    style: Option<String>,
    label: String,
}

/// A JSON-serializable edge: endpoints and the `style=` value (or null).
#[derive(Debug, Serialize)]
pub struct ParsedEdge {
    source: String,
    target: String,
    style: Option<String>,
}

/// The JSON-serializable structured graph the `parseTikz` observable returns.
#[derive(Debug, Serialize)]
pub struct ParsedGraph {
    nodes: Vec<ParsedNode>,
    edges: Vec<ParsedEdge>,
}

/// Re-parse tikz `source` through the D-1 / P90 parser and return its structured
/// node/edge content (D-8 / P97). This is the faithful re-parse the subgraph-copy
/// obligation demands: clipboard text written by [`crate::clipboard::copy_subgraph_tikz`]
/// is fed back through this command and the recovered structure is asserted to be
/// EXACTLY the selected subgraph — proving the clipboard carries canonical,
/// round-trippable tikz. A `source` that is not parseable tikz is a LOUD error.
#[tauri::command]
pub fn parse_tikz(source: String) -> crate::error::Result<ParsedGraph> {
    let g = parse(&source)
        .map_err(|e| crate::error::Error::InvalidArgument(format!("tikz parse failed: {e}")))?;
    Ok(ParsedGraph {
        nodes: g
            .nodes()
            .iter()
            .map(|n| ParsedNode {
                name: n.name().to_string(),
                x: n.coord().0,
                y: n.coord().1,
                style: n.style().map(str::to_string),
                label: n.label().to_string(),
            })
            .collect(),
        edges: g
            .edges()
            .iter()
            .map(|e| ParsedEdge {
                source: e.source().to_string(),
                target: e.target().to_string(),
                style: e.style().map(str::to_string),
            })
            .collect(),
    })
}

/// Extract the node names defined in a selected source FRAGMENT (D-8 / P97).
///
/// A TikzIt "select a region of nodes" gesture covers a contiguous span of node
/// definition lines — a PROPER SUBSET of a picture's source, NOT a full
/// `tikzpicture` envelope — so [`parse`] (which demands the envelope) cannot
/// read it. This runs the SAME D-1 `\node` parser ([`node`]) over the fragment
/// with `many0`, returning the names of the nodes the selection covers, in
/// source order. The induced subgraph is then formed by
/// [`Graph::induced_subgraph`] against the FULLY-parsed picture, so each selected
/// node's authoritative coordinates/props/label come from the real source.
///
/// A fragment that covers no parseable `\node` (an empty or non-node selection)
/// yields an empty name list; the caller turns the resulting empty subgraph into
/// a LOUD error rather than copying a raw-text guess.
pub fn node_names_in(fragment: &str) -> Vec<String> {
    match many0(node).parse(fragment) {
        Ok((_, ns)) => ns.into_iter().map(|n| n.name).collect(),
        Err(_) => Vec::new(),
    }
}

/// Turn a position in `frag` (a sub-slice of `src`, not necessarily a suffix)
/// into a `TikzError` that names the 1-based line number and quotes the
/// offending line.
///
/// nom returns the failing input as a borrowed sub-slice of the original
/// source, so the byte offset is recovered by pointer arithmetic against
/// `src` — length subtraction would be wrong for a slice taken from the middle
/// of the source (e.g. a `pgfonlayer` body), which is exactly where a
/// malformed node/edge surfaces.
fn locate(src: &str, frag: &str, reason: &str) -> TikzError {
    let base = src.as_ptr() as usize;
    let here = frag.as_ptr() as usize;
    assert!(
        here >= base && here <= base + src.len(),
        "tikz error fragment is not a sub-slice of the source"
    );
    let offset = here - base;
    let line = src[..offset].bytes().filter(|&b| b == b'\n').count() + 1;
    let excerpt = src.lines().nth(line - 1).unwrap_or("").trim().to_string();
    TikzError {
        line,
        excerpt,
        reason: reason.to_string(),
    }
}

/// Extract the value of the `style=` key from a raw bracket-content string.
/// The value runs from after `style=` up to the next top-level comma.
fn extract_style(props: &str) -> Option<&str> {
    for part in props.split(',') {
        let part = part.trim();
        if let Some(rest) = part.strip_prefix("style=") {
            return Some(rest);
        }
        if let Some(rest) = part.strip_prefix("style =") {
            return Some(rest.trim_start());
        }
    }
    None
}

/// Format an `f64` canonically: integral values lose the trailing `.0`, others
/// print with the minimal `{}` representation. Stable under re-parse.
fn fmt_num(x: f64) -> String {
    if x == x.trunc() && x.is_finite() {
        format!("{}", x as i64)
    } else {
        format!("{}", x)
    }
}

// ---------------------------------------------------------------------------
// nom parsers (port of the TikzIt grammar subset)
// ---------------------------------------------------------------------------

/// Skip insignificant whitespace before a token.
fn ws<'a, O, F>(inner: F) -> impl Parser<&'a str, Output = O, Error = nom::error::Error<&'a str>>
where
    F: Parser<&'a str, Output = O, Error = nom::error::Error<&'a str>>,
{
    preceded(multispace0, inner)
}

/// A property bracket `[ ... ]`, returning the verbatim inner content. The
/// inner content has no nested `]` in the TikzIt subset.
fn props(input: &str) -> IResult<&str, &str> {
    delimited(ws(char('[')), take_until("]"), char(']')).parse(input)
}

/// A parenthesised name `( ... )`, returning the trimmed identifier.
fn paren_name(input: &str) -> IResult<&str, &str> {
    let (input, raw) = delimited(ws(char('(')), take_until(")"), char(')')).parse(input)?;
    Ok((input, raw.trim()))
}

/// A brace-delimited label `{ ... }`, verbatim (may be empty, may contain
/// balanced TeX braces such as `\bar{x}`).
fn brace_label(input: &str) -> IResult<&str, &str> {
    let (input, _) = ws(char('{')).parse(input)?;
    // Walk to the matching close brace, tracking nesting so `\bar{x}` is kept.
    let mut depth = 1usize;
    for (i, c) in input.char_indices() {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    let (label, rest) = input.split_at(i);
                    return Ok((&rest[1..], label));
                }
            }
            _ => {}
        }
    }
    Err(nom::Err::Error(nom::error::Error::new(
        input,
        nom::error::ErrorKind::Char,
    )))
}

/// A signed decimal coordinate component.
fn number(input: &str) -> IResult<&str, f64> {
    ws(double).parse(input)
}

/// `( num , num )` — a coordinate pair.
fn coord(input: &str) -> IResult<&str, (f64, f64)> {
    let (input, _) = ws(char('(')).parse(input)?;
    let (input, x) = number(input)?;
    let (input, _) = ws(char(',')).parse(input)?;
    let (input, y) = number(input)?;
    let (input, _) = ws(char(')')).parse(input)?;
    Ok((input, (x, y)))
}

/// `\node [props]? (name) at (x, y) {label};`
fn node(input: &str) -> IResult<&str, Node> {
    let (input, _) = ws(tag("\\node")).parse(input)?;
    let (input, p) = opt(props).parse(input)?;
    let (input, name) = paren_name(input)?;
    let (input, _) = ws(tag("at")).parse(input)?;
    let (input, (x, y)) = coord(input)?;
    let (input, label) = brace_label(input)?;
    let (input, _) = ws(char(';')).parse(input)?;
    Ok((
        input,
        Node {
            name: name.to_string(),
            x,
            y,
            props: p.map(str::to_string),
            label: label.to_string(),
        },
    ))
}

/// `\draw [props]? (source) to (target);`
fn edge(input: &str) -> IResult<&str, Edge> {
    let (input, _) = ws(tag("\\draw")).parse(input)?;
    let (input, p) = opt(props).parse(input)?;
    let (input, source) = paren_name(input)?;
    let (input, _) = ws(tag("to")).parse(input)?;
    let (input, target) = paren_name(input)?;
    let (input, _) = ws(char(';')).parse(input)?;
    Ok((
        input,
        Edge {
            source: source.to_string(),
            target: target.to_string(),
            props: p.map(str::to_string),
        },
    ))
}

/// `\path [use as bounding box] (x1,y1) rectangle (x2,y2);`
fn bounding_box(input: &str) -> IResult<&str, BoundingBox> {
    let (input, _) = ws(tag("\\path")).parse(input)?;
    let (input, _) = opt(props).parse(input)?;
    let (input, (x1, y1)) = coord(input)?;
    let (input, _) = ws(tag("rectangle")).parse(input)?;
    let (input, (x2, y2)) = coord(input)?;
    let (input, _) = ws(char(';')).parse(input)?;
    Ok((input, BoundingBox { x1, y1, x2, y2 }))
}

/// `\begin{pgfonlayer}{<name>}` … `\end{pgfonlayer}`, returning the layer name
/// and the verbatim body (re-parsed by the caller into nodes/edges).
fn pgfonlayer(input: &str) -> IResult<&str, (&str, &str)> {
    let (input, _) = ws(tag("\\begin{pgfonlayer}")).parse(input)?;
    let (input, name) = recognize(delimited(char('{'), take_until("}"), char('}'))).parse(input)?;
    let (input, body) = take_until("\\end{pgfonlayer}").parse(input)?;
    let (input, _) = tag("\\end{pgfonlayer}").parse(input)?;
    Ok((input, (name, body)))
}

/// A node layer body: zero or more nodes.
fn node_layer_body(input: &str) -> IResult<&str, Vec<Node>> {
    let (input, ns) = many0(node).parse(input)?;
    let (input, _) = multispace0(input)?;
    Ok((input, ns))
}

/// An edge layer body: zero or more edges.
fn edge_layer_body(input: &str) -> IResult<&str, Vec<Edge>> {
    let (input, es) = many0(edge).parse(input)?;
    let (input, _) = multispace0(input)?;
    Ok((input, es))
}

/// The whole `\begin{tikzpicture}` … `\end{tikzpicture}` envelope.
fn graph(input: &str) -> IResult<&str, Graph> {
    let (input, _) = ws(tag("\\begin{tikzpicture}")).parse(input)?;

    let mut bbox = None;
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let mut rest = input;

    loop {
        let after_ws = multispace0::<&str, nom::error::Error<&str>>(rest)
            .map(|(r, _)| r)
            .unwrap_or(rest);

        if after_ws.starts_with("\\end{tikzpicture}") {
            rest = after_ws;
            break;
        }

        if after_ws.starts_with("\\path") {
            let (r, b) = bounding_box(rest)?;
            bbox = Some(b);
            rest = r;
            continue;
        }

        if after_ws.starts_with("\\begin{pgfonlayer}") {
            let (r, (name, body)) = pgfonlayer(rest)?;
            // The layer name carries surrounding braces from `recognize`.
            if name.contains("nodelayer") {
                let (body_rest, ns) = node_layer_body(body)?;
                if !body_rest.trim().is_empty() {
                    return Err(nom::Err::Failure(nom::error::Error::new(
                        body_rest,
                        nom::error::ErrorKind::Many0,
                    )));
                }
                nodes.extend(ns);
            } else if name.contains("edgelayer") {
                let (body_rest, es) = edge_layer_body(body)?;
                if !body_rest.trim().is_empty() {
                    return Err(nom::Err::Failure(nom::error::Error::new(
                        body_rest,
                        nom::error::ErrorKind::Many0,
                    )));
                }
                edges.extend(es);
            } else {
                return Err(nom::Err::Failure(nom::error::Error::new(
                    rest,
                    nom::error::ErrorKind::Tag,
                )));
            }
            rest = r;
            continue;
        }

        // Anything else inside the envelope is malformed; fail loudly at this
        // locus so `locate` can name the line.
        return Err(nom::Err::Failure(nom::error::Error::new(
            after_ws,
            nom::error::ErrorKind::Tag,
        )));
    }

    let (rest, _) = ws(tag("\\end{tikzpicture}")).parse(rest)?;
    Ok((rest, Graph { bbox, nodes, edges }))
}
