# Proof Obligations (P1–P66)

User-approved external proof obligations for Pandoc Preview.
Each is an exact, externally observable happy-path state — real display, real pandoc, real filesystem, real XDG config.
No internal behaviours, no forced error modes.
An assertion is admissible only if it would fail on a plausibly broken app (unwired pandoc, frozen preview, UI-only fake state, junk output).

P45–P50 (added 2026-06-16) cover the Tier 1 "Recovery and Git State" milestone, authored from [[recovery-and-git-state-requirements]]. Recovery durability is the deepest priority in the app: the core guarantee is that no more than several seconds of work is ever permanently lost, recovery lives on the HOST FILESYSTEM (never browser storage), and corruption is treated as strictly worse than a crash.

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
  Revised 2026-06-16 (commit 1dbc698): the side bar no longer carries a separate "Explorer" label header — that was redundant with the file tree's own folder-name header, which now sits at the top of the side bar and names the active view.
  The obligation is that the side bar shows the active view's content, not that it carries a distinct view-label header.
  Save is a File menu / Ctrl+S item, not a toolbar button — see P3.)

### Tier 1 — Recovery and Git State (P45–P50)

- **P45 — Recovery captures unsaved edits durably.** While the user edits, the buffer is continuously captured to an app-owned recovery store ON THE HOST FILESYSTEM within several seconds, with no user action.
  Append a unicode-discriminating sentence (e.g. `Café résumé — naïve ζ.`) to the buffer WITHOUT saving; within several seconds, an independent process reading the host-filesystem recovery store finds a copy byte-equal to the current buffer (the appended sentence included, unicode intact), AND the project file on disk is still byte-for-byte unchanged.
  Admissible because it fails on a no-op autosave (recovery store never contains the sentence), an autosave that only uses browser storage (no host-filesystem copy exists for the independent reader), an autosave that fires only on Save (the project-file-unchanged clause forces a pre-save witness — recovery must precede any disk write), and a debounce too long to capture within several seconds.

- **P46 — Repo-state machine reflects and mutates real git state.** The app continuously reflects whether the open file is noRepo / untracked / tracked via a prominent indicator, with one-click shortcuts OUT of every degraded state.
  Open a file in a directory that is not a git repository: the indicator reads noRepo.
  Invoke "initialize repository": a real repository appears on disk (an independent git query against the directory succeeds) and the indicator becomes untracked.
  Invoke "start tracking": an independent git query reports the file as tracked, and the indicator becomes tracked.
  Admissible because it fails on a UI-only indicator that never reads real git (the independent git query contradicts the displayed state), a state hardcoded to one value (it never transitions across the three observed states), and a "track" action that relabels the indicator without actually staging the file (the independent git query still reports it untracked).

