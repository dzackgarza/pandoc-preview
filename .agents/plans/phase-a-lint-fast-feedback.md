# Phase A — Feedback Faster Than a Compile (implementation plan)

Durable, resumable roadmap for Phase A of the competitive-parity push: a STATIC,
PRE-compile diagnostic layer in the CodeMirror editor, plus a STRUCTURED parse of the
existing POST-compile log. This is a repo artifact (future-work + current-state), NOT a
memory; the durable *decisions* and the source inventory live in memory — see
[[competitive-parity-roadmap]] ("## Phase A"), [[parity-research/snippet-and-lint-ecosystem]]
(ChkTeX warning classes + per-line suppression), and [[parity-research/vimtex]] (pplatex
log post-processing). If interrupted, resume from **Status / resume here** at the bottom.

Phase A delivers the user's named keystone — "extremely good linting that kicks in long
before compiles" / "feedback faster than a latex compile." It is FIRST because it is the
single most under-tracked High-relevance cluster (the catalogue has matched-delimiter
*highlighting* at Tier-0 and a raw post-compile *log* at Tier-2/P11, but NO static
pre-compile *diagnostic* layer), and because the host — CodeMirror 6's `@codemirror/lint`
— is already a declared dependency wired into the editor, so the owned surface is small
and the payoff is daily.

## Source items (from the roadmap)

Copied faithfully from [[competitive-parity-roadmap]] "## Phase A — Feedback faster than a
compile (static lint + structured logs)", with the roadmap's status tags:

| Item | Status | Rel |
| --- | --- | --- |
| Static delimiter-balance WARNINGS — count `{}`/`[]`/`$…$`/`\left`-`\right` across the buffer, surface imbalance in the gutter (vs. cursor-pair highlighting only) | net-new gap | High |
| Static math-mode balance check — flag an unterminated `$`/`\(`/`\[` live, before the render garbles | net-new gap | High |
| User-defined regex lint rules (ChkTeX `UserWarnRegex` analog) — config-owned `regex→message` house-style rules as diagnostics | net-new gap | High |
| Structured post-compile log → diagnostics (line, severity, message, jump-target), `pplatex`-class, distinct from raw P11 output | refines Tier 2 / P11 | High |
| Configurable typographic lint layer — dash length, `...`→`\dots`, straight/curly quotes, `x`→`\times`, `x^10`→`x^{10}`, `sin`→`\sin` | net-new gap | Med-High |
| In-document lint suppression (`% chktex N` analog) — per-line/per-file opt-out | net-new gap | Med |
| Optionally run real ChkTeX on the pandoc-emitted transient `.tex`, map diagnostics back (gated on the `sourcepos` line-mapping problem — see Tier-2 scroll-sync) | net-new gap | Med |

Roadmap constraints carried forward verbatim: *prefer ChkTeX's tunable/suppressible model
over lacheck (self-described "crude approximation", no per-warning disable). Running an
external linter binary is a plugin-firewall candidate.*

**Scope boundary — PRE vs POST.** Six of the seven items are PRE-compile (the headline:
diagnostics computed by reading the buffer, never spawning pandoc/latex). The structured
log item is POST-compile — it REFINES the existing raw P11 log surface; it does not relax
or replace P11. The two surfaces stay distinct: PRE lives entirely in the editor
(`@codemirror/lint` gutter), POST lives in the Compile Log pane fed by `render.rs`.

## Discipline

Mirrors [[render-rebuild-sequencing-and-vendoring-decisions]] / `render-rebuild-plan.md`:

