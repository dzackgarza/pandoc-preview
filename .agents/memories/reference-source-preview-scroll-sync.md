# Reference: Source-Preview Scroll Sync

**When this applies:** implementing source↔preview scroll sync ([Feature Catalogue and Implementation Status](feature-catalogue-and-implementation-status)). Scoped 2026-06-13 via research agent (pandoc 3.6 behavior verified locally).
"Primitive" sync is the acceptable bar; this records how, and the decision it forces.

**Decisive finding — pandoc source positions are reader-dependent.** Pandoc emits per-element source positions ONLY for the **CommonMark-family readers** (`commonmark`, `commonmark_x`, `gfm`) via the `sourcepos` extension (since 2.11.3): `pandoc -f commonmark+sourcepos -t html` puts `data-pos="file@L:C-L:C"` on blocks (`Header`, wrapping `Div`, `CodeBlock`) and every inline `Span`. **The full `markdown` reader — the app's shipped default — does NOT support it** (`-f markdown+sourcepos` errors outright), and there is **no Lua-filter workaround** (the `markdown` reader keeps no source positions in the AST; `pandoc.utils` exposes no position API). So precise line-mapping requires a CommonMark reader.

**THE PRODUCT DECISION THIS FORCES (user-owned, currently unmade):** switching the *preview* reader to `commonmark_x` to obtain `sourcepos` loses, verified locally: (a) `+citations` (unsupported in `commonmark_x`) and (b) raw-LaTeX environment parsing (`\begin{equation}…` passes through as literal).
Citations are first-class for math research, and this collides with the "get EXACTLY what the pandoc CLI produces" invariant ([Founding Philosophy: Exact Pandoc Preview](founding-philosophy-exact-pandoc-preview)) if the user's real/export command uses `-f markdown`. **Tracked as an open decision in [Decision Provenance: User-Owned vs Framework-Forced](decision-provenance-user-owned-vs-framework-forced).** Precise line-mapping (Stage 1 below) is gated on it.

**Cleanup filter (verified working):** `sourcepos` tags every inline Span (noisy).
A ~25-line Lua filter collapses to clean VSCode-style `data-line` on blocks and drops wrapper spans — `data-pos` lives in the element Attr (3rd tuple), readable on `Header`/`Div`/`CodeBlock`:
```lua
local function startline(p) return p:match("@(%d+):") end
local function tag(el)
  local p = el.attributes["data-pos"]
  if p then el.attributes["data-line"]=startline(p); el.attributes["data-pos"]=nil end
  return el
end
function Header(el) return tag(el) end
function Div(el) return tag(el) end
function CodeBlock(el) return tag(el) end
```

**Same-origin shortcut (verified):** the preview iframe is `srcdoc` with `sandbox="allow-same-origin allow-scripts"`, so the parent reads `iframe.contentWindow.scrollY/scrollTo` and `iframe.contentDocument.querySelectorAll('[data-line]')` **directly — no postMessage needed** for scroll.
(postMessage only if the sandbox model changes.)
See [Preview Iframe and Asset Resolution](preview-iframe-and-asset-resolution).

**Reference implementations:** **Codebraid Preview** (`github.com/gpoore/codebraid-preview-vscode`) is the most relevant — pandoc-based, uses `sourcepos`→`data-pos`, **defaults to `commonmark_x` for exactly this reason**, disables sync for non-CommonMark formats, has a less-accurate emulation fallback.
**VSCode built-in markdown preview** (`extensions/markdown-language-features/preview-src/scroll-sync.ts`) is the canonical algorithm: inject `data-line` → binary-search the bracketing visible elements → interpolate by bounding-rect; double-ended with a scroll lock.
**Tideflow** (`/tmp/ref-tideflow`, Tauri+CM6, Typst→PDF — also in [Reference: Render Lifecycle (Tideflow, mdTeX)](reference-render-lifecycle-tideflow-mdtex)) is the best locking/feedback reference: `SourceMap` anchors with proportional fallback, `scrollGuards.ts` (programmaticScroll timestamp guard, isTyping "editor-first" guard, rendering guard, manual-scroll lock), sync modes, and `useAnchorManagement` preserving position when element IDs change across re-renders.
Quarto has no canonical sync (open feature request).

**Technique menu vs the three hard invariants** (full re-render every change · MathJax reflow after insertion · iframe boundary):
- **A. Proportional** (`scrollTop` ratio): trivial, reader-agnostic (works with `-f markdown`), poor accuracy — the "primitive" floor.
  Read `scrollHeight` AFTER `MathJax.startup.promise`.
- **B. Line-mapping + interpolation** (VSCode/Codebraid): best accuracy; needs `data-line` (CommonMark reader + filter).
  Rebuild the sorted `[{line, element}]` array via one `querySelectorAll` after each render (cheap, regenerated never patched); read rects post-MathJax.
- **C. IntersectionObserver**: good for the preview→editor direction, inherently height-aware (robust to MathJax reflow); re-create observers after each render; still needs `data-line`.

**Recommended (staged, renderer-plugin-aware):**
- **Stage 0** — proportional + `data-line` snap where present, a `programmaticScroll` timestamp guard, capture/restore `scrollTop` across re-renders, all height reads gated on `MathJax.startup.promise`. Works with `-f markdown`, **no exactness violation** — meets the primitive bar.
- **Stage 1** (gated on the reader decision): **1a clean** = `commonmark_x+sourcepos` + the Lua filter + the VSCode algorithm + IntersectionObserver for the reverse direction; **1b exactness-preserving** = keep `-f markdown`, accept proportional-only as the ceiling.
- Scroll-sync mapping is a **pandoc-plugin concern** ([Renderer Plugin Architecture](renderer-plugin-architecture)): the app core consumes an OPTIONAL `data-line` contract and degrades to proportional when absent; line markers come from the selected pandoc reader/filter workflow, not a non-pandoc renderer.

**Risks:** exactness violation (reader switch); MathJax timing (reading heights before typeset desyncs everything below the first math block); re-render churn (rebuild mappings/observers on render-complete, never memoize across renders — element identity is destroyed every render by design); filter ordering (existing tikz/callout Lua filters must tolerate/skip `sourcepos` Divs); YAML-frontmatter `sourcepos` line offset (pandoc issue #7863 — may need a correction offset).

**Spike:** render with `commonmark_x+sourcepos` + cleanup filter; after `MathJax.startup.promise`, `querySelectorAll('[data-line]')` and log `{line, rect.top}`; move the CM cursor to a known line and assert interpolation lands within the right element's rect.
Critical fixture: `# H1` / a tall `$$…$$` block / `## H2` — exactly where proportional fails and line-mapping must win.
Then a reflow check (insert math above target, re-render) and a feedback check (programmatic preview scroll must not bounce the editor).

Related: [Feature Catalogue and Implementation Status](feature-catalogue-and-implementation-status), [Preview Iframe and Asset Resolution](preview-iframe-and-asset-resolution), [Reference: Render Lifecycle (Tideflow, mdTeX)](reference-render-lifecycle-tideflow-mdtex), [Renderer Plugin Architecture](renderer-plugin-architecture), [Decision Provenance: User-Owned vs Framework-Forced](decision-provenance-user-owned-vs-framework-forced).
