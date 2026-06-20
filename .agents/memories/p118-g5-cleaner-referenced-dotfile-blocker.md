# P118 G5 cleaner referenced-dotfile blocker

The frozen p126 spec clause D and provisioner reference a dot-prefixed raster
image (`fig/.p126-dot.png`) via a SURVIVING `\includegraphics` (outside any
stripped comment), then require the unpacked bundle to carry NO dot-file
anywhere, asserting "ONLY the cleaner removes them."

VERIFIED (source, replica, and real proof run 20260620T010106Z) that the REAL
unmodified google-research/arxiv-latex-cleaner — both PyPI 1.0.11 and git HEAD
(bcc1460) — KEEPS a genuinely-referenced dot-prefixed raster image:

- `run_arxiv_cleaner` UNCONDITIONALLY overwrites the merged config's `to_delete`
  and `figures_to_copy_if_referenced` with hardcoded lists
  (arxiv_latex_cleaner.py ~line 931 `parameters.update({...})`), so a config
  `to_delete: ['\..*\.png$']` has NO effect (empirically confirmed).
- Referenced figures are copied via `_resize_and_copy_figures_if_referenced`
  from `splits['figures'] = _keep_pattern(all, figures_to_copy_if_referenced)`,
  which is NEVER filtered by `to_delete`. A referenced `.png` is always copied,
  dot-prefix preserved.
- `--convert_png_to_jpg` renames the extension but preserves the dot basename
  (`.p126-dot.jpg`) AND renames `plot.png`→`plot.jpg` (would break clause C).
- No CLI flag exists for hidden/dot files; `_list_all_files` only ignores
  `.git/` dirs.

Clauses A (SECRET COMMENT), B (\todo), C (unused pruned + plot.png kept) all
PASS with the real cleaner driven via `uvx --from arxiv-latex-cleaner
arxiv_latex_cleaner <bundle> --config cleaner-config.yaml`. ONLY clause D fails.

The only ways to satisfy clause D are FORBIDDEN: owning a dot-file remover /
hand-rolled post-cleaner strip (explicitly rejected — own no remover, never
substitute a hand-rolled cleaner), or modifying the cleaner. This is an
irreducible conflict between the frozen fixture and the real tool's contract.