- **Interop-first / research-first governs EVERY work item (AGENTS.md HARD RULE #0).** No
  work item below may begin with "write a new X." Each starts with the research step that
  answers "what already exists" and NAMES the concrete tool / binary / data format /
  reference implementation it leverages, supports, or ports — the real ChkTeX/lacheck
  binaries, the `@codemirror/lint` host, the pplatex log-parser shape, the
  `angelozerr/codemirror-lint-eslint` CM6↔external-linter bridge. The lint CHECKS are owned
  by the real linters, not reimplemented; only genuinely pandoc-markdown-specific checks
  that NO existing linter covers may be owned, and even those open with a researched
  reference. Greenfield is rejected — a work item whose first action is bespoke
  re-implementation of something a binary/library already does is sent back to the research
  step.
- TDD: design → RED proof obligations (externally observable, user-ratified) → commit RED
  → GREEN → commit. Each sub-milestone gates on its proofs green before the next starts.
- The existing obligations P1–P69 and the doctor battery (D-series) stay green throughout.
  A sub-milestone that would break one must be re-scoped. In particular: P11 (raw compile
  log reflects the real subprocess, including the cosmetic `exit status:` shape) is NOT
  weakened — the structured-log work adds a parsed view ALONGSIDE the raw log, it does not
  mutate `format_log`'s contract that P11 asserts.
- No fallbacks / defaults / mocks; fail loud. A declared-but-unreadable lint config is a
  loud toast (the exact pattern `registerSnippetDictionary` / `installSpellcheck` already
  use in `EditorPane.svelte`), never a silently-empty rule set. Single-user Linux desktop;
  no multi-platform, no runtime mode flags.
- Proof obligations are EXACT externally-observable happy-path states, admissible only if
  they FAIL on a plausibly broken app. The reserved block is **P70–P76**. These are
  PROPOSALS for user ratification; this plan does NOT edit `proof-obligations.md`.
- Commits may use `--no-verify` while the global QC tree is absent on this host (the
  standing render-rebuild note); the per-obligation Playwright proof is the gate.

## Current code seams (what gets touched/extended)

Grounded by reading the actual files; cite `file:symbol`.

- **`src/lib/components/EditorPane.svelte`** — the sole CodeMirror 6 setup site. Extensions
  are assembled in `onMount` → `EditorState.create({extensions})`; `editorBasics()`
  (`EditorPane.svelte:147`) is the basicSetup-minus-lineNumbers list; the `lintKeymap` is
  ALREADY in the keymap (`EditorPane.svelte:170`) and `@codemirror/lint` is already a
  declared dependency (`package.json:16`). **No app-owned `linter()` source is registered
  today** — the only linter present is the vendored fork's grammar linter (below). This is
  the primary seam: a new `Compartment` carrying the app static-lint extension
  (`linter(...)` + `lintGutter(...)`) is added next to `spellCompartment`
  (`EditorPane.svelte:101`), and the config-owned lint rules are read post-mount exactly
  like `registerSnippetDictionary` (`EditorPane.svelte:256`). The app already exposes
  blind-TDD E2E hooks on the `EditorPane` instance (e.g. `insertSnippet`,
  `syntaxAncestryAt`, `cursorOffset`) — Phase A adds lint-introspection hooks here.
- **`vendor/codemirror-lang-latex/src/linter.ts` : `latexLinter`** — the EXISTING linter,
  enabled via `latex({linter:{checkMissingDocumentEnv:false}})` (`EditorPane.svelte:197`)
  and pushed as `linter(latexLinter(...))` inside `latex()`
  (`latex-language.ts`, `enableLinting` branch). It already does `checkUnclosedBraces`
  (`{}` balance across paragraph/EOF) and `checkUnmatchedEnvironments` (`\begin`/`\end`).
  **It is LaTeX-grammar-oriented, NOT pandoc-markdown-math:** it has no `$…$` math-mode
  on/off tracking, no `\left`/`\right` counting, no `[]` count, no typographic class, no
  user-regex, no in-document suppression. Phase A's PRE-compile lints are surfaced through a
  NEW `@codemirror/lint` source whose CHECKS come from the REAL ChkTeX/lacheck binaries (A.1),
  not a native reimplementation; it COMPOSES with this fork linter (two `linter()` extensions
  coexist; CM6 merges their diagnostics), the same compose-don't-override discipline P51
  established for completion. The fork linter is reused, not duplicated; the new source hosts
  the real linters' output for what the fork lacks (the `@codemirror/lint` host is the
  diagnostic mechanism, ChkTeX is the check engine).
- **`src/lib/editor/`** — where app editor logic lives (`snippets.ts`, `spellcheck.ts`,
  `dictionaries/`). New modules land here: `lint.ts` (the ADAPTER that calls the real-
  ChkTeX/lacheck Rust backend and maps its output to `Diagnostic[]` + the `.tex`→markdown
  line mapping + the directive→`% chktex N` translation — NOT a reimplementation of the
  checks) and `complog.ts` (the pplatex log adapter: pplatex output / raw log string →
  structured `{line, severity, message}[]`). The pure mapping/parsing parts are unit-testable
  like `parseSnippetDictionary`/`parseWordlist`; the Playwright proof drives them end-to-end.
- **`src-tauri/src/config.rs` : `Editor`** (`config.rs:218`) — the typed config section
  holding `snippet_dictionary`/`spell_dictionary` (both `Option<ExistingFile>`,
  `deny_unknown_fields`). The lint config (a `[editor.lint]` sub-table or sibling fields:
  enable flags per class, the user-regex rule list, the typographic toggles) is a config-
  owned addition here, validated by the same `validate()` path; the user-regex rules are
  config-declared `regex→message` entries (OSOT — one canonical place). A4 of the render
  plan keeps core config hand-coded `validate()`, so this section is validated there.
- **`src-tauri/src/render.rs` : `format_log` / `RenderResult.log`** (`render.rs:60`,
  `render.rs:46`) — the POST-compile surface (P11). `RenderResult` already carries
  `ok`/`html`/`log`; the structured-log item adds a parsed view of `log` WITHOUT changing
  `format_log` (P11 asserts the raw shape). The parse can live in the frontend
  (`complog.ts` over `res.log`) — preferred, keeps `render.rs` untouched and P11 safe.
