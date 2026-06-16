# Proof Obligations (P1–P18)

User-approved external proof obligations for Pandoc Preview.
Each is an exact, externally observable happy-path state — real display, real pandoc, real filesystem, real XDG config.
No internal behaviours, no forced error modes.
An assertion is admissible only if it would fail on a plausibly broken app (unwired pandoc, frozen preview, UI-only fake state, junk output).

## Shared witness fixture

A per-run temp project containing `demo.md` with:

- heading `# Geometry of Numbers — Café` (unicode discriminator)
- `*naïve*` emphasis
- an ordered list whose last item is `Minkowski bound`
- math line `$\zeta(2) = \pi^2/6$`
- `![scatter](fig/plot.png)` referencing a real 64×48 PNG at `fig/plot.png`

## Obligations

- **P1 — Source→preview fidelity.** Open project, click `demo.md`. Preview iframe document contains `h1` with text exactly "Geometry of Numbers — Café", an `em` with text "naïve", an `ol` whose last item is "Minkowski bound".
- **P2 — Live re-render.** Type `The discriminant equals −163.` at buffer end.
  Sentence absent from preview before the edit; present verbatim after the configured debounce elapses.
- **P3 — Save persists exact bytes.** After the P2 edit, Save via the File menu surface (File > Save / Ctrl+S — Save is NOT a toolbar button).
  Independent process reads the file from disk: byte-for-byte equal to the editor buffer, unicode intact.
- **P4 — Math rendering (MathJax, always).** Math is hard-coded to MathJax — KaTeX cannot cover pandoc's full math syntax range, so no engine option exists anywhere (config, settings UI, first-run script).
  Preview contains `span.math mjx-container` whose assistive MathML flattens to exactly `ζ(2)=π2/6`; the literal `$\zeta(2)` does not appear as text.
- **P5 — Relative resource resolution.** Preview `img[alt="scatter"]` has `naturalWidth == 64 && naturalHeight == 48` (real pixels decoded through the asset-protocol `<base href>` chain).
- **P6 — File manager mutates the real directory.** (a) Sidebar lists exactly the non-hidden entries of the opened folder, directories first.
  (b) Creating `chapter2.md` via the UI yields a real empty file on disk and the editor opens it.
  (c) Renaming to `chapter-two.md` makes the old path absent and the new present on disk.
- **P7 — Export HTML artifact (shipped default plugin).** Export HTML to a chosen temp path: file exists at exactly that path, parsed DOM repeats P1 witnesses, `img` `src` is a `data:` URI (self-contained).
  The export runs the configured `[export.html]` plugin command ([[export-plugins-contract]]), not a hard-coded invocation.
