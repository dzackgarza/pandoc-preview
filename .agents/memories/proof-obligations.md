# Proof Obligations (P1–P11)

User-approved external proof obligations for Pandoc Preview. Each is an exact, externally observable happy-path state — real display, real pandoc, real filesystem, real XDG config. No internal behaviours, no forced error modes. An assertion is admissible only if it would fail on a plausibly broken app (unwired pandoc, frozen preview, UI-only fake state, junk output).

## Shared witness fixture

A per-run temp project containing `demo.md` with:

- heading `# Geometry of Numbers — Café` (unicode discriminator)
- `*naïve*` emphasis
- an ordered list whose last item is `Minkowski bound`
- math line `$\zeta(2) = \pi^2/6$`
- `![scatter](fig/plot.png)` referencing a real 64×48 PNG at `fig/plot.png`

## Obligations

- **P1 — Source→preview fidelity.** Open project, click `demo.md`. Preview iframe document contains `h1` with text exactly "Geometry of Numbers — Café", an `em` with text "naïve", an `ol` whose last item is "Minkowski bound".
- **P2 — Live re-render.** Type `The discriminant equals −163.` at buffer end. Sentence absent from preview before the edit; present verbatim after the configured debounce elapses.
- **P3 — Save persists exact bytes.** After the P2 edit, Save. Independent process reads the file from disk: byte-for-byte equal to the editor buffer, unicode intact.
- **P4 — Math via configured engine.** With `math = "katex"`, preview contains `span.katex` whose TeX annotation equals `\zeta(2) = \pi^2/6`; the literal `$\zeta(2)` does not appear as text.
- **P5 — Relative resource resolution.** Preview `img[alt="scatter"]` has `naturalWidth == 64 && naturalHeight == 48` (real pixels decoded through the asset-protocol `<base href>` chain).
- **P6 — File manager mutates the real directory.** (a) Sidebar lists exactly the non-hidden entries of the opened folder, directories first. (b) Creating `chapter2.md` via the UI yields a real empty file on disk and the editor opens it. (c) Renaming to `chapter-two.md` makes the old path absent and the new present on disk.
- **P7 — Export HTML artifact.** Export HTML to a chosen temp path: file exists at exactly that path, parsed DOM repeats P1 witnesses, `img` `src` is a `data:` URI (self-contained).
- **P8 — Export PDF artifact.** Export PDF: valid PDF whose extracted text contains "Geometry of Numbers" and "Minkowski bound". lualatex is a hard dependency — fail loudly, never skip.
- **P9 — Settings round-trip to XDG TOML.** With hermetic `XDG_CONFIG_HOME`, change font size 14→18 and theme dark→light via Settings, save. On-disk `pandoc-preview/config.toml` parses to exactly `font_size = 18`, `theme = "light"`, all other keys unchanged; editor computed font-size 18px.
- **P10 — First-run script → bootable app.** Drive `scripts/first-run.sh` in a real PTY through the gum prompts: config.toml parses to exactly the selected values, and a subsequent app launch reaches the editor UI (not the config-error screen).
- **P11 — Compile log reflects the real subprocess.** After a successful render, the Compile Log tab contains the configured `--from markdown` and a zero exit status. (Known cosmetic defect found at design time: `render.rs::format_log` produces `exit status: exit status: 0`.)

## Verification vehicle

Real app on a real display via `tauri-plugin-playwright` (precedent: the sibling repo `~/gitclones/pandoc-preview-greenfield` proof harness; see also the `tauri-playwright` skill). Hermetic per-run temp project dirs and `XDG_CONFIG_HOME`; disk assertions via independent processes; pandoc, lualatex, gum as hard dependencies. No mocks, no skips, no forced error modes.

P10 caveat: the only obligation requiring PTY automation of gum; if brittle, record as explicit proof debt — never weaken to existence checks.