- **`src/App.svelte`** — owns `let log = $state("")` (`App.svelte:154`), the
  `activeTab: "preview" | "log"` toggle (`App.svelte:171`), `api.renderPreview` →
  `log = res.log` (`App.svelte:654`/`:1072`), and the `__PPE_E2E__` hook object
  (`App.svelte:238`). The structured-log view is rendered in the Compile Log pane
  (driven by parsing `log`); a "jump to source line" action reuses the existing
  `editor.goToLine` hook (`EditorPane.svelte:468`). New `__PPE_E2E__` lint hooks are
  registered on this object.
- **`src/lib/components/InsertionBar.svelte` / `StatusBar.svelte`** — candidate homes for a
  diagnostic count / lint indicator (a status-cluster glyph), if a sub-milestone surfaces a
  buffer-wide imbalance summary distinct from the gutter markers. Optional, low-priority.

## Work items (ordered sub-milestones)

**Backend reframe (interop-first, AGENTS.md HARD RULE #0).** The PRIMARY lint backend is the
REAL ChkTeX (and lacheck) binaries, NOT a native reimplementation of their warning classes.
The pipeline: pandoc already emits `.tex` (the existing render path) → run the real `chktex`
(and, for cross-line group/environment mismatches it complements, `lacheck`) on that `.tex`
→ map their stdout to CodeMirror `Diagnostic[]`. CodeMirror's `@codemirror/lint` is ONLY the
diagnostic HOST (the gutter + diagnostics field + `lintGutter`) — the standard, correct
mechanism to surface diagnostics, fine to use; it is NOT where the checks are reimplemented.
The CHECKS (delimiter/math-mode balance, typographic classes, etc.) come from the real
linters that already implement "over 40 warnings" and are tunable/suppressible
([[parity-research/snippet-and-lint-ecosystem]]). The genuinely unsolved part is mapping the
real linters' `.tex` line numbers back through pandoc to markdown source lines (the
`sourcepos` problem) — that, not the checks, is the real risk and the gate.

Ordered by dependency: A.1 establishes the CM6↔real-linter BRIDGE (the diagnostic host wired
to the real ChkTeX/lacheck backend) that A.2–A.5 configure/extend; A.6 is the POST-compile
refinement (independent of A.1–A.5).

### A.1 — CM6↔real-ChkTeX/lacheck lint bridge (delimiter + math-mode balance) — P70

**Research-first.** Leverage the REAL `chktex` binary (and `lacheck` for its cross-line
group/environment mismatch reporting) as the check engine — they already implement
delimiter-count (ChkTeX 9/17), math-mode on/off, and bracket/environment balance natively
and tunably ([[parity-research/snippet-and-lint-ecosystem]] §"ChkTeX warning classes"). Host
their output in CodeMirror via `@codemirror/lint`'s standard `linter()` source + `lintGutter`
— the host mechanism, not a check reimplementation. Reference the established CM6↔external-
linter bridge pattern (`angelozerr/codemirror-lint-eslint`: an async `linter()` source shells
out to a real linter and translates its output into `Diagnostic[]`); the `linter()` source
may be async (returns a `Promise<Diagnostic[]>`), which is exactly what spawning a binary
requires. The pandoc `md→tex` emit already exists in the render path; reuse it, do not add a
second pandoc invocation contract.

**Goal.** An `@codemirror/lint` source that runs the REAL ChkTeX/lacheck on the pandoc-emitted
`.tex` and surfaces their diagnostics in the gutter — buffer-wide delimiter-COUNT imbalance
(`{`/`}`, `[`/`]`, `$…$` parity, `\left`/`\right`), and an unterminated math-mode delimiter
(`$`, `\(`, `\[`) — composing with the fork's `latexLinter`. This is the headline "feedback
faster than a compile," and the checks are ChkTeX's, not owned.

**Concrete work.**
- A Rust/Tauri command (plugin-firewall candidate per the roadmap note) that takes the
  current buffer, runs the existing pandoc `md→tex` emit, then spawns the real `chktex`
  (and `lacheck`) on the transient `.tex`, returning structured `{texLine, severity,
  message, ruleId}[]` parsed from their stdout. A missing `chktex`/`lacheck` binary is a
  loud doctor/toast failure (fail-loud), never a silent empty diagnostic set.
- New `src/lib/editor/lint.ts`: a thin async `chktexDiagnostics(state): Promise<Diagnostic[]>`
  that calls that command and maps each linter entry to a CM6 `Diagnostic` (`from`/`to` from
  the mapped markdown span, `severity`, `message`, a stable `ruleId` from the ChkTeX warning
  number). It does NOT reimplement the checks; it adapts the real linters' output. The
  `.tex`→markdown line mapping lands here and is the gated risk (see "Line-mapping gate"
  below).
