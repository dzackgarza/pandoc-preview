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

- TDD: design → RED proof obligations (externally observable, user-ratified) → commit RED
  → GREEN → commit. Each sub-milestone gates on its proofs green before the next starts.
- The existing obligations P1–P62 and the doctor battery (D-series) stay green throughout.
  A sub-milestone that would break one must be re-scoped. In particular: P11 (raw compile
  log reflects the real subprocess, including the cosmetic `exit status:` shape) is NOT
  weakened — the structured-log work adds a parsed view ALONGSIDE the raw log, it does not
  mutate `format_log`'s contract that P11 asserts.
- No fallbacks / defaults / mocks; fail loud. A declared-but-unreadable lint config is a
  loud toast (the exact pattern `registerSnippetDictionary` / `installSpellcheck` already
  use in `EditorPane.svelte`), never a silently-empty rule set. Single-user Linux desktop;
  no multi-platform, no runtime mode flags.
- Proof obligations are EXACT externally-observable happy-path states, admissible only if
  they FAIL on a plausibly broken app. The reserved block is **P63–P69**. These are
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
  user-regex, no in-document suppression. Phase A's PRE-compile lints are a NEW app-owned
  `@codemirror/lint` source that COMPOSES with this fork linter (two `linter()` extensions
  coexist; CM6 merges their diagnostics), the same compose-don't-override discipline P51
  established for completion. The fork linter is reused, not duplicated; the app source
  owns only what the fork lacks.
- **`src/lib/editor/`** — where app editor logic lives (`snippets.ts`, `spellcheck.ts`,
  `dictionaries/`). New pure modules land here: `lint.ts` (the static rule engine: a
  `Diagnostic[]`-producing function over `EditorState`/buffer text + the math-zone
  predicate + the suppression scanner) and `complog.ts` (the pplatex-class log parser:
  raw log string → structured `{line, severity, message}[]`). Pure and unit-testable like
  `parseSnippetDictionary`/`parseWordlist`; the Playwright proof drives them end-to-end.
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

Ordered by dependency: A.1 establishes the app-owned lint host that A.2–A.5 contribute
into; A.6 is the POST-compile refinement (independent of A.1–A.5); A.7 is the gated
external-binary path, last.

### A.1 — App-owned static-lint host (delimiter + math-mode balance) — P63

**Goal.** A NEW app-owned `@codemirror/lint` source composes with the fork's `latexLinter`
and surfaces, in the gutter, pandoc-markdown-math static diagnostics the fork does not:
(a) buffer-wide delimiter-COUNT imbalance — `{`/`}`, `[`/`]`, `$…$` parity, `\left`/`\right`
counts — and (b) an unterminated math-mode delimiter (`$`, `\(`, `\[`). This is the
headline "feedback faster than a compile."

