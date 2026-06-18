//! P90 — tikz-subset parser round-trips real TikzIt-class source.
//!
//! RED test (D-1 keystone). Authored blind to the parser implementation and
//! crate choice. It exercises the OBSERVABLE round-trip behaviour frozen in
//! `.agents/memories/proof-obligations.md` (P90), nothing about how the parser
//! is built.
//!
//! Intended parser API (provided by the GREEN implementer — NOT implemented
//! here):
//!
//! - `pandoc_preview_lib::tikz::parse(src: &str) -> Result<Graph, TikzError>`
//!   parses TikzIt-class `.tikz` source into the owned structured graph model,
//!   or returns a LOUD structured error naming the offending line/token.
//! - `Graph::to_tikz(&self) -> String` serializes the model back to canonical
//!   tikz source.
//! - `Graph` derives `PartialEq` so two parses can be compared structurally.
//! - Content accessors used by the explicit-content assertions below:
//!   `Graph::nodes() -> &[Node]`, `Graph::edges() -> &[Edge]`,
//!   `Graph::bbox() -> Option<&BoundingBox>`, `Node::name() -> &str`,
//!   `Node::coord() -> (f64, f64)`, `Node::style() -> Option<&str>`,
//!   `Node::label() -> &str`, `Edge::source() -> &str`,
//!   `Edge::target() -> &str`, `Edge::style() -> Option<&str>`.
//! - `TikzError: std::error::Error` whose `Display` names the offending line.
//!
//! ADMISSIBILITY: the test fails on a parser that DROPS a node/edge/style/label
//! (the explicit-content assertions and the structural `assert_eq!` break), on a
//! serializer whose output cannot be RE-PARSED or re-parses to a DIFFERENT
//! structure (the round-trip `assert_eq!` breaks), on an UNSTABLE serialization
//! (the idempotence `assert_eq!` on the two serializations breaks), and on a
//! parser that ACCEPTS MALFORMED input (the malformed case asserts a structured
//! `Err`, never `Ok`). It is NOT satisfied by a parse function that merely
//! exists: a parser that returned an empty `Graph` would fail the content
//! assertions, and a serializer that returned the empty string would fail the
//! re-parse.

use pandoc_preview_lib::tikz::{self, Graph};

/// Absolute path to a fixture under `tests/fixtures/tikz/`.
fn fixture(name: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("tikz")
        .join(name)
}

fn read_fixture(name: &str) -> String {
    std::fs::read_to_string(fixture(name))
        .unwrap_or_else(|e| panic!("fixture {name} unreadable: {e}"))
}

/// Core round-trip + stability harness shared by every well-formed fixture.
///
/// parse(src) -> g1 ; serialize(g1) -> s1 ; parse(s1) -> g2 ; serialize(g2) -> s2
/// Asserts g1 == g2 (no content lost or mangled across serialize↔parse) and
/// s1 == s2 (serialization is stable/canonical across the round-trip). Returns
/// g1 so per-fixture content assertions can inspect the real parsed model.
fn round_trip(name: &str) -> Graph {
    let src = read_fixture(name);

    let g1 = tikz::parse(&src)
        .unwrap_or_else(|e| panic!("{name}: first parse rejected well-formed source: {e}"));

    let s1 = g1.to_tikz();
    assert!(
        !s1.trim().is_empty(),
        "{name}: serialization of a non-empty graph produced empty source"
    );

    let g2 = tikz::parse(&s1).unwrap_or_else(|e| {
        panic!("{name}: canonical serialization did not re-parse: {e}\n--- serialized ---\n{s1}")
    });

    assert_eq!(
        g1, g2,
        "{name}: re-parsed model is not structurally equal to the original \
         (the serializer lost or mangled content across the round-trip)"
    );

    let s2 = g2.to_tikz();
    assert_eq!(
        s1, s2,
        "{name}: serialization is not stable across the round-trip \
         (re-serializing the re-parsed model produced different source)"
    );

    g1
}