- `EditorPane.svelte`: add a `lintCompartment` next to `spellCompartment`
  (`EditorPane.svelte:101`); in `onMount`, configure it with
  `[linter(view => chktexDiagnostics(view.state)), lintGutter()]` (async source). Compose —
  do NOT pass through `latex({linter})`; the fork linter stays as-is. Add E2E hooks on the
  EditorPane instance: `lintDiagnostics(): {from,to,severity,message,source}[]` (reads the
  live `forceLinting`-flushed `@codemirror/lint` diagnostic field) so the proof can observe
  the produced diagnostics deterministically, and `lintCount()`.
- `App.svelte`: register the new hooks on `__PPE_E2E__` (`App.svelte:238`).

**Line-mapping gate.** The `.tex`→markdown line mapping is the genuine unsolved risk —
related to the `sourcepos` decision (`render-rebuild-plan.md`; reader stays `-f markdown`,
precise sourcepos struck 2026-06-16). A.1 is admissible only with a real mapping strategy
(e.g. emitting markers, or a span-anchored re-derivation); if no reliable mapping exists, A.1
is gated exactly as the external-binary path was, and the obligation is documented as proof
DEBT rather than shipped with a wrong-line bridge. The LINTER itself is never the blocker —
ChkTeX is real; only the mapping is.

**Reuse.** `lintGutter`/`linter`/`Diagnostic`/`forceLinting` from `@codemirror/lint`
(already a dep); the async `linter()` source + output-translation pattern from
`angelozerr/codemirror-lint-eslint`; the `Compartment` + post-mount-reconfigure pattern from
`spellCompartment` (`EditorPane.svelte:278`); the existing pandoc `md→tex` emit in the render
path; the math-zone tokenization already available via the fork (`syntaxAncestryAt` proves
`$…$` is a `MathSpan`).

**Files.** create `src/lib/editor/lint.ts` + the Rust lint command; edit `EditorPane.svelte`,
`App.svelte`.
**Depends on.** nothing (foundation); gated on the `.tex`→markdown line-mapping strategy.

### A.2 — Configurable typographic lint layer (ChkTeX classes) — P71

**Research-first.** These are EXISTING ChkTeX warning classes — dash length (ChkTeX 8),
ellipsis `...`→`\dots`, quote type/direction (ChkTeX 18), `x`→`\times`, sub/superscript
grouping `x^10`→`x^{10}`, operator-as-variable `sin`→`\sin`
([[parity-research/snippet-and-lint-ecosystem]] §"ChkTeX warning classes"). Leverage the real
`chktex` running on the emitted `.tex` (the A.1 backend); each class is ENABLED/DISABLED via
ChkTeX's own tunable config (its per-warning on/off + `chktexrc`), surfaced through the
`[editor.lint]` config that maps to ChkTeX's flags — support ChkTeX's tunability, do not
re-author its typographic matchers.

**Goal.** The ChkTeX typographic warning set, each class toggleable from config, surfaced as
`info`/`warning` gutter diagnostics via the A.1 host. Math-scoped classes (`x^10`, `sin`,
`\times`) fire only inside math, exactly as ChkTeX scopes them.

**Concrete work.**
- Configure ChkTeX's per-warning enable/disable (via `chktexrc`/flags driven by the
  `[editor.lint]` config) so the A.1 backend emits/suppresses each typographic class; the
  diagnostics flow through the existing A.1 mapping. No new owned matchers — the checks are
  ChkTeX's.
- Extend `config.rs::Editor` (`config.rs:218`) with the typographic toggles (a
  `[editor.lint]` sub-table of booleans mapping to ChkTeX warning numbers, validated in
  `validate()`); thread to the editor via the `Config` TS type, read in `EditorPane`'s
  post-mount lint registration and passed into the ChkTeX invocation.

**Reuse.** the A.1 real-ChkTeX backend + host + gutter; ChkTeX's own per-warning enable/
disable and `chktexrc`; the config-validation path in `config.rs::validate` (`config.rs:257`).
**Files.** edit `src/lib/editor/lint.ts`, `config.rs`, `src/lib/types.ts`, `EditorPane.svelte`.
**Depends on.** A.1.

### A.3 — User-defined regex lint rules (ChkTeX UserWarnRegex analog) — P72

**Research-first.** This is ChkTeX's OWN extensibility mechanism: `UserWarnRegex` (warning
44) in `chktexrc` — arbitrary user-defined PCRE house-style rules
([[parity-research/snippet-and-lint-ecosystem]] §"User-defined regex patterns"). SUPPORT
ChkTeX's `UserWarnRegex` natively: the `[editor.lint]` config's user rules are written into
the `chktexrc` ChkTeX reads, so the real ChkTeX evaluates them and emits the diagnostics
through the A.1 backend. Do not build a parallel regex engine — ChkTeX already has one.

**Goal.** A config-owned list of `{regex, message, severity?}` house-style rules surfaced as
diagnostics via ChkTeX's `UserWarnRegex`. Pairs with the OSOT config philosophy: rules live
in ONE canonical place (the config), which is rendered into the `chktexrc` ChkTeX consumes.

