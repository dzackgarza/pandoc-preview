# Geometry of Numbers — clean compile

This document compiles to a PDF through the multi-pass latexmk driver with ZERO surviving LaTeX warnings: it declares no undefined references, no `\cite`, and no numbered cross-references.
The section heading's hyperref bookmark label produces only the transient "Label(s) may have changed.
Rerun" warning on the FIRST pass, which latexmk's own reruns resolve — so the FINAL compile log carries NO LaTeX warning at all.

The Minkowski bound estimate controls the lattice growth rate in a symmetric convex body.
Inline math is fine: $\zeta(2) = \pi^2/6$.
No display-equation numbering and no `\ref`/`\cite` appear, so a stabilised multi-pass build emits no LaTeX warning.
A correct Problems pane therefore surfaces NO `severity = warning` entry for this fixture — anything it shows would be a fabricated phantom warning.
