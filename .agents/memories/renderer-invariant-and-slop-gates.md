# Renderer Invariant and Slop Gates

**When this applies:** writing, reviewing, or gating any code touching the preview/rendering path, config, or file dialogs.

**Invariant:** there is exactly one rendering pipeline — `canonical editor text → configured Pandoc command → HTML stdout → preview container → MathJax typeset → diagnostics from stderr/status`. No second renderer may exist, even disabled, even "temporarily".
The decisive gate is not "tests pass" but "the wrong old paths are dead."

**Static gates — fail QC if production preview imports/calls any of:**

```
markdown-it, react-markdown, rehype-katex, remark-math (as renderer source),
katex, mermaid (as renderer source), fallbackHtml, renderMarkdown,
renderLocalMarkdown, PANDOC_RENDER_CMD fallback, split_whitespace(),
Ok({ ok: false }), window.__PPE, backend_status, probe, PathEntryOpen,
list_directory (as file picker)
```

Sole exception: Mermaid/diagram tooling may later exist as an external save-gated path-consuming tool integration — never as preview source of truth.

**Runtime proof obligations** (extends [Proof Obligations (P1–P11)](proof-obligations)):

- missing config / missing template or filter blocks normal rendering (no silent built-in preview)
- the configured Pandoc command is actually executed; its stderr/status surface as diagnostics
- preview HTML disappears or fails visibly when the Pandoc command is invalid — never a preserved green preview with a toast
- MathJax runs after Pandoc HTML injection; KaTeX absent from the production bundle
- Open/Save As use the Tauri dialog path-result boundary; saved file bytes equal canonical editor text
- autosave creates a real Git commit; save-gated commands receive a real durable path

**Why:** the classic failure shape is `try Pandoc → on failure show old markdown-it/KaTeX preview → green forever`. Every gate above kills one branch of that shape.
See [Threat Model: Polished Fallback Machine](threat-model-polished-fallback-machine).

**Verify:** grep gates wired into QC (agent justfile recipe), and a deliberate breakage test — corrupt the Pandoc command, observe the preview fail loudly.