**Concrete work.**
- New `src/lib/editor/lint.ts`: a pure `staticDiagnostics(state): Diagnostic[]` that scans
  the buffer (masking fenced code blocks / verbatim and `<!-- -->` comments, reusing the
  fork's `maskCommentsAndRanges` approach as a reference, not an import unless exported)
  and emits: a `warning` per surplus opener/closer with `from`/`to` at the offending span;
  an `error` for a math zone opened and never closed (track `$` parity and `\[`/`\]`,
  `\(`/`\)`). Severities chosen so they FAIL a plausibly-broken app (an imbalance produces
  a real marked range, not a no-op).
- `EditorPane.svelte`: add a `lintCompartment` next to `spellCompartment`
  (`EditorPane.svelte:101`); in `onMount`, configure it with
  `[linter(view => staticDiagnostics(view.state)), lintGutter()]`. Compose — do NOT pass
  through `latex({linter})`; the fork linter stays as-is. Add E2E hooks on the EditorPane
  instance: `lintDiagnostics(): {from,to,severity,message,source}[]` (reads the live
  `forceLinting`-flushed `@codemirror/lint` diagnostic field) so the proof can observe the
  produced diagnostics deterministically, and `lintCount()`.
- `App.svelte`: register the new hooks on `__PPE_E2E__` (`App.svelte:238`).

**Reuse.** `lintGutter`/`linter`/`Diagnostic`/`forceLinting` from `@codemirror/lint`
(already a dep); the `Compartment` + post-mount-reconfigure pattern from `spellCompartment`
(`EditorPane.svelte:278`); the math-zone tokenization already available via the fork
(`syntaxAncestryAt` proves `$…$` is a `MathSpan` — the math-zone predicate A.3/Phase-B
share builds on this).

**Files.** create `src/lib/editor/lint.ts`; edit `EditorPane.svelte`, `App.svelte`.
**Depends on.** nothing (foundation).

### A.2 — Configurable typographic lint layer — P64

**Goal.** A ChkTeX-class typographic warning set adapted to pandoc-markdown-math, each
toggleable from config: dash length (`-`/`--`/`---`), `...`→`\dots`, straight-vs-curly
quotes, `x`→`\times` between numbers, sub/superscript grouping (`x^10`→`x^{10}`),
operator-as-variable (`sin`→`\sin`). Surfaced as `info`/`warning` gutter diagnostics.

**Concrete work.**
- Extend `lint.ts` with the typographic rule set (each a small matcher over the buffer
  text, math-zone-scoped where the rule demands it — `x^10`, `sin`, `\times` only fire
  INSIDE math). Each rule keyed by a config flag.
- Extend `config.rs::Editor` (`config.rs:218`) with the typographic toggles (a
  `[editor.lint]` sub-table of booleans, validated in `validate()`); thread to the editor
  via the `Config` TS type, read in `EditorPane`'s post-mount lint registration.

**Reuse.** the A.1 lint source + gutter; the math-zone predicate from A.1/A.3; the
config-validation path in `config.rs::validate` (`config.rs:257`).
**Files.** edit `src/lib/editor/lint.ts`, `config.rs`, `src/lib/types.ts`, `EditorPane.svelte`.
**Depends on.** A.1.

### A.3 — User-defined regex lint rules (ChkTeX UserWarnRegex analog) — P65

**Goal.** A config-owned list of `{regex, message, severity?}` house-style rules surfaced
as diagnostics. Pairs with the OSOT config philosophy: rules live in ONE canonical place
(the config), not in code.

**Concrete work.**
- `config.rs::Editor`: a `lint_rules: Vec<UserLintRule>` (config-owned; each
  `{pattern: String, message: String, severity}`), validated (each pattern compiles; a bad
  regex is a loud config error, never silently dropped).
- `lint.ts`: compile each user rule to a `RegExp`, scan the buffer, emit a diagnostic per
  match with the rule's message/severity. Order-stable.
- Thread `lint_rules` through the `Config` TS type into the editor's lint registration.

**Reuse.** A.1 lint source; the `Config` plumbing A.2 establishes; the loud-fail config
validation pattern (`ExistingFile` validators in `config.rs`).
**Files.** edit `config.rs`, `src/lib/editor/lint.ts`, `src/lib/types.ts`, `EditorPane.svelte`.
**Depends on.** A.1 (host), A.2 (config plumbing).

### A.4 — In-document lint suppression (`% chktex N` analog) — P66

**Goal.** A comment-based per-line / per-file opt-out so intentional constructs do not nag.
The pandoc-markdown analog of `% chktex N`: an HTML-comment directive (the buffer is
markdown; `<!-- ppe-lint-disable-line <id> -->` / `<!-- ppe-lint-disable-file <id> -->`),
where `<id>` names a lint rule/class. A bare disable suppresses all classes on that line.

**Concrete work.**
- `lint.ts`: a suppression scanner that reads the directive comments, maps suppressed
  `(line, ruleId)` pairs, and FILTERS the diagnostics A.1–A.3 produced before returning
  them. Rule ids are the stable identifiers each lint class already carries (`source`/an
  id field on the diagnostic).
- Give each lint a stable `ruleId` so a directive can name it (introduced in A.1's
  `Diagnostic` shape via a custom field or the `source` tag).

**Reuse.** the comment-masking logic from A.1; the diagnostic `source`/id already on every
produced diagnostic.
**Files.** edit `src/lib/editor/lint.ts` (+ minor: stable ids in A.1).
**Depends on.** A.1–A.3 (it filters their output).

### A.5 — Lint config surface & status indicator (consolidation) — (folds into P63–P66)

**Goal.** No NEW obligation; consolidation. The `[editor.lint]` config section is the OSOT
for which classes are on; a status-cluster glyph (count of current diagnostics) may surface
in `StatusBar.svelte`. Verify all PRE-compile classes coexist (A.1–A.4 compose) and the
fork linter + spellcheck + completion are all still live in the same buffer (regression
against P51/P54).
**Depends on.** A.1–A.4.

### A.6 — Structured post-compile log → diagnostics (pplatex-class) — P67

**Goal.** REFINE the raw P11 Compile Log: parse the real subprocess log into structured
entries `{line, severity, message, jump-target}` and present a clickable list distinct
from the raw text; clicking an entry jumps the editor to the source line. POST-compile;
P11's raw-log contract is untouched.

**Concrete work.**
- New `src/lib/editor/complog.ts`: a pure `parseCompileLog(raw: string): LogEntry[]`
  (pplatex-class — recognise `file:line: message` / latex `! ...` error blocks /
  `Warning:` lines, classify severity). Pure and unit-testable.
- `App.svelte`: in the Compile Log pane, render `parseCompileLog(log)` as a clickable list
  alongside the raw `log`; clicking an entry calls `editor.goToLine(entry.line)`
  (`EditorPane.svelte:468`). `log` source unchanged (`App.svelte:654`).
- E2E hook: `structuredLog(): LogEntry[]` on `__PPE_E2E__` for the proof.

**Reuse.** the existing `log` state + Compile Log tab (`App.svelte:154`/`:171`); the
existing `editor.goToLine` jump (`EditorPane.svelte:468`); `RenderResult.log`
(`render.rs:46`) read as-is — `render.rs` NOT modified, so P11 stays green.
**Files.** create `src/lib/editor/complog.ts`; edit `App.svelte`.
**Depends on.** nothing (independent of A.1–A.5; can run in parallel).

### A.7 — Optional real-ChkTeX-on-transient-`.tex` (plugin-firewall, GATED) — P68 (HELD)

**Goal.** Optionally run the real ChkTeX binary on the pandoc-EMITTED transient `.tex` and
map diagnostics back to markdown source lines. **HELD / gated** on the `sourcepos`
line-mapping decision (`render-rebuild-plan.md` "Cross-cutting open decisions": the reader
stays `-f markdown`, which forgoes precise `sourcepos`; precise-sourcepos features were
struck from scope 2026-06-16). Until that gate opens, the line-mapping back to markdown is
not reliable, so this is documented as proof DEBT, not built.

**Concrete work (when ungated).** A plugin (per the firewall doctrine, `category` =
diagnostic) that runs `pandoc md→tex` then `chktex` on the transient, maps `.tex` lines →
markdown lines, returns structured diagnostics merged into the gutter. Running an external
binary is explicitly a plugin-firewall candidate (roadmap note).
**Depends on.** the `sourcepos`/scroll-sync reader decision (external to Phase A). **Do not
start until that decision lands.** P68 is RESERVED but HELD; do not RED it yet.

## Proposed proof obligations (P63–P69)

PROPOSALS for user ratification (this plan does NOT edit `proof-obligations.md`). Each is an
exact externally-observable happy-path state, driven by the real app via the
`tauri-plugin-playwright` harness against the shared witness fixture, observing real CM6
`@codemirror/lint` diagnostics and real config. Admissible only if it FAILS on a plausibly
broken app.

- **P63 — Static delimiter & math-mode balance warns before compile.** With a buffer
  containing a real imbalance — e.g. a math line with two `\left` and one `\right`, and a
  separate `$`-opened math zone with no closing `$` — the editor surfaces, via the
  `@codemirror/lint` diagnostics field (observed through the `lintDiagnostics()` hook), at
  least one diagnostic whose marked range covers the surplus `\left`/the unterminated `$`
  and whose message names the imbalance; AND after the user balances them (append the
  missing `\right` and `$`), that diagnostic is gone. NO pandoc/latex process is spawned
  to produce it (the preview render is not the source). **Admissible** because it fails on:
  no app lint source (the diagnostics field has only the fork's `\begin`/`\end` checks, the
  `\left`/`$` imbalance is never marked); a cursor-pair-highlighting-only implementation
  (highlighting shows the pair under the cursor, never a buffer-wide COUNT imbalance, so no
  diagnostic exists); and a stuck linter (the diagnostic persists after the user balances).

- **P64 — Typographic lint fires only when its class is enabled, scoped to math.** With
  `[editor.lint]` enabling the operator-as-variable and sub/superscript-grouping classes,
  a math line containing `sin x` and `x^10` yields diagnostics marking `sin` (→ `\sin`) and
  `x^10` (→ `x^{10}`); the SAME tokens in PROSE (outside `$…$`) yield none; and with those
  classes disabled in config, the math-line diagnostics are absent. **Admissible** because
  it fails on: a missing typographic layer (the math `sin`/`x^10` are never marked); a
  layer that ignores math scope (prose `sin` is wrongly marked); and a layer that ignores
  config (disabling the class in config still marks the tokens — the config is dead).

- **P65 — User-defined regex lint rule surfaces as a diagnostic.** With a config-owned
  `lint_rules` entry `{pattern: "\\bTODO\\b", message: "resolve before submission"}`,
  typing `TODO` into the buffer yields a diagnostic whose range covers `TODO` and whose
  message is exactly `resolve before submission`; pointing config at a DIFFERENT rule set
  (a different pattern/message) makes the buffer surface THAT rule's diagnostic instead.
  **Admissible** because it fails on: no user-regex engine (the config rule is ignored,
  `TODO` is never marked); a hardcoded rule list (a different config rule set produces the
  same diagnostics, proving config is not read); and a message mismatch (the diagnostic's
  message is not the config-declared string).

- **P66 — In-document suppression silences a named lint on its line.** With a buffer line
  that triggers a known lint (e.g. an intentional `x^10` in math), adding the directive
  comment `<!-- ppe-lint-disable-line <ruleId> -->` for that line's rule removes the
  diagnostic on THAT line while the SAME construct on another (un-suppressed) line still
  warns; removing the directive restores the diagnostic. **Admissible** because it fails
  on: no suppression scanner (the directive is inert, the diagnostic persists); an
  over-broad suppression (the directive on one line silences the construct everywhere); and
  a suppression that never restores (removing the directive leaves the line silent).

- **P67 — Structured compile-log entries jump to source.** After a render whose real
  subprocess log contains a line-tagged message, the Compile Log pane presents a structured
  entry (observed via the `structuredLog()` hook) with a parsed `{line, severity, message}`
  matching that log line; activating the entry moves the editor cursor to exactly that
  source line (observed via `cursorOffset()`/`goToLine`). The RAW log (P11) is still
  present and unchanged. **Admissible** because it fails on: a raw-only log (no structured
  entry exists, only the unparsed text — P11's surface); a parse that drops the line number
  (the entry has no jump-target, activation is a no-op); and a jump to the wrong line (the
  cursor lands somewhere other than the parsed line). It does NOT subsume or weaken P11 —
  P11's raw-log assertion runs unchanged alongside this.

- **P68 — RESERVED, HELD.** Real-ChkTeX-on-transient-`.tex` with `.tex`→markdown line
  mapping. HELD pending the `sourcepos`/scroll-sync reader decision; not RED until that
  gate opens. Reserved here so the obligation number is not reused.

- **P69 — RESERVED.** Spare within the Phase-A block (e.g. a buffer-wide diagnostic-count
  status indicator, or a delimiter-imbalance summary in the status cluster) if A.5 is
  promoted from consolidation to a first-class observable. Not specified until needed.

## Verification

End-to-end proof, no shortcuts (mirrors `proof-obligations.md` "Verification vehicle"):

- **Real app on a real display via `tauri-plugin-playwright`.** Each P63–P67 spec lands in
  `tests/proof/` (e.g. `p63-static-lint-balance.spec.ts`), following the established blind-
  TDD pattern (`tests/proof/p55-insertion-bar-amsthm.spec.ts`): drive a stable
  `__PPE_E2E__` hook (NOT synthetic key/click events into CM6's contentEditable, which are
  flaky — the documented reason P52/P53/P55 use hooks), observe a REAL surface.
- **Real diagnostics, not a mirror.** The lint specs observe the live CM6 `@codemirror/lint`
  diagnostics field through `lintDiagnostics()`/`forceLinting` — the SAME field the gutter
  renders — so a passing spec proves the gutter would mark it. A spec that asserted on a
  parallel JS array would be inadmissible (it could pass on a broken gutter); the hook must
  read the editor's actual lint state.
- **Real config drives the rules.** P64/P65 use a hermetic `XDG_CONFIG_HOME` with a real
  `config.toml` carrying `[editor.lint]` / `lint_rules`; flipping the config and re-reading
  proves the config is load-bearing (the "different config → different diagnostics" clause).
- **Real pandoc / real filesystem for the POST path.** P67 runs a real `render_preview`
  (real pandoc subprocess) and parses its REAL `log` — no synthetic log string. The
  jump-target is verified by an independent read of the editor cursor offset after
  activation.
- **No PRE-compile process.** P63 explicitly asserts the diagnostics appear with no
  pandoc/latex spawn (the lint is buffer-only) — the "faster than a compile" guarantee.
- **Regression gate.** P1–P62 and the doctor battery run green throughout; P11's raw-log
  spec runs UNCHANGED to prove A.6 did not mutate `format_log`; P51/P54 prove the new lint
  source composes (completion + spellcheck + fork linter + app linter all live together).

## Sequencing & dependencies

```
A.1 (P63, host: delimiter+math-balance)  ──┐
   └─► A.2 (P64, typographic) ──► A.3 (P65, user-regex) ──► A.4 (P66, suppression) ──► A.5 (consolidate)
A.6 (P67, structured log)  ── independent, parallelizable with A.1–A.5
A.7 (P68) ── HELD on the sourcepos/reader decision; do not RED until that gate opens
```

- A.1 is the foundation: the app-owned `@codemirror/lint` host every PRE-compile class
  contributes into. A.2→A.3→A.4 are strictly ordered (A.4 filters A.1–A.3's output; A.3
  reuses A.2's config plumbing).
- A.6 touches a disjoint seam (the POST-compile log) and can be built in parallel by a
  separate agent without contending on `lint.ts`/`EditorPane.svelte`.
- A.7 is gated and last; it does not block ratifying or shipping A.1–A.6.

## Status / resume here

**Not started — RED obligations P63–P67 pending user ratification.** Design complete;
seams grounded in the real files (CM6 setup at `EditorPane.svelte:147`/`:197`; the existing
fork linter at `vendor/codemirror-lang-latex/src/linter.ts:latexLinter`, already enabled
and already doing `{}`/`\begin`-`\end` balance but NOT `$…$`/`\left`-`\right`/typographic/
user-regex; `@codemirror/lint` already a declared dep, `lintKeymap` already in the keymap;
the POST-compile log at `render.rs:format_log` + `App.svelte:154` Compile Log tab).

**Biggest prerequisite/risk.** Two:
(1) **A.7 is hard-gated** on the unresolved `sourcepos` / preview-reader decision
(reader stays `-f markdown`, precise sourcepos struck 2026-06-16) — the `.tex`→markdown
line mapping the real-ChkTeX path needs does not reliably exist, so P68 is HELD, not built.
(2) **Compose-don't-override discipline:** the app lint source must COEXIST with the fork's
`latexLinter` (two `linter()` extensions, merged diagnostics) — exactly the P51 lesson; a
naive single-linter override would silently drop the fork's `\begin`/`\end` and brace
checks. A.5's regression assertion (P51/P54 + the fork linter all live in one buffer) is
the guard against that.

**Next action.** Ratify P63–P67 with the user, then RED A.1 (`p63` spec: a real imbalance
produces a real `@codemirror/lint` diagnostic; fails because no app lint source exists yet,
only the fork's grammar checks). Commit RED before any GREEN.
