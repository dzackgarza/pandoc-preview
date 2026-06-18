# Phase C — Citations Done Right (implementation plan)

Durable, resumable implementation plan for Phase C of the Competitive Parity Roadmap.
Authored 2026-06-16. If interrupted, resume from the **Status / resume here** section at
the bottom.

This is a **repo artifact** (future-work + current-state), NOT a memory. The durable
*priorities* and *mechanisms* live in memory: see the roadmap
[[competitive-parity-roadmap]] ("## Phase C — Citations done right") and the per-program
parity studies [[parity-research/vimtex]], [[parity-research/zettlr]],
[[parity-research/overleaf]], [[parity-research/pandoc-editor]]. The tracking surfaces are
[[feature-catalogue-and-implementation-status]] (Tier-0 insertion-bar citation/`\cref`
items; Tier-4 Zotero CAYW) and [[proof-obligations]] (P51 composable completion; P55–P62
insertion bar). This plan REFINES the already-planned bib autocomplete + workspace-aware
`\cref` picker with concrete mechanisms; it does **not** re-plan Zotero CAYW.

**Deliverable.** "Quickly finding and inserting citations" is a top-3 user priority
([[competitive-parity-roadmap]] Phase C rationale). The catalogue already *plans* bib
autocomplete + a `\cref` picker + Tier-4 Zotero; the parity research supplies the
MECHANISMS that make them usable (metadata fuzzy-match + tooltip preview; `@`-trigger entry
point; cross-file label harvesting) plus two small net-new surfaces (per-file
`bibliography:` override; a references sidebar tab). Priority *within* the roadmap is third
(after Phase A lint and Phase B snippets), but every Phase-C mechanism rides surfaces that
already exist and are green: the composable completion registry (P51), the insertion bar
(P55–P62), the activity-bar/side-bar (P18), and the configured-directories explorer model
(P44). The leverage is high and the owned surface is small.

## Source items (from the roadmap)

Copied verbatim from [[competitive-parity-roadmap]] "## Phase C — Citations done right",
with status tags:

| Item | Status | Rel |
| --- | --- | --- |
| Citation fuzzy-match on a `key + author + year + title` formatted string, not just the cite key; tooltip preview of the bib entry before insert | refines Tier 0 (bib autocomplete) | High |
| `@`-trigger as the in-editor citation entry point (line-start / after-space / after `[`), full pandoc citation syntax (`[@Key, p. 45]`, narrative, locator) | refines Tier 0 | High |
| Label/`\cref` completion harvested from ALL project files via main-document root detection (the index that powers cross-file completion) | refines Tier 0 (`\cref` picker "scans subdocuments") | High |
| Per-file `bibliography:` YAML frontmatter override (papers that ship their own `.bib`), in addition to the config-declared global bib | net-new gap | Med |
| References/bibliography preview sidebar — live "what this doc cites so far" panel in a CSL style; a sibling sidebar tab to the planned figures tab | net-new gap | Med |
| Command/backslash completion scoped to AVAILABLE macros (the injected MathJax macro tiers), so users only see macros that will render | refines Tier 0 (P51) | Med |

**Out of scope (referenced, not planned here).** Zotero CAYW + Better-BibTeX (Tier 4,
[[feature-catalogue-and-implementation-status]] "Zotero citation insertion (very
important)"): a plugin-side surface that invokes Zotero's own CAYW popup and inserts the
returned citation. Phase C deliberately does NOT reimplement an in-app bibliography manager;
the bib data source for the Phase-C surfaces is the **config-declared BibTeX/CSL file**
(see the prerequisite below). When the Tier-4 Zotero plugin lands it inserts the SAME
pandoc `[@Key]` syntax these surfaces produce, so they compose; Phase C does not block on
it.

## Discipline

(Matches [[../render-rebuild-plan]] and the global TDD doctrine.)