- **P8 — Export PDF artifact (shipped default plugin).** Export PDF via the configured `[export.pdf]` plugin: valid PDF whose extracted text contains "Geometry of Numbers" and "Minkowski bound", AND whose `pdfinfo` Creator/Producer discriminates the configured engine (lualatex → LuaTeX, not pdfTeX) — proving the configured command is what actually ran.
  lualatex is a hard dependency — fail loudly, never skip.
  (Revised 2026-06-13: the original P8 never discriminated the engine; exports silently ran pandoc's implicit pdflatex default.)
- **P9 — Settings round-trip to XDG TOML.** With hermetic `XDG_CONFIG_HOME`, change font size 14→18 and theme dark→light via Settings, save.
  On-disk `pandoc-preview/config.toml` parses to exactly `font_size = 18`, `theme = "light"`, all other keys unchanged; editor computed font-size 18px.
- **P10 — First-run script → bootable app.** Drive `scripts/first-run.sh` in a real PTY through the gum prompts: config.toml parses to exactly the selected values, and a subsequent app launch reaches the editor UI (not the config-error screen).
- **P11 — Compile log reflects the real subprocess.** After a successful render, the Compile Log tab contains the configured `--from markdown` and a zero exit status.
  (Known cosmetic defect found at design time: `render.rs::format_log` produces `exit status: exit status: 0`.)
- **P12 — Custom export pipeline honored.** A user-defined `[export.<id>]` plugin whose command is an arbitrary executable (e.g. a script writing a discriminating witness derived from the real input file to `{output}`) runs verbatim on export: the witness file appears at exactly the chosen path with content proving the configured argv ran against the real source.
  Proves the export surface is plugin-shaped, not pandoc-shaped ([[export-plugins-contract]]).
- **P13 — Splitter tracks the pointer.** Dragging the editor/preview divider moves it to the pointer position (within a few px), including when the drag path crosses the preview iframe, and it never sticks or jumps.
  (Observed bug 2026-06-13: hand-rolled drag in App.svelte — no pointer capture, so the iframe swallows pointermove; ratio computed against the whole main row including the sidebar, so the divider does not land at the pointer.)
- **P14 — Tab switch preserves the split.** Switching Preview ↔ Compile Log changes neither pane's width.
  (Observed bug 2026-06-13: clicking the Compile Log tab makes pane sizes jump.)
- **P15 — Sidebar toggle preserves the editor:preview ratio.** Hiding/showing the file tree keeps the relative split of the two panes.
- **P16 — Preview math renders with no network (local MathJax).** With the webview's network blocked (no route to any CDN), open `demo.md`; the preview still satisfies P4 (`span.math mjx-container`, assistive MathML flattening to `ζ(2)=π2/6`). Discriminates a CDN-sourced MathJax — the current bare `--mathjax` preview leaves raw `$\zeta(2)` text offline.
  The MathJax `<script src>` resolves to the bundled app asset via the asset protocol, not `https://`. ([[mathjax-offline-local-source-decision]], decision A 2026-06-13.)
- **P17 — Exported HTML renders math offline (self-contained, no remote MathJax).** Export HTML via the shipped `[export.html]` plugin while offline: export exits 0 with no "Could not fetch" warning, the artifact contains NO `https://`/`cdn.jsdelivr` reference, and opening it in a network-blocked webview typesets the math (P4-shape `mjx-container`). Proves the shipped default inlines a local MathJax bundle (`--mathjax=<local>` + `--embed-resources`), not a CDN link.
  Strengthens P7 (which only asserted `data:` image URIs).
  ([[mathjax-offline-local-source-decision]].)
- **P18 — VSCode-style activity bar + collapsible side bar.** The left of the window is an always-visible activity bar (a vertical strip of view controls, built to hold more views later) plus a collapsible side bar showing the ACTIVE view.
  One view now: Explorer (file tree), control `[data-view="explorer"]`; side bar `[data-pane="sidebar"]` showing that view's content.
  The Explorer control exists; the side bar starts open showing the Explorer view (the file tree, listing the open project's files); clicking the active view's control collapses the side bar while the activity bar PERSISTS (the control stays, VSCode-style); clicking again reopens it.
  (Added 2026-06-13, revised same day from a single ☰ toolbar toggle to the VSCode activity-bar model so more view tabs can be added later.
  Revised 2026-06-16 (commit 1dbc698): the side bar no longer carries a separate "Explorer" label header — that was redundant with the file tree's own folder-name header, which now sits at the top of the side bar and names the active view. The obligation is that the side bar shows the active view's content, not that it carries a distinct view-label header.
  Save is a File menu / Ctrl+S item, not a toolbar button — see P3.)

## Verification vehicle

Real app on a real display via `tauri-plugin-playwright` (precedent: the sibling repo `~/gitclones/pandoc-preview-greenfield` proof harness; see also the `tauri-playwright` skill).
Hermetic per-run temp project dirs and `XDG_CONFIG_HOME`; disk assertions via independent processes; pandoc, lualatex, gum as hard dependencies.
No mocks, no skips, no forced error modes.

P10 caveat: the only obligation requiring PTY automation of gum; if brittle, record as explicit proof debt — never weaken to existence checks.
