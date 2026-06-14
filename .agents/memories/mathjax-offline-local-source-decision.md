# MathJax Offline: Local-Source Decision (Option A)

**When this applies:** any work on the live preview's MathJax loading, the shipped `[export.html]` default, or bundling MathJax as an app asset.
User decision, 2026-06-13 ("Record A and proceed with it").

## Decision

MathJax always loads from a **locally-bundled, version-pinned copy shipped with the app — never a CDN** — for BOTH the live preview and the shipped HTML export.
The offline/airplane case is a normal use case (a user writing on a laptop with no network), not a wild edge case.

## Update (2026-06-13): MathJax **4.1.2**, full plugin set

User correction: do NOT ship an old MathJax.
Earlier this doc/specs assumed 3.2.2 (reflexively matching pandoc's `mathjax@3` CDN default) — wrong.
Use the current stable **4.1.2**, and ship the **FULL** capability set ("every plugin under the sun by default; size is irrelevant; pare down later if needed"). This means vendoring the full MathJax distribution (all components + fonts + a11y/assistive-mml + explorer + all TeX extensions), not a single minimal bundle.

Verified against the real 4.1.2 dist (npm `mathjax@4.1.2`, all offline tests via chromium `setOffline(true)` + route-abort of non-`file:`/`data:`/`blob:`):

- **Preview = SOLVED.** Full a11y renders offline with **zero remote requests** when the dist is on disk and loaded via the MathJax loader: `window.MathJax={loader:{load:['a11y/assistive-mml']},options:{enableAssistiveMml:true}}`
  + `<script src="<dist>/tex-svg.js">`. The loader resolves sibling components (a11y, fonts) from the co-located dist via local URLs.
    So the asset-served preview gets full capability offline.
    render.rs must inject that config (via `--include-in-header` or a template — pandoc's `--mathjax` alone injects no config) alongside `--mathjax=<asset-url>/tex-svg.js`, with the config script ORDERED before the loader.
- **v4 layout:** components are at the dist ROOT (no `es5/`). The SVG bundle with default font is `tex-svg.js` (~1.85 MB); a11y components live in `a11y/` (assistive-mml.js, explorer.js, complexity.js, semantic-enrich.js, speech.js, sre.js).
- **v4 semantic MathML inserts U+2061** (FUNCTION APPLICATION) into assistive MathML (`ζ⁡(2)=π2/6`). The P4/P16/P17 oracle now strips invisible math operators U+2061–U+2064 before comparing (content-preserving; non-breaking on v3).
- **Single-file export — RESOLVED, feasible.** The a11y component needs the MathJax loader; loading it as a plain 2nd inline `<script>` does NOT register it, and loading the main bundle from a `data:` URL breaks MathJax's base-path detection.
  The working shape is MathJax's *custom combined component* build (`@mathjax/src@4` webpack): one ES module that imports TeX + SVG + all 41 TeX extensions + the full a11y set and calls `Loader.preLoaded(...)` so nothing lazy-loads.
  Result: a single ~2 MB `.js` (`tex-full-svg-a11y.min.js`), pandoc-inlinable via `--mathjax=file://<it> --embed-resources`. Independently verified offline: renders, assistive MathML correct, ZERO remote requests.
  Vendored at `src-tauri/resources/mathjax/tex-full-svg-a11y.min.js` with the build recipe in its PROVENANCE. Both preview (asset URL) and export (file://) reference this one file; assistive-mml defaults on, so no extra config script is needed.
  KNOWN non-blocking limitation: the SRE speech/explorer Web Worker (`file:///sre/speech-worker.js`) 404s offline — one harmless pageerror, no remote request, does not block rendering or assistive MathML; interactive spoken/explorable a11y is a follow-up (ship `sre/` + configure the worker path).

The rest of this doc below is the original v3-era reasoning; the mechanism (file:// for export, asset protocol for preview, no server) still holds — only the bundle (full v4 dist) and the export packaging (pending de-risk) change.

## Why (verified facts, pandoc 3.6, online + offline via `unshare -rn`)

- **Preview today is CDN-bound and broken offline.** `render.rs:12` is `const MATH_FLAG = "--mathjax"` (bare), so the preview emits a `<script src="https://cdn.jsdelivr.net/...mathjax...">` and math fails to typeset with no network.
  This is the larger of the two defects and shares A's fix.
- **Export `--embed-resources --mathjax` fetches the CDN at export time.** `--embed-resources` means "inline every external resource"; the `--mathjax` `<script src=cdn>` is such a resource, so pandoc downloads the ~1.3 MB bundle and inlines it (online: exit 0, 1.33 MB self-contained file).
  Offline it **fail-opens**: exit 0, `[WARNING] Could not fetch resource`, a dead `cdn.jsdelivr` link left in a file labelled "self-contained".
  (The offline file is NOT corrupt — it degrades to an ordinary CDN-linked HTML that renders whenever next opened online; it only fails offline-to-offline.)
- **Dropping `--mathjax` entirely is wrong:** with no math flag pandoc emits an HTML/CSS approximation (`<span class="math"><em>E</em>=<em>m</em>...`), not `\(...\)` — MathJax ignores it, so a template-injected MathJax would render nothing.
- **The flag that threads it: `--mathjax=<URL>`** keeps raw `\(...\)` TeX output AND sets the injected `<script src>`. Verified offline with a local path + `--embed-resources`: exit 0, NO fetch warning, the local script inlined directly.
  This is the only config satisfying self-contained · offline · real MathJax · MathJax-only.

## Mechanism (Option A — no server)

One version-pinned MathJax bundle shipped as a Tauri resource, addressed two ways because the two consumers run in different process/origin contexts:

- **Export** (external pandoc + `--embed-resources`): shipped `[export.html]` uses `--mathjax=file://<bundled-path>`; pandoc inlines the local bundle.
  No server.
- **Preview** (in-webview `srcdoc`): `render.rs` passes `--mathjax=<asset-protocol-url>` to the bundled copy.
  The `srcdoc` `<base href>` asset-protocol chain already resolves local assets (P5 proves images decode through it), so an asset-protocol `<script>` should load; the one thing to confirm is CSP `script-src` allows the asset protocol.

**Rejected — Option B (localhost HTTP server, the "app already has a server" idea):** there is NO server today (the only `localhost` is the Vite *dev* server, absent from a built app; the preview is `srcdoc`-injected, not served).
`file://` already solves export with no server, and the asset protocol already serves the preview.
A bound port is strictly more surface (lifecycle, must be up before export, firewall prompt) for no gain.
See [Preview Iframe and Asset Resolution](preview-iframe-and-asset-resolution).

## Open implementation questions (resolve with evidence, not assertion)

- **Which MathJax build is offline-safe.** MathJax 3 **CHTML** output (`tex-chtml*.js`, pandoc's default) loads woff fonts at runtime from the MathJax path — NOT offline-safe from a single file.
  MathJax **SVG** output (`tex-svg-full.js`) renders to self-contained SVG with no runtime font fetch — likely the offline-correct bundle.
  The implementer must establish this with a real offline render (known-solution-first), not assume.
  Note P4 asserts `mjx-container` + assistive MathML flattening — confirm the chosen build still satisfies P4's DOM/MathML shape.
- **Install-portable export path.** The export command is user-owned argv, so an absolute install path baked by `first-run.sh` breaks if the app moves.
  Prefer extending the `{input}`/`{output}` substitution model with an app-injected `{mathjax}` (or `{assets}`) placeholder so the shipped default stays portable.
  See [[export-plugins-contract]].
- **Resource resolution.** `render.rs` must resolve the app resource dir → asset-protocol URL (preview) and a filesystem path (export placeholder).

## Orthogonal to the macro/template system

A governs only WHERE mathjax.js loads (CDN → local).
WHICH macros configure `window.MathJax` is a separate layer — see [MathJax Macro System: Tiers and Injection](mathjax-macro-system-tiers-and-injection).
Current `render.rs` uses no `--template` and no macros, so A does not touch it.

## New proof obligations

P16 (preview math renders with no network) and P17 (exported HTML renders math offline / carries no remote MathJax reference).
See [Proof Obligations](proof-obligations).