- **Interop-first / research-first governs every work item (AGENTS.md HARD RULE #0).** Each
  sub-milestone BEGINS with the research step that answers "what already exists" and names the
  concrete existing tool / library / binary / standard format / reference implementation it
  leverages, supports, or ports — before any build step. Greenfield is rejected: a work item
  whose first action is "write a new X" with no such research is sent back for the research step.
  Phase C's interop anchors: support standard `.bib` / BibLaTeX / CSL-JSON bibliography files
  directly (consume them, never flatten into a bespoke schema), embed an existing BibTeX/CSL
  parser library rather than writing a parser, ride the existing CodeMirror 6
  `@codemirror/autocomplete` infrastructure via the project's composable source registry (P51),
  and port the APPROACH (not code) of vimtex's project-root label indexing.
- TDD per sub-milestone: design → RED proof obligation (user-ratified) → commit RED →
  GREEN → commit. Each sub-milestone gates on its proof green before the next starts.
  RED must FAIL because the observed citation/label behaviour is absent, never because a
  guessed solution surface is missing — a proof that would still pass on a broken app is
  inadmissible ([[proof-obligations]] admissibility rule).
- Existing obligations **P1–P69** (and D1–D17) stay green throughout. A sub-milestone that
  would break one must be re-scoped. P51's composable-completion guarantee is load-bearing:
  every new completion source here is ADDED to `appCompletionSources`, never an override —
  P51 itself proves a new source must not displace the LaTeX backslash / `:::` completions.
- No fallbacks, no soft defaults, no mocks; fail loud. A configured-but-unreadable bib file
  is a hard, visible error (toast), never a silently-empty completion source — mirrors the
  snippet-dictionary load path (`registerSnippetDictionary` → `toastError`).
- Single-user Linux desktop; bib/CSL are real files on the host fs; assertions read them
  through independent processes / the real preview, never a fixture stand-in.
- Proof harness contract preserved: webview specs land as `tests/proof/pNN-*.spec.ts` in
  the existing battery (precedent p51–p62); the doctor `[OK]/[FAIL]/[SKIP]` report format is
  untouched (Phase C adds no doctor checks — the bib-file existence guarantee rides the
  existing `ExistingFile` config newtype, which already fails loud at load).

**Proof obligation numbering: RESERVED block P84–P89.** This plan PROPOSES P84–P89; it does
NOT edit [[proof-obligations]]. Ratify the obligations with the user before writing any RED
spec. (P70–P83 are reserved by the Phase-A and Phase-B plans; Phase C owns P84–P89.)

## Current code seams (what gets touched/extended)

Real files inspected 2026-06-16. The completion + bar + sidebar surfaces all exist and are
green; Phase C extends them, greenfielding only the bib-index module and the references
sidebar component.

- **`src/lib/components/EditorPane.svelte`** — the completion seam. `appCompletionSources:
  CompletionSource[]` (line ~109) is a mutable registry; `delegatingCompletionSource`
  (~119) fans out to it and is folded into `latex({ extraCompletionSources: [...] })`
  (~201), so app sources COMPOSE with the LaTeX command source (the P51 guarantee).
  `registerSnippetDictionary` (~256) is the exact precedent for "read a config-owned file
  post-mount, parse it, `appCompletionSources.push(...)`". Phase C adds (a) a citation
  completion source pushed the same way, (b) a label completion source over a
  cross-file-harvested index, and (c) a filter on the LaTeX backslash source scoped to the
  available macro tiers. `insertSnippet`/`runSnippet` (~393) and the bar-control insert
  methods (`insertCodeBlock`, `insertFootnote`, `insertImageReference`) are the precedent
  for inserting citation/locator text at the cursor.
- **`src/lib/editor/snippets.ts`** — the canonical "config-owned file → composable
  completion source" module. The new `src/lib/editor/citations.ts` (bib parse → formatted
  `key + author + year + title` match string + tooltip `info` render → `CompletionSource`)
  and `src/lib/editor/labels.ts` (harvest `\label{}` / `{#id}` / `:::{#id}` anchors across
  project files → label completion source) follow its shape exactly (parse-loud, branded
  config path, one source factory).
- **`src/lib/components/InsertionBar.svelte`** — the `@`-trigger lives in the editor, not
  the bar, but a "cite" bar control (sibling to `paste image`) MAY route through the same
  citation insert path for discoverability; the bar already takes `onInsert*` callbacks and
  config-derived option lists (`snippetTriggers`, `codeBlockLanguages`) — a `citeKeys` prop
  is the same pattern. (Decide at C2 whether to add a bar control or keep `@` editor-only.)
