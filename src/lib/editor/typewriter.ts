// Typewriter scrolling as a CM6 extension (P120 / H.1).
//
// The published CM6 typewriter-mode recipe: keep the caret line vertically
// CENTERED in the editor viewport. Two cooperating pieces, both standard CM6:
//
//   (1) EditorView.scrollMargins — a Facet returning invisible margins around the
//       scroller. Returning a top+bottom margin of (nearly) half the scroller
//       height makes CM6 treat the top and bottom halves of the viewport as
//       "covered", so its scroll-into-view logic can only satisfy a caret by
//       parking it in the central band. The large bottom margin is what lets a
//       caret at the very END of the document still center (the scroller gains
//       room to scroll past the last line).
//   (2) An updateListener that, on every selection/doc change, dispatches
//       EditorView.scrollIntoView(head, { y: "center" }) — the explicit "move the
//       caret to the vertical center" strategy the CM6 view API exposes. Combined
//       with the margins above, the caret line settles on viewport mid-height.
//
// This is the SAME machinery the published @uiw / Marijn-Haverbeke CM6 typewriter
// examples use; no bespoke scroll engine. It is installed/removed through a
// Compartment (the spellCompartment precedent) so toggling the mode reconfigures
// it in/out without rebuilding the editor.

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

/** The typewriter extension: a scroll-margin facet that reserves half the
 *  viewport above and below the content, plus an update listener that recenters
 *  the caret line on every cursor move or edit. The empty array (the
 *  compartment's OFF value) disables both, restoring CM6's default
 *  minimal-scroll behaviour. */
export function typewriterExtension(): Extension {
  return [
    // Real scrollable runway above and below the content: half the viewport of
    // padding on each side of `.cm-content`. WITHOUT this, a caret on the FIRST
    // or LAST line cannot be centered — the scroller has no room to scroll the
    // edge line to mid-height. This is the published typewriter recipe's content
    // padding (the counterpart to the scrollMargins below): the padding supplies
    // the runway, the center-scroll uses it. 50vh top+bottom centers any line.
    EditorView.theme({
      ".cm-content": { paddingTop: "50vh", paddingBottom: "50vh" },
    }),
    // Reserve top+bottom margins of half the scroller height so CM6's own
    // scroll-into-view treats the top and bottom halves of the viewport as
    // covered, biasing every auto-scroll toward the central band. CM6 calls this
    // on every scroll computation, so it tracks viewport resizes live.
    EditorView.scrollMargins.of((view) => {
      const height = view.scrollDOM.clientHeight;
      // Half the viewport, minus a line so the very-centered band straddles
      // mid-height rather than pushing the caret a hair past it.
      const margin = Math.max(0, height / 2 - view.defaultLineHeight);
      return { top: margin, bottom: margin };
    }),
    // Re-center the caret line whenever the selection head moves or the document
    // changes. scrollIntoView with y:"center" is the CM6 "park at vertical
    // center" strategy; the scrollMargins above give it the room to do so even at
    // the document edges.
    EditorView.updateListener.of((u) => {
      if (!u.selectionSet && !u.docChanged) return;
      const head = u.state.selection.main.head;
      u.view.dispatch({
        effects: EditorView.scrollIntoView(head, { y: "center" }),
      });
    }),
  ];
}