**Concrete work.**
- `config.rs::Editor`: a `lint_rules: Vec<UserLintRule>` (config-owned; each
  `{pattern: String, message: String, severity}`), validated (each pattern compiles as a
  ChkTeX-compatible PCRE; a bad regex is a loud config error, never silently dropped).
- Render `lint_rules` into `UserWarnRegex` entries in the `chktexrc` the A.1 backend hands to
  the real `chktex`; the resulting diagnostics map back through the A.1 mapping with the
  rule's message/severity. No owned regex scan.
- Thread `lint_rules` through the `Config` TS type into the ChkTeX-invocation config.

**Reuse.** the A.1 real-ChkTeX backend + host; ChkTeX's `UserWarnRegex`/`chktexrc`; the
`Config` plumbing A.2 establishes; the loud-fail config validation pattern (`ExistingFile`
validators in `config.rs`).
**Files.** edit `config.rs`, `src/lib/editor/lint.ts`, `src/lib/types.ts`, `EditorPane.svelte`.
**Depends on.** A.1 (host), A.2 (config plumbing).

### A.4 — In-document lint suppression (`% chktex N` analog) — P73

**Research-first.** Port ChkTeX's OWN suppression mechanism — its `% chktex N` /
`% chktex-file N` per-line/per-file warning opt-out
([[parity-research/snippet-and-lint-ecosystem]] §"Per-line / per-file suppression"). The
directive's SEMANTICS are ChkTeX's; only the SURFACE differs because the user authors
markdown, not `.tex`. PORT the directive as a pandoc-markdown HTML-comment that the A.1
backend translates into the real `% chktex N` ChkTeX consumes (preferred: let the real ChkTeX
do the suppression), falling back to filtering ChkTeX's emitted diagnostics by `(line,
ruleId)` only where the directive cannot be injected into the `.tex`. This is the one
genuinely pandoc-markdown-specific seam — and even it is a port of ChkTeX's documented
suppression contract, named here, not a fresh invention.

**Goal.** A comment-based per-line / per-file opt-out so intentional constructs do not nag.
The pandoc-markdown surface for ChkTeX's `% chktex N`: an HTML-comment directive (the buffer
is markdown; `<!-- ppe-lint-disable-line <id> -->` / `<!-- ppe-lint-disable-file <id> -->`),
where `<id>` is the ChkTeX warning number / rule id. A bare disable suppresses all classes on
that line.

**Concrete work.**
- Translate the markdown directive into ChkTeX's `% chktex N` in the emitted `.tex` so the
  real ChkTeX suppresses the warning at source; where that is not injectable, filter the
  ChkTeX-emitted diagnostics by `(line, ruleId)` before returning. Rule ids are the ChkTeX
  warning numbers already carried on each diagnostic (`source`/id field, from A.1).
- Ensure each diagnostic carries the stable ChkTeX `ruleId` so a directive can name it
  (introduced in A.1's `Diagnostic` shape).

**Reuse.** ChkTeX's native `% chktex N`/`% chktex-file N` suppression; the comment-masking
logic from A.1; the diagnostic `source`/ChkTeX-warning-number id already on every produced
diagnostic.
**Files.** edit `src/lib/editor/lint.ts` (+ minor: stable ids in A.1).
**Depends on.** A.1–A.3 (it filters their output).

### A.5 — Lint config surface & status indicator (consolidation) — (folds into P70–P73)

**Research-first.** No new backend; this consolidates the existing surfaces — the real
ChkTeX/lacheck backend (A.1–A.4), the `@codemirror/lint` host, and ChkTeX's own
`[editor.lint]`↔`chktexrc` config — verifying they coexist. The status glyph reuses the
existing `StatusBar.svelte` status-cluster pattern; nothing new is invented.

**Goal.** No NEW obligation; consolidation. The `[editor.lint]` config section is the OSOT
for which ChkTeX classes are on; a status-cluster glyph (count of current diagnostics) may
surface in `StatusBar.svelte`. Verify all PRE-compile classes coexist (A.1–A.4 compose) and
the fork linter + spellcheck + completion are all still live in the same buffer (regression
against P51/P54).
**Depends on.** A.1–A.4.

### A.6 — Structured post-compile log → diagnostics (pplatex-class) — P74

**Research-first.** Port the REAL `pplatex` (the LaTeX-log pretty-printer vimtex itself routes
compile logs through before quickfix — [[parity-research/vimtex]] §"Compile-log → quickfix"
and §"pplatex-class log post-processing"). Prefer running the real `pplatex` binary on the
emitted log and parsing its already-structured output; if `pplatex` is not present, PORT its
parsing contract (the documented `file:line: message` / `! ...` error-block / `Warning:`
recognition) rather than designing a fresh log grammar. The structured-log shape is pplatex's,
not invented here.

**Goal.** REFINE the raw P11 Compile Log: route the real subprocess log through pplatex (real
binary, or its ported parse) into structured entries `{line, severity, message, jump-target}`
and present a clickable list distinct from the raw text; clicking an entry jumps the editor
to the source line. POST-compile; P11's raw-log contract is untouched.

**Concrete work.**
- New `src/lib/editor/complog.ts`: `parseCompileLog(raw: string): LogEntry[]` that consumes
  the real `pplatex` output where available, else applies pplatex's documented parse
  (`file:line: message` / latex `! ...` error blocks / `Warning:` lines, severity
  classification). Pure and unit-testable.
- `App.svelte`: in the Compile Log pane, render `parseCompileLog(log)` as a clickable list
  alongside the raw `log`; clicking an entry calls `editor.goToLine(entry.line)`
  (`EditorPane.svelte:468`). `log` source unchanged (`App.svelte:654`).
- E2E hook: `structuredLog(): LogEntry[]` on `__PPE_E2E__` for the proof.

**Reuse.** the existing `log` state + Compile Log tab (`App.svelte:154`/`:171`); the
existing `editor.goToLine` jump (`EditorPane.svelte:468`); `RenderResult.log`
(`render.rs:46`) read as-is — `render.rs` NOT modified, so P11 stays green.
**Files.** create `src/lib/editor/complog.ts`; edit `App.svelte`.
**Depends on.** nothing (independent of A.1–A.5; can run in parallel).

### A.7 — `.tex`→markdown line-mapping for the real-linter backend (GATED) — P75 (HELD)

**Reframe.** Running the real ChkTeX binary on the pandoc-emitted transient `.tex` is NO
LONGER a gated/secondary item — it was PROMOTED to the PRIMARY backend in A.1 (the lint
checks ARE ChkTeX's; A.2–A.4 configure the real ChkTeX/lacheck). What remains genuinely
GATED — and the real risk this obligation guards — is PRECISE `.tex`→markdown line mapping:
the `sourcepos` decision (`render-rebuild-plan.md` "Cross-cutting open decisions": the reader
stays `-f markdown`, which forgoes precise `sourcepos`; precise-sourcepos features were
struck from scope 2026-06-16). A.1 ships with whatever mapping strategy is reliable; A.7/P75
holds the PRECISE-per-line mapping that needs the struck `sourcepos` machinery.

**Research-first.** No new linter is built here — the linter is the real ChkTeX (A.1). The
research target is the `.tex`→markdown line-mapping strategy: pandoc's marker/`sourcepos`
machinery and how reference integrations (e.g. the established CM6↔external-linter bridges)
anchor a transient artifact's lines back to source. The CHECKS are never the blocker; only
the precise mapping is.

**Concrete work (when ungated).** Promote the A.1 backend's line mapping from
approximate/span-anchored to PRECISE per-`.tex`-line, using the `sourcepos` machinery once
that gate opens; merge into the same gutter. Running the external binary is a plugin-firewall
candidate (roadmap note); the plumbing already exists from A.1.
**Depends on.** the `sourcepos`/scroll-sync reader decision (external to Phase A). **Do not
start until that decision lands.** P75 is RESERVED but HELD; do not RED it yet.

## Proposed proof obligations (P70–P76)

PROPOSALS for user ratification (this plan does NOT edit `proof-obligations.md`). Each is an
exact externally-observable happy-path state, driven by the real app via the
`tauri-plugin-playwright` harness against the shared witness fixture, observing real CM6
`@codemirror/lint` diagnostics and real config. Admissible only if it FAILS on a plausibly
broken app.

- **P70 — Static delimiter & math-mode balance warns before compile.** With a buffer
  containing a real imbalance — e.g. a math line with two `\left` and one `\right`, and a
  separate `$`-opened math zone with no closing `$` — the editor surfaces, via the
  `@codemirror/lint` diagnostics field (observed through the `lintDiagnostics()` hook), at
  least one diagnostic whose marked range covers the surplus `\left`/the unterminated `$`
  and whose message names the imbalance; AND after the user balances them (append the
  missing `\right` and `$`), that diagnostic is gone. NO latex COMPILE / preview RENDER is
  the source — the diagnostic comes from the cheap real-ChkTeX lint pass on the emitted
  `.tex` (pandoc `md→tex` + `chktex`), not the full pandoc-HTML render, which is exactly
  "feedback faster than a compile." **Admissible** because it fails on:
  no app lint source (the diagnostics field has only the fork's `\begin`/`\end` checks, the
  `\left`/`$` imbalance is never marked); a cursor-pair-highlighting-only implementation
  (highlighting shows the pair under the cursor, never a buffer-wide COUNT imbalance, so no
  diagnostic exists); and a stuck linter (the diagnostic persists after the user balances).

- **P71 — Typographic lint fires only when its class is enabled, scoped to math.** With
  `[editor.lint]` enabling the operator-as-variable and sub/superscript-grouping classes,
  a math line containing `sin x` and `x^10` yields diagnostics marking `sin` (→ `\sin`) and
  `x^10` (→ `x^{10}`); the SAME tokens in PROSE (outside `$…$`) yield none; and with those
  classes disabled in config, the math-line diagnostics are absent. **Admissible** because
  it fails on: a missing typographic layer (the math `sin`/`x^10` are never marked); a
  layer that ignores math scope (prose `sin` is wrongly marked); and a layer that ignores
  config (disabling the class in config still marks the tokens — the config is dead).

- **P72 — User-defined regex lint rule surfaces as a diagnostic.** With a config-owned
  `lint_rules` entry `{pattern: "\\bTODO\\b", message: "resolve before submission"}`,
  typing `TODO` into the buffer yields a diagnostic whose range covers `TODO` and whose
  message is exactly `resolve before submission`; pointing config at a DIFFERENT rule set
  (a different pattern/message) makes the buffer surface THAT rule's diagnostic instead.
  **Admissible** because it fails on: no user-regex engine (the config rule is ignored,
  `TODO` is never marked); a hardcoded rule list (a different config rule set produces the
  same diagnostics, proving config is not read); and a message mismatch (the diagnostic's
  message is not the config-declared string).

- **P73 — In-document suppression silences a named lint on its line.** With a buffer line
  that triggers a known lint (e.g. an intentional `x^10` in math), adding the directive
  comment `<!-- ppe-lint-disable-line <ruleId> -->` for that line's rule removes the
  diagnostic on THAT line while the SAME construct on another (un-suppressed) line still
  warns; removing the directive restores the diagnostic. **Admissible** because it fails
  on: no suppression scanner (the directive is inert, the diagnostic persists); an
  over-broad suppression (the directive on one line silences the construct everywhere); and
  a suppression that never restores (removing the directive leaves the line silent).

- **P74 — Structured compile-log entries jump to source.** After a render whose real
  subprocess log contains a line-tagged message, the Compile Log pane presents a structured
  entry (observed via the `structuredLog()` hook) with a parsed `{line, severity, message}`
  matching that log line; activating the entry moves the editor cursor to exactly that
  source line (observed via `cursorOffset()`/`goToLine`). The RAW log (P11) is still
  present and unchanged. **Admissible** because it fails on: a raw-only log (no structured
  entry exists, only the unparsed text — P11's surface); a parse that drops the line number
  (the entry has no jump-target, activation is a no-op); and a jump to the wrong line (the
  cursor lands somewhere other than the parsed line). It does NOT subsume or weaken P11 —
  P11's raw-log assertion runs unchanged alongside this.

- **P75 — RESERVED, HELD.** Real-ChkTeX-on-transient-`.tex` with `.tex`→markdown line
  mapping. HELD pending the `sourcepos`/scroll-sync reader decision; not RED until that
  gate opens. Reserved here so the obligation number is not reused.

- **P76 — RESERVED.** Spare within the Phase-A block (e.g. a buffer-wide diagnostic-count
  status indicator, or a delimiter-imbalance summary in the status cluster) if A.5 is
  promoted from consolidation to a first-class observable. Not specified until needed.

## Verification

End-to-end proof, no shortcuts (mirrors `proof-obligations.md` "Verification vehicle"):

- **Real app on a real display via `tauri-plugin-playwright`.** Each P70–P74 spec lands in
  `tests/proof/` (e.g. `p63-static-lint-balance.spec.ts`), following the established blind-
  TDD pattern (`tests/proof/p55-insertion-bar-amsthm.spec.ts`): drive a stable
  `__PPE_E2E__` hook (NOT synthetic key/click events into CM6's contentEditable, which are
  flaky — the documented reason P52/P53/P55 use hooks), observe a REAL surface.
- **Real diagnostics, not a mirror.** The lint specs observe the live CM6 `@codemirror/lint`
  diagnostics field through `lintDiagnostics()`/`forceLinting` — the SAME field the gutter
  renders — so a passing spec proves the gutter would mark it. A spec that asserted on a
  parallel JS array would be inadmissible (it could pass on a broken gutter); the hook must
  read the editor's actual lint state.
- **Real config drives the rules.** P71/P72 use a hermetic `XDG_CONFIG_HOME` with a real
  `config.toml` carrying `[editor.lint]` / `lint_rules`; flipping the config and re-reading
  proves the config is load-bearing (the "different config → different diagnostics" clause).
- **Real pandoc / real filesystem for the POST path.** P74 runs a real `render_preview`
  (real pandoc subprocess) and parses its REAL `log` — no synthetic log string. The
  jump-target is verified by an independent read of the editor cursor offset after
  activation.
- **Real ChkTeX/lacheck binaries are the check engine.** The lint specs prove the
  diagnostics originate from the REAL `chktex`/`lacheck` on the pandoc-emitted `.tex`, not a
  native reimplementation; a missing binary is a loud doctor/toast failure (fail-loud), never
  an empty diagnostic set. The `@codemirror/lint` host is the diagnostic mechanism only.
- **No latex round-trip.** P70 asserts the diagnostics appear from the cheap real-ChkTeX lint
  pass (pandoc `md→tex` + `chktex`), with NO full latex compile / preview render as the
  source — the "faster than a compile" guarantee.
- **Regression gate.** P1–P69 and the doctor battery run green throughout; P11's raw-log
  spec runs UNCHANGED to prove A.6 did not mutate `format_log`; P51/P54 prove the new lint
  source composes (completion + spellcheck + fork linter + app linter all live together).

## Sequencing & dependencies

```
A.1 (P70, host: delimiter+math-balance)  ──┐
   └─► A.2 (P71, typographic) ──► A.3 (P72, user-regex) ──► A.4 (P73, suppression) ──► A.5 (consolidate)