- **P47 — Path-consuming actions are gated on durable identity.** Save-in-place, export, and plugin-run on an identity-less (recovery-backed) buffer first resolve a real durable destination; until that destination is resolved, the action does not run.
  With a buffer that has no real file identity, invoke export: NO artifact is produced and the downstream command does NOT run.
  After a real destination is resolved, the file exists at exactly that destination, that destination becomes the live editable file going forward, and a later edit followed by Save writes to that same destination (independent disk read confirms).
  A buffer that already has a durable identity saves with no prompt at all.
  Admissible because it fails on an export that silently runs against the volatile buffer (an artifact appears with no destination resolved), a gate that auto-guesses a filename (a destination materializes that the user never chose), a gate that runs the downstream command anyway (the command's effect is observed despite no resolved destination), and a gate that re-prompts on an already-durable save (the no-prompt clause fails).

- **P48 — Save refuses to clobber an externally modified file.** Before writing, the app compares a fingerprint captured at open/last-save against the current on-disk state; if the file changed underneath the editor, Save is refused LOUDLY and the external content is preserved.
  Open a file; an independent process then rewrites it on disk with different content; the next in-app Save is refused with a VISIBLE error, the on-disk content remains exactly what the independent process wrote (the editor buffer did not win), and the buffer stays dirty.
  An explicit overwrite/reload resolution offered after the refusal then succeeds — the refusal is a real gate, not a dead end.
  Admissible because it fails on a blind overwrite (the editor buffer clobbers the external content), a never-captured fingerprint (no comparison happens, so Save proceeds), and a silent refusal (Save does nothing with no visible error, leaving the user unaware their work was not written).

- **P49 — Launch restores the last session and offers newer recovery content.** On launch the app reopens the last file/project and window state from host-filesystem session state, and when the recovery store is ahead of the on-disk file, offers to restore that newer content.
  Edit a file (recovery captures the unsaved change), then relaunch the app against the same host session-state and data locations: the editor reopens that file, a restore offer presents the newer recovery content, and accepting it loads the buffer including the unsaved edit (byte-equal to the recovery copy).
  Admissible because it fails on a launch that opens blank or a hardcoded file (the last file is not reopened), a restore offer sourced from browser storage (no host-filesystem session state drives the reopen), and a restore that loads the stale on-disk content instead of the newer recovery buffer (the accepted buffer lacks the unsaved edit).

- **P50 — Closing with a dirty buffer is guarded and loses nothing.** Closing the app (or switching files) with a dirty buffer prompts the user to resolve; the app does not close until the prompt is resolved; and because recovery already captured the buffer, no content is lost even on discard.
  With a dirty buffer, request close: a resolution prompt fires and the app stays alive (it does not close out from under the unsaved work).
  Independently, the host-filesystem recovery store holds the dirty content — the lose-nothing backstop that survives even a forced quit.
  Admissible because it fails on a close that drops the dirty buffer with no prompt and no recovery copy (work vanishes silently), and a prompt-only guard that still loses content on force-quit (the prompt blocks a graceful close but the recovery backstop is missing, so a hard kill loses the buffer).

### Tier 0 — Editor Completion (P51–P54)

P51–P54 (added 2026-06-16) cover the Tier 0 "Editor Completion" milestone: the editor's autocomplete is a composable surface that hosts multiple completion sources at once, a user-defined snippet dictionary is one such source that expands snippet bodies (not literal triggers) at the cursor, Emmet abbreviations expand into real markup at the cursor, and spellcheck marks misspelled words while honoring a custom math dictionary.

- **P51 — Composable editor completion.** The editor's autocomplete hosts MULTIPLE completion sources that COMPOSE — registering a new app completion source does not displace the completions that were already there.
  Register a new app completion source bound to a trigger, then drive the editor: typing that trigger opens the standard autocomplete tooltip and the newly-registered source's option appears in it, AND the pre-existing LaTeX completions still work in the same buffer — typing a backslash command (e.g. `\alpha`) offers the LaTeX completion, and typing the `:::` fenced-div trigger offers the fenced-div completion.
  Admissible because it fails on a wiring that lets one source monopolize or suppress the others (the new source's option appears but the LaTeX backslash/fenced-div completions no longer surface, or vice versa), and on a wiring that drops the LaTeX completions outright when a new source is added (the backslash and `:::` completions vanish once the new source is registered).

- **P52 — User-defined snippet dictionary expands.** A user-defined snippet dictionary, declared by a config-owned path (not a hardcoded list), surfaces as editor completions: typing a snippet's trigger opens the standard autocomplete tooltip offering a completion labeled by that trigger; accepting it expands the snippet BODY at the cursor — the inserted text is the snippet's expansion, not the literal trigger string, and the cursor lands at the snippet's declared tabstop.
  The dictionary path comes from config, so pointing config at a dictionary file makes those snippets the ones offered (a different dictionary offers different snippets).
  Admissible because it fails on a no-op source (the trigger is typed but never offered in the tooltip), a source that inserts the literal trigger text instead of the snippet body (accepting the completion leaves the trigger in the buffer rather than the expansion, and the cursor is not at the tabstop), and a dictionary that is ignored (config points at a dictionary whose triggers are typed but none of its snippets are ever offered).

- **P53 — Emmet abbreviation expands.** Typing an Emmet abbreviation in the editor and firing the Emmet-expand action replaces the abbreviation with the expanded markup at the cursor.
  Type an Emmet abbreviation that uniquely discriminates a real expansion (a multi-character/multi-element expansion Emmet produces, e.g. one that yields nested elements, repeated siblings, or attribute/class wrappers from a terse source) and invoke the Emmet-expand action: the abbreviation text is gone and the buffer at the cursor now holds the expanded markup it denotes, with the cursor landing inside the expansion.
  Admissible because it fails when the Emmet extension/keymap is absent — the abbreviation stays literal in the buffer (the expand action is a no-op and the typed abbreviation is echoed verbatim rather than replaced by the markup it expands to).

- **P54 — Spellcheck marks misspelled words, honoring a custom math dictionary.** The editor marks misspelled words as spelling errors while respecting a user-owned custom math dictionary, so that mathematical terms are not flagged.
  Type a clearly-misspelled token (random gibberish) into the buffer: it is visibly marked as a spelling error.
  Type an ordinary correctly-spelled English word: it is NOT marked.
  Type a mathematical term that ordinary English spellcheck would flag but which is present in the user's custom math dictionary: it is NOT marked, proving the custom dictionary is in effect.
  Admissible because it fails when there is no spellcheck (nothing is marked, so the gibberish token is not flagged), on a checker that marks everything (the correctly-spelled English word and the dictionary math term are both wrongly flagged), on a checker that marks nothing (the gibberish token is never flagged), and on a checker WITHOUT the custom math dictionary (the math term is wrongly marked even though the dictionary lists it).

### Milestone G — Insertion Bar (P55–P62)

P55–P62 (added 2026-06-16) cover the Milestone G "Insertion Bar" milestone: the editor's top edit bar is a math-research INSERTION bar (not a generic formatting toolbar) that inserts amsthm environments, tikz/tikzcd diagram scaffolds, matrix environments of a chosen shape, pandoc pipe-tables of a chosen shape, config-declared snippets via a bar dropdown, language-tagged fenced code blocks via a dropdown, complete footnotes (marker plus definition) via a modal, and an image pasted from the system clipboard persisted as a real file in the configured global figures directory — all at the cursor.

- **P55 — Insertion bar replaces the formatting toolbar and inserts amsthm environments.** The editor's top edit bar is a math-research INSERTION bar; the generic H1/bold/italic formatting toolbar is gone.
  Selecting a named amsthm environment (e.g. `theorem`) from the bar inserts that environment's fenced-div scaffold (`:::{.theorem} … :::`) at the cursor, leaving the cursor at the environment body.
  Admissible because it fails if the old formatting toolbar is still present or its buttons insert markup like `**bold**` (the bar is still a formatting toolbar, not an insertion bar), on a no-op insert (selecting the environment leaves the buffer unchanged so no scaffold appears at the cursor), and if the wrong environment is inserted (selecting `theorem` inserts a fenced div whose class is not `theorem`).

- **P56 — tikz/tikzcd scaffold insert.** Selecting a tikz or tikzcd scaffold from the insertion bar inserts the corresponding diagram skeleton at the cursor, leaving the cursor inside the diagram body.
  Admissible because it fails on a no-op insert (selecting the scaffold leaves the buffer unchanged so no skeleton appears at the cursor), on a wrong-kind insert (a tikz skeleton is inserted when tikzcd was chosen, or a tikzcd skeleton when tikz was chosen), and when the cursor is not placed inside the diagram body after the insert.

- **P57 — Matrix builder.** Choosing matrix dimensions (rows×cols) on the insertion bar inserts a LaTeX matrix environment of exactly that shape at the cursor.
  Admissible because it fails on a no-op insert (choosing dimensions leaves the buffer unchanged so no matrix appears at the cursor), on a fixed-size insert that ignores the chosen dimensions (a different rows×cols matrix is inserted than the one chosen), and on a malformed matrix (the inserted environment has the wrong number of rows or columns for the chosen shape).

- **P58 — Table builder.** Choosing table dimensions (cols×body-rows) on the insertion bar inserts a pandoc pipe-table of exactly that shape at the cursor: a header row, an alignment separator row, and the chosen number of body rows, where every row carries the chosen number of `|`-delimited cells.
  Admissible because it fails on a no-op insert (choosing dimensions leaves the buffer unchanged so no table appears at the cursor), on a fixed-shape insert that ignores the chosen dimensions (a different cols×body-rows table is inserted than the one chosen), and on a missing or malformed separator row (without the alignment separator row the inserted text is not a valid pandoc pipe-table).

- **P59 — Snippet dropdown on the bar.** The insertion bar surfaces the config-declared snippet dictionary's triggers in a dropdown; choosing a trigger from that dropdown inserts the snippet's expanded BODY (not its literal trigger string) at the cursor, with the cursor landing at the snippet's declared tabstop.
  The dropdown's contents come from the config-declared snippet dictionary, so pointing config at a different dictionary makes the bar's dropdown surface that dictionary's triggers.
  Admissible because it fails on an empty or hardcoded dropdown that ignores the config dictionary (the dictionary's triggers never appear as dropdown entries), on literal-trigger insertion (choosing the entry leaves the trigger string in the buffer rather than the expanded body, and the cursor is not at the tabstop), and on an ignored dictionary (config points at a dictionary whose triggers are never surfaced in the dropdown).
  This is distinct from P52, which proves the autocomplete-popup path (typing a trigger in the buffer opens the completion tooltip); P59 proves the BAR-dropdown path (selecting a trigger from the insertion bar's dropdown).

- **P60 — Code-block-type dropdown.** Choosing a language from the insertion bar's code-block-type dropdown inserts a fenced code block tagged with that language at the cursor: an opening fence carrying the chosen language tag (```` ```<lang> ````) and a matching closing fence, with the cursor placed inside the block.
  Admissible because it fails on a no-op insert (choosing a language leaves the buffer unchanged so no fenced block appears at the cursor), on an untagged block that ignores the chosen language (the opening fence carries no language tag), and on a wrong language tag (the inserted fence is tagged with a language other than the one chosen).

- **P61 — Footnote modal.** A footnote action on the insertion bar opens a modal in which the user types the footnote body; on confirm, a COMPLETE footnote is inserted — a reference marker (`[^id]`) at the cursor AND a footnote definition line (`[^id]: <body>`) whose body is exactly the text the user typed.
  Admissible because it fails on a no-op insert (confirming the modal leaves the buffer unchanged so neither marker nor definition appears), on a marker-only insert with no definition (the reference marker is placed but the typed body is lost because no `[^id]:` definition line is inserted), on a plain-text insert (the typed body lands in the buffer as ordinary text rather than as a footnote marker-plus-definition pair), and on a body mismatch (the inserted definition's body is not byte-equal to what the user typed in the modal).

- **P62 — Insert image from clipboard.** With an image on the system clipboard, the insertion bar's paste-image action writes the image as a real file into the CONFIGURED GLOBAL figures directory and inserts a markdown image reference (`![…](…)`) to that exact file at the cursor.
  An independent process reading the configured global figures directory finds a newly-written image file whose bytes are the clipboard image (real image bytes are persisted, not zero-length), and the markdown reference inserted at the cursor points at that same on-disk file.
  Admissible because it fails on a no-op insert (the paste-image action leaves the buffer unchanged so no image reference appears at the cursor), on a dangling reference (a markdown image reference is inserted but it points at a file that was never written / does not exist on disk), on a wrong-location write (the file is written into a local `./figures` relative to the project instead of the configured global figures directory), and on an empty persist (the reference points at a file that exists but holds no image bytes — nothing of the clipboard image was actually persisted).

### Milestone — Export as a discovered plugin (P66)

P66 (added 2026-06-17) covers the milestone that retires the transitional `[export.<id>]` app-config tables ([[export-plugins-contract]]) by making export a discovered plugin in the pandoc suite — exactly as rendering already moved to the pandoc-renderer plugin. The app core owns NO pandoc/export command knowledge; the export flags live inside the export plugins themselves.

- **P66 — Export is a discovered plugin in the pandoc suite.** A plugin declaring `category = "export"` placed in the plugins directory is discovered the same way the pandoc-renderer plugin is — no app-core `[export.<id>]` config table is involved anywhere.
  Once discovered, that plugin auto-populates an "Export: <name>" menu / command-palette entry that carries the plugin's declared output extension (a generic manifest field on the export-category plugin, read by the menu populator), AND the plugin contributes its own row to the doctor check.
  Admissible because it fails if the export menu still reads the app-core `[export.<id>]` config (an export plugin that declares NO `[export.*]` table would then never appear in the menu), if discovery ignores `category` (a non-export plugin populates an "Export:" entry, or the export plugin does not), and if the export plugin contributes no doctor row (the doctor output has no entry attributable to that discovered export plugin).

## Export-as-plugin migration rulings (2026-06-17)

Ratified rulings for the export-as-plugin-suite migration. Apply these; do not re-litigate.

1. **MathJax (total externality).** The HTML export plugin VENDORS its own MathJax bundle INSIDE its plugin dir (copy from `src-tauri/resources/mathjax/tex-full-svg-a11y.min.js`) and references it locally — NOT via an AppHandle resource path.
2. **Independent raw command per plugin (richness bar).** Each export plugin carries its OWN independent raw command; export commands are individually managed per plugin.
3. **Enable/disable OUT OF SCOPE this milestone.** Export plugins are discovered + run + doctored + configured exactly like the pandoc-renderer plugin — no enable/disable.
4. **Output extension is a generic manifest field.** The output file extension is a generic manifest field on the export-category plugin, read by the menu populator.

These map to the next spec families the obligations document already tracks: webview specs p45–p50 and doctor-class specs d17+. The spec design itself belongs to the test author and implementer, not to this obligations document.

## Verification vehicle

Real app on a real display via `tauri-plugin-playwright` (precedent: the sibling repo `~/gitclones/pandoc-preview-greenfield` proof harness; see also the `tauri-playwright` skill).
Hermetic per-run temp project dirs and `XDG_CONFIG_HOME`; disk assertions via independent processes; pandoc, lualatex, gum as hard dependencies.
No mocks, no skips, no forced error modes.

P10 caveat: the only obligation requiring PTY automation of gum; if brittle, record as explicit proof debt — never weaken to existence checks.