- **`src/App.svelte`** — sidebar/activity-bar wiring. `SIDEBAR_VIEWS` (~119:
  `explorer`/`macros`/`figures`) is "the single extension point — add an entry to add a
  tab" ([[ActivityBar]] doc comment). The references tab is a FOURTH `SIDEBAR_VIEWS` entry
  rendered in the `data-pane="sidebar"` block (~1402, alongside the macros/figures panes,
  P44 precedent). App holds `config`, the live buffer, and `editor` method handles
  (`getOutline`, etc.) — the references panel reads the current doc's resolved citations
  the same way the outline panel reads `editor.getOutline()`.
- **`src-tauri/src/config.rs`** — **the prerequisite seam (see Risk).** The `Editor` struct
  carries `snippet_dictionary` / `spell_dictionary` as `Option<ExistingFile>` (load-time
  existence-validated, fail-loud). Phase C adds a config-declared **bibliography** key (a
  *required* `ExistingFile` per the roadmap "hard-required config key"), readable by the
  frontend, as the data source for citation completion + the references sidebar. TODAY the
  bib path is NOT a config key — it is baked into the renderer plugin's pandoc command
  string (`scripts/first-run.sh:112` `BIBLIOGRAPHY="$HOME/.pandoc/bib/references.bib"`,
  embedded in `PANDOC_COMMAND`). The frontend cannot read it. C1 must surface it as a
  first-class config key.
- **`src/lib/types.ts` / `src/lib/api.ts`** — `Config` mirrors the Rust struct; `editor`
  gains the bib key (branded `ExistingFile`). `api.ts` gains a thin `readTextFile`-class
  reader for the bib (and, for cross-file labels, a `listTree`/`readTextFile` walk over the
  project root — both already exist; no new Tauri command needed for the MVP label index).
- **`scripts/first-run.sh`** — generates the config; it already KNOWS the bib path
  (`BIBLIOGRAPHY`/`CSL`). C1 makes it ALSO write the new `editor.bibliography` (and
  `editor.csl`) config key, so the one bib path is declared once and consumed by both the
  renderer command and the frontend (OSOT — the path is named in one place the user edits,
  and the renderer-plugin command references the same config value rather than a second
  literal). Reconcile the existing literal in `PANDOC_COMMAND` against the new key here.

## Work items (ordered sub-milestones)

Ordered so the data source (config bib key) lands first, then the high-relevance editor
mechanisms, then the two net-new surfaces, then the macro-scoping refinement.

### C1 — Bib as a config-declared, frontend-readable source  [FOUNDATION; proposes P84]

**Research-first:** support standard bibliography files directly — a config-declared
`.bib` / BibLaTeX / CSL-JSON file consumed as-is (the same native formats Zettlr and vimtex
read — [[parity-research/zettlr]] "BibTeX, or BibLaTeX used directly"; [[parity-research/vimtex]]
`.bib` backends), plus the existing CSL file the renderer already ships. No bespoke bib schema
is introduced; the config key names the user's existing file and the existing `ExistingFile`
config newtype (already load-validating `snippet_dictionary` / `spell_dictionary`) is the
mechanism reused for fail-loud existence validation. Nothing new is parsed here — C1 only
surfaces the already-shipped bib/CSL paths as first-class config keys.

The data source for every other Phase-C item. Promote the bibliography from a literal
buried in the renderer command to a *hard-required* `editor.bibliography` config key
(`ExistingFile`, load-time validated, fail-loud), mirrored into `Config` (types.ts) and
read on the frontend. Reconcile `first-run.sh` so the one bib path is declared once and the
renderer-plugin pandoc command references the config value (OSOT) rather than a second
literal. Add `csl` likewise (the references sidebar needs the CSL to render in the user's
style). A `readBibliography` reader in `api.ts` returns the bib file's bytes for the
parser.

- RED reason: there is no `editor.bibliography` config key; the frontend cannot obtain the
  bib path, so no citation source can be built from "the configured bib file".
- Touches: `config.rs` (`Editor` struct + `validate`), `types.ts`, `api.ts`,
  `first-run.sh`, the renderer-plugin config/command reconciliation.

### C2 — Citation completion: metadata fuzzy-match + tooltip preview + `@`-trigger  [proposes P85, P86]

