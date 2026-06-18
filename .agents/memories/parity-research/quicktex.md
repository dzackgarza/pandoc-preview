# quicktex — Parity Research

**When this applies:** scoping the snippet/abbreviation-expansion completion source (the "quicktex-class 281-entry dict migrated as a CodeMirror completion source" tracked in Tier 0). Cross-links: [[../lineage-vim-live-texing-setup]] (quicktex is part of the user's heritage stack — daily-use proof theorem envs are authored as fenced divs), [[../editor-experience-targets-conceals-folding-expansion]] (the 281-entry `g:quicktex_prose`/`g:quicktex_math` dict is "the de facto personal authoring vocabulary spec"), [[../feature-catalogue-and-implementation-status]] (Tier-0 snippets; proof obligations P52/P59). Source: `dzackgarza/quicktex` README (read 2026-06-16) — the user's own fork; clones at `/tmp/ref-quicktex` per [[../lineage-vim-live-texing-setup]].

## What it is

quicktex (the user's fork of josephwright's/the vim plugin) is a **template expander for fast LaTeX authoring** — a mode-aware abbreviation dictionary that the heritage vim setup used to "write as fast as the lecturer writes on the blackboard" (Castel ideal, [[../lineage-vim-live-texing-setup]]). It is NOT a full snippet engine (no transforms, no dynamic nodes); it is a flat keyword→body map with two distinguishing features: (1) **space-triggered auto-expansion** (no expand key — type the keyword, press space, it expands and chains), and (2) **mode-awareness** (separate prose vs math dictionaries, so the same short trigger means different things inside `$…$`). This is the direct ancestor of P52 (user-defined snippet dictionary expands at cursor with tabstop) and P59 (insertion-bar snippet dropdown).
It is the SOURCE FORMAT we are migrating, so parity here is about faithfully reproducing its trigger/jump/mode semantics in CodeMirror, not about copying a third-party UI.

## Feature inventory

- **Keyword → expansion-body dictionary** (`g:quicktex_<filetype>`, e.g. `g:quicktex_tex`): a flat Vim dict mapping a trigger string to an expansion body.
  `[relevance: High]`
- **Space-triggered auto-expansion**: keywords expand automatically when followed by a space — no separate trigger keypress.
  Enables sequential rapid expansion ("type in the same order the lecturer writes"). `[relevance: High]`
- **Jump-points / tabstops via `<+++>` and `<++>` markers**: cursor auto-jumps to `<+++>` after expansion; pressing space-after-space navigates to the next `<++>`. Multi-part templates (e.g. `\frac{<+++>}{<++>}`) place the cursor at the first slot then tab through.
  `[relevance: High]`
- **Mode-awareness (prose vs math)**: `g:quicktex_prose` and `g:quicktex_math` are separate maps; the active map depends on whether the cursor is in math mode.
  The SAME short trigger (`m`, `M`, `st`) resolves differently inside vs outside math.
  This is quicktex's biggest advantage over generic snippet plugins for math notation.
  `[relevance: High]`
- **Vim-keypress-sequence bodies**: double-quoted expansion bodies are interpreted as Vim key notation (`\<CR>`, `\<BS>`, `\<Right>`), enabling cursor positioning / multi-step transforms inside an expansion.
  `[relevance: Med]` (a vim-ism; the CM analog is tabstop + insert-position metadata, not literal keystrokes)
- **Single-quote literal bodies**: single-quoted bodies expand verbatim.
  `[relevance: High]`
- **Domain vocabulary entries**: the real 281-entry dict includes prose abbreviations (`st` → "such that"), math constructors (`frac` → `\frac{<+++>}{<++>}`), and pandoc fenced-div theorem environments (`thm` → `:::{.theorem title="?"}` … per [[../lineage-vim-live-texing-setup]]). Proves theorem environments are authored as fenced divs, not `\begin{theorem}`. `[relevance: High]`

## Parity matrix

| feature | target has it | our status | math-writing relevance | notable mechanism worth porting |
| --- | --- | --- | --- | --- |
| Flat keyword→body dictionary | yes | planned: Tier0 (config-declared snippet dict, P52/P59) | High | the 281-entry dict IS the migration payload — config-owned path, not hardcoded |
| Tabstop / jump-points (`<+++>`/`<++>`) | yes | planned: Tier0 (P52 "cursor lands at snippet's declared tabstop") | High | first-slot `<+++>` vs subsequent `<++>` ordering; CM6 snippet templates use `${1}`/`${2}` — translate the markers |
| Space-triggered auto-expansion (no expand key) | yes | gap (P52 is autocomplete-tooltip path; P59 is bar-dropdown path — neither is space-autotrigger) | High | the "as fast as the blackboard" ergonomic; an autotrigger source distinct from popup-accept |
| Mode-awareness: prose vs math dictionary | yes | gap | High | the SAME trigger means different things in `$…$` — needs a math-zone detector gating which dict is active |
| Domain vocabulary (prose `st`, env `thm`, math `frac`) | yes | planned: Tier0 (migrated as completion source) | High | preserve the exact 281 entries verbatim — they are the personal authoring spec |
| Vim-keystroke bodies (`\<CR>` etc.) | yes | n/a (vim-specific) | Low | replace with CM tabstop/cursor metadata; do NOT reimplement keystroke interpretation |

## Gaps (net-new candidates our catalogue does NOT track)

- **Space-triggered AUTO-expansion** (the keyword expands on the next space with NO accept keypress and NO popup).
  P52 proves the autocomplete-TOOLTIP path (type trigger → tooltip → accept) and P59 proves the BAR-DROPDOWN path; NEITHER reproduces quicktex's defining ergonomic of zero-friction inline expansion.
  This is the single most important behavior to port and is currently untracked.
  Mirrors UltiSnips/LuaSnip autotrigger (see [[snippet-and-lint-ecosystem]]). `[relevance: High]`
- **Math-zone-conditional dictionary selection**: quicktex's prose/math split means a trigger expands to one thing in text and another in math.
  The catalogue's snippet source is flat; it has no notion of a math-context predicate selecting which entries are live.
  This needs a math-zone detector (the same detector LuaSnip uses for math-only snippets).
  Without it, short single-letter math triggers (`m`, `M`) collide with prose.
  `[relevance: High]`
- **Chained sequential expansion**: because expansion fires on space and immediately re-arms, you can fire several expansions in one fluid stroke.
  A popup-accept model breaks this rhythm.
  Worth validating that the CM autotrigger source re-arms after each expansion.
  `[relevance: Med]`
- **The actual 281-entry dictionary as a versioned data asset**: the catalogue says "281-entry dict migrated as a completion source" but does not pin WHERE the canonical dict lives (the user's fork / `after/ftplugin/pandoc/quicktex_dict.vim`) or that it must be migrated verbatim (OSOT). Establishing the dict's canonical provenance + a converter (vim-dict → config snippet format) is a concrete net-new task.
  `[relevance: High]`

## Dispositions

- **Vim-keystroke-sequence expansion bodies** (`\<CR>`, `\<Right>`, `\<BS>`) — *excluded — vim-specific, not portable*: these encode cursor movement as literal vim keys.
  The CodeMirror equivalent is tabstop markers + insert-position metadata in the snippet template.
  Reimplementing a keystroke interpreter would be reinventing a worse snippet engine; map to CM6 `${1}`/`${2}` template syntax instead.
- **"quicktex" name ambiguity** — *resolved*: the prompt flagged a possible confusion with josephwright's TeX package.
  In THIS repo's lineage, quicktex = the ~281-entry vim abbreviation/expansion dictionary in the user's fork ([[../lineage-vim-live-texing-setup]], [[../editor-experience-targets-conceals-folding-expansion]]). The migration target is the DICTIONARY DATA + its trigger/jump/mode semantics, not a LaTeX package.
- No gimmicks and no banned-non-goal overlap: quicktex is local single-user authoring tooling.