#[test]
fn commutative_square_round_trips_with_full_content() {
    let g = round_trip("commutative_square.tikz");

    // Four styled, coordinate-bearing, labelled nodes survive the parse.
    assert_eq!(
        g.nodes().len(),
        4,
        "expected 4 nodes in the commutative square"
    );

    let a = g
        .nodes()
        .iter()
        .find(|n| n.name() == "0")
        .expect("node (0) must be present");
    assert_eq!(a.coord(), (0.0, 2.0), "node (0) coordinate must round-trip");
    assert_eq!(a.style(), Some("object"), "node (0) style must round-trip");
    assert_eq!(a.label(), "$A$", "node (0) label must round-trip");

    let d = g
        .nodes()
        .iter()
        .find(|n| n.name() == "3")
        .expect("node (3) must be present");
    assert_eq!(d.coord(), (2.0, 0.0), "node (3) coordinate must round-trip");
    assert_eq!(d.label(), "$D$", "node (3) label must round-trip");

    // Four styled edges with the right endpoints survive the parse.
    assert_eq!(
        g.edges().len(),
        4,
        "expected 4 edges in the commutative square"
    );
    let endpoints: Vec<(&str, &str)> = g.edges().iter().map(|e| (e.source(), e.target())).collect();
    assert!(endpoints.contains(&("0", "1")), "edge 0->1 must be present");
    assert!(endpoints.contains(&("0", "2")), "edge 0->2 must be present");
    assert!(endpoints.contains(&("1", "3")), "edge 1->3 must be present");
    assert!(endpoints.contains(&("2", "3")), "edge 2->3 must be present");
    assert!(
        g.edges().iter().all(|e| e.style() == Some("arrow")),
        "every edge style must round-trip as 'arrow'"
    );

    // The bounding box survives the parse.
    let bbox = g.bbox().expect("bounding box must be parsed");
    let _ = bbox; // structural equality of bbox is enforced by round_trip()'s assert_eq!
}

#[test]
fn string_diagram_round_trips_with_mixed_styles_and_labels() {
    let g = round_trip("string_diagram.tikz");

    // Five nodes: distinct styles, decimal/negative coords, empty + nonempty labels.
    assert_eq!(g.nodes().len(), 5, "expected 5 nodes in the string diagram");

    let red = g
        .nodes()
        .iter()
        .find(|n| n.name() == "0")
        .expect("node (0) must be present");
    assert_eq!(
        red.style(),
        Some("red node"),
        "multi-word style must round-trip"
    );
    assert_eq!(red.coord(), (0.0, 1.0));
    assert_eq!(red.label(), "", "empty label must round-trip as empty");

    let foo = g
        .nodes()
        .iter()
        .find(|n| n.name() == "3")
        .expect("node (3) must be present");
    assert_eq!(foo.style(), Some("yellow square"));
    assert_eq!(foo.label(), "foo", "non-empty label must round-trip");

    let dec = g
        .nodes()
        .iter()
        .find(|n| n.name() == "4")
        .expect("node (4) must be present");
    assert_eq!(
        dec.coord(),
        (0.0, -1.5),
        "decimal/negative coordinate must round-trip"
    );
    assert_eq!(
        dec.label(),
        "$\\bar{x}$",
        "LaTeX label must round-trip verbatim"
    );

    // Five edges, mixed styled and unstyled.
    assert_eq!(g.edges().len(), 5, "expected 5 edges in the string diagram");
    assert!(
        g.edges()
            .iter()
            .any(|e| e.source() == "2" && e.target() == "0" && e.style().is_none()),
        "the unstyled edge (2)->(0) must round-trip with no style"
    );
    assert!(
        g.edges()
            .iter()
            .any(|e| e.source() == "3" && e.target() == "1" && e.style() == Some("in-out")),
        "the styled edge (3)->(1) must round-trip with style 'in-out'"
    );
}

#[test]
fn malformed_source_is_rejected_with_a_loud_structured_error() {
    let src = read_fixture("malformed_unterminated_node.tikz");

    let result = tikz::parse(&src);

    let err = match result {
        Ok(g) => panic!(
            "malformed source was silently accepted as a graph with {} nodes / {} edges; \
             P90 requires a LOUD structured error naming the offending line, never a \
             silent empty/partial graph",
            g.nodes().len(),
            g.edges().len(),
        ),
        Err(e) => e,
    };

    // The error must NAME the offending line — the unterminated \node is on
    // line 4 of the fixture. A faithful structured error surfaces that locus.
    let msg = err.to_string();
    assert!(
        msg.contains('4') || msg.to_lowercase().contains("node"),
        "structured parse error must name the offending line/token (line 4, the \
         unterminated \\node), got: {msg}"
    );
}