**Research-first:** leverage an existing maintained BibTeX/CSL parser library (e.g. a
well-regarded JS BibTeX/BibLaTeX parser, or a CSL-JSON reader for the CSL-JSON case) to read the
C1 file into entries — do NOT hand-write a bib parser. Wire the `@`-trigger and the candidate
list through the existing CodeMirror 6 `@codemirror/autocomplete` infrastructure via the
project's composable source registry (P51, `appCompletionSources`) — no bespoke completion
engine. The match-string and trigger-predicate DESIGN is ported from the reference
implementations: the `key + author + year + title` formatted match string from vimtex's
`match_str_fmt` ([[parity-research/vimtex]]), and the `@`-at-line-start/after-whitespace/after-`[`
trigger plus tooltip-preview-before-Enter from Zettlr ([[parity-research/zettlr]]).

The two High-relevance citation items, built as one composable source pushed to
`appCompletionSources` (P51-shaped). Parse the C1 bib file into entries; for each, build a
formatted match string `key + author + year + title` (the vimtex `match_str_fmt`
mechanism — [[parity-research/vimtex]]: fuzzy-match on author/year/title, not just key) and
a tooltip `info` renderer showing the full bib entry (the zettlr "tooltip shows
bibliographic info to verify before Enter" mechanism — [[parity-research/zettlr]]). The
`@`-trigger is the editor entry point: a completion source firing when `@` is typed at
line-start / after-whitespace / after `[` (zettlr's exact trigger predicate), offering the
formatted candidates; accepting inserts a pandoc citation. Support the full pandoc citation
syntax surface — `[@Key]`, narrative `@Key`, and the locator form `[@Key, p. 45]` (locator
typed after accept; the source completes the key, the syntax wrapper is the insert shape).

- **P85 (`@`-trigger + metadata fuzzy-match):** typing `@` in a trigger position opens the
  completion tooltip; the offered candidates filter against author/year/title (a query
  matching a word in the title surfaces the entry whose KEY does not contain that word —
  proving the match string is metadata, not key-only); accepting inserts `[@<key>]` (or the
  narrative form) at the cursor. Admissible because it fails on a key-only matcher (a
  title-word query yields nothing), a no-trigger wiring (`@` does not open completion), and
  a literal-key insert that does not produce pandoc citation syntax.
- **P86 (tooltip bib-entry preview):** the citation completion option carries an `info`
  tooltip whose rendered content shows the bib entry's author + year + title (the fields
  the user verifies before insert), sourced from the configured bib file. Admissible
  because it fails on an option with no info tooltip (nothing previews before accept) and on
  a tooltip that shows only the bare key (the metadata the user needs to disambiguate is
  absent).
- Touches: new `src/lib/editor/citations.ts`; `EditorPane.svelte`
  (`registerCitationSource`, pushed alongside the snippet source); reuses the E2E
  `typeInEditor`/`acceptCompletion`/`cursorOffset` harness surfaces.

### C3 — Cross-file label / `\cref` completion via project-root harvesting  [proposes P87]

**Research-first:** port the APPROACH of vimtex's multi-file project-root indexing
([[parity-research/vimtex]]: harvest labels from ALL project files via main-document root
detection, the index that powers cross-file completion) — port the indexing strategy, not vim
code. Build the harvest on the existing `listTree` + `readTextFile` Tauri surfaces (both already
in `api.ts`; no new command) and expose the result as another P51-composed
`@codemirror/autocomplete` source, reusing the same `appCompletionSources` registry C2 uses. No
greenfield indexer or completion engine.

The workspace-aware `\cref` picker the catalogue already promises
([[feature-catalogue-and-implementation-status]]: "workspace-aware — scans across
subdocuments"), with the concrete mechanism from [[parity-research/vimtex]]: harvest labels
from ALL project files via main-document root detection, not the current buffer only. Build
a label index by walking the project root (`listTree` + `readTextFile`, both already in
`api.ts`) and harvesting anchor definitions — pandoc `{#id}` heading attributes,
`:::{#id}` fenced-div ids, and `\label{}` — across every markdown file under the root.
Expose a `\cref{` / `[@...]`-class completion source over that index, composed into
`appCompletionSources`. Root detection: the open project root (the workspace the explorer is
rooted at) is the index scope; a `main-document` marker is the vimtex analog but the MVP
scope is "every file under the open project root" (the explorer's root).

- **P87 (cross-file label completion):** with a project containing TWO markdown files where
  a label/anchor is defined in file A, open file B and trigger label completion — the label
  defined in the OTHER file is offered (proving the index spans the project, not the current
  buffer), and accepting inserts a reference to it at the cursor. Admissible because it
  fails on a current-buffer-only index (file A's label is never offered while editing file
  B), a no-op source (no labels offered at all), and an insert that does not reference the
  chosen label.
- Touches: new `src/lib/editor/labels.ts` (harvest + source); `App.svelte` (hand the editor
  the project root + a way to read sibling files, or build the index in App and pass it
  down — decide at design time, favouring App-owned index built from the same `listTree`
  the explorer uses); `EditorPane.svelte` (`registerLabelSource`).

### C4 — Per-file `bibliography:` YAML frontmatter override  [net-new; proposes P88]

**Research-first:** support the standard pandoc/Zettlr per-file `bibliography:` YAML
frontmatter key directly ([[parity-research/zettlr]] "per-file via YAML
`bibliography: ./assets/references.json`"; [[parity-research/pandoc-editor]] frontmatter editor)
— this is pandoc's own native metadata key, consumed as authored, not a bespoke override
mechanism. It reuses the C2 parser library (the override file is the SAME `.bib`/CSL-JSON format)
and re-selects the C2 citation source; nothing new is parsed or formatted.

A paper that ships its own `.bib` declares `bibliography: ./refs.bib` in its YAML
frontmatter; that override takes precedence over the C1 global config bib for citation
completion AND the references sidebar (the zettlr / pandoc-editor per-file model —
[[parity-research/zettlr]], [[parity-research/pandoc-editor]] frontmatter editor). The
override is read from the open buffer's frontmatter (resolved relative to the file's
directory) and, when present, supplies the citation source's entries instead of the global
bib. Absent frontmatter key → the C1 global bib (no silent empty source).

- **P88 (per-file override):** open a file whose frontmatter declares a `bibliography:`
  pointing at a sibling `.bib` containing a key absent from the global bib; citation
  completion offers that file-local key (proving the override is in effect), and a file
  WITHOUT the frontmatter key still offers the global bib's keys (proving the global remains
  the fallback source, not a hole). Admissible because it fails on an ignored frontmatter
  key (the file-local key is never offered), a override that drops the global bib for files
  without the key (global keys vanish), and a non-existent override path treated silently
  (must fail loud, not empty).
- Touches: `src/lib/editor/citations.ts` (frontmatter-aware source selection);
  `EditorPane.svelte` / `App.svelte` (re-resolve the citation source on file open, since the
  active bib now depends on the open file's frontmatter).

### C5 — References / bibliography preview sidebar tab  [net-new; proposes P89]

**Research-first:** reuse the existing pandoc `--citeproc` rendering path the preview already
runs (the preview's `#refs` block already resolves the bibliography for cited keys — p27) to
produce the CSL-styled references, rather than reimplementing CSL formatting in JS. The sidebar
is the FOURTH entry on the existing `SIDEBAR_VIEWS` extension point (P44/P18 precedent), modeled
on Zettlr's References sidebar ([[parity-research/zettlr]]) — no new render engine and no bespoke
CSL formatter; the one source of truth for "what a key renders as" stays the real pandoc
citeproc output.

A live "what this doc cites so far" panel — a FOURTH `SIDEBAR_VIEWS` tab sibling to the
planned figures tab (zettlr References sidebar — [[parity-research/zettlr]]; the roadmap
"sibling sidebar tab to the planned figures tab"). It lists the citations the current
document actually contains, rendered in the configured CSL style. The cited-key set comes
from scanning the live buffer for `[@key]` / `@key` citations; each is resolved against the
active bib (C1 global or C4 per-file override) and rendered as a formatted reference. The
panel updates as the buffer changes (the same `onChange`/outline-refresh cadence App already
runs). The "rendered in a CSL style" requirement is satisfiable by the SAME pandoc
`--citeproc` path the preview already uses (the preview's `#refs` block already resolves the
bibliography for cited keys — p27); the sidebar can reuse the rendered bibliography rather
than re-implementing CSL formatting in JS.

- **P89 (references sidebar reflects cited keys):** with the references tab active, citing a
  key in the buffer makes that reference appear in the panel (author/year/title text, not
  the bare key), and a key that is NOT cited does not appear; rendering uses the configured
  CSL (the formatted label/entry matches the preview's bibliography for the same key).
  Admissible because it fails on a static/empty panel (citing a key adds nothing), a panel
  that lists the WHOLE bib rather than only what the doc cites (an uncited key appears), and
  a panel that shows bare keys with no resolved bibliographic text (no CSL rendering).
- Touches: new `src/lib/components/ReferencesPanel.svelte`; `App.svelte` (`SIDEBAR_VIEWS`
  entry + sidebar-pane render block + cited-key extraction from the buffer + access to the
  resolved bibliography, e.g. from the preview render result or a dedicated citeproc call).

### C6 — Backslash completion scoped to available MathJax macro tiers  [refines P51; deferred-or-last]

**Research-first:** port the APPROACH of vimtex's package-scoped command completion
([[parity-research/vimtex]]: "command completion filtered by active packages") and reuse the
EXISTING vendored `codemirror-lang-latex` completion source (`vendor/.../completion.ts`) plus the
already-baked MathJax macro-tier vocabulary ([[mathjax-macro-system-tiers-and-injection]]) as the
source of truth — FILTER/augment the existing source against a real read of the tier SoT, never
greenfield a new command list or hardcode a JS macro array (that hardcode is the admissibility
line below).

Scope the LaTeX backslash command completion to the macros that will actually render —
the injected MathJax macro tiers ([[mathjax-macro-system-tiers-and-injection]]) — so users
only see commands that the preview can typeset (the vimtex "command completion filtered by
active packages" mechanism — [[parity-research/vimtex]]). The vendored
`codemirror-lang-latex` completion source (`vendor/.../completion.ts`) offers a fixed
LaTeX command list; this item FILTERS/augments it against the macro-tier vocabulary the app
injects. Lower priority and gated on a clean read of the macro-tier source-of-truth (the
baked MathJax config / tier macro lists); it does not block C1–C5.

- No new obligation proposed yet — this refines P51's surface. If ratified as a standalone
  obligation it would assert: a macro PRESENT in an injected tier is offered by backslash
  completion, and a plausible LaTeX command ABSENT from every tier (and thus not renderable
  in preview) is NOT offered. Decide at design time whether this earns an obligation or is a
  P51-subsumed refinement (the macro list must be a real read of the tier SoT, not a
  hardcoded JS list — that is the admissibility line).
- Touches: `EditorPane.svelte` (wrap/filter the LaTeX completion source against the
  macro-tier list); a reader for the macro-tier vocabulary (the baked config asset).

## Proposed proof obligations (P84–P89)

PROPOSALS only — ratify with the user before writing RED. Do NOT edit [[proof-obligations]]
until ratified. Each is an exact, externally observable happy-path state, admissible only if
it would FAIL on a plausibly broken app.

- **P84 — Bib file is a config-declared, load-validated source.** The bibliography path is a
  required `editor.bibliography` config key validated to exist at load (`ExistingFile`); the
  frontend reads it, and pointing config at a different bib file changes the citation
  candidates. Admissible because it fails when the bib path is not a config key (the
  frontend has no path to read), when a missing bib path is silently accepted (load must
  fail loud), and when the candidates ignore the configured file (a different bib offers the
  same candidates).
- **P85 — `@`-trigger citation completion with metadata fuzzy-match.** (See C2.) Typing `@`
  in a trigger position offers candidates that filter on author/year/title; accepting
  inserts pandoc `[@key]` syntax.
- **P86 — Citation tooltip previews the bib entry before insert.** (See C2.) The completion
  option's info tooltip shows the entry's author/year/title from the configured bib.
- **P87 — Cross-file label completion.** (See C3.) A label defined in one project file is
  offered while editing another, and accepting inserts a reference to it.
- **P88 — Per-file `bibliography:` frontmatter override.** (See C4.) A file's frontmatter
  bib takes precedence; a file without it falls back to the global config bib.
- **P89 — References sidebar reflects the document's cited keys in CSL style.** (See C5.)
  The panel lists only the keys the buffer cites, rendered via the configured CSL.

(C6 proposes no obligation yet — it refines P51; ratify separately if it earns one.)

## Verification

- Vehicle: the existing `tauri-plugin-playwright` proof harness (the `tauri-playwright`
  skill; [[proof-obligations]] "Verification vehicle"). New specs land as
  `tests/proof/p77-*.spec.ts … p82-*.spec.ts`, precedent p51–p62.
- Real bib/CSL files: each citation/label/sidebar spec ships a real `.bib` (precedent
  `tests/proof/fixtures/references.bib`, already carrying `@DM19`) and asserts behaviour
  against its real entries — the metadata-match proof (P85) needs an entry whose
  title/author word is absent from its key; the cross-file proof (P87) needs two real
  markdown files; the per-file proof (P88) needs a sibling `.bib` with a key absent from the
  global.
- Editor-side proofs drive the real CM6 pipeline through the existing E2E surfaces
  (`typeInEditor`, `acceptCompletion`, `cursorOffset`, `appendAtEnd`); citation/label
  insertion is asserted by reading the buffer, and the tooltip preview by reading the
  rendered completion `info` DOM. The references sidebar (P89) is asserted by reading the
  `data-pane="sidebar"` references panel DOM against the cited keys.
- The CSL-rendered reference text (P86/P89) is cross-checked against the preview's resolved
  bibliography (`#refs`, p27) for the same key — one source of truth for "what this key
  renders as", so the sidebar cannot drift from the preview.
- Regression gate: P1–P69 stay green. P51 specifically guards that the new citation/label
  sources compose (LaTeX backslash + `:::` completions still surface); run p51 after each of
  C2/C3/C6.

## Sequencing & dependencies

- **C1 is the hard prerequisite** for C2, C4, C5 (they all consume the configured bib) and
  is the riskiest seam (it reconciles a literal buried in the renderer command — see Risk).
  Do C1 first, alone, and confirm P1/P27 (preview citation rendering) stay green after the
  bib path moves to a config key.
- C2 (citation completion) depends on C1. C3 (labels) is INDEPENDENT of the bib (labels are
  harvested from markdown files, not the bib) — it can proceed in parallel with C2 once the
  project-root access pattern is settled, but it shares the `appCompletionSources` push
  pattern so doing C2 first de-risks the composition.
- C4 (per-file override) depends on C2 (it re-selects C2's citation source by frontmatter).
- C5 (references sidebar) depends on C1 (bib) and benefits from C4 (override-aware) and the
  preview's resolved `#refs` (reuse, do not re-implement CSL in JS).
- C6 is independent and LAST (or deferred): it touches a different completion surface (LaTeX
  backslash) and is gated on a clean read of the macro-tier SoT; it must not be a hardcoded
  list (admissibility).
- External dependency: none new. The bib/CSL are existing shipped assets
  (`~/.pandoc/bib/references.bib`, `~/.pandoc/csl/alpha-preview.csl`); `--citeproc` is
  already wired (p27). No Tauri command is strictly required for the MVP — `readTextFile` /
  `listTree` already exist; a dedicated `read_bibliography` command is an OPTIONAL
  ergonomics wrapper, not a prerequisite.

**Biggest risk / prerequisite (C1).** The bib path is currently a **literal embedded in the
renderer plugin's pandoc command string** (`scripts/first-run.sh:112`
`BIBLIOGRAPHY="$HOME/.pandoc/bib/references.bib"`, spliced into `PANDOC_COMMAND`), NOT a
config key the frontend can read — and per the ratified plugin architecture
([[renderer-plugin-architecture]], [[../render-rebuild-plan]] Milestone C) the renderer
plugin owns its command as an OPAQUE raw string; the app core does NOT parse pandoc flags.
So Phase C cannot extract the bib path from the renderer command. C1 must introduce
`editor.bibliography` (+ `editor.csl`) as a *first-class config key* that BOTH the frontend
reads AND `first-run.sh` uses to build the renderer command — preserving OSOT (the path is
declared once, in config, and the generated renderer command references that one value)
without the core parsing the plugin's command. Getting this seam wrong either (a) re-creates
two divergent bib paths (config vs. the renderer literal — a drift bug the moment a user
edits one), or (b) tempts the core to parse the renderer command (an architecture
violation). Settle this with the user before C1 RED. Secondary risk: cross-file label
harvesting (C3) walking a large thesis on every completion must be indexed/cached (build
the index on project open / file-tree refresh, not per keystroke), or completion latency
regresses.

## Status / resume here

- **2026-06-16:** Plan authored. Six sub-milestones C1–C6; proposed obligations P84–P89
  (RESERVED block; PROPOSALS only — [[proof-obligations]] NOT edited). Nothing implemented.
- Prerequisite green baseline: P1–P69 green (insertion bar P55–P62 landed; HEAD at plan
  time `9452cd4`, the P62 RED — confirm P55–P62 GREEN before starting). Phase A (P70–P76?)
  and Phase B (P77–P83?) precede Phase C in roadmap order but do not block it technically;
  Phase C rides surfaces already green (P51 completion registry, P18 sidebar, P44 explorer).
- **NEXT:** ratify the C1 bib-config-key seam with the user (the biggest risk — how the bib
  path becomes a config key without the core parsing the renderer command), then ratify
  P84–P89, then C1 RED.
- Open decisions to settle before RED: (1) C1 — exact config shape (`editor.bibliography`
  + `editor.csl`, both required `ExistingFile`?) and how `first-run.sh` reconciles the one
  path between the config key and the renderer command. (2) C2 — `@`-trigger editor-only vs.
  a sibling bar "cite" control. (3) C3 — App-owned label index (built from the explorer's
  `listTree`) vs. editor-owned; main-document root marker vs. "every file under the project
  root" for the MVP scope. (4) C5 — reuse the preview's resolved `#refs` bibliography vs. a
  dedicated citeproc call for the sidebar. (5) C6 — standalone obligation vs. P51-subsumed
  refinement, and the macro-tier vocabulary SoT to read.

- **2026-06-18: decisions RATIFIED (controller, under the standing "execute all phases,
  no stops" directive); grounded in the CURRENT seam (re-inspected — the bib/CSL paths are
  literals repeated across THREE command generators: `first-run.sh:112`,
  `provision-proof.sh:119/133`, and the renderer plugin's `configure-wizard.sh:42`; the
  renderer command is opaque and the core never parses it).**
  - **(1) C1 = Shape B1 (render-context token, true OSOT).** Add `{bibliography}` and
    `{csl}` as render-context placeholders the app substitutes (joining
    `{base_dir}`/`{base_url}`/`{mathjax}` in `plugins.rs`), sourced from new **required
    `editor.bibliography` + `editor.csl` config keys** (`ExistingFile`, load-validated,
    fail-loud — mirroring `snippet_dictionary`/`spell_dictionary`). `render.sh` layers
    `--bibliography`/`--csl` onto the command from those tokens (exactly as it layers
    `--variable=figure-width` from `.style.figure_width` and `--mathjax` from the context).
    The canonical pandoc command string **DROPS** the `--bibliography=`/`--csl=` literals.
    The path then lives ONCE in `editor.bibliography`, read by BOTH the frontend AND every
    render — no drift, no core-parsing of pandoc flags (the core substitutes a token it
    owns, identical to `{mathjax}`). `first-run.sh`/`provision-proof.sh`/`configure-wizard.sh`
    stop emitting the bib/csl literals and instead write the config keys.
  - **P84 C1-observable (behavioral, not a tautology):** the configured bib drives the
    preview's resolved `#refs` bibliography (rides p27); changing `editor.bibliography` to a
    different bib changes the rendered references (fails on a leftover baked literal); a
    missing bib path fails loud at config load (fails on a silent-accept). P1/P27 stay
    green after the bib path moves from command-literal to config-key-injected token.
  - **(2) C2 = `@`-trigger editor-only** (plan's primary; the bar "cite" control is a later
    QoL, not Phase C). **(3) C3 = App-owned label index** built from the explorer's
    `listTree`, MVP scope "every markdown file under the open project root" (no
    main-document marker yet). **(4) C5 = reuse the preview's resolved `#refs`** (OSOT — no
    JS CSL formatter). **(5) C6 = P51-subsumed refinement, LAST/deferred** (no standalone
    obligation unless it earns one; the macro-tier SoT is the baked MathJax config asset,
    read live — never a hardcoded JS list).
  - Executed in worktree `phase-c-citations` (`/home/dzack/ppe-phase-c`); C1 is the
    app-core-mutating risky seam (config.rs + plugins.rs + render.sh + 3 generators) →
    isolation per the worktree policy. Blind-TDD via Workflow: obligation → RED → GREEN →
    adversarial review, role-separated, RED committed before GREEN.
