# Geometry of Numbers — warning fixture

This document compiles to a PDF SUCCESSFULLY (it is NOT a hard error) but emits a real, persistent LaTeX WARNING: a forward `\ref` to a label that is never defined anywhere in the document.
Through the multi-pass latexmk driver the engine reruns until the cross-references stabilise, so the only surviving LaTeX warning is the genuine undefined-reference warning (the transient "Label(s) may have changed" rerun warning that a single pass leaves is cleared by latexmk's reruns).

The Minkowski bound estimate controls the lattice growth rate in equation \ref{nonexistent-label-xyz}, whose label is deliberately never declared — so the real `/usr/bin/lualatex` emits, on every pass, exactly:

```
LaTeX Warning: Reference `nonexistent-label-xyz' on page 1 undefined on input line N.
```

That is a WARNING (severity warning), not an error: the PDF is still produced, so the compile status is OK and the raw compile log (the P11 surface) carries the warning text.
The pplatex / TexLogParser-class layer (P74) classifies this exact line shape as a `{severity = warning}` structured entry.
