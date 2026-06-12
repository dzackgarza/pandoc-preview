# Architecture Path: Fork-Biased, Inkwell First

**When this applies:** choosing or re-evaluating the base architecture for the Pandoc preview editor, or any pressure to restart/greenfield/fork a different base.

**Decision (audited 2026-06):** the path is NOT "fork a rich Markdown editor and add Pandoc" and NOT blank greenfield. It is fork-biased reference-locked construction:

1.  **Primary:** fork or closely mirror [Inkwell](https://github.com/Amoner/inkwell) (MIT, Tauri 2, CodeMirror 6, intentionally small) as the minimal editor shell. The fork must be *destructive and controlled*: first commit deletes the markdown-it preview and all app-side rendering fallbacks, adds static gates banning old renderer paths, and wires editor text to a backend `render_current` that executes the configured Pandoc command. Preview displays only Pandoc stdout; MathJax typesets after update; stderr/status become diagnostics.
2.  **Fallback (if Inkwell is too thin or build-hostile):** reference-locked greenfield — narrow Tauri v2 app inventing no patterns, using the subsystem map in [Reference Repo Map: Subsystem Sources](reference-repo-map-subsystem-sources).
3.  **Backup fork only:** Glyph — only if its react-markdown/KaTeX/Mermaid renderer is cleanly excisable. Its preview stack is the heavier slop risk.

**Hard rule:** never fork an editor whose existing non-Pandoc preview system would remain alive beside Pandoc. If an app cannot survive complete deletion of its old renderer cleanly, it is not a valid fork base. Rejected as primary bases: Astro Editor (AGPL, Astro-domain), mx (GPL-3), SoloMD (too large), Gramax (GPL-3, docs product), MarkFlowy (AGPL, ProseMirror), Blank (ProseMirror/WYSIWYG conflicts with source-oriented CodeMirror pipeline), Parchment/Ubiquity (stale/Tauri v1).

**Why:** the target renderer is `canonical editor text → configured Pandoc command → HTML stdout → preview container → MathJax typeset → diagnostics from stderr/status`, with Pandoc templates/filters owning theorem/amsthm/document semantics. Nearly every mature Tauri editor centers on markdown-it/react-markdown/KaTeX/ProseMirror — the wrong center of gravity. A rich fork hands the agent a mature-looking fallback surface; blank greenfield hands it maximum design freedom exactly where it is weakest. See [Threat Model: Polished Fallback Machine](threat-model-polished-fallback-machine).

**Verify:** production bundle contains no markdown-it/react-markdown/KaTeX renderer path; preview fails visibly when the Pandoc command is invalid.