A.6 (P74, structured log)  ── independent, parallelizable with A.1–A.5
A.7 (P75) ── HELD on the sourcepos/reader decision; do not RED until that gate opens
```

- A.1 is the foundation: the CM6↔real-ChkTeX/lacheck BRIDGE (the `@codemirror/lint` host
  wired to the real linter backend) every PRE-compile class flows through. A.2→A.3→A.4 are
  strictly ordered (they configure ChkTeX's classes / `UserWarnRegex` / suppression; A.4
  filters/translates A.1–A.3's output; A.3 reuses A.2's config plumbing).
- A.6 touches a disjoint seam (the POST-compile log) and can be built in parallel by a
  separate agent without contending on `lint.ts`/`EditorPane.svelte`.
- A.7 is gated and last; it does not block ratifying or shipping A.1–A.6.

## Status / resume here

**Not started — RED obligations P70–P74 pending user ratification.** Design complete;
seams grounded in the real files (CM6 setup at `EditorPane.svelte:147`/`:197`; the existing
fork linter at `vendor/codemirror-lang-latex/src/linter.ts:latexLinter`, already enabled
and already doing `{}`/`\begin`-`\end` balance but NOT `$…$`/`\left`-`\right`/typographic/
user-regex; `@codemirror/lint` already a declared dep, `lintKeymap` already in the keymap;
the POST-compile log at `render.rs:format_log` + `App.svelte:154` Compile Log tab).

**Biggest prerequisite/risk.** Two:
(1) **`.tex`→markdown line mapping is the real gate** (NOT the linter — ChkTeX/lacheck are
real and proven). It bears on A.1's PRIMARY path: A.1 ships with whatever mapping is reliable
(span-anchored / marker-based); the PRECISE per-line mapping — which needs the struck
`sourcepos` machinery (reader stays `-f markdown`, precise sourcepos struck 2026-06-16) — is
held as A.7/P75. The CHECKS are never the blocker; only the mapping is.
(2) **Compose-don't-override discipline:** the real-linter-hosting source must COEXIST with
the fork's `latexLinter` (two `linter()` extensions, merged diagnostics) — exactly the P51
lesson; a naive single-linter override would silently drop the fork's `\begin`/`\end` and
brace checks. A.5's regression assertion (P51/P54 + the fork linter all live in one buffer)
is the guard against that.

**Next action.** Ratify P70–P74 with the user, then RED A.1 (`p63` spec: a real imbalance
produces a real `@codemirror/lint` diagnostic sourced from the real `chktex` on the emitted
`.tex`; fails because no app lint source wires the real linter yet, only the fork's grammar
checks). Commit RED before any GREEN.

## STATUS UPDATE — 2026-06-18: Phase A COMPLETE (P75 HELD)

Delivered under AGENTS.md HARD RULE #0 (interop-first) + the user ruling that lint be COMPLETELY MODULAR — lint is a firewall PLUGIN, app core owns ZERO lint code.
- Lint engine = `src-tauri/resources/vendor/plugins/pandoc-md-lint/` (run via the generic `run_plugin` firewall); `src-tauri/src/lint.rs` DELETED; arch gate green (no chktex/lint in core).
- **A.1/P70** real `chktex`/`lacheck` delimiter balance + owned markdown-native `$`/`$$` math-mode balance (pandoc escapes lone `$`, so chktex can't — the one genuinely-md-specific check). **A.2/P71** typographic classes config-gated via the plugin's `[plugin.pandoc-md-lint]` section. **A.3/P72** user-regex via chktex `UserWarnRegex`. **A.4/P73** in-document `% chktex N` suppression. **A.6/P74** structured compile-log → jump-to-source (pplatex parse ported; `render.rs` untouched, P11 intact). **A.5** consolidation: full lint+completion+snippet+spellcheck+fork-linter stack composes.
- **A.7/P75 HELD** — precise `.tex`→markdown per-line mapping, gated on the struck sourcepos reader decision (the lualatex `l.NN` jump is deferred to avoid a semantically-wrong line jump).
- Verified green together at HEAD: p70–p74 + p11. The pandoc-md-lint plugin script is the seed of the standalone reusable `pandoc-md-lint` tool (extract to its own repo when warranted).
